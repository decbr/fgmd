// components inside markdown, the part of MDX most people want, without running any code:
//
//   <Chart kind="bar" data={[3, 1, 4]} />      a block on its own line
//
//   <Tabs>                                      a block whose content is markdown
//   ## First
//   Some *text*.
//   </Tabs>
//
//   Press <Kbd>Ctrl</Kbd> or <Icon name="x" />  inline
//
// names start with a capital letter or have a dot (Tabs.Item), as in MDX; lowercase tags are
// HTML and follow the html option. props are strings, bare booleans, or {JSON}: data, never code.
// a tag with anything else in braces isn't a component, and stays text.
//
// the renderer supplies each component by name: the Svelte component's `components` prop, or
// `render` here for HTML. a component with nothing to draw it renders just its content
import type { BlockContent, Component, JsonValue, Node, Paragraph, PhrasingContent } from '../ast.js';
import type { RenderContext } from '../options.js';
import type { Plugin } from '../plugin.js';
import { asComponent, componentProps } from '../shared.js';
import { decodeEntities } from '../util.js';

export interface ComponentOptions {
	// which names are components: a list, or a predicate. default: every capitalised or dotted name
	allow?: readonly string[] | ((name: string) => boolean);
	// HTML for markdown() by name. props arrive with URL-valued ones (href, src...) policy-checked;
	// context.children() renders the content. return undefined for the default (just the content)
	render?: Record<string, (props: Record<string, JsonValue>, context: RenderContext) => string | undefined>;
}

// the tag an inline rule found, waiting for the transform to pair it up
interface Marker {
	type: 'componentOpen' | 'componentClose';
	name: string;
	props: Record<string, JsonValue>;
	// the source, for when it pairs with nothing and goes back to being text
	raw: string;
}

interface Tag {
	name: string;
	props: Record<string, JsonValue>;
	selfClosing: boolean;
	end: number;
}

// an inline tag longer than this isn't looked for, so a run of unclosed "<A a a a ..." can't
// make every "<" scan to the end of the paragraph
const MAX_INLINE_TAG = 1000;
// how deep inline components nest; deeper tags stay text, so rendering can't overflow the stack
const MAX_DEPTH = 100;

const reName = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/y;
const rePropName = /[A-Za-z_$][\w$:-]*/y;
const reSpace = /\s*/y;
const reClose = /<\/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*>/y;

const isComponentName = (name: string) => /^[A-Z]/.test(name) || name.includes('.');

function sticky(re: RegExp, s: string, at: number): RegExpExecArray | null {
	re.lastIndex = at;
	return re.exec(s);
}

// the end of a {...} expression starting at `at`, or -1: braces and brackets balanced, JSON
// strings skipped
function braceEnd(s: string, at: number, limit: number): number {
	let depth = 0;
	for (let i = at; i < limit; i++) {
		const c = s[i];
		if (c === '"') {
			for (i++; i < limit && s[i] !== '"'; i++) if (s[i] === '\\') i++;
		} else if (c === '{' || c === '[') {
			depth++;
		} else if (c === '}' || c === ']') {
			if (--depth === 0) return c === '}' ? i + 1 : -1;
		}
	}
	return -1;
}

// <Name a="x" b={1} c /> or <Name ...> at `at`, or null
function parseTag(s: string, at: number, limit: number): Tag | null {
	if (s[at] !== '<') return null;
	const name = sticky(reName, s, at + 1);
	if (!name || !isComponentName(name[0])) return null;
	const props: Record<string, JsonValue> = {};
	let i = at + 1 + name[0].length;
	for (;;) {
		const space = (sticky(reSpace, s, i) as RegExpExecArray)[0].length;
		i += space;
		if (i >= limit) return null;
		if (s.startsWith('/>', i)) return { name: name[0], props, selfClosing: true, end: i + 2 };
		if (s[i] === '>') return { name: name[0], props, selfClosing: false, end: i + 1 };
		if (space === 0) return null; // props need space before them
		const prop = sticky(rePropName, s, i);
		if (!prop) return null;
		i += prop[0].length;
		let value: JsonValue = true;
		const eq = sticky(/\s*=\s*/y, s, i);
		if (eq) {
			i += eq[0].length;
			const quote = s[i];
			if (quote === '"' || quote === "'") {
				const close = s.indexOf(quote, i + 1);
				if (close === -1 || close >= limit) return null;
				value = decodeEntities(s.slice(i + 1, close));
				i = close + 1;
			} else if (quote === '{') {
				const end = braceEnd(s, i, limit);
				if (end === -1) return null;
				try {
					value = JSON.parse(s.slice(i + 1, end - 1)) as JsonValue;
				} catch {
					return null;
				}
				i = end;
			} else {
				return null;
			}
		}
		if (prop[0] !== '__proto__') props[prop[0]] = value; // a prop can't reach the object's prototype
	}
}

export function components(options: ComponentOptions = {}): Plugin {
	const allow = options.allow;
	const allowed =
		typeof allow === 'function' ? allow : allow ? (name: string) => allow.includes(name) : () => true;
	const render = options.render ?? {};

	// a whole line that is one tag
	const lineTag = (line: string): Tag | null => {
		const tag = parseTag(line, 0, line.length);
		return tag && tag.end === line.length && allowed(tag.name) ? tag : null;
	};

	return {
		name: 'components',
		block: [
			{
				kind: 'wrapper',
				chars: '<',
				open(line) {
					const tag = lineTag(line);
					return tag && !tag.selfClosing ? tag : null;
				},
				close(line, tag: Tag) {
					const m = sticky(reClose, line, 0);
					return m !== null && m[0].length === line.length && m[1] === tag.name;
				},
				node(children, tag: Tag, ctx) {
					ctx.data.components = true;
					return block({ type: 'component', name: tag.name, props: tag.props, children });
				}
			},
			{
				kind: 'line',
				chars: '<',
				match: /^<[^\n]*\/>[ \t]*$/,
				node(match, ctx) {
					const tag = lineTag(match[0].trimEnd());
					if (!tag?.selfClosing) return null;
					ctx.data.components = true;
					return block({ type: 'component', name: tag.name, props: tag.props, children: [] });
				}
			}
		],
		inline: [
			{
				triggers: '<',
				parse(state) {
					const s = state.source;
					const at = state.pos;
					const limit = Math.min(s.length, at + MAX_INLINE_TAG);
					if (s[at + 1] === '/') {
						const m = sticky(reClose, s, at);
						if (!m || !isComponentName(m[1] as string) || !allowed(m[1] as string)) return null;
						state.pos = at + m[0].length;
						state.data.components = true;
						state.data.componentMarkers = true;
						return marker({ type: 'componentClose', name: m[1] as string, props: {}, raw: m[0] });
					}
					const tag = parseTag(s, at, limit);
					if (!tag || !allowed(tag.name)) return null;
					state.pos = tag.end;
					state.data.components = true;
					if (tag.selfClosing) return inline({ type: 'component', name: tag.name, props: tag.props, children: [] });
					state.data.componentMarkers = true;
					return marker({ type: 'componentOpen', name: tag.name, props: tag.props, raw: s.slice(at, tag.end) });
				}
			}
		],
		transform(tree, ctx) {
			if (!ctx.data.components) return;
			if (ctx.data.componentMarkers) foldTree(tree);
			unwrapParagraphs(tree);
		},
		renderers: {
			component(node: Component, context) {
				const fn = render[node.name];
				return fn ? fn(componentProps(node, context.options), context) : undefined;
			}
		}
	};
}

// component nodes sit outside the content maps (see ast.ts), so they go into the tree cast
const block = (c: Component) => c as unknown as BlockContent;
const inline = (c: Component) => c as unknown as PhrasingContent;

// markers travel through the inline parser as phrasing content until the transform folds them
const marker = (m: Marker) => m as unknown as PhrasingContent;
const isMarker = (node: Node): boolean =>
	(node.type as string) === 'componentOpen' || (node.type as string) === 'componentClose';

function foldTree(node: Node): void {
	if ('children' in node) {
		const children = node.children as Node[];
		for (const child of children) if (!isMarker(child)) foldTree(child);
		(node as { children: Node[] }).children = foldList(children);
	}
	if (node.type === 'container' && node.title) {
		for (const child of node.title) if (!isMarker(child)) foldTree(child);
		node.title = foldList(node.title) as PhrasingContent[];
	}
}

// pairs open and close markers among one list of siblings into component nodes. a close goes to
// the innermost open tag of its name, and anything opened inside it that never closed is text
function foldList(nodes: Node[]): Node[] {
	if (!nodes.some(isMarker)) return nodes;
	const out: Node[] = [];
	const open: { marker: Marker; index: number }[] = []; // the open markers, innermost last, with where each sits in `out`
	const counts = new Map<string, number>();
	for (const node of nodes) {
		if (!isMarker(node)) {
			out.push(node);
			continue;
		}
		const m = node as unknown as Marker;
		if (m.type === 'componentOpen') {
			if (open.length < MAX_DEPTH) {
				open.push({ marker: m, index: out.length });
				counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
			}
			out.push(node);
			continue;
		}
		if (!counts.get(m.name)) {
			out.push(node);
			continue;
		}
		let i = open.length - 1;
		while ((open[i] as { marker: Marker }).marker.name !== m.name) i--;
		const frame = open[i] as { marker: Marker; index: number };
		for (const dropped of open.splice(i)) counts.set(dropped.marker.name, (counts.get(dropped.marker.name) as number) - 1);
		const children = out.splice(frame.index + 1);
		const start = (frame.marker as unknown as Node).position?.start;
		const end = node.position?.end;
		out[frame.index] = inline({
			type: 'component',
			name: frame.marker.name,
			props: frame.marker.props,
			children: toText(children) as PhrasingContent[],
			...(start && end && { position: { start, end } })
		});
	}
	return toText(out);
}

// markers that paired with nothing go back to being the text they came from
function toText(nodes: Node[]): Node[] {
	const out: Node[] = [];
	for (const node of nodes) {
		const value = isMarker(node) ? (node as unknown as Marker).raw : node.type === 'text' ? node.value : null;
		const last = out[out.length - 1];
		const start = last?.position?.start;
		const end = node.position?.end;
		if (value !== null && last?.type === 'text') {
			out[out.length - 1] = { type: 'text', value: last.value + value, ...(start && end && { position: { start, end } }) };
		} else {
			out.push(value !== null && isMarker(node) ? { type: 'text', value, ...(node.position && { position: node.position }) } : node);
		}
	}
	return out;
}

// a paragraph that is only a component is that component, as in MDX: `<Badge>new</Badge>` on
// its own line is a block whose content stays inline, with no <p>
function unwrapParagraphs(node: Node): void {
	if (!('children' in node)) return;
	const children = node.children as Node[];
	for (let i = 0; i < children.length; i++) {
		const child = children[i] as Node;
		const only = child.type === 'paragraph' ? soleComponent(child) : null;
		if (only) children[i] = block(only);
		else unwrapParagraphs(child);
	}
}

function soleComponent(paragraph: Paragraph): Component | null {
	const content = paragraph.children.filter((c) => !(c.type === 'text' && !/\S/.test(c.value)));
	const only = content[0];
	return content.length === 1 && only ? asComponent(only) : null;
}
