// the Svelte component and renderHtml must produce the same markup. Svelte's SSR output differs
// in insignificant ways (hydration comments, whitespace, <br> vs <br />, which characters get
// escaped), so both sides are normalised before comparing.
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import InlineMarkdown from '../src/svelte/InlineMarkdown.svelte';
import Markdown from '../src/svelte/Markdown.svelte';
import {
	abbreviations,
	attributes,
	callouts,
	definitionLists,
	emoji,
	markdown,
	markdownInline,
	math,
	typography,
	wikilinks,
	type MarkdownOptions,
	type Plugin
} from '../src/index.js';
import Snippets from './fixtures/Snippets.svelte';

function normalize(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\s*\/>/g, '>')
		.replace(/=""/g, '')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&gt;/g, '>')
		.replace(/&lt;/g, '<')
		.replace(/>\s+/g, '>')
		.replace(/\s+</g, '<')
		.replace(/\s+/g, ' ')
		.trim();
}

function svelte(props: Record<string, unknown>): string {
	return render(Markdown, { props }).body;
}

const kitchenSink = `# Heading *one*

Paragraph with **strong**, _em_, ~~del~~, \`code\`, a [link](https://example.com "title"), and an ![image](/i.png "t").
Second line with a hard break
after it. 1 < 2 & "quotes".

> quote with a list:
> - one
> - two

1. first
2. second
   - nested [x](/y)

3) third

- [ ] task
- [x] done
- [ ] > quoted task

- loose

- list

| Left | Center | Right |
|:-----|:------:|------:|
| a    | b      | c     |
| d |

\`\`\`js
const x = 1 < 2;
\`\`\`

---

## Heading *one*

Footnote here[^a] and again[^a], plus [^b].

[^a]: The note with *style*.

[^b]: > quoted footnote

www.example.com and someone@example.com, [bad](javascript:alert(1)) and ![bad](javascript:x)
`;

const pluginSink = `# Heading {#custom .big}

> [!WARNING] Careful
> Body **text**.

> [!NOTE]-
> Folded.

:::details More
Hidden *stuff*.
:::

:::box
Plain container.
:::

==marked== H~2~O x^2^ "quoted" it's -- dash --- em... ||Ctrl||

Apple
: A fruit.

Other

: Loose def

*[HTML]: HyperText Markup Language

HTML rocks. $e=mc^2$ and $5. :tada: [[Some Page|a link]] ![[pic.png]]

$$
x = 1
$$

![photo](/a.jpg "A caption")

Footnote[^1] and side[^2].

[^1]: **Title.** Body.

[^2]: Short.
`;

const htmlSink = `Inline <b>bold</b> and <a href="/x" onclick="evil()">link</a> and <em>unclosed

<details>
<summary>More</summary>

**hidden**

</details>

<div>
text <span title="t">span</span>
</div>

<script>alert(1)</script>
`;

// a custom node drawn purely through data.hName
const keycap: Plugin = {
	name: 'keycap',
	inline: [
		{
			triggers: '|',
			parse(state) {
				const m = state.match(/\|\|([^|\s]+)\|\|/);
				return m ? ({ type: 'keycap', data: { hName: 'kbd', hProperties: { class: 'key' } }, children: [{ type: 'text', value: m[1] }] } as never) : null;
			}
		}
	]
};

const plugins = [
	callouts(),
	typography(),
	attributes(),
	definitionLists(),
	abbreviations(),
	math(),
	emoji({ map: { tada: '🎉' } }),
	wikilinks(),
	keycap
];

const variants: [string, string, MarkdownOptions][] = [
	['defaults', kitchenSink, {}],
	[
		'every render option',
		kitchenSink,
		{
			breaks: true,
			headingIds: true,
			idPrefix: 'd-',
			lazyImages: true,
			tableWrapperClass: 'scroll',
			classes: { p: 'para', a: 'link', li: 'item', code: 'mono', h1: 'big', input: 'box', sup: 'fn' },
			linkAttrs: (url) => (url.startsWith('/') ? null : { target: '_blank', rel: 'noreferrer' })
		}
	],
	['every plugin, figures and anchors', pluginSink, { plugins, figures: true, headingAnchors: true }],
	['anchors after', pluginSink, { plugins, headingAnchors: { position: 'after', symbol: '¶' } }],
	['anchors wrapping', pluginSink, { plugins, headingAnchors: { position: 'wrap' } }],
	['details footnotes', pluginSink, { plugins, footnotes: { style: 'details', heading: 'Notes', backref: '^' } }],
	['sidenotes', pluginSink, { plugins, footnotes: { style: 'sidenote' } }],
	['sanitised html', htmlSink, { html: 'sanitize' }]
];

describe('Svelte component matches renderHtml', () => {
	for (const [name, source, options] of variants) {
		it(name, () => {
			expect(normalize(svelte({ source, ...options }))).toBe(normalize(markdown(source, options)));
		});
	}

	it('unwrapped image paragraphs', () => {
		const md = '![](a.jpg)\n![](b.jpg)\n\ntext ![](c.jpg)';
		const options = { unwrapImages: true, breaks: true };
		expect(normalize(svelte({ source: md, ...options }))).toBe(normalize(markdown(md, options)));
	});

	it('leaves a frontmatter block out, like renderHtml', () => {
		const md = '---\ntitle: Detour\nblurb: detour blurb\n---\n\ndetour copy\n';
		const out = svelte({ source: md, frontmatter: true });
		expect(normalize(out)).toBe(normalize(markdown(md, { frontmatter: true })));
		expect(out).not.toContain('Detour');
	});

	it('inline mode', () => {
		const md = '**hi** _there_ [x](/y)';
		expect(normalize(svelte({ source: md, inline: true }))).toBe(normalize(markdownInline(md)));
	});
});

describe('InlineMarkdown matches markdownInline', () => {
	const cases: [string, MarkdownOptions][] = [
		['**hi** _there_ [x](/y) `code`', {}],
		['a &amp; b &notin; c &notit; d \\*kept\\*', {}],
		['~~gone~~ <https://a.b> www.c.d ![alt](i.png "t") [bad](javascript:x)', { classes: { a: 'link', img: 'pic' } }],
		['line one  \nline two', { breaks: true }],
		['==mark== ^sup^ :tada: $x^2$', { plugins: [typography(), emoji({ map: { tada: '🎉' } }), math()] }],
		['a <b onclick="x()">b</b>', { html: 'sanitize' }],
		['[ext](https://e.com) [int](/i)', { linkAttrs: (url) => (url.startsWith('/') ? null : { target: '_blank', rel: 'ugc' }) }]
	];

	for (const [md, options] of cases) {
		it(md, () => {
			const out = render(InlineMarkdown, { props: { source: md, ...options } }).body;
			expect(normalize(out)).toBe(normalize(markdownInline(md, options)));
			expect(normalize(out)).toBe(normalize(svelte({ source: md, inline: true, ...options })));
		});
	}
});

describe('Svelte component safety', () => {
	it('never emits raw HTML, even when the tree contains some', () => {
		const out = svelte({ source: 'a <b onclick="x()">b</b>\n\n<div>block</div>', html: true });
		expect(out).not.toContain('<b');
		expect(out).not.toContain('<div');
		expect(out).toContain('&lt;b onclick="x()">');
	});

	it('draws sanitised HTML as real elements', () => {
		const source = 'a <b onclick="x()">b</b> <script>x</script>';
		const out = normalize(svelte({ source, html: 'sanitize' }));
		expect(out).toBe(normalize(markdown(source, { html: 'sanitize' })));
		expect(out).toContain('<b>b</b>');
		expect(out).not.toContain('onclick');
		expect(out).not.toContain('script');
	});
});

describe('Svelte snippet overrides', () => {
	// normalize() drops whitespace next to tags, hence "</a>b" and "let x</div>"
	const out = normalize(
		render(Snippets, { props: { source: '# Title\n\n[a](/x) [b](javascript:alert(1))\n\n```js\nlet x\n```' } }).body
	);

	it('replaces how node types render, keeping the computed attributes', () => {
		expect(out).toBe('<h2>Title</h2><p><a href="/x" data-custom="yes">a</a>b</p><div class="code-box" data-lang="js">let x</div>');
	});

	it('is not asked to draw a link whose URL the policy rejects', () => {
		expect(out).not.toContain('javascript');
	});
});
