// {#id .class key=value} attributes, as in Pandoc and markdown-it-attrs:
//
//   # Heading {#custom-id}           a trailing block on a heading
//   A paragraph. {.lead}             at the end of a paragraph (after a space)
//   ![photo](a.jpg){width=300}       straight after a link, image, code span or emphasis
//   ```js {.numbered}                in a fenced code block's info string
//
// what may be set is allowlisted: on* handlers and style never are, so it's safe for user content.
import type { Attributes, Node, NodeBase } from '../ast.js';
import type { Plugin } from '../plugin.js';
import { cx } from '../shared.js';

export interface AttributesOptions {
	// attribute names you may set, besides id and class. 'data-*' and 'aria-*' allow those families.
	// default: title, lang, dir, width, height, loading, target, rel, role, data-*, aria-*
	allow?: readonly string[];
}

const DEFAULT_ALLOW = ['title', 'lang', 'dir', 'width', 'height', 'loading', 'target', 'rel', 'role', 'data-*', 'aria-*'];

// one {...} item: #id, .class, key=value, key="value", key='value' or a bare key
const reItem = /\s*(?:#([\w-]+)|\.([\w-]+)|([a-zA-Z_][\w:.-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`{}]+)))?)/y;

// nodes that can take attributes straight after them
const INLINE_TARGETS = new Set([
	'link', 'image', 'inlineCode', 'emphasis', 'strong', 'delete', 'mark', 'superscript', 'subscript', 'abbr', 'inlineMath'
]);

export function attributes(options: AttributesOptions = {}): Plugin {
	const allow = new Set(options.allow ?? DEFAULT_ALLOW);
	const allowed = (name: string) => {
		const lower = name.toLowerCase();
		if (lower.startsWith('on') || lower === 'style') return false;
		if (lower === 'id' || lower === 'class') return true;
		if (allow.has(lower)) return true;
		if (lower.startsWith('data-') && allow.has('data-*')) return true;
		return lower.startsWith('aria-') && allow.has('aria-*');
	};

	// the inside of {...}, or null if it isn't a valid attribute list at all
	const parse = (source: string): Attributes | null => {
		const out: Attributes = {};
		const classes: string[] = [];
		reItem.lastIndex = 0;
		let pos = 0;
		while (pos < source.length) {
			if (!/\S/.test(source.slice(pos))) break;
			reItem.lastIndex = pos;
			const m = reItem.exec(source);
			if (!m || m[0].length === 0) return null;
			pos = reItem.lastIndex;
			if (m[1]) out.id = m[1];
			else if (m[2]) classes.push(m[2]);
			else if (m[3] && allowed(m[3])) out[m[3].toLowerCase()] = m[4] ?? m[5] ?? m[6] ?? true;
		}
		if (classes.length > 0) out.class = classes.join(' ');
		if (!allowed('id')) delete out.id;
		return Object.keys(out).length > 0 || classes.length > 0 ? out : {};
	};

	const apply = (node: NodeBase, attrs: Attributes) => {
		const props = node.data?.hProperties ?? {};
		node.data = {
			...node.data,
			hProperties: { ...props, ...attrs, class: cx(props.class as string | undefined, attrs.class as string | undefined) }
		};
	};

	// a trailing ` {...}` at the end of a line of text: strips it and returns the attributes
	const takeTrailing = (children: Node[]): Attributes | null => {
		const last = children[children.length - 1];
		if (last?.type !== 'text') return null;
		const m = /(^|[ \t\n]+)\{([^{}\n]*)\}[ \t]*$/.exec(last.value);
		if (!m) return null;
		const attrs = parse(m[2] as string);
		if (!attrs) return null;
		last.value = last.value.slice(0, m.index);
		if (last.value === '') children.pop();
		return attrs;
	};

	const walk = (node: Node) => {
		if (node.type === 'code' && node.meta) {
			const m = /\{([^{}\n]*)\}/.exec(node.meta);
			const attrs = m && parse(m[1] as string);
			if (m && attrs) {
				apply(node, attrs);
				node.meta = (node.meta.slice(0, m.index) + node.meta.slice(m.index + m[0].length)).trim() || null;
			}
			return;
		}
		if (!('children' in node)) return;
		const children = node.children as Node[];

		// {...} straight after an inline element belongs to it
		for (let i = 1; i < children.length; i++) {
			const child = children[i] as Node;
			const target = children[i - 1] as Node;
			if (child.type !== 'text' || !INLINE_TARGETS.has(target.type)) continue;
			const m = /^\{([^{}\n]*)\}/.exec(child.value);
			const attrs = m && parse(m[1] as string);
			if (!m || !attrs) continue;
			apply(target, attrs);
			child.value = child.value.slice(m[0].length);
			if (child.value === '') children.splice(i--, 1);
		}

		if (node.type === 'heading' || node.type === 'paragraph') {
			const attrs = takeTrailing(children);
			if (attrs) {
				apply(node, attrs);
				const last = children[children.length - 1];
				if (last?.type === 'text') last.value = last.value.replace(/[ \t]+$/, '');
			}
		}
		if (node.type === 'container' && node.title) {
			const attrs = takeTrailing(node.title);
			if (attrs) apply(node, attrs);
		}
		for (const child of children) walk(child);
	};

	return {
		name: 'attributes',
		transform(tree) {
			walk(tree);
		}
	};
}
