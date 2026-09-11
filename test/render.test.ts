import { describe, expect, it } from 'vitest';
import { markdown } from '../src/index.js';

describe('highlight', () => {
	it('replaces the code with the highlighter\'s HTML', () => {
		expect(markdown('```js\nx\n```', { highlight: (_code, lang) => `<b>${lang}</b>` })).toBe(
			'<pre><code class="language-js"><b>js</b></code></pre>\n'
		);
	});

	it('uses a whole <pre> as the block, and falls back when given nothing', () => {
		expect(markdown('```js\nx\n```', { highlight: () => '<pre class="shiki">X</pre>' })).toBe('<pre class="shiki">X</pre>\n');
		expect(markdown('```\n<x>\n```', { highlight: () => undefined })).toBe('<pre><code>&lt;x&gt;\n</code></pre>\n');
	});
});

describe('heading anchors', () => {
	it('adds a link before the text by default', () => {
		expect(markdown('# Hi there', { headingAnchors: true })).toBe(
			'<h1 id="hi-there"><a class="anchor" href="#hi-there" aria-label="Link to this section: Hi there">#</a>Hi there</h1>\n'
		);
	});

	it('can go after the text, or wrap it', () => {
		expect(markdown('# Hi there', { headingAnchors: { position: 'after', symbol: '¶' } })).toBe(
			'<h1 id="hi-there">Hi there <a class="anchor" href="#hi-there" aria-label="Link to this section: Hi there">¶</a></h1>\n'
		);
		expect(markdown('# Hi there', { headingAnchors: { position: 'wrap' } })).toBe(
			'<h1 id="hi-there"><a class="anchor" href="#hi-there">Hi there</a></h1>\n'
		);
	});
});

describe('figures', () => {
	it('turns a lone titled image into a figure', () => {
		expect(markdown('![alt](/a.png "Caption")', { figures: true })).toBe(
			'<figure>\n<img src="/a.png" alt="alt" />\n<figcaption>Caption</figcaption>\n</figure>\n'
		);
	});

	it('leaves untitled images and images among text alone', () => {
		expect(markdown('![alt](/a.png)', { figures: true })).toBe('<p><img src="/a.png" alt="alt" /></p>\n');
		expect(markdown('see ![alt](/a.png "t")', { figures: true })).toBe('<p>see <img src="/a.png" alt="alt" title="t" /></p>\n');
	});
});

describe('footnote styles', () => {
	const source = 'Text[^a].\n\n[^a]: **Title.** Body.';
	const reference = '<p>Text<sup class="footnote-ref"><a href="#fn-a" id="fnref-a" data-footnote-ref>1</a></sup>.</p>\n';

	it('adds a heading and custom back links to the section', () => {
		const out = markdown(source, { footnotes: { heading: 'Notes', backref: '^', backrefLabel: 'Up to {n}' } });
		expect(out).toContain('<section class="footnotes" data-footnotes>\n<h2 class="footnotes-heading">Notes</h2>\n<ol>');
		expect(out).toContain('aria-label="Up to 1">^</a>');
	});

	it('writes collapsible <details>, titled from a leading **bold**', () => {
		expect(markdown(source, { footnotes: { style: 'details' } })).toBe(
			reference +
				'<section class="footnotes footnotes-details" data-footnotes>\n' +
				'<details class="footnote" id="fn-a">\n<summary><span class="fn-num">1</span> Title.</summary>\n<p>Body.</p>\n' +
				'<p class="fn-back"><a href="#fnref-a" class="footnote-backref" data-footnote-backref data-footnote-backref-idx="1" aria-label="Back to reference 1">↩</a></p>\n' +
				'</details>\n</section>\n'
		);
	});

	it('puts one-paragraph footnotes inline as sidenotes', () => {
		expect(markdown('A[^1] b.\n\n[^1]: Side note.', { footnotes: { style: 'sidenote' } })).toBe(
			'<p>A<sup class="footnote-ref sidenote-ref"><a href="#fn-1" id="fnref-1" data-footnote-ref>1</a></sup>' +
				'<span class="sidenote" id="fn-1"><span class="sidenote-number">1</span> Side note.</span> b.</p>\n'
		);
	});

	it('still collects longer footnotes at the end in sidenote style', () => {
		const out = markdown('A[^1].\n\n[^1]: One.\n\n    Two.', { footnotes: { style: 'sidenote' } });
		expect(out).not.toContain('sidenote');
		expect(out).toContain('<section class="footnotes"');
	});
});
