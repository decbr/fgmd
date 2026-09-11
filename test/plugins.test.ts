import { describe, expect, it } from 'vitest';
import { gemoji } from '../src/emoji.js';
import {
	abbreviations,
	attributes,
	callouts,
	definitionLists,
	emoji,
	mapText,
	markdown,
	math,
	parse,
	typography,
	wikilinks,
	type Plugin
} from '../src/index.js';

describe('callouts', () => {
	const options = { plugins: [callouts()] };

	it('turns GitHub alerts into asides with a default title', () => {
		expect(markdown('> [!NOTE]\n> Useful.', options)).toBe(
			'<aside class="callout callout-note">\n<p class="callout-title">Note</p>\n<p>Useful.</p>\n</aside>\n'
		);
	});

	it('takes a custom title from the marker line', () => {
		expect(markdown('> [!TIP] Pro *tip*\n> Body', options)).toBe(
			'<aside class="callout callout-tip">\n<p class="callout-title">Pro <em>tip</em></p>\n<p>Body</p>\n</aside>\n'
		);
	});

	it('folds with - and + into <details>', () => {
		expect(markdown('> [!WARNING]-\n> Hidden', options)).toBe(
			'<details class="callout callout-warning">\n<summary>Warning</summary>\n<p>Hidden</p>\n</details>\n'
		);
		expect(markdown('> [!WARNING]+\n> Shown', options)).toContain('<details class="callout callout-warning" open>');
	});

	it('leaves unknown types and ordinary quotes alone', () => {
		expect(markdown('> [!FOO]\n> x', options)).toBe('<blockquote>\n<p>[!FOO]\nx</p>\n</blockquote>\n');
		expect(markdown('> just a quote', options)).toBe('<blockquote>\n<p>just a quote</p>\n</blockquote>\n');
	});

	it('accepts custom types and class names', () => {
		const custom = { plugins: [callouts({ types: { danger: 'Danger!' }, className: 'box' })] };
		expect(markdown('> [!DANGER]\n> x', custom)).toBe(
			'<aside class="box box-danger">\n<p class="box-title">Danger!</p>\n<p>x</p>\n</aside>\n'
		);
	});

	it('reads ::: containers: callouts, details, and plain ones', () => {
		expect(markdown(':::warning Careful\nBody\n:::', options)).toBe(
			'<aside class="callout callout-warning">\n<p class="callout-title">Careful</p>\n<p>Body</p>\n</aside>\n'
		);
		expect(markdown(':::details More\nHidden\n:::', options)).toBe(
			'<details class="details">\n<summary>More</summary>\n<p>Hidden</p>\n</details>\n'
		);
		expect(markdown(':::details\nHidden\n:::', options)).toContain('<summary>Details</summary>');
		expect(markdown(':::box\nx\n:::', options)).toBe('<div class="box">\n<p>x</p>\n</div>\n');
	});

	it('nests containers, closing the innermost first', () => {
		expect(markdown(':::box\n:::note\ninner\n:::\nouter\n:::', options)).toBe(
			'<div class="box">\n<aside class="callout callout-note">\n<p class="callout-title">Note</p>\n<p>inner</p>\n</aside>\n<p>outer</p>\n</div>\n'
		);
	});

	it('leaves a ::: line inside a code block alone', () => {
		expect(markdown(':::box\n```\n:::\n```\n:::', options)).toBe('<div class="box">\n<pre><code>:::\n</code></pre>\n</div>\n');
	});
});

describe('typography', () => {
	const options = { plugins: [typography()] };

	it('does mark, superscript, subscript, and keeps strikethrough', () => {
		expect(markdown('==hi== x^2^ H~2~O ~~gone~~', options)).toBe(
			'<p><mark>hi</mark> x<sup>2</sup> H<sub>2</sub>O <del>gone</del></p>\n'
		);
	});

	it('leaves lookalikes alone', () => {
		expect(markdown('a == b, 2 ^ 3 ^ 4', options)).toBe('<p>a == b, 2 ^ 3 ^ 4</p>\n');
	});

	it('curls quotes, makes dashes and ellipses', () => {
		expect(markdown(`"Hello," she said. It's '90s -- then --- ok...`, options)).toBe(
			'<p>“Hello,” she said. It’s ’90s – then — ok…</p>\n'
		);
		expect(markdown('"*quoted*"', options)).toBe('<p>“<em>quoted</em>”</p>\n');
		expect(markdown('`"code"`', options)).toBe('<p><code>&quot;code&quot;</code></p>\n');
	});

	it('takes other quote styles, or none', () => {
		expect(markdown('"x"', { plugins: [typography({ smart: { quotes: '„“‚‘' } })] })).toBe('<p>„x“</p>\n');
		expect(markdown('"x" --', { plugins: [typography({ smart: false })] })).toBe('<p>&quot;x&quot; --</p>\n');
	});
});

describe('attributes', () => {
	const options = { plugins: [attributes()] };

	it('sets ids and classes on headings and paragraphs', () => {
		expect(markdown('# Title {#my-id .big}', options)).toBe('<h1 id="my-id" class="big">Title</h1>\n');
		expect(markdown('Para text. {.lead}', options)).toBe('<p class="lead">Para text.</p>\n');
	});

	it('sets attributes on inline elements straight after them', () => {
		expect(markdown('![a](/x.png){width=300 .round}', options)).toBe(
			'<p><img src="/x.png" alt="a" width="300" class="round" /></p>\n'
		);
		expect(markdown('[link](/u){target=_blank}', options)).toBe('<p><a href="/u" target="_blank">link</a></p>\n');
	});

	it('never lets through event handlers or styles', () => {
		expect(markdown('[x](/u){onclick=alert(1) style=color:red}', options)).toBe('<p><a href="/u">x</a></p>\n');
	});

	it('reads fenced code info strings', () => {
		expect(markdown('```js {.numbered}\nx\n```', options)).toBe('<pre class="numbered"><code class="language-js">x\n</code></pre>\n');
	});

	it('leaves text that isn\'t an attribute list', () => {
		expect(markdown('a {not valid=}', options)).toBe('<p>a {not valid=}</p>\n');
	});

	it('gives a heading id to headingAnchors', () => {
		expect(markdown('# T {#custom}', { ...options, headingAnchors: true })).toContain('href="#custom"');
	});
});

describe('definition lists', () => {
	const options = { plugins: [definitionLists()] };

	it('reads terms and definitions', () => {
		expect(markdown('Apple\n: A fruit.\n: A company.', options)).toBe(
			'<dl>\n<dt>Apple</dt>\n<dd>A fruit.</dd>\n<dd>A company.</dd>\n</dl>\n'
		);
		expect(markdown('A\nB\n: both', options)).toBe('<dl>\n<dt>A</dt>\n<dt>B</dt>\n<dd>both</dd>\n</dl>\n');
	});

	it('goes loose after a blank line before the definition', () => {
		expect(markdown('Term\n\n: Def', options)).toBe('<dl>\n<dt>Term</dt>\n<dd>\n<p>Def</p>\n</dd>\n</dl>\n');
	});

	it('joins entries separated by blank lines into one list', () => {
		expect(markdown('A\n: a\n\nB\n: b', options)).toBe('<dl>\n<dt>A</dt>\n<dd>a</dd>\n<dt>B</dt>\n<dd>b</dd>\n</dl>\n');
	});

	it('is plain text without the plugin', () => {
		expect(markdown('Apple\n: A fruit.')).toBe('<p>Apple\n: A fruit.</p>\n');
	});
});

describe('abbreviations', () => {
	it('expands whole words defined in the document', () => {
		expect(
			markdown('*[HTML]: HyperText Markup Language\n\nHTML and XHTML. `HTML`', { plugins: [abbreviations()] })
		).toBe('<p><abbr title="HyperText Markup Language">HTML</abbr> and XHTML. <code>HTML</code></p>\n');
	});

	it('takes expansions from options too', () => {
		expect(markdown('CSS rocks', { plugins: [abbreviations({ titles: { CSS: 'Cascading Style Sheets' } })] })).toBe(
			'<p><abbr title="Cascading Style Sheets">CSS</abbr> rocks</p>\n'
		);
	});
});

describe('math', () => {
	const options = { plugins: [math()] };

	it('reads inline math, leaving money alone', () => {
		expect(markdown('$a^2$ costs $5 and $10', options)).toBe(
			'<p><span class="math math-inline">a^2</span> costs $5 and $10</p>\n'
		);
		expect(markdown('$a<b$', options)).toBe('<p><span class="math math-inline">a&lt;b</span></p>\n');
	});

	it('reads display math blocks, fenced or on one line', () => {
		expect(markdown('$$\nx = 1\n$$', options)).toBe('<div class="math math-display">x = 1</div>\n');
		expect(markdown('$$ x $$', options)).toBe('<div class="math math-display">x</div>\n');
	});

	it('hands TeX to a renderer', () => {
		const render = (tex: string, { display }: { display: boolean }) => `[${display ? 'D' : 'I'}:${tex}]`;
		expect(markdown('$x$', { plugins: [math({ render })] })).toBe('<p><span class="math math-inline">[I:x]</span></p>\n');
	});
});

describe('emoji', () => {
	it('replaces shortcodes from a map', () => {
		const options = { plugins: [emoji({ map: gemoji })] };
		expect(markdown(':tada: :+1: :nope: 10:30:45', options)).toBe('<p>🎉 👍 :nope: 10:30:45</p>\n');
	});

	it('asks lookup for anything else', () => {
		const lookup = (name: string) =>
			name === 'party' ? { type: 'image' as const, url: '/p.png', alt: 'party', title: null } : null;
		expect(markdown(':party:', { plugins: [emoji({ lookup })] })).toBe('<p><img src="/p.png" alt="party" /></p>\n');
	});
});

describe('wikilinks', () => {
	it('links pages, labels and headings', () => {
		expect(markdown('[[My Page]] [[Other|label]] [[Doc#Some Part]]', { plugins: [wikilinks()] })).toBe(
			'<p><a href="/my-page" class="wikilink">My Page</a> <a href="/other" class="wikilink">label</a> <a href="/doc#some-part" class="wikilink">Doc#Some Part</a></p>\n'
		);
	});

	it('marks missing pages and embeds images', () => {
		const options = { plugins: [wikilinks({ exists: (page) => page === 'Home' })] };
		expect(markdown('[[Home]] [[Nope]]', options)).toBe(
			'<p><a href="/home" class="wikilink">Home</a> <a href="/nope" class="wikilink wikilink-new">Nope</a></p>\n'
		);
		expect(markdown('![[cat.png]] [a](/b)', options)).toBe('<p><img src="/cat.png" alt="cat.png" /> <a href="/b">a</a></p>\n');
	});
});

describe('plugins by name', () => {
	it('resolves built-in names, with options', () => {
		expect(markdown('==x==', { plugins: ['typography'] })).toBe('<p><mark>x</mark></p>\n');
		expect(markdown(':a:', { plugins: [['emoji', { map: { a: 'A' } }]] })).toBe('<p>A</p>\n');
	});

	it('names the ones that exist when a name is wrong', () => {
		expect(() => markdown('x', { plugins: ['nope'] })).toThrow(/unknown plugin "nope".*callouts/);
	});
});

// a plugin of your own, using every hook at once
describe('writing a plugin', () => {
	const mine: Plugin = {
		name: 'mine',
		inline: [
			{
				triggers: '@',
				parse(state) {
					// not the @ in an email address
					if (/\w/.test(state.charBefore())) return null;
					const m = state.match(/@([a-z0-9_]+)/i);
					if (!m) return null;
					return {
						type: 'link',
						url: `/u/${m[1]}`,
						title: null,
						children: [{ type: 'text', value: m[0] }],
						data: { hProperties: { class: 'mention' } }
					};
				}
			}
		],
		delimiters: [{ char: '+', lengths: { 2: 'insert' } }],
		block: [
			{ kind: 'fence', char: '%', length: 3, node: (content, info) => ({ type: 'code', lang: 'mermaid', meta: info || null, value: content }) },
			{ kind: 'line', match: /^\[\[toc\]\]$/, node: () => ({ type: 'html', value: '<nav class="toc"></nav>' }) }
		],
		definitions: [
			{
				match: /%define (\w+) (.*)/,
				define(m, ctx) {
					((ctx.data.vars ??= {}) as Record<string, string>)[m[1] as string] = m[2] as string;
				}
			}
		],
		transform(tree, ctx) {
			const vars = (ctx.data.vars ?? {}) as Record<string, string>;
			mapText(tree, (text) =>
				text.value.includes('{{') ? [{ type: 'text', value: text.value.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '') }] : undefined
			);
		},
		renderers: {
			insert: (_node, ctx) => `<ins>${ctx.children()}</ins>`
		}
	};

	it('runs inline rules, delimiters, block rules, definitions, transforms and renderers', () => {
		const md = '%define name World\n\nHello {{name}}, @dia ++new++ text. me@example.com\n\n%%% graph\nA-->B\n%%%\n\n[[toc]]';
		expect(markdown(md, { plugins: [mine] })).toBe(
			'<p>Hello World, <a href="/u/dia" class="mention">@dia</a> <ins>new</ins> text. <a href="mailto:me@example.com">me@example.com</a></p>\n' +
				'<pre><code class="language-mermaid">A--&gt;B\n</code></pre>\n' +
				'<nav class="toc"></nav>\n'
		);
	});

	it('puts its nodes in the tree', () => {
		const tree = parse('++x++', { plugins: [mine] });
		expect(tree.children[0]).toEqual({ type: 'paragraph', children: [{ type: 'insert', children: [{ type: 'text', value: 'x' }] }] });
	});

	it('renders an unknown node through data.hName without a renderer', () => {
		const keycap: Plugin = {
			name: 'keycap',
			inline: [
				{
					triggers: '|',
					parse(state) {
						const m = state.match(/\|\|([^|\s]+)\|\|/);
						return m ? ({ type: 'keycap', data: { hName: 'kbd' }, children: [{ type: 'text', value: m[1] }] } as never) : null;
					}
				}
			]
		};
		expect(markdown('Press ||Ctrl||', { plugins: [keycap] })).toBe('<p>Press <kbd>Ctrl</kbd></p>\n');
	});
});
