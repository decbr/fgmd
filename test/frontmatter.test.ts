import { describe, expect, it } from 'vitest';
import { frontmatter, markdown, parse } from '../src/index.js';

const detour = ['---', 'title: Detour', 'blurb: detour blurb', '---', '', 'detour copy', ''].join('\n');

describe('frontmatter()', () => {
	it('splits a page into its metadata and its markdown', () => {
		expect(frontmatter(detour)).toEqual({
			data: { title: 'Detour', blurb: 'detour blurb' },
			body: '\ndetour copy\n',
			raw: 'title: Detour\nblurb: detour blurb'
		});
	});

	it('leaves a document without frontmatter alone', () => {
		expect(frontmatter('# hi\n')).toEqual({ data: {}, body: '# hi\n', raw: null });
		// a thematic break, then a setext heading: prose, not metadata
		expect(frontmatter('---\nFoo\n---\nBar\n').raw).toBe(null);
		// never closed
		expect(frontmatter('---\ntitle: x\n').raw).toBe(null);
		// not the first line
		expect(frontmatter('\n---\ntitle: x\n---\n').raw).toBe(null);
		// '---' and nothing else
		expect(frontmatter('---').raw).toBe(null);
	});

	it('reads an empty block, a CRLF document and a BOM', () => {
		expect(frontmatter('---\n---\nhi\n')).toEqual({ data: {}, body: 'hi\n', raw: '' });
		expect(frontmatter('---\r\ntitle: x\r\n---\r\nhi\r\n')).toEqual({ data: { title: 'x' }, body: 'hi\r\n', raw: 'title: x' });
		expect(frontmatter('\ufeff---\ntitle: x\n---\n').data).toEqual({ title: 'x' });
	});

	it('accepts a closing ... and trailing spaces on the fences', () => {
		expect(frontmatter('--- \ntitle: x\n...\nbody\n')).toEqual({ data: { title: 'x' }, body: 'body\n', raw: 'title: x' });
	});

	it('ends the body at the closing fence, even with nothing after it', () => {
		expect(frontmatter('---\ntitle: x\n---\n').body).toBe('');
		expect(frontmatter('---\ntitle: x\n---').body).toBe('');
	});
});

describe('frontmatter values', () => {
	const data = (yaml: string) => frontmatter(`---\n${yaml}\n---\n`).data;

	it('reads strings, numbers, booleans and null', () => {
		expect(data('a: text\nb: 42\nc: -1.5\nd: 2e3\ne: true\nf: FALSE\ng: null\nh: ~\ni:')).toEqual({
			a: 'text',
			b: 42,
			c: -1.5,
			d: 2000,
			e: true,
			f: false,
			g: null,
			h: null,
			i: null
		});
	});

	it('keeps dates, versions and anything else as written', () => {
		expect(data('released: 2026-09-11\nversion: 1.2.3\ntime: 12:30\nratio: 1_000')).toEqual({
			released: '2026-09-11',
			version: '1.2.3',
			time: '12:30',
			ratio: '1_000'
		});
	});

	it('reads quoted strings, with escapes', () => {
		expect(data(`a: 'it''s fine'\nb: "line\\nbreak"\nc: "\\u2764"\nd: "42"\ne: 'true'`)).toEqual({
			a: "it's fine",
			b: 'line\nbreak',
			c: '❤',
			d: '42',
			e: 'true'
		});
	});

	it('keeps a colon or a hash inside a value', () => {
		expect(data('url: https://mcmayhem.live/detour\ntag: c#\nnote: a # comment')).toEqual({
			url: 'https://mcmayhem.live/detour',
			tag: 'c#',
			note: 'a'
		});
	});

	it('skips comments, blank lines and lines that are not entries', () => {
		expect(data('# a note\n\ntitle: x\n\nnonsense\n# another\nblurb: y')).toEqual({ title: 'x', blurb: 'y' });
	});

	it('reads sequences, indented or not', () => {
		expect(data('facts:\n  - one\n  - two')).toEqual({ facts: ['one', 'two'] });
		expect(data('facts:\n- one\n- two')).toEqual({ facts: ['one', 'two'] });
		expect(data('facts: [one, 2, "three", true]')).toEqual({ facts: ['one', 2, 'three', true] });
		expect(data('empty: []\nnothing: {}')).toEqual({ empty: [], nothing: {} });
	});

	it('reads nested mappings and sequences of mappings', () => {
		expect(data('game:\n  name: Detour\n  players:\n    min: 2\n    max: 4')).toEqual({
			game: { name: 'Detour', players: { min: 2, max: 4 } }
		});
		expect(data('credits:\n  - name: Dec\n    role: code\n  - name: Someone\n    role: art')).toEqual({
			credits: [
				{ name: 'Dec', role: 'code' },
				{ name: 'Someone', role: 'art' }
			]
		});
		expect(data('meta: { name: Detour, tags: [a, b] }')).toEqual({ meta: { name: 'Detour', tags: ['a', 'b'] } });
		expect(data('grid:\n  - - 1\n    - 2\n  - - 3')).toEqual({ grid: [[1, 2], [3]] });
	});

	it('reads block scalars, literal and folded', () => {
		expect(data('copy: |\n  one\n  two\n')).toEqual({ copy: 'one\ntwo\n' });
		expect(data('copy: |-\n  one\n  two')).toEqual({ copy: 'one\ntwo' });
		expect(data('copy: >\n  one\n  two\n\n  three')).toEqual({ copy: 'one two\nthree\n' });
		expect(data('copy: >-\n  one\n  two')).toEqual({ copy: 'one two' });
		expect(data('copy: |\n  # not a comment\n\n  still text')).toEqual({ copy: '# not a comment\n\nstill text\n' });
		expect(data('copy: |\n  keep\n\nafter: x')).toEqual({ copy: 'keep\n', after: 'x' });
	});

	it('folds a plain value that runs on to the next line', () => {
		expect(data('blurb: a long\n  sentence, continued\ntitle: x')).toEqual({
			blurb: 'a long sentence, continued',
			title: 'x'
		});
	});

	it('takes the last of a repeated key', () => {
		expect(data('title: first\ntitle: second')).toEqual({ title: 'second' });
	});

	it('survives malformed and hostile blocks', () => {
		expect(data('a: [1, 2')).toEqual({ a: [1, 2] });
		expect(data('a: "unterminated')).toEqual({ a: '"unterminated' });
		expect(data('a: { b: 1')).toEqual({ a: { b: 1 } });
		expect(data(`${'- '.repeat(400)}x`)).toEqual({});
		const deep = Array.from({ length: 500 }, (_, i) => '  '.repeat(i) + 'k:').join('\n');
		expect(() => data(deep)).not.toThrow();
		expect(() => data(`a: ${'['.repeat(5000)}`)).not.toThrow();
	});
});

describe('parsing with { frontmatter: true }', () => {
	it('keeps the block out of the HTML and puts its values on the tree', () => {
		expect(markdown(detour, { frontmatter: true })).toBe('<p>detour copy</p>\n');
		const tree = parse(detour, { frontmatter: true });
		expect(tree.data?.frontmatter).toEqual({ title: 'Detour', blurb: 'detour blurb' });
		expect(tree.children[0]).toEqual({ type: 'yaml', value: 'title: Detour\nblurb: detour blurb' });
		expect(tree.children[1]).toEqual({ type: 'paragraph', children: [{ type: 'text', value: 'detour copy' }] });
	});

	it('is off by default, where --- is a thematic break', () => {
		expect(markdown(detour)).toBe('<hr />\n<h2>title: Detour\nblurb: detour blurb</h2>\n<p>detour copy</p>\n');
		expect(parse(detour).data).toBeUndefined();
	});

	it('leaves a document without a block untouched', () => {
		expect(markdown('# hi\n', { frontmatter: true })).toBe('<h1>hi</h1>\n');
		expect(markdown('---\nFoo\n---\nBar\n', { frontmatter: true })).toBe('<hr />\n<h2>Foo</h2>\n<p>Bar</p>\n');
		expect(parse('# hi\n', { frontmatter: true }).data).toBeUndefined();
	});

	it('renders the body the same as if the block had never been there', () => {
		const body = '# Detour\n\n> a quote\n\n- one\n- two\n';
		expect(markdown(`---\ntitle: x\n---\n${body}`, { frontmatter: true })).toBe(markdown(body));
	});

	it('a renderer can draw the block if it wants to', () => {
		expect(
			markdown(detour, { frontmatter: true, renderers: { yaml: (node) => `<pre class="meta">${node.value}</pre>\n` } })
		).toBe('<pre class="meta">title: Detour\nblurb: detour blurb</pre>\n<p>detour copy</p>\n');
	});

	it('survives sanitising and inline parsing', () => {
		expect(markdown(detour, { frontmatter: true, html: 'sanitize' })).toBe('<p>detour copy</p>\n');
		expect(parse(detour, { frontmatter: true, html: 'sanitize' }).data?.frontmatter).toEqual({
			title: 'Detour',
			blurb: 'detour blurb'
		});
	});
});
