// helpers both renderers (HTML string and Svelte) use, so their output agrees. describe() is the
// heart of it: for any node it decides the element name and the final attributes, so the two
// renderers only differ in how they write the markup down.
import type {
	Attributes,
	BlockContent,
	Container,
	Data,
	Element,
	FootnoteDefinition,
	FootnoteReference,
	Heading,
	Image,
	Node,
	Paragraph,
	PhrasingContent,
	Root
} from './ast.js';
import { toString } from './inline.js';
import { resolveUrl, type Classes, type ClassKey, type RenderOptions } from './options.js';
import { URL_ATTRIBUTES } from './sanitize.js';
import { escapeHtml, normalizeUrl } from './util.js';

export interface FootnoteEntry {
	definition: FootnoteDefinition;
	// display number, in order of first reference
	number: number;
	// how many times it's referenced
	references: number;
}

export interface FootnoteIndex {
	entries: FootnoteEntry[];
	// the number and occurrence (1-based) of every reference that points at a definition
	references: Map<FootnoteReference, { entry: FootnoteEntry; occurrence: number }>;
}

// numbers footnotes in the order they're first referenced. definitions nobody references are
// left out, as on GitHub. references inside footnotes count too, after the main text.
export function indexFootnotes(root: Root | readonly Node[]): FootnoteIndex {
	const definitions = new Map<string, FootnoteDefinition>();
	const entries: FootnoteEntry[] = [];
	const byIdentifier = new Map<string, FootnoteEntry>();
	const references: FootnoteIndex['references'] = new Map();

	const collect = (node: Node) => {
		if (node.type === 'footnoteDefinition' && !definitions.has(node.identifier)) {
			definitions.set(node.identifier, node);
		}
		if ('children' in node) for (const child of node.children) collect(child as Node);
	};

	const walk = (node: Node) => {
		if (node.type === 'footnoteDefinition') return;
		if (node.type === 'footnoteReference') {
			const definition = definitions.get(node.identifier);
			if (!definition) return;
			let entry = byIdentifier.get(node.identifier);
			if (!entry) {
				entry = { definition, number: entries.length + 1, references: 0 };
				entries.push(entry);
				byIdentifier.set(node.identifier, entry);
			}
			entry.references += 1;
			references.set(node, { entry, occurrence: entry.references });
			return;
		}
		if ('children' in node) for (const child of node.children) walk(child as Node);
	};

	const nodes: readonly Node[] = Array.isArray(root) ? root : [root as Root];
	nodes.forEach(collect);
	if (definitions.size === 0) return { entries, references };
	nodes.forEach(walk);
	// footnotes can reference other footnotes; entries grows while this runs
	for (let i = 0; i < entries.length; i++) {
		for (const child of (entries[i] as FootnoteEntry).definition.children) walk(child);
	}
	return { entries, references };
}

// github-slugger's rules: lowercase, drop punctuation, spaces become hyphens, repeats get -1, -2...
export function createSlugger(): (text: string) => string {
	const seen = new Map<string, number>();
	return (text) => {
		let slug = text
			.toLowerCase()
			.trim()
			.replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
			.replace(/ /g, '-');
		if (slug === '') slug = 'section';
		let result = slug;
		while (seen.has(result)) {
			const count = (seen.get(slug) ?? 0) + 1;
			seen.set(slug, count);
			result = `${slug}-${count}`;
		}
		seen.set(result, 0);
		return result;
	};
}

// ids for every heading, slugged in the order they render: the document first, then footnotes.
// a heading that already has an id (from the attributes plugin, say) keeps it
export function computeHeadingIds(nodes: readonly Node[], footnotes: FootnoteIndex, prefix: string): Map<Heading, string> {
	const slug = createSlugger();
	const ids = new Map<Heading, string>();
	const walk = (node: Node) => {
		if (node.type === 'footnoteDefinition') return;
		if (node.type === 'heading') {
			const own = node.data?.hProperties?.id;
			ids.set(node, typeof own === 'string' ? own : prefix + slug(toString(node.children)));
		}
		if ('children' in node) for (const child of node.children) walk(child as Node);
	};
	nodes.forEach(walk);
	for (const entry of footnotes.entries) entry.definition.children.forEach(walk);
	return ids;
}

export function wantsHeadingIds(options: RenderOptions): boolean {
	return Boolean(options.headingIds || options.headingAnchors);
}

// --- paragraphs that render specially

function isImageLike(node: PhrasingContent): boolean {
	if (node.type === 'image') return true;
	if (node.type === 'link') return node.children.length > 0 && node.children.every(isImageLikeOrSpace);
	return false;
}

function isImageLikeOrSpace(node: PhrasingContent): boolean {
	return isImageLike(node) || (node.type === 'text' && !/\S/.test(node.value));
}

// a paragraph made only of images (or linked images), raw inline HTML and whitespace, with at
// least one image. unwrapImages emits these without the <p>.
export function isImageOnly(paragraph: Paragraph): boolean {
	let image = false;
	for (const child of paragraph.children) {
		if (isImageLike(child)) image = true;
		else if (child.type === 'html' || child.type === 'element' || child.type === 'break') continue;
		else if (child.type === 'text' && !/\S/.test(child.value)) continue;
		else return false;
	}
	return image;
}

// the image in a paragraph that is just one titled image: { figures } makes it a <figure>
export function figureImage(paragraph: Paragraph): Image | null {
	let image: Image | null = null;
	for (const child of paragraph.children) {
		if (child.type === 'image' && image === null) image = child;
		else if (child.type === 'text' && !/\S/.test(child.value)) continue;
		else return null;
	}
	return image?.title ? image : null;
}

// a raw <br> tag. with { breaks }, a newline straight after one isn't turned into a second break:
// whoever typed "line<br>" and then pressed enter wanted one line break, not two
export function isRawBreak(node: PhrasingContent | undefined): boolean {
	if (node?.type === 'element') return node.tagName === 'br';
	return node?.type === 'html' && /^<br\s*\/?>$/i.test(node.value);
}

// splits text on its newlines for { breaks }, marking which newlines become <br>
export function breakLines(value: string, previous: PhrasingContent | undefined): { text: string; br: boolean }[] {
	const skipFirst = isRawBreak(previous) && value.startsWith('\n');
	return value.split('\n').map((text, i) => ({ text, br: i > 0 && !(i === 1 && skipFirst) }));
}

// --- attributes

// joins class strings, skipping empties
export function cx(...parts: (string | null | undefined | false)[]): string | undefined {
	const joined = parts.filter(Boolean).join(' ');
	return joined || undefined;
}

export function classFor(classes: Classes | undefined, key: ClassKey | string): string | undefined {
	return classes?.[key] || undefined;
}

export function attributeString(attributes: Attributes): string {
	let out = '';
	for (const [name, value] of Object.entries(attributes)) {
		if (value === false || value === null || value === undefined) continue;
		out += value === true ? ` ${name}` : ` ${name}="${escapeHtml(String(value))}"`;
	}
	return out;
}

// an element's final attributes: fgmd's own, then the node's data.hProperties (except the
// protected ones, e.g. a link's policy-checked href), with the classes option, fgmd's class and
// hProperties' class all joined
export function elementAttributes(
	tag: string,
	base: Attributes,
	node: { data?: Data } | null,
	classes: Classes | undefined,
	protect: readonly string[] = []
): Attributes {
	const props = node?.data?.hProperties;
	const out: Attributes = { ...base };
	if (props) {
		for (const [name, value] of Object.entries(props)) {
			if (name !== 'class' && !protect.includes(name)) out[name] = value;
		}
	}
	const cls = cx(classFor(classes, tag), base.class as string | undefined, props?.class as string | undefined);
	if (cls !== undefined || 'class' in out) out.class = cls;
	return out;
}

// a sanitised or plugin-made element's properties, with URL-valued ones checked by the urlPolicy
export function elementProperties(node: Element, options: RenderOptions): Attributes {
	const out: Attributes = {};
	for (const [name, value] of Object.entries(node.properties)) {
		if (URL_ATTRIBUTES.has(name) && typeof value === 'string') {
			const url = resolveUrl(value, name === 'src' || name === 'poster' ? 'image' : 'link', options);
			if (url === null) continue;
			out[name] = url;
		} else {
			out[name] = value;
		}
	}
	return out;
}

export interface Described {
	tag: string;
	attributes: Attributes;
}

// the element a node renders as and its attributes, or null for nodes that don't render as one
// element of their own (text, breaks, rejected links and images, html strings...)
export function describe(node: Node, options: RenderOptions, headingIds: ReadonlyMap<Heading, string>): Described | null {
	const classes = options.classes;
	const name = (fallback: string) => node.data?.hName ?? fallback;
	const element = (fallback: string, base: Attributes = {}, protect?: readonly string[]): Described => {
		const tag = name(fallback);
		return { tag, attributes: elementAttributes(tag, base, node, classes, protect) };
	};

	switch (node.type) {
		case 'paragraph':
			return element('p');
		case 'heading':
			return element(`h${node.depth}`, { id: headingIds.get(node) });
		case 'blockquote':
			return element('blockquote');
		case 'list':
			return element(node.ordered ? 'ol' : 'ul', {
				start: node.ordered && node.start !== null && node.start !== 1 ? node.start : undefined
			});
		case 'listItem':
			return element('li');
		case 'thematicBreak':
			return element('hr');
		case 'code':
			// the <pre>; the <code> inside only carries the language class
			return element('pre');
		case 'table':
			return element('table');
		case 'tableRow':
			return element('tr');
		case 'emphasis':
			return element('em');
		case 'strong':
			return element('strong');
		case 'delete':
			return element('del');
		case 'mark':
			return element('mark');
		case 'superscript':
			return element('sup');
		case 'subscript':
			return element('sub');
		case 'inlineCode':
			return element('code');
		case 'abbr':
			return element('abbr', { title: node.title });
		case 'definitionList':
			return element('dl');
		case 'definitionTerm':
			return element('dt');
		case 'definitionDescription':
			return element('dd');
		case 'math':
			return element('div', { class: 'math math-display' });
		case 'inlineMath':
			return element('span', { class: node.display ? 'math math-display' : 'math math-inline' });
		case 'container':
			return describeContainer(node, options);
		case 'link': {
			const href = resolveUrl(node.url, 'link', options);
			if (href === null) return null;
			const extra = options.linkAttrs?.(href) ?? {};
			return element('a', { href, title: node.title ?? undefined, ...extra }, ['href']);
		}
		case 'image': {
			const src = resolveUrl(node.url, 'image', options);
			if (src === null) return null;
			return element(
				'img',
				{ src, alt: node.alt, title: node.title ?? undefined, loading: options.lazyImages ? 'lazy' : undefined },
				['src']
			);
		}
		case 'element':
			return { tag: node.tagName, attributes: elementAttributes(node.tagName, elementProperties(node, options), node, classes) };
		case 'root':
		case 'text':
		case 'break':
		case 'html':
		case 'tableCell':
		case 'footnoteReference':
		case 'footnoteDefinition':
		case 'yaml':
			return null;
		default: {
			// a node type from a plugin: drawn as its hName, if it has one
			const hName = (node as Node).data?.hName;
			return hName ? { tag: hName, attributes: elementAttributes(hName, {}, node as Node, classes) } : null;
		}
	}
}

// --- containers

export interface ContainerView extends Described {
	// the title's element: <summary> for a collapsible container, otherwise <p>
	titleTag: string;
	titleAttributes: Attributes;
	// a collapsible container without a title still needs a summary: its name, capitalised
	fallbackTitle: string | null;
}

function describeContainer(node: Container, options: RenderOptions): ContainerView {
	const collapsible = node.collapsible !== null;
	const tag = node.data?.hName ?? (collapsible ? 'details' : 'div');
	// the container's name is its class, unless the node brings its own
	const base: Attributes = {
		class: node.data?.hProperties?.class ? undefined : node.name,
		open: node.collapsible === 'open' ? true : undefined
	};
	const titleTag = collapsible ? 'summary' : 'p';
	const titleClass = collapsible ? undefined : ((node.data?.titleClass as string | undefined) ?? 'container-title');
	return {
		tag,
		attributes: elementAttributes(tag, base, node, options.classes),
		titleTag,
		titleAttributes: { class: cx(classFor(options.classes, titleTag), titleClass) },
		fallbackTitle: collapsible && !node.title ? node.name.charAt(0).toUpperCase() + node.name.slice(1) : null
	};
}

export function containerView(node: Container, options: RenderOptions): ContainerView {
	return describeContainer(node, options);
}

// --- heading anchors

export interface AnchorConfig {
	position: 'before' | 'after' | 'wrap';
	symbol: string;
	className: string;
	label: string;
}

export function anchorConfig(options: RenderOptions): AnchorConfig | null {
	const anchors = options.headingAnchors;
	if (!anchors) return null;
	const config = anchors === true ? {} : anchors;
	return {
		position: config.position ?? 'before',
		symbol: config.symbol ?? '#',
		className: config.className ?? 'anchor',
		label: config.label ?? 'Link to this section'
	};
}

export function anchorAttributes(config: AnchorConfig, id: string, heading: Heading): Attributes {
	return {
		class: config.className,
		href: `#${normalizeUrl(id)}`,
		'aria-label': config.position === 'wrap' ? undefined : `${config.label}: ${toString(heading.children)}`
	};
}

// --- footnotes

export interface FootnoteConfig {
	style: 'section' | 'details' | 'sidenote';
	heading: string | null;
	backref: string;
	backrefLabel: string;
}

export function footnoteConfig(options: RenderOptions): FootnoteConfig {
	const f = options.footnotes ?? {};
	return {
		style: f.style ?? 'section',
		heading: f.heading ?? null,
		backref: f.backref ?? '↩',
		backrefLabel: f.backrefLabel ?? 'Back to reference {n}'
	};
}

export function footnoteIds(identifier: string, occurrence: number, prefix: string) {
	const suffix = occurrence > 1 ? `-${occurrence}` : '';
	return {
		definition: `${prefix}fn-${identifier}`,
		reference: `${prefix}fnref-${identifier}${suffix}`
	};
}

// "1" for the first reference to footnote 1, "1-2" for the second
export function backrefIndex(entry: FootnoteEntry, occurrence: number): string {
	return occurrence > 1 ? `${entry.number}-${occurrence}` : `${entry.number}`;
}

// a footnote that can sit inline as a sidenote: exactly one paragraph
export function isSidenote(definition: FootnoteDefinition, config: FootnoteConfig): boolean {
	return config.style === 'sidenote' && definition.children.length === 1 && definition.children[0]?.type === 'paragraph';
}

// for details-style footnotes: a definition whose first paragraph opens with **Title** gives that
// title to the <summary>, and the rest of the paragraph (if any) stays in the body
export function splitFootnoteTitle(definition: FootnoteDefinition): { title: PhrasingContent[] | null; body: BlockContent[] } {
	const [first, ...rest] = definition.children;
	if (first?.type !== 'paragraph' || first.children[0]?.type !== 'strong') {
		return { title: null, body: definition.children };
	}
	const [strong, ...after] = first.children;
	const remaining = [...after];
	const lead = remaining[0];
	if (lead?.type === 'text') {
		const trimmed = lead.value.replace(/^\s+/, '');
		if (trimmed) remaining[0] = { ...lead, value: trimmed };
		else remaining.shift();
	}
	const body: BlockContent[] = remaining.length > 0 ? [{ ...first, children: remaining }, ...rest] : rest;
	return { title: (strong as { children: PhrasingContent[] }).children, body };
}

// --- mixed content

// node types that are blocks; anything else in a children list is phrasing
const BLOCK_TYPES = new Set([
	'paragraph', 'heading', 'thematicBreak', 'blockquote', 'list', 'code', 'table', 'footnoteDefinition',
	'container', 'math', 'definitionList', 'yaml'
]);

export function isBlock(node: Node): boolean {
	return BLOCK_TYPES.has(node.type);
}

export type { BlockContent };
