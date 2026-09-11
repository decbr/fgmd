// html: 'sanitize' must be safe for anything a stranger can type
import { describe, expect, it } from 'vitest';
import { markdown, parse, type MarkdownOptions } from '../src/index.js';

const s = (md: string, extra: MarkdownOptions = {}) => markdown(md, { html: 'sanitize', ...extra });

describe('sanitize', () => {
	it('keeps allowed tags as real elements', () => {
		expect(s('a <b>bold</b> <kbd>Ctrl</kbd>')).toBe('<p>a <b>bold</b> <kbd>Ctrl</kbd></p>\n');
		expect(parse('<b>x</b>', { html: 'sanitize' }).children[0]).toEqual({
			type: 'paragraph',
			children: [{ type: 'element', tagName: 'b', properties: {}, children: [{ type: 'text', value: 'x' }] }]
		});
	});

	it('drops event handlers and styles, whatever their case', () => {
		expect(s('<b onclick="x()" style="color:red" title="t">x</b>')).toBe('<p><b title="t">x</b></p>\n');
		expect(s('<B ONCLICK="x">y</B>')).toBe('<p><b>y</b></p>\n');
	});

	it('removes script, style, iframe and svg together with their content', () => {
		expect(s('<script>alert(1)</script>')).toBe('');
		expect(s('<style>body{display:none}</style>')).toBe('');
		expect(s('x <iframe src="https://evil"></iframe> y')).toBe('<p>x  y</p>\n');
		expect(s('<svg><script>alert(1)</script></svg>x')).toBe('<p>x</p>\n');
	});

	it('rejects javascript: URLs however they are spelled', () => {
		expect(s('<a href="javascript:alert(1)">x</a>')).toBe('<p><a>x</a></p>\n');
		expect(s('<a href="&#106;avascript:alert(1)">x</a>')).toBe('<p><a>x</a></p>\n');
		expect(s('<a href="java&#9;script:alert(1)">x</a>')).toBe('<p><a>x</a></p>\n');
		expect(s('<a href=" javascript:alert(1)">x</a>')).toBe('<p><a>x</a></p>\n');
		expect(s('<a href=javascript:alert(1)>x</a>')).toBe('<p><a>x</a></p>\n');
		expect(s('<img src="x" onerror="alert(1)">')).toBe('<img src="x" />\n');
		expect(s('<img src="data:image/svg+xml,<svg onload=alert(1)>">')).not.toContain('data:');
	});

	it('escapes attribute values, so quotes can\'t break out', () => {
		const out = s('<a href="/a&quot;onmouseover=&quot;x" title="a&lt;b">x</a>');
		expect(out).toContain('href="/a&quot;onmouseover=&quot;x"');
		expect(out).toContain('title="a&lt;b"');
	});

	it('can\'t close the page\'s own elements', () => {
		const out = s('</div></div>hi');
		expect(out).not.toContain('</div>');
		expect(out).toContain('hi');
	});

	it('closes tags left open at the end of their paragraph', () => {
		expect(s('<em>unclosed and <b>bold')).toBe('<p><em>unclosed and <b>bold</b></em></p>\n');
	});

	it('keeps the markdown between block tags inside the element', () => {
		expect(s('<details>\n<summary>More</summary>\n\n**hidden**\n\n</details>')).toBe(
			'<details>\n<summary>More</summary>\n<p><strong>hidden</strong></p>\n</details>\n'
		);
	});

	it('unwraps tags it doesn\'t allow, keeping their text', () => {
		expect(s('x <blink>hi</blink> <input name="x">')).toBe('<p>x hi </p>\n');
		// <form> opens an HTML block, so what survives is loose text, not a paragraph
		expect(s('<form><input name="x"><blink>hi</blink></form>')).toBe('hi');
	});

	it('removes comments', () => {
		expect(s('a <!-- x --> b')).toBe('<p>a  b</p>\n');
	});

	it('lets the allowlist be changed', () => {
		expect(
			s('<span class="x" id="y">a</span>', {
				sanitize: { attributes: (d) => ({ ...d, '*': [...(d['*'] ?? []), 'class'] }) }
			})
		).toBe('<p><span class="x">a</span></p>\n');
		expect(s('<u>x</u>', { sanitize: { tags: (d) => d.filter((t) => t !== 'u') } })).toBe('<p>x</p>\n');
	});

	it('still runs URLs through a custom urlPolicy', () => {
		expect(s('<a href="https://x.y">x</a>', { urlPolicy: (url) => (url.startsWith('/') ? url : null) })).toBe(
			'<p><a>x</a></p>\n'
		);
	});
});
