# fgmd

A f***ing good markdown parser.

- **Correct.** Passes all 652 examples in the CommonMark 0.31.2 spec and all 24 GFM extension examples. The test suite fails if either count ever drops.
- **Safe by default.** Raw HTML shows up as text unless you opt in, and `html: 'sanitize'` allows a GitHub-like subset rebuilt as real elements. Links and images may only use http, https, mailto, tel, or relative URLs. The Svelte component contains no `{@html}`, and hostile input can't hang or crash the parser.
- **Extensible.** Eight built-in plugins: callouts, typography, attributes, definition lists, abbreviations, math, emoji and wikilinks. A plugin API adds inline syntax, block syntax and tree transforms, and each built-in is written against that same API.
- **Customisable.** Per-element classes and URL policies. Replace any node's HTML, or draw any node with your own Svelte snippet.
- **Usable from any language.** A single-file CLI with a streaming mode lets PHP, Python, Ruby or Go builds use it too.
- **Zero runtime dependencies.** The library uses no Node APIs (only the CLI does), so it runs in Node, Deno and browsers alike.

```sh
npm install fgmd
```

```js
import { markdown, callouts, math } from 'fgmd';

markdown('# Hello *world*');
// '<h1>Hello <em>world</em></h1>\n'

markdown('> [!TIP]\n> $e = mc^2$', { plugins: [callouts(), math()] });
```

## Syntax

**CommonMark covers:**
- ATX and setext headings
- paragraphs
- `*`/`_` emphasis and strong
- code spans
- fenced and indented code
- block quotes
- nested ordered and bullet lists, loose or tight
- thematic breaks
- inline and reference links and images, with titles and balanced parentheses
- `<autolinks>`
- hard line breaks
- entities and backslash escapes
- raw HTML (opt-in)

**GFM adds:**
- tables with alignment
- `~~strikethrough~~`
- `- [x]` task lists
- `[^1]` footnotes
- bare `www.`/`https://`/email autolinks

**Additions beyond both specs:**
- **Comments never ship.** HTML comments and `[//]: # (…)` comment lines are removed, including ones whose note contains parentheses, as in a commented-out image. `keepComments: true` turns this off. Comments inside code are left alone.
- **`unwrapImages`.** A paragraph that holds only images (plus inline HTML like `<video>`) loses its `<p>`, which makes CSS photo grids easy.
- **`breaks` respects a hand-written `<br>`.** A newline straight after a raw `<br>` doesn't become a second break.

Everything else lives in plugins.

## Plugins

Pass plugins as objects, or by name so plain JSON configs (the CLI, PHP) can use them:

```js
import { markdown, callouts, typography, emoji } from 'fgmd';
import { gemoji } from 'fgmd/emoji';

markdown(source, { plugins: [callouts(), typography({ smart: { quotes: '„“‚‘' } }), emoji({ map: gemoji })] });
markdown(source, { plugins: ['callouts', 'typography', ['emoji', { map: { tada: '🎉' } }]] });
```

| plugin | syntax | output |
| --- | --- | --- |
| `callouts({ types, className, containers })` | GitHub alerts `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` (plus your own types). A title can follow the marker: `> [!TIP] Pro tip`. `[!NOTE]-` / `[!NOTE]+` make it collapsible, starting closed or open. `:::name Title` … `:::` containers; `:::details` folds. | `<aside class="callout callout-note"><p class="callout-title">…`, `<details>` when collapsible, `<div class="name">` for other containers |
| `typography({ mark, superscript, subscript, smart })` | `==mark==`, `^sup^`, `~sub~`, and smart quotes/dashes/ellipses. With `subscript` on, a single `~` means subscript while `~~` stays strikethrough. `smart: { quotes: '“”‘’', dashes, ellipses }` | `<mark>`, `<sup>`, `<sub>`, “ ” ‘ ’ – — … |
| `attributes({ allow })` | `{#id .class key=val}`: at the end of a heading or paragraph, straight after a link, image, code span or emphasis (`![x](a.jpg){width=300}`), or in a fence's info string (` ```js {.numbered} `). `on*` and `style` are never allowed, and the other keys go through an allowlist, so it's safe for user content. | attributes on that element |
| `definitionLists()` | `Term` then `: definition` lines. Indented lines continue a definition, and a blank line after the term makes it loose. | `<dl><dt><dd>` |
| `abbreviations({ titles })` | `*[HTML]: HyperText Markup Language` anywhere in the document, plus `titles` from options | `<abbr title="…">HTML</abbr>` on whole words |
| `math({ render })` | `$inline$` (Pandoc rules: `$5 and $10` stays money), `$$display$$`, and `$$` fenced blocks | `<span class="math math-inline">` / `<div class="math math-display">` holding escaped TeX, ready for KaTeX auto-render. Pass `render: (tex, { display }) => katex.renderToString(tex, { displayMode: display })` for HTML output |
| `emoji({ map, lookup })` | `:shortcode:` | the emoji. `fgmd/emoji` exports GitHub's full set (`gemoji`); `lookup` can return nodes, e.g. custom images |
| `wikilinks({ resolve, exists, embeds, resolveEmbed })` | `[[Page]]`, `[[Page\|label]]`, `[[Page#Heading]]`, `![[image.png]]` | `<a class="wikilink">`, plus `wikilink-new` when `exists(page)` is false |

### Writing a plugin

A plugin is a plain object. Every hook is optional:

```ts
import { mapText, type Plugin } from 'fgmd';

const mentions: Plugin = {
  name: 'mentions',

  // new inline syntax, tried at its trigger characters before fgmd's own
  inline: [{
    triggers: '@',
    parse(state) {
      if (/\w/.test(state.charBefore())) return null;          // not the @ in an email
      const m = state.match(/@([a-z0-9_]+)/i);                 // matched at state.pos, which then advances
      if (!m) return null;                                     // decline: fgmd carries on as normal
      return { type: 'link', url: `/u/${m[1]}`, title: null,
               children: [{ type: 'text', value: m[0] }],
               data: { hProperties: { class: 'mention' } } };
    }
  }],

  // wrapping syntax from a repeated character: ++inserted++. goes through the same
  // algorithm as *emphasis*, so it nests and interleaves correctly
  delimiters: [{ char: '+', lengths: { 2: 'insert' } }],

  // block syntax: a raw fence, a markdown container, or a single line
  block: [
    { kind: 'fence', char: '%', length: 3, node: (content, info) => ({ type: 'code', lang: 'mermaid', meta: info || null, value: content }) },
    { kind: 'container', names: ['aside'], node: (c) => { c.data = { hName: 'aside' }; } },
    { kind: 'line', match: /^\[\[toc\]\]$/, node: () => ({ type: 'html', value: '<nav class="toc"></nav>' }) }
  ],

  // lines consumed from the start of a paragraph, the way [ref]: /url is
  definitions: [{ match: /%define (\w+) (.*)/, define: (m, ctx) => { ctx.data[m[1]] = m[2]; } }],

  // edit the parsed tree
  transform(tree, ctx) {
    mapText(tree, (text) => text.value.includes('{{') ? [{ type: 'text', value: text.value.replace(/\{\{(\w+)\}\}/g, (_, k) => String(ctx.data[k] ?? '')) }] : undefined);
  },

  // HTML for node types fgmd doesn't know (your own renderers option overrides these)
  renderers: { insert: (node, ctx) => `<ins>${ctx.children()}</ins>` }
};
```

A node type neither renderer knows draws itself from `data.hName`/`data.hProperties`, in HTML and Svelte alike: `{ type: 'keycap', data: { hName: 'kbd' }, children: […] }`. You only need a renderer for anything fancier.

For TypeScript, declare custom nodes the way mdast does:

```ts
declare module 'fgmd' {
  interface PhrasingContentMap { insert: { type: 'insert'; children: PhrasingContent[] } }
}
```

To let JSON configs name your plugin, call `registerPlugin('mentions', () => mentions)`.

## Options

Every option is optional, and `markdown()` takes both kinds.

**Parsing:**

| option | default | |
| --- | --- | --- |
| `html` | `false` | Raw HTML. `false` shows it as text. `true` passes it through untouched; use that only for content you wrote. `'sanitize'` allows a safe subset (see below). |
| `sanitize` | GitHub-like | What `html: 'sanitize'` lets through: `{ tags, attributes }`, each a list/map or a function that edits `SANITIZE_DEFAULTS`. |
| `plugins` | `[]` | See Plugins. |
| `gfm` | `true` | `false` turns off every GFM extension. An object `{ tables, strikethrough, tasklists, autolinks, footnotes, tagfilter }` picks individually; everything except `tagfilter` defaults to on. |
| `indentedCode` | `true` | 4-space indented code blocks. |
| `keepComments` | `false` | Keep HTML comments. They only render with `html: true`. |

**Rendering:**

| option | default | |
| --- | --- | --- |
| `breaks` | `false` | Render single newlines as `<br>`, the way GitHub comments do. |
| `allowedSchemes` | `['http','https','mailto','tel']` | URL schemes links and images may use. Relative URLs are always allowed. |
| `urlPolicy` | | `(url, kind) => url \| null`. Full control: return a (possibly rewritten) URL, or `null` to reject. A rejected link renders as its plain label, a rejected image as its alt text. Also applies to sanitised HTML. |
| `linkAttrs` | | `(url) => attributes`, e.g. `target`/`rel` for external links. |
| `classes` | | A class per element name: `{ p: 'mb-4', a: 'text-accent', code: 'font-mono', aside: 'callout' }`. |
| `headingIds` | `false` | GitHub-style slugs (`hello-world`, `hello-world-1`, …). An id set with `{#id}` wins. |
| `headingAnchors` | `false` | A clickable link on every heading (turns `headingIds` on): `true`, or `{ position: 'before' \| 'after' \| 'wrap', symbol: '#', className: 'anchor', label }`. |
| `figures` | `false` | A paragraph that is just one titled image becomes `<figure><img><figcaption>title</figcaption></figure>`. |
| `footnotes` | section | `{ style, heading, backref, backrefLabel }`. `style: 'section'` gives GitHub's numbered list. `'details'` gives a collapsible `<details class="footnote">` each, and a footnote starting with `**Title**` uses it as the summary. `'sidenote'` puts one-paragraph footnotes inline beside their reference, for margin notes. |
| `highlight` | | `(code, lang, meta) => html` for code blocks (HTML output). Return the code's inner HTML, or a whole `<pre>…</pre>` (shiki does), or nothing to keep plain escaped code. |
| `lazyImages` | `false` | Adds `loading="lazy"` to images. |
| `unwrapImages` | `false` | See above. |
| `tableWrapperClass` | | Wraps each table in `<div class="…">`, e.g. for sideways scrolling on phones. |
| `idPrefix` | `''` | Prefix for every generated id, when one page holds several documents. |
| `renderers` | | `{ [nodeType]: (node, ctx) => html \| undefined }`. Replaces how a node type renders; return `undefined` to fall back to the default. The context offers `ctx.children()`, `ctx.attributes` (fgmd's URL-checked attributes), `ctx.default()` (the built-in output, e.g. to wrap it) and `ctx.render(nodes)`. HTML output only. |

## Safety

With the defaults, `markdown()` output is safe to put on a page even when anyone can write the input:
- raw HTML is escaped
- `javascript:`, `data:`, `vbscript:` and every other non-listed scheme are refused (including `JaVaScRiPt:`, entity-encoded and tab-split spellings)
- all text and attributes are escaped
- quotes, lists, containers and inline formatting nested more than 100 deep are kept as text
- the inputs that make naive parsers quadratic are covered by tests, following cmark's pathological suite

**`html: 'sanitize'`** is for content like comments or wiki edits, where people should get *some* HTML.
- **How it works:** raw HTML is tokenised and rebuilt as real element nodes, not filtered as a string. Each tag's scope is its own paragraph or container, so a user can't leave a tag open across your page or close your layout with a stray `</div>`.
- **Allowed by default:** GitHub-like, including `b`, `i`, `em`, `strong`, `code`, `kbd`, `sub`, `sup`, `mark`, `del`, `ins`, `s`, `u`, `br`, `hr`, `p`, `div`, `span`, `details`, `summary`, lists, tables, `img`, `picture`/`source`, `video`/`audio`, `figure`/`figcaption`, `abbr`, `q`, `time` and `ruby`.
- **Removed:** `script`, `style`, `iframe`, `object`, `svg`, `math`, `template` and similar, together with their content. Event handlers and `style` attributes are always dropped.
- **URLs:** `href`/`src`/`cite`/`poster` go through `urlPolicy`.
- **`class` and `id`:** off by default. They'd let a comment dress up as your UI or clobber globals your scripts read.

**`html: true`** hands authors the whole of HTML, including `<script>` and `onerror=`. Use it only for content you wrote. `gfm: { tagfilter: true }` is GitHub's filter for a few dangerous tags, but it is not a sanitiser.

## Svelte

Svelte 5 is an optional peer dependency.

```svelte
<script>
  import { Markdown } from 'fgmd/svelte';
  import { callouts } from 'fgmd';
  import source from './privacy.md?raw';
</script>

<Markdown {source} plugins={[callouts()]} classes={{ h2: 'text-2xl mt-10', p: 'mb-4 text-muted' }} />

<!-- short copy: inline markdown, no <p> -->
<p class="lede"><Markdown source={game.blurb} inline /></p>
```

Draw any node your own way with a snippet named after its type:

```svelte
<Markdown {source}>
  {#snippet link({ attributes, children })}
    <a {...attributes} data-sveltekit-preload-data>{@render children()}</a>
  {/snippet}
  {#snippet code({ node })}
    <Highlight lang={node.lang} code={node.value} />
  {/snippet}
  {#snippet image({ node, attributes })}
    <enhanced:img {...attributes} />
  {/snippet}
</Markdown>
```

Each snippet gets:
- `node`
- `attributes`: what fgmd would put on the element, already URL-checked, with your classes
- `children`: renders the node's content normally

A link or image whose URL the policy rejects never reaches your snippet. Snippets also work for custom plugin node types. For the `html` node type, pass `html={snippet}`; the prop still accepts `true`/`'sanitize'` as the option.

The component takes every option above except `renderers` and `highlight`, which are for HTML output; use snippets instead. It also takes:
- `source`
- `ast`: a tree you parsed yourself
- `inline`

It has no `{@html}`. Raw HTML under `html: true` appears as literal text, while `html: 'sanitize'` draws the allowed HTML as real elements. Its output matches `markdown()` element for element; the test suite checks this for every node, option and plugin.

## Other languages: the CLI

```sh
fgmd post.md > post.html
cat post.md | fgmd --options '{"html":true,"breaks":true}' --plugins callouts,typography,emoji
```

`npm run build` also produces `dist/fgmd.mjs`, the whole CLI in one file with no imports. You can copy it into a project that has no `package.json` and run it with plain `node`. There, the `emoji` plugin includes GitHub's full shortcode set.

For builds that render many documents, `--serve` keeps one process alive:
- **Requests:** one JSON object per line on stdin, `{"src": "…", "options"?: {…}, "inline"?: true}`. `options.plugins` takes names.
- **Responses:** one line each on stdout, in order: `{"html": "…"}` or `{"error": "…"}`.
- **Defaults:** options given on the command line apply to every request.

From PHP:

```php
const FGMD_OPTIONS = ['html' => true, 'breaks' => true, 'plugins' => ['callouts', 'typography']];

function markdown(string $text): string {
    static $proc = null, $pipes = [];
    if ($proc === null) {
        $proc = proc_open(
            ['node', __DIR__ . '/tools/fgmd.mjs', '--serve', '--options', json_encode(FGMD_OPTIONS)],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => STDERR],
            $pipes
        );
        if (!is_resource($proc)) {
            fwrite(STDERR, "could not start fgmd\n");
            exit(1);
        }
    }
    fwrite($pipes[0], json_encode(['src' => $text], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n");
    $line = fgets($pipes[1]);
    $response = $line === false ? null : json_decode($line, true);
    if (!isset($response['html'])) {
        fwrite(STDERR, 'fgmd failed: ' . ($response['error'] ?? 'no response - is node installed?') . "\n");
        exit(1);
    }
    return $response['html'];
}
```

## The tree

```js
import { parse, parseInline, renderHtml, toString, visit, mapText } from 'fgmd';

const tree = parse(source, { plugins: ['math'] });   // plain JSON: read it, transform it, cache it
visit(tree, (node) => { if (node.type === 'heading') console.log(toString(node.children)); });
const html = renderHtml(tree, { headingAnchors: true });
```

Nodes follow mdast's names and fields:
- **Block nodes:** `paragraph`, `heading{depth}`, `blockquote`, `list{ordered,start,spread}`, `listItem{checked}`, `code{lang,meta,value}`, `table{align}`, `tableRow`, `tableCell`, `thematicBreak`, `html`, `footnoteDefinition`.
- **Inline nodes:** `text`, `emphasis`, `strong`, `delete`, `inlineCode`, `break`, `link{url,title}`, `image{url,alt,title}`, `footnoteReference`.
- **From plugins and sanitising:** `container`, `math`, `inlineMath`, `mark`, `superscript`, `subscript`, `abbr`, `definitionList`/`definitionTerm`/`definitionDescription`, `element{tagName,properties}`.

Any node can carry `data: { hName, hProperties }` rendering hints. There are two differences from mdast:
- Reference links arrive already resolved as `link`/`image`.
- There are no position fields.

Helpers:
- `visit(tree, fn)` walks every node; returning `false` skips a node's children.
- `mapText(tree, fn, skip?)` replaces text nodes.
- `toString(nodes)` gives plain text.

## Recipes

A personal site whose posts mix Markdown with hand-written HTML, where every newline is a line break:

```js
markdown(post, { html: true, breaks: true, lazyImages: true, unwrapImages: true, figures: true,
                 tableWrapperClass: 'table-wrap', footnotes: { style: 'details', heading: 'Footnotes' },
                 plugins: ['typography', 'callouts'] });
```

User comments, with a little HTML allowed:

```js
markdown(comment, { html: 'sanitize', breaks: true, linkAttrs: () => ({ rel: 'nofollow ugc noopener' }) });
```

Documents on a site that doesn't allow `{@html}`, with links kept to site paths, http(s) and email:

```svelte
<Markdown
  {source}
  urlPolicy={(url) => (url.startsWith('/') && !url.startsWith('//')) || /^(https?:\/\/|mailto:)/i.test(url) ? url : null}
  linkAttrs={(url) => (url.startsWith('/') ? null : { target: '_blank', rel: 'noreferrer' })}
/>
```

Short copy with a little formatting:

```svelte
{#each game.description as paragraph}
  <p><Markdown source={paragraph} inline /></p>
{/each}
```

## Coming from a regex-based parser

fgmd follows the spec, so a few things written for a looser parser come out differently:

- **Markdown inside a raw HTML block stays literal.** In `<details><ul><li>**bold**</li></ul></details>`, the asterisks are shown as typed. Either write HTML inside the block (`<strong>`), or leave a blank line after the opening tag. Everything after that blank line is Markdown again. Alternatively, use GFM footnotes with `footnotes: { style: 'details' }`, which produce collapsible footnotes from plain Markdown.
- **A line holding only spaces is a blank line**, so it ends the paragraph or quote before it.
- **A quote swallows the lines that follow it until a blank line** (lazy continuation). End the quote with an empty line if the next text isn't part of it.
- **With `breaks`, every newline breaks**, including the one between an image and a caption written on the next line, and inside quotes. Put a blank line between them to make separate paragraphs instead.

## Development

```sh
npm test               # unit, plugin, sanitiser, CLI, Svelte parity, pathological and spec tests
npm run spec           # every failing spec example, expected vs actual
npm run spec -- --summary
npm run check          # tsc + svelte-check
npm run build          # dist/ and dist/fgmd.mjs
npm run fetch-spec     # re-download the spec examples into test/spec/
npm run gen-entities   # regenerate src/entities.ts from the WHATWG table
node scripts/gen-emoji.mjs   # regenerate src/emoji-data.ts from GitHub's gemoji
```

The block and inline algorithms follow [commonmark.js](https://github.com/commonmark/commonmark.js), and the GFM extensions follow [cmark-gfm](https://github.com/github/cmark-gfm).

## License

MIT
