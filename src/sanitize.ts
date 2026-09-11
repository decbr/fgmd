// { html: 'sanitize' }: raw HTML is allowed, but only through an allowlist, and it never reaches
// the output as a string. every html node is split into tags and text, and the tags are folded
// into real element nodes, with whatever markdown sits between them as children, using a stack
// scoped to one list of siblings. so a tag can't stay open past its paragraph or container, a
// stray </div> can't close anything outside the document, and the Svelte component can draw the
// result without {@html}.
import type { Attributes, Element, Node, Root } from './ast.js';
import { ATTRIBUTE, HTMLCOMMENT, TAGNAME, decodeEntities } from './util.js';

type AttributeLists = Readonly<Record<string, readonly string[]>>;

export interface SanitizeOptions {
	// allowed tag names: a list, or a function that edits the defaults
	tags?: readonly string[] | ((defaults: readonly string[]) => readonly string[]);
	// allowed attributes per tag, with '*' for every tag: a map, or a function that edits the
	// defaults. on* handlers and style are never allowed, whatever this says
	attributes?: AttributeLists | ((defaults: AttributeLists) => AttributeLists);
}

export interface SanitizeConfig {
	tags: Set<string>;
	attributes: Map<string, Set<string>>;
}

// roughly what GitHub lets through. no class or id by default: they let a comment dress itself
// up as part of your page's UI, or clobber globals your scripts read
export const SANITIZE_DEFAULTS: { tags: readonly string[]; attributes: AttributeLists } = {
	tags: [
		'a', 'abbr', 'audio', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'cite', 'code', 'col',
		'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1',
		'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'picture',
		'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'source', 'span', 'strong', 'sub',
		'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'track', 'u',
		'ul', 'var', 'video', 'wbr'
	],
	attributes: {
		'*': ['title', 'lang', 'dir'],
		a: ['href'],
		img: ['src', 'alt', 'width', 'height', 'loading'],
		video: ['src', 'poster', 'width', 'height', 'controls', 'muted', 'loop', 'playsinline', 'preload'],
		audio: ['src', 'controls', 'muted', 'loop', 'preload'],
		source: ['src', 'type', 'media'],
		track: ['src', 'kind', 'srclang', 'label', 'default'],
		ol: ['start', 'reversed', 'type'],
		li: ['value'],
		td: ['colspan', 'rowspan', 'align'],
		th: ['colspan', 'rowspan', 'align', 'scope'],
		col: ['span'],
		colgroup: ['span'],
		details: ['open'],
		time: ['datetime'],
		q: ['cite'],
		blockquote: ['cite'],
		del: ['cite', 'datetime'],
		ins: ['cite', 'datetime']
	}
};

// attributes holding a URL. renderers put these through the urlPolicy, like link and image URLs
export const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
	'href', 'src', 'cite', 'poster', 'action', 'formaction', 'background', 'longdesc', 'xlink:href'
]);

export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
	'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'
]);

// dropped together with everything inside them, not just unwrapped
const DROP_CONTENT = new Set([
	'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'svg', 'math',
	'template', 'textarea', 'title', 'noscript', 'noembed', 'noframes', 'xmp', 'plaintext', 'head'
]);

// node types whose children are blocks, where whitespace between tags is just layout
const BLOCK_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition', 'container', 'definitionDescription']);

export function resolveSanitize(options: SanitizeOptions = {}): SanitizeConfig {
	const tags = typeof options.tags === 'function' ? options.tags(SANITIZE_DEFAULTS.tags) : (options.tags ?? SANITIZE_DEFAULTS.tags);
	const attributes =
		typeof options.attributes === 'function'
			? options.attributes(SANITIZE_DEFAULTS.attributes)
			: (options.attributes ?? SANITIZE_DEFAULTS.attributes);
	return {
		tags: new Set(tags.map((t) => t.toLowerCase())),
		attributes: new Map(
			Object.entries(attributes).map(([tag, names]) => [tag.toLowerCase(), new Set(names.map((n) => n.toLowerCase()))])
		)
	};
}

type Token =
	| { kind: 'text'; value: string }
	| { kind: 'open'; name: string; attributes: [string, string | true][]; selfClosing: boolean }
	| { kind: 'close'; name: string };

const reOpen = new RegExp(`<(${TAGNAME})((?:${ATTRIBUTE})*)\\s*(/?)>`, 'y');
const reClose = new RegExp(`</(${TAGNAME})\\s*>`, 'y');
const reOther = new RegExp(`(?:${HTMLCOMMENT})|<[?][\\s\\S]*?[?]>|<![A-Za-z]+[^>]*>|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>`, 'y');
const reAttribute = /\s+([a-zA-Z_:][a-zA-Z0-9:._-]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^"'=<>`\x00-\x20]+))?/g;

function parseAttributes(source: string): [string, string | true][] {
	const out: [string, string | true][] = [];
	for (const m of source.matchAll(reAttribute)) {
		const raw = m[2];
		const value = raw === undefined ? true : decodeEntities(/^["']/.test(raw) ? raw.slice(1, -1) : raw);
		out.push([(m[1] as string).toLowerCase(), value]);
	}
	return out;
}

// splits raw HTML into tags and text. anything that isn't a well-formed tag is text; comments,
// declarations and processing instructions vanish
function tokenize(html: string): Token[] {
	const tokens: Token[] = [];
	let text = '';
	const flush = () => {
		if (text) tokens.push({ kind: 'text', value: decodeEntities(text) });
		text = '';
	};
	let i = 0;
	while (i < html.length) {
		const lt = html.indexOf('<', i);
		if (lt === -1) {
			text += html.slice(i);
			break;
		}
		text += html.slice(i, lt);
		let m: RegExpExecArray | null;
		reOpen.lastIndex = lt;
		if ((m = reOpen.exec(html))) {
			flush();
			tokens.push({
				kind: 'open',
				name: (m[1] as string).toLowerCase(),
				attributes: parseAttributes(m[2] ?? ''),
				selfClosing: m[3] === '/'
			});
			i = reOpen.lastIndex;
			continue;
		}
		reClose.lastIndex = lt;
		if ((m = reClose.exec(html))) {
			flush();
			tokens.push({ kind: 'close', name: (m[1] as string).toLowerCase() });
			i = reClose.lastIndex;
			continue;
		}
		reOther.lastIndex = lt;
		if (reOther.exec(html)) {
			flush();
			i = reOther.lastIndex;
			continue;
		}
		text += '<';
		i = lt + 1;
	}
	flush();
	return tokens;
}

function filterAttributes(tag: string, attributes: [string, string | true][], config: SanitizeConfig): Attributes {
	const forTag = config.attributes.get(tag);
	const global = config.attributes.get('*');
	const out: Attributes = {};
	for (const [name, value] of attributes) {
		if (name.startsWith('on') || name === 'style') continue;
		if (!(forTag?.has(name) || global?.has(name))) continue;
		// the first of a repeated attribute wins, as in a browser
		if (Object.hasOwn(out, name)) continue;
		out[name] = value;
	}
	return out;
}

interface Frame {
	name: string;
	// the element this tag became, or null when the tag itself was dropped
	element: Element | null;
	// a tag whose content is dropped too
	drop: boolean;
}

// hostile input can't nest elements deeper than this (deeper tags are unwrapped), nor keep more
// tags open than MAX_OPEN_TAGS (further ones are ignored), so rendering can't overflow the stack
// and closing tags can't turn into a quadratic search
const MAX_ELEMENT_DEPTH = 100;
const MAX_OPEN_TAGS = 1000;

function foldChildren(node: Node, config: SanitizeConfig): void {
	if (!('children' in node)) return;
	(node as { children: Node[] }).children = foldList(node.children as Node[], config, BLOCK_PARENTS.has(node.type));
}

function foldList(nodes: Node[], config: SanitizeConfig, block: boolean): Node[] {
	const out: Node[] = [];
	const stack: Frame[] = [];
	// the open elements, innermost last: what new content goes into
	const elements: Element[] = [];
	// how many open tags drop their content
	let dropping = 0;

	const target = (): Node[] => (elements.length > 0 ? ((elements[elements.length - 1] as Element).children as Node[]) : out);
	const push = (frame: Frame) => {
		stack.push(frame);
		if (frame.element) elements.push(frame.element);
		if (frame.drop) dropping++;
	};
	const popTo = (depth: number) => {
		while (stack.length > depth) {
			const frame = stack.pop() as Frame;
			if (frame.element) elements.pop();
			if (frame.drop) dropping--;
		}
	};

	for (const node of nodes) {
		if (node.type !== 'html') {
			if (dropping > 0) continue;
			foldChildren(node, config);
			target().push(node);
			continue;
		}

		for (const token of tokenize(node.value)) {
			if (token.kind === 'text') {
				if (dropping > 0) continue;
				const into = target();
				// whitespace between block-level tags is layout, not content
				if (!/\S/.test(token.value) && block && into === out) continue;
				into.push({ type: 'text', value: token.value });
			} else if (token.kind === 'open') {
				const isVoid = VOID_ELEMENTS.has(token.name) || token.selfClosing;
				if (stack.length >= MAX_OPEN_TAGS) continue;
				if (DROP_CONTENT.has(token.name)) {
					if (!isVoid) push({ name: token.name, element: null, drop: true });
				} else if (config.tags.has(token.name) && dropping === 0 && elements.length < MAX_ELEMENT_DEPTH) {
					const element: Element = {
						type: 'element',
						tagName: token.name,
						properties: filterAttributes(token.name, token.attributes, config),
						children: []
					};
					target().push(element);
					if (!isVoid && !VOID_ELEMENTS.has(token.name)) push({ name: token.name, element, drop: false });
				} else if (!isVoid) {
					// not allowed (or too deep): the tag goes, what's inside it stays
					push({ name: token.name, element: null, drop: false });
				}
			} else {
				// closes the innermost open tag of that name, and anything opened inside it.
				// a close tag with nothing to close is ignored
				for (let i = stack.length - 1; i >= 0; i--) {
					if ((stack[i] as Frame).name === token.name) {
						popTo(i);
						break;
					}
				}
			}
		}
	}
	return out;
}

export function sanitizeTree(root: Root, config: SanitizeConfig): Root {
	return { ...root, children: foldList(root.children, config, true) as Root['children'] };
}
