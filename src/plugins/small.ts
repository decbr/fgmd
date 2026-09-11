// the smaller built-in plugins: definition lists, abbreviations, math, emoji and wikilinks
import type { Abbr, PhrasingContent, Text } from '../ast.js';
import type { Plugin } from '../plugin.js';
import { cx } from '../shared.js';
import { escapeHtml, normalizeUrl } from '../util.js';
import { mapText } from '../visit.js';

// Term, then `: definition` lines (PHP Markdown Extra / Pandoc syntax). the syntax itself lives
// in the block parser; this switches it on
//
//   Apple
//   : A fruit.
//   : A company.
export function definitionLists(): Plugin {
	return { name: 'definitionLists', syntax: { definitionLists: true } };
}

export interface AbbreviationOptions {
	// expansions that apply everywhere, on top of *[ABBR]: lines in the document
	titles?: Record<string, string>;
}

// *[HTML]: HyperText Markup Language, then every whole-word HTML becomes <abbr title="...">
export function abbreviations(options: AbbreviationOptions = {}): Plugin {
	return {
		name: 'abbreviations',
		definitions: [
			{
				match: /\*\[([^\]\n]+)\]:[ \t]*([^\n]*)/,
				define(m, ctx) {
					const found = (ctx.data.abbreviations ??= new Map<string, string>()) as Map<string, string>;
					const key = (m[1] as string).trim();
					if (!found.has(key)) found.set(key, (m[2] as string).trim());
				}
			}
		],
		transform(tree, ctx) {
			const found = (ctx.data.abbreviations as Map<string, string> | undefined) ?? new Map<string, string>();
			const titles = new Map([...Object.entries(options.titles ?? {}), ...found]);
			if (titles.size === 0) return;
			// longest first, so "HTML5" wins over "HTML"
			const alternatives = [...titles.keys()]
				.sort((a, b) => b.length - a.length)
				.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
			const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}_])`, 'gu');
			mapText(
				tree,
				(text) => {
					re.lastIndex = 0;
					if (!re.test(text.value)) return undefined;
					// matchAll starts from the regex's lastIndex, which test() just moved
					re.lastIndex = 0;
					const out: PhrasingContent[] = [];
					let last = 0;
					for (const m of text.value.matchAll(re)) {
						if (m.index > last) out.push({ type: 'text', value: text.value.slice(last, m.index) });
						const abbr: Abbr = { type: 'abbr', title: titles.get(m[0]) as string, children: [{ type: 'text', value: m[0] }] };
						out.push(abbr);
						last = m.index + m[0].length;
					}
					if (last < text.value.length) out.push({ type: 'text', value: text.value.slice(last) });
					return out;
				},
				(node) => node.type === 'abbr'
			);
		}
	};
}

export interface MathOptions {
	// turns TeX into HTML for the HTML renderer, e.g. (tex, { display }) => katex.renderToString(tex, { displayMode: display })
	render?: (tex: string, options: { display: boolean }) => string;
}

// $inline$ and $$display$$ math. without render, the TeX is written escaped inside
// <span class="math math-inline"> / <div class="math math-display">, ready for a client-side
// renderer such as KaTeX's auto-render
export function math(options: MathOptions = {}): Plugin {
	const render = options.render;
	return {
		name: 'math',
		block: [
			{
				kind: 'fence',
				char: '$',
				length: 2,
				node: (content, info) => ({ type: 'math', value: content.replace(/\n$/, ''), meta: info || null })
			}
		],
		inline: [
			{
				triggers: '$',
				parse(state) {
					if (state.source.startsWith('$$', state.pos)) {
						const m = state.match(/\$\$((?:\\[\s\S]|[^\\$])+?)\$\$/);
						return m ? { type: 'inlineMath', value: (m[1] as string).trim(), display: true } : null;
					}
					// Pandoc's rules: no space just inside the dollars, no digit straight after the
					// closing one, so "$5 and $10" stays money
					const m = state.match(/\$(?![\s$])((?:\\[\s\S]|[^\\$])*?[^\s\\])\$(?!\d)/);
					return m ? { type: 'inlineMath', value: m[1] as string, display: false } : null;
				}
			}
		],
		renderers: render
			? {
					math: (node: { value: string }) =>
						`<div class="math math-display">${render(node.value, { display: true })}</div>\n`,
					inlineMath: (node: { value: string; display: boolean }) =>
						`<span class="${node.display ? 'math math-display' : 'math math-inline'}">${render(node.value, { display: node.display })}</span>`
				}
			: undefined
	};
}

export interface EmojiOptions {
	// shortcode -> emoji. import { gemoji } from 'fgmd/emoji' for GitHub's full set
	map?: Readonly<Record<string, string>>;
	// for anything else, e.g. custom images: return a string, a node, or nothing to leave it
	lookup?: (name: string) => string | PhrasingContent | null | undefined;
}

// :shortcode: emoji
export function emoji(options: EmojiOptions = {}): Plugin {
	const map = options.map ?? {};
	return {
		name: 'emoji',
		inline: [
			{
				triggers: ':',
				parse(state) {
					const m = state.match(/:([a-zA-Z0-9_+-]+):/);
					if (!m) return null;
					const name = m[1] as string;
					const found = options.lookup?.(name) ?? (Object.hasOwn(map, name) ? map[name] : undefined);
					if (found === null || found === undefined) return null;
					return typeof found === 'string' ? ({ type: 'text', value: found } satisfies Text) : found;
				}
			}
		]
	};
}

export interface WikilinkOptions {
	// URL for a page (and heading). default: /page-name#heading-name
	resolve?: (page: string, heading: string | null) => string;
	// whether a page exists; missing ones get the wikilink-new class
	exists?: (page: string) => boolean;
	// ![[file.png]] embeds images. default true
	embeds?: boolean;
	// URL for an embedded file. default: /file.png
	resolveEmbed?: (target: string) => string;
}

const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-');

// [[Page]], [[Page|label]], [[Page#Heading]] and ![[image.png]]
export function wikilinks(options: WikilinkOptions = {}): Plugin {
	const resolve = options.resolve ?? ((page, heading) => `/${slug(page)}${heading ? `#${slug(heading)}` : ''}`);
	const resolveEmbed = options.resolveEmbed ?? ((target) => `/${target.trim()}`);
	const re = /\[\[([^[\]|#\n]+)(?:#([^[\]|\n]+))?(?:\|([^[\]\n]+))?\]\]/;
	const embedRe = /!\[\[([^[\]|\n]+)(?:\|([^[\]\n]+))?\]\]/;
	return {
		name: 'wikilinks',
		inline: [
			{
				triggers: '[',
				parse(state) {
					if (!state.source.startsWith('[[', state.pos)) return null;
					const m = state.match(re);
					if (!m) return null;
					const page = (m[1] as string).trim();
					const heading = m[2]?.trim() || null;
					const label = m[3]?.trim() || (heading ? `${page}#${heading}` : page);
					const missing = options.exists ? !options.exists(page) : false;
					return {
						type: 'link',
						url: normalizeUrl(resolve(page, heading)),
						title: null,
						children: [{ type: 'text', value: label }],
						data: { hProperties: { class: cx('wikilink', missing && 'wikilink-new') } }
					};
				}
			},
			...(options.embeds === false
				? []
				: [
						{
							triggers: '!',
							parse(state: Parameters<NonNullable<Plugin['inline']>[number]['parse']>[0]) {
								if (!state.source.startsWith('![[', state.pos)) return null;
								const m = state.match(embedRe);
								if (!m) return null;
								const target = (m[1] as string).trim();
								return {
									type: 'image' as const,
									url: normalizeUrl(resolveEmbed(target)),
									title: null,
									alt: m[2]?.trim() || target
								};
							}
						}
					])
		]
	};
}

// kept for plugins that want to escape text in their own renderers
export { escapeHtml };
