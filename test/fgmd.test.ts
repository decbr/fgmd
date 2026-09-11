import { describe, expect, it } from 'vitest';
import { markdown, markdownInline, parse, parseInline, type UrlPolicy } from '../src/index.js';

describe('safe by default', () => {
	it('shows raw HTML as text unless { html: true }', () => {
		expect(markdown('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>\n');
		expect(markdown('hi <b>there</b>')).toBe('<p>hi &lt;b&gt;there&lt;/b&gt;</p>\n');
		expect(markdown('hi <b>there</b>', { html: true })).toBe('<p>hi <b>there</b></p>\n');
	});

	it('drops links and images with executable schemes, keeping their text', () => {
		expect(markdown('[x](javascript:alert(1))')).toBe('<p>x</p>\n');
		expect(markdown('[x](JAVASCRIPT:alert(1))')).toBe('<p>x</p>\n');
		expect(markdown('[x](&#106;avascript:alert(1))')).toBe('<p>x</p>\n');
		expect(markdown('<javascript:alert(1)>')).toBe('<p>javascript:alert(1)</p>\n');
		expect(markdown('![alt text](javascript:x)')).toBe('<p>alt text</p>\n');
		expect(markdown('[**bold**](vbscript:x)')).toBe('<p><strong>bold</strong></p>\n');
	});

	it('keeps http(s), mailto, tel and scheme-less URLs', () => {
		expect(markdown('[a](/ok) [b](https://a.b) [c](mailto:a@b.c) [d](#frag) [e](tel:123) [f](page.html)')).toBe(
			'<p><a href="/ok">a</a> <a href="https://a.b">b</a> <a href="mailto:a@b.c">c</a> <a href="#frag">d</a> <a href="tel:123">e</a> <a href="page.html">f</a></p>\n'
		);
	});

	it('lets allowedSchemes or urlPolicy change the rules', () => {
		expect(markdown('[a](ftp://x.y)')).toBe('<p>a</p>\n');
		expect(markdown('[a](ftp://x.y)', { allowedSchemes: ['ftp'] })).toBe('<p><a href="ftp://x.y">a</a></p>\n');
		const rewrite: UrlPolicy = (url, kind) => (kind === 'image' ? `/proxy?u=${encodeURIComponent(url)}` : url);
		expect(markdown('![i](https://a.b/c.png)', { urlPolicy: rewrite })).toBe(
			'<p><img src="/proxy?u=https%3A%2F%2Fa.b%2Fc.png" alt="i" /></p>\n'
		);
	});
});

describe('comments', () => {
	it('strips HTML comments so they never reach readers', () => {
		expect(markdown('a <!-- secret --> b')).toBe('<p>a  b</p>\n');
		expect(markdown('<!-- secret -->\n\ntext')).toBe('<p>text</p>\n');
		expect(markdown('<!-- secret -->\n\ntext', { html: true })).toBe('<p>text</p>\n');
		expect(markdown('<div>\n<!-- secret -->\n<p>y</p>\n</div>', { html: true })).toBe('<div>\n\n<p>y</p>\n</div>\n');
	});

	it('strips [//]: # (...) comment lines, even with nested parens', () => {
		expect(markdown('[//]: # (a comment with ![an image](x.png) inside)\n\ntext')).toBe('<p>text</p>\n');
		expect(markdown('[comment]: <> (hidden)\ntext')).toBe('<p>text</p>\n');
	});

	it('leaves comments inside code alone', () => {
		expect(markdown('`<!-- kept -->`')).toBe('<p><code>&lt;!-- kept --&gt;</code></p>\n');
		expect(markdown('```\n<!-- kept -->\n```')).toBe('<pre><code>&lt;!-- kept --&gt;\n</code></pre>\n');
	});

	it('keeps comments with keepComments', () => {
		expect(markdown('a <!-- x --> b', { html: true, keepComments: true })).toBe('<p>a <!-- x --> b</p>\n');
	});
});

// the shapes diasite's posts rely on
describe('diasite-style content', () => {
	const diasite = { html: true, breaks: true, lazyImages: true, unwrapImages: true, tableWrapperClass: 'table-wrap' };

	it('turns single newlines into <br> with breaks', () => {
		expect(markdown('a\nb', { breaks: true })).toBe('<p>a<br />\nb</p>\n');
		expect(markdown('a\nb')).toBe('<p>a\nb</p>\n');
	});

	it('does not double up a hand-written <br> that ends a line', () => {
		expect(markdown('one <br>\ntwo\nthree', { html: true, breaks: true })).toBe(
			'<p>one <br>\ntwo<br />\nthree</p>\n'
		);
		expect(markdown('> a <br/>\n> b', { html: true, breaks: true })).toBe(
			'<blockquote>\n<p>a <br/>\nb</p>\n</blockquote>\n'
		);
	});

	it('unwraps an image-only paragraph inside a raw HTML grid', () => {
		const md = [
			'<div class="photo-grid">',
			'',
			'![](a.jpg)',
			'![](b.jpg)',
			'<video src="v.mov" controls></video>',
			'![](c.jpg)',
			'',
			'</div>'
		].join('\n');
		expect(markdown(md, diasite)).toBe(
			'<div class="photo-grid">\n' +
				'<img src="a.jpg" alt="" loading="lazy" />\n' +
				'<img src="b.jpg" alt="" loading="lazy" />\n' +
				'<video src="v.mov" controls></video>\n' +
				'<img src="c.jpg" alt="" loading="lazy" />\n' +
				'</div>\n'
		);
	});

	it('does not unwrap paragraphs that contain words', () => {
		expect(markdown('look\n![](a.jpg)', diasite)).toBe('<p>look<br />\n<img src="a.jpg" alt="" loading="lazy" /></p>\n');
	});

	it('passes raw HTML footnote blocks and inline <sup> through untouched', () => {
		const block =
			'<details class="footnote" id="fn1">\n<summary><span class="fn-num">1</span> Title</summary>\n<p>Body</p>\n</details>';
		expect(markdown(block, diasite)).toBe(block + '\n');
		expect(markdown('text<sup id="fnref1"><a href="#fn1">1</a></sup>.', diasite)).toBe(
			'<p>text<sup id="fnref1"><a href="#fn1">1</a></sup>.</p>\n'
		);
	});

	it('keeps balanced parentheses in link targets', () => {
		expect(markdown('[song](https://en.wikipedia.org/wiki/Mull_of_Kintyre_(song))')).toBe(
			'<p><a href="https://en.wikipedia.org/wiki/Mull_of_Kintyre_(song)">song</a></p>\n'
		);
	});

	it('wraps tables for scrolling', () => {
		expect(markdown('| a | b |\n|---|---|\n| 1 | 2 |', { tableWrapperClass: 'table-wrap' })).toBe(
			'<div class="table-wrap">\n<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n' +
				'<tbody>\n<tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody>\n</table>\n</div>\n'
		);
	});

	it('adds loading="lazy" to images', () => {
		expect(markdown('![dog](/d.jpg)', { lazyImages: true })).toBe(
			'<p><img src="/d.jpg" alt="dog" loading="lazy" /></p>\n'
		);
	});
});

// the shapes klyx-website's documents rely on
describe('klyx-style content', () => {
	const klyxPolicy: UrlPolicy = (url) =>
		(url.startsWith('/') && !url.startsWith('//')) || /^https?:\/\//i.test(url) || /^mailto:/i.test(url)
			? url
			: null;

	it('reads _underscores_ as emphasis', () => {
		expect(markdown('_Last Updated 8th Sept 2026_')).toBe('<p><em>Last Updated 8th Sept 2026</em></p>\n');
	});

	it('nests a 4-space indented list under an ordered item', () => {
		const md = '1. Players must be 16+.\n2. Your players:\n    - **General** - is expected.\n    - **Play Fair** - no.';
		expect(markdown(md)).toBe(
			'<ol>\n<li>Players must be 16+.</li>\n<li>Your players:\n<ul>\n' +
				'<li><strong>General</strong> - is expected.</li>\n<li><strong>Play Fair</strong> - no.</li>\n' +
				'</ul>\n</li>\n</ol>\n'
		);
	});

	it('can restrict links to site paths, http(s) and mailto', () => {
		expect(markdown('[a](//evil.com) [b](/ok) [c](#x) [**d**](mailto:x@y.z)', { urlPolicy: klyxPolicy })).toBe(
			'<p>a <a href="/ok">b</a> c <a href="mailto:x@y.z"><strong>d</strong></a></p>\n'
		);
	});

	it('adds attributes to links through linkAttrs', () => {
		const linkAttrs = (url: string) => (url.startsWith('/') ? null : { target: '_blank', rel: 'noreferrer' });
		expect(markdown('[a](https://x.y) [b](/z)', { linkAttrs })).toBe(
			'<p><a href="https://x.y" target="_blank" rel="noreferrer">a</a> <a href="/z">b</a></p>\n'
		);
	});

	it('puts per-element classes on the output', () => {
		expect(markdown('Hi **there**', { classes: { p: 'mb-4', strong: 'font-bold' } })).toBe(
			'<p class="mb-4">Hi <strong class="font-bold">there</strong></p>\n'
		);
	});
});

describe('GFM', () => {
	it('slugs headings like GitHub, de-duplicating repeats', () => {
		expect(markdown('# Hello World\n\n## Hello World\n\n### Hello, *World*!', { headingIds: true })).toBe(
			'<h1 id="hello-world">Hello World</h1>\n<h2 id="hello-world-1">Hello World</h2>\n<h3 id="hello-world-2">Hello, <em>World</em>!</h3>\n'
		);
		expect(markdown('# Hi', { headingIds: true, idPrefix: 'doc-' })).toBe('<h1 id="doc-hi">Hi</h1>\n');
	});

	it('numbers footnotes by first reference and links back', () => {
		const md = 'Text[^1] more[^note].\n\n[^1]: First.\n[^note]: Second.';
		expect(markdown(md)).toBe(
			'<p>Text<sup class="footnote-ref"><a href="#fn-1" id="fnref-1" data-footnote-ref>1</a></sup>' +
				' more<sup class="footnote-ref"><a href="#fn-note" id="fnref-note" data-footnote-ref>2</a></sup>.</p>\n' +
				'<section class="footnotes" data-footnotes>\n<ol>\n' +
				'<li id="fn-1">\n<p>First. <a href="#fnref-1" class="footnote-backref" data-footnote-backref data-footnote-backref-idx="1" aria-label="Back to reference 1">↩</a></p>\n</li>\n' +
				'<li id="fn-note">\n<p>Second. <a href="#fnref-note" class="footnote-backref" data-footnote-backref data-footnote-backref-idx="2" aria-label="Back to reference 2">↩</a></p>\n</li>\n' +
				'</ol>\n</section>\n'
		);
	});

	it('leaves unreferenced footnotes and unknown references alone', () => {
		expect(markdown('[^missing] text\n\n[^unused]: nobody points here')).toBe('<p>[^missing] text</p>\n');
	});

	it('renders task list items', () => {
		expect(markdown('- [ ] a\n- [x] b')).toBe(
			'<ul>\n<li><input disabled="" type="checkbox"> a</li>\n<li><input checked="" disabled="" type="checkbox"> b</li>\n</ul>\n'
		);
	});

	it('renders strikethrough and bare autolinks', () => {
		expect(markdown('~~gone~~')).toBe('<p><del>gone</del></p>\n');
		expect(markdown('visit www.example.com.')).toBe(
			'<p>visit <a href="http://www.example.com">www.example.com</a>.</p>\n'
		);
		expect(markdown('mail someone@example.com')).toBe(
			'<p>mail <a href="mailto:someone@example.com">someone@example.com</a></p>\n'
		);
	});

	it('can be switched off', () => {
		expect(markdown('| a |\n|---|', { gfm: false })).toBe('<p>| a |\n|---|</p>\n');
		expect(markdown('~~a~~ www.x.com', { gfm: { strikethrough: false, autolinks: false } })).toBe(
			'<p>~~a~~ www.x.com</p>\n'
		);
	});
});

describe('API', () => {
	it('parses to an mdast-shaped tree', () => {
		expect(parse('# Hi *there*')).toEqual({
			type: 'root',
			children: [
				{
					type: 'heading',
					depth: 1,
					children: [
						{ type: 'text', value: 'Hi ' },
						{ type: 'emphasis', children: [{ type: 'text', value: 'there' }] }
					]
				}
			]
		});
	});

	it('resolves reference links into link nodes', () => {
		expect(parse('[a][ref]\n\n[ref]: /u "T"').children).toEqual([
			{ type: 'paragraph', children: [{ type: 'link', url: '/u', title: 'T', children: [{ type: 'text', value: 'a' }] }] }
		]);
	});

	it('does inline-only markdown without a wrapping <p>', () => {
		expect(markdownInline('**hi** there')).toBe('<strong>hi</strong> there');
		expect(parseInline('`x`')).toEqual([{ type: 'inlineCode', value: 'x' }]);
	});

	it('lets renderers override a node type, falling back when they return undefined', () => {
		const html = markdown('# Title\n\n## Keep', {
			renderers: {
				heading: (node, ctx) =>
					node.depth === 1 ? `<h2 class="title">${ctx.render(node.children)}</h2>\n` : undefined
			}
		});
		expect(html).toBe('<h2 class="title">Title</h2>\n<h2>Keep</h2>\n');
	});

	it('renders a tree more than once identically', () => {
		const tree = parse('a[^1]\n\n[^1]: b');
		expect(markdown('a[^1]\n\n[^1]: b')).toBe(markdown('a[^1]\n\n[^1]: b'));
		expect(tree.children.length).toBe(2);
	});

	it('handles CRLF input and NUL characters', () => {
		expect(markdown('a\r\nb\r\n\r\nc')).toBe('<p>a\nb</p>\n<p>c</p>\n');
		expect(markdown('a\0b')).toBe('<p>a�b</p>\n');
	});
});
