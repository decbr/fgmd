// AST -> HTML string. with default options the output format (newlines, <br />, attribute order)
// matches the reference implementations, so the official spec examples compare byte for byte.
// which element each node becomes, and with what attributes, is decided by describe() in
// shared.ts, which the Svelte component uses too.
import type { Container, DefinitionList, Element, Heading, ListItem, Node, Paragraph, PhrasingContent, Root, Table } from './ast.js';
import { resolvePlugins } from './plugin.js';
import type { Attributes, RenderContext, RenderOptions } from './options.js';
import { VOID_ELEMENTS } from './sanitize.js';
import {
	anchorAttributes,
	anchorConfig,
	attributeString,
	backrefIndex,
	breakLines,
	classFor,
	computeHeadingIds,
	containerView,
	cx,
	describe,
	elementAttributes,
	figureImage,
	footnoteConfig,
	footnoteIds,
	indexFootnotes,
	isBlock,
	isImageOnly,
	isSidenote,
	splitFootnoteTitle,
	wantsHeadingIds,
	type AnchorConfig,
	type FootnoteConfig,
	type FootnoteEntry,
	type FootnoteIndex
} from './shared.js';
import { escapeHtml, normalizeUrl } from './util.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RendererFn = (node: any, context: RenderContext) => string | undefined;

// node types whose children are a line of text rather than blocks
const PHRASING_PARENTS = new Set([
	'paragraph', 'heading', 'emphasis', 'strong', 'delete', 'link', 'mark', 'superscript', 'subscript',
	'abbr', 'tableCell', 'definitionTerm'
]);

class HtmlRenderer {
	private buffer = '';
	private lastOut = '\n';
	private readonly footnotes: FootnoteIndex;
	private readonly headingIds: Map<Heading, string>;
	private readonly prefix: string;
	private readonly anchors: AnchorConfig | null;
	private readonly notes: FootnoteConfig;
	private readonly renderers = new Map<string, RendererFn>();
	// checkbox markup waiting to be written at the start of a task item's first paragraph
	private pendingCheckbox = '';
	// inside an unwrapped image paragraph, line breaks stay plain newlines
	private unwrapped = false;
	// the sibling rendered just before the current inline node
	private previousInline: PhrasingContent | undefined;
	// whether the node being rendered sits among blocks, or inside a line of text. decides how
	// raw HTML, elements and plugin nodes are laid out
	private blockContext = true;

	constructor(
		private readonly options: RenderOptions,
		nodes: readonly Node[]
	) {
		this.footnotes = indexFootnotes(nodes);
		this.prefix = options.idPrefix ?? '';
		this.headingIds = wantsHeadingIds(options) ? computeHeadingIds(nodes, this.footnotes, this.prefix) : new Map();
		this.anchors = anchorConfig(options);
		this.notes = footnoteConfig(options);
		// plugins' renderers first, so your own override them
		for (const plugin of resolvePlugins(options.plugins)) {
			for (const [type, fn] of Object.entries(plugin.renderers ?? {})) if (fn) this.renderers.set(type, fn);
		}
		for (const [type, fn] of Object.entries(options.renderers ?? {})) if (fn) this.renderers.set(type, fn as RendererFn);
	}

	render(nodes: readonly Node[], inline: boolean): string {
		if (inline) this.inlines(nodes);
		else this.blocks(nodes, false);
		this.footnoteSection();
		return this.buffer;
	}

	// --- output primitives

	private lit(s: string): void {
		this.buffer += s;
		this.lastOut = s;
	}

	private cr(): void {
		if (this.lastOut !== '\n') this.lit('\n');
	}

	private open(tag: string, attributes: Attributes, selfClosing = false): void {
		this.lit(`<${tag}${attributeString(attributes)}${selfClosing ? ' />' : '>'}`);
	}

	private close(tag: string): void {
		this.lit(`</${tag}>`);
	}

	// renders into a separate string, for renderer contexts
	private capture(fn: () => void): string {
		const saved = [this.buffer, this.lastOut] as const;
		this.buffer = '';
		this.lastOut = '\n';
		fn();
		const out = this.buffer;
		[this.buffer, this.lastOut] = saved;
		return out;
	}

	// --- lists of nodes

	private blocks(nodes: readonly Node[], tight: boolean): void {
		const saved = this.blockContext;
		this.blockContext = true;
		for (const node of nodes) this.node(node, tight);
		this.blockContext = saved;
	}

	private inlines(nodes: readonly Node[]): void {
		const saved = this.blockContext;
		this.blockContext = false;
		nodes.forEach((node, i) => {
			this.previousInline = nodes[i - 1] as PhrasingContent | undefined;
			this.node(node, false);
		});
		this.blockContext = saved;
	}

	private childrenOf(node: Node, tight: boolean): void {
		if (!('children' in node)) return;
		const children = node.children as Node[];
		if (PHRASING_PARENTS.has(node.type) || (!this.blockContext && !isBlock(node))) this.inlines(children);
		else this.blocks(children, tight);
	}

	// --- dispatch

	private node(node: Node, tight: boolean): void {
		const override = this.renderers.get(node.type);
		if (override) {
			const out = override(node, this.contextFor(node, tight));
			if (out !== undefined) {
				this.lit(out);
				// an override that ends its block with a newline shouldn't get a second one
				if (out.endsWith('\n')) this.lastOut = '\n';
				return;
			}
		}
		this.renderDefault(node, tight);
	}

	private contextFor(node: Node, tight: boolean): RenderContext {
		const blockContext = this.blockContext;
		return {
			options: this.options,
			render: (target) =>
				this.capture(() => {
					const list: readonly Node[] = Array.isArray(target) ? target : [target as Node];
					if (blockContext) this.blocks(list, false);
					else this.inlines(list);
				}),
			children: () => this.capture(() => this.childrenOf(node, tight)),
			attributes: describe(node, this.options, this.headingIds)?.attributes ?? {},
			default: () => this.capture(() => this.renderDefault(node, tight))
		};
	}

	private renderDefault(node: Node, tight: boolean): void {
		switch (node.type) {
			case 'root':
				return this.blocks(node.children, false);
			case 'paragraph':
				return this.paragraph(node, tight);
			case 'heading':
				return this.heading(node);
			case 'thematicBreak': {
				const d = describe(node, this.options, this.headingIds);
				this.cr();
				if (d) this.open(d.tag, d.attributes, true);
				this.cr();
				return;
			}
			case 'blockquote':
			case 'math':
			case 'definitionList':
				return this.wrapBlock(node);
			case 'list': {
				const d = describe(node, this.options, this.headingIds);
				if (!d) return;
				this.cr();
				this.open(d.tag, d.attributes);
				this.cr();
				for (const item of node.children) this.node(item, !node.spread);
				this.cr();
				this.close(d.tag);
				this.cr();
				return;
			}
			case 'listItem':
				return this.listItem(node, tight);
			case 'code':
				return this.codeBlock(node);
			case 'html':
				if (this.blockContext) {
					this.cr();
					this.lit(node.value);
					this.cr();
				} else {
					this.lit(node.value);
				}
				return;
			case 'table':
				return this.table(node);
			case 'container':
				return this.container(node);
			case 'element':
				return this.element(node);
			case 'footnoteDefinition':
				// collected into the footnote section at the end
				return;
			case 'yaml':
				// frontmatter: metadata, not content
				return;
			case 'text':
				return this.text(node.value);
			case 'break':
				this.open('br', {}, true);
				this.cr();
				return;
			case 'inlineCode':
			case 'inlineMath': {
				const d = describe(node, this.options, this.headingIds);
				if (!d) return;
				this.open(d.tag, d.attributes);
				this.lit(escapeHtml(node.value));
				this.close(d.tag);
				return;
			}
			case 'link': {
				const d = describe(node, this.options, this.headingIds);
				// a rejected URL degrades to its label
				if (!d) return this.inlines(node.children);
				this.open(d.tag, d.attributes);
				this.inlines(node.children);
				this.close(d.tag);
				return;
			}
			case 'image': {
				const d = describe(node, this.options, this.headingIds);
				if (!d) return this.lit(escapeHtml(node.alt));
				this.open(d.tag, d.attributes, true);
				return;
			}
			case 'footnoteReference':
				return this.footnoteReference(node);
			default:
				return this.generic(node, tight);
		}
	}

	// emphasis, strong, mark, sup, sub, abbr, and anything a plugin names with data.hName
	private generic(node: Node, tight: boolean): void {
		const d = describe(node, this.options, this.headingIds);
		const block = this.blockContext && isBlock(node);
		if (d) {
			if (block) this.cr();
			this.open(d.tag, d.attributes);
		}
		if ('children' in node) this.childrenOf(node, tight);
		else if ('value' in node && typeof node.value === 'string') this.lit(escapeHtml(node.value));
		if (d) {
			this.close(d.tag);
			if (block) this.cr();
		}
	}

	// blockquote, display math, definition lists: an element on its own lines around its content
	private wrapBlock(node: Node): void {
		const d = describe(node, this.options, this.headingIds);
		if (!d) return;
		this.cr();
		this.open(d.tag, d.attributes);
		if (node.type === 'math') {
			this.lit(escapeHtml(node.value));
		} else {
			this.cr();
			if (node.type === 'definitionList') this.definitionItems(node);
			else if ('children' in node) this.blocks(node.children as Node[], false);
			this.cr();
		}
		this.close(d.tag);
		this.cr();
	}

	// --- blocks

	private paragraph(node: Paragraph, tight: boolean): void {
		const checkbox = this.pendingCheckbox;
		this.pendingCheckbox = '';

		const image = this.options.figures ? figureImage(node) : null;
		const img = image ? describe(image, this.options, this.headingIds) : null;
		if (image && img) {
			this.cr();
			this.lit(checkbox);
			this.open('figure', elementAttributes('figure', {}, node, this.options.classes));
			this.cr();
			this.open(img.tag, { ...img.attributes, title: undefined }, true);
			this.cr();
			this.open('figcaption', elementAttributes('figcaption', {}, null, this.options.classes));
			this.lit(escapeHtml(image.title as string));
			this.close('figcaption');
			this.cr();
			this.close('figure');
			this.cr();
			return;
		}

		if (this.options.unwrapImages && isImageOnly(node)) {
			this.cr();
			this.lit(checkbox);
			this.unwrapped = true;
			this.inlines(node.children);
			this.unwrapped = false;
			this.cr();
			return;
		}
		if (tight) {
			this.lit(checkbox);
			this.inlines(node.children);
			return;
		}
		const d = describe(node, this.options, this.headingIds);
		if (!d) return;
		this.cr();
		this.open(d.tag, d.attributes);
		this.lit(checkbox);
		this.inlines(node.children);
		this.close(d.tag);
		this.cr();
	}

	private heading(node: Heading): void {
		const d = describe(node, this.options, this.headingIds);
		if (!d) return;
		const id = this.headingIds.get(node);
		const anchor = this.anchors && id ? this.anchors : null;
		const link = anchor && id ? `<a${attributeString(anchorAttributes(anchor, id, node))}>` : '';

		this.cr();
		this.open(d.tag, d.attributes);
		if (anchor?.position === 'before') this.lit(`${link}${escapeHtml(anchor.symbol)}</a>`);
		if (anchor?.position === 'wrap') this.lit(link);
		this.inlines(node.children);
		if (anchor?.position === 'wrap') this.lit('</a>');
		if (anchor?.position === 'after') this.lit(` ${link}${escapeHtml(anchor.symbol)}</a>`);
		this.close(d.tag);
		this.cr();
	}

	private listItem(item: ListItem, tight: boolean): void {
		const d = describe(item, this.options, this.headingIds);
		if (!d) return;
		this.open(d.tag, d.attributes);
		if (item.checked !== null) {
			const checkbox = `<input${attributeString({
				checked: item.checked ? '' : undefined,
				disabled: '',
				type: 'checkbox',
				class: classFor(this.options.classes, 'input')
			})}> `;
			if (item.children[0]?.type === 'paragraph') this.pendingCheckbox = checkbox;
			else this.lit(checkbox);
		}
		this.blocks(item.children, tight);
		this.pendingCheckbox = '';
		this.close(d.tag);
		this.cr();
	}

	private codeBlock(node: Extract<Node, { type: 'code' }>): void {
		const d = describe(node, this.options, this.headingIds);
		if (!d) return;
		const highlighted = this.options.highlight?.(node.value, node.lang, node.meta);
		this.cr();
		if (highlighted && /^\s*<pre[\s>]/i.test(highlighted)) {
			// a highlighter that builds the whole block (shiki does)
			this.lit(highlighted.trim());
		} else {
			this.open(d.tag, d.attributes);
			this.open('code', { class: node.lang ? `language-${node.lang}` : undefined });
			this.lit(highlighted || escapeHtml(node.value));
			this.close('code');
			this.close(d.tag);
		}
		this.cr();
	}

	private table(node: Table): void {
		const wrapper = this.options.tableWrapperClass;
		const d = describe(node, this.options, this.headingIds);
		if (!d) return;
		if (wrapper) {
			this.cr();
			this.lit(`<div class="${escapeHtml(wrapper)}">`);
		}
		this.cr();
		this.open(d.tag, d.attributes);
		this.cr();
		const [head, ...body] = node.children;
		const row = (tr: Table['children'][number], cell: 'th' | 'td') => {
			const r = describe(tr, this.options, this.headingIds);
			if (!r) return;
			this.open(r.tag, r.attributes);
			this.cr();
			tr.children.forEach((c, i) => {
				this.open(cell, elementAttributes(cell, { align: node.align[i] ?? undefined }, c, this.options.classes));
				this.inlines(c.children);
				this.close(cell);
				this.cr();
			});
			this.close(r.tag);
			this.cr();
		};
		if (head) {
			this.open('thead', elementAttributes('thead', {}, null, this.options.classes));
			this.cr();
			row(head, 'th');
			this.close('thead');
			this.cr();
		}
		if (body.length > 0) {
			this.open('tbody', elementAttributes('tbody', {}, null, this.options.classes));
			this.cr();
			for (const r of body) row(r, 'td');
			this.close('tbody');
			this.cr();
		}
		this.close(d.tag);
		this.cr();
		if (wrapper) {
			this.lit('</div>');
			this.cr();
		}
	}

	private definitionItems(node: DefinitionList): void {
		for (const child of node.children) {
			const d = describe(child, this.options, this.headingIds);
			if (!d) continue;
			this.open(d.tag, d.attributes);
			if (child.type === 'definitionTerm') this.inlines(child.children);
			else this.blocks(child.children, !child.spread);
			this.close(d.tag);
			this.cr();
		}
	}

	private container(node: Container): void {
		const view = containerView(node, this.options);
		this.cr();
		this.open(view.tag, view.attributes);
		this.cr();
		if (node.title || view.fallbackTitle) {
			this.open(view.titleTag, view.titleAttributes);
			if (node.title) this.inlines(node.title);
			else this.lit(escapeHtml(view.fallbackTitle as string));
			this.close(view.titleTag);
			this.cr();
		}
		this.blocks(node.children, false);
		this.cr();
		this.close(view.tag);
		this.cr();
	}

	// an element from sanitised HTML (or a plugin): drawn as real markup, never as a string
	private element(node: Element): void {
		const d = describe(node, this.options, this.headingIds);
		if (!d) return;
		const block = this.blockContext;
		const isVoid = VOID_ELEMENTS.has(d.tag);
		if (block) this.cr();
		this.open(d.tag, d.attributes, isVoid);
		if (!isVoid) {
			if (block) this.blocks(node.children, false);
			else this.inlines(node.children);
			this.close(d.tag);
		}
		if (block) this.cr();
	}

	// --- inline

	private text(value: string): void {
		if (this.blockContext) {
			// loose text among blocks: only sanitised HTML makes this
			this.lit(escapeHtml(value));
			return;
		}
		if (!this.options.breaks || this.unwrapped) {
			this.lit(escapeHtml(value));
			return;
		}
		const parts = breakLines(value, this.previousInline);
		this.lit(parts.map((p, i) => (i === 0 ? '' : p.br ? '<br />\n' : '\n') + escapeHtml(p.text)).join(''));
	}

	private footnoteReference(node: Extract<Node, { type: 'footnoteReference' }>): void {
		const ref = this.footnotes.references.get(node);
		if (!ref) {
			this.lit(escapeHtml(`[^${node.label}]`));
			return;
		}
		const ids = footnoteIds(node.identifier, ref.occurrence, this.prefix);
		const sidenote = ref.occurrence === 1 && isSidenote(ref.entry.definition, this.notes);
		this.lit(
			`<sup${attributeString({ class: cx('footnote-ref', sidenote && 'sidenote-ref', classFor(this.options.classes, 'sup')) })}>` +
				`<a href="#${escapeHtml(normalizeUrl(ids.definition))}" id="${escapeHtml(ids.reference)}" data-footnote-ref>${ref.entry.number}</a></sup>`
		);
		if (sidenote) {
			const paragraph = ref.entry.definition.children[0] as Paragraph;
			this.lit(`<span class="sidenote" id="${escapeHtml(ids.definition)}"><span class="sidenote-number">${ref.entry.number}</span> `);
			this.inlines(paragraph.children);
			this.lit('</span>');
		}
	}

	// --- footnotes at the end

	private backrefs(entry: FootnoteEntry): string[] {
		const out: string[] = [];
		for (let k = 1; k <= entry.references; k++) {
			const ids = footnoteIds(entry.definition.identifier, k, this.prefix);
			const idx = backrefIndex(entry, k);
			const label = this.notes.backrefLabel.replace('{n}', idx);
			out.push(
				`<a href="#${escapeHtml(normalizeUrl(ids.reference))}" class="footnote-backref" data-footnote-backref data-footnote-backref-idx="${idx}" aria-label="${escapeHtml(label)}">${escapeHtml(this.notes.backref)}${k > 1 ? `<sup class="footnote-ref">${k}</sup>` : ''}</a>`
			);
		}
		return out;
	}

	private footnoteSection(): void {
		const entries = this.footnotes.entries.filter((entry) => !isSidenote(entry.definition, this.notes));
		if (entries.length === 0) return;
		const details = this.notes.style === 'details';
		this.cr();
		this.lit(
			`<section${attributeString({
				class: cx('footnotes', details && 'footnotes-details', classFor(this.options.classes, 'section'))
			})} data-footnotes>\n`
		);
		if (this.notes.heading) this.lit(`<h2 class="footnotes-heading">${escapeHtml(this.notes.heading)}</h2>\n`);
		if (!details) this.lit('<ol>\n');

		for (const entry of entries) {
			const { definition, number } = entry;
			const id = escapeHtml(footnoteIds(definition.identifier, 1, this.prefix).definition);
			const back = this.backrefs(entry).join(' ');

			if (details) {
				const { title, body } = splitFootnoteTitle(definition);
				this.lit(`<details class="footnote" id="${id}">\n<summary><span class="fn-num">${number}</span>`);
				if (title) {
					this.lit(' ');
					this.inlines(title);
				}
				this.lit('</summary>\n');
				this.lastOut = '\n';
				this.blocks(body, false);
				this.cr();
				this.lit(`<p class="fn-back">${back}</p>\n</details>\n`);
				continue;
			}

			this.lit(`<li id="${id}">\n`);
			this.lastOut = '\n';
			const children = definition.children;
			const last = children[children.length - 1];
			this.blocks(last?.type === 'paragraph' ? children.slice(0, -1) : children, false);
			this.cr();
			if (last?.type === 'paragraph') {
				const d = describe(last, this.options, this.headingIds);
				this.open(d?.tag ?? 'p', d?.attributes ?? {});
				this.inlines(last.children);
				this.lit(` ${back}`);
				this.close(d?.tag ?? 'p');
			} else {
				this.lit(`<p>${back}</p>`);
			}
			this.cr();
			this.lit('</li>\n');
		}
		if (!details) this.lit('</ol>\n');
		this.lit('</section>\n');
	}
}

export function renderHtml(tree: Root | Node | readonly Node[], options: RenderOptions = {}): string {
	const nodes: readonly Node[] = Array.isArray(tree) ? tree : [tree as Node];
	// a bare list of phrasing nodes (from parseInline) renders as one line of text
	const inline = Array.isArray(tree) && !nodes.some(isBlock);
	return new HtmlRenderer(options, nodes).render(nodes, inline);
}
