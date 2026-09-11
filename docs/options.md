# Options

Every option is optional, and `markdown()` takes both kinds. The Svelte component takes them too, except `renderers` and `highlight` (see [Svelte](svelte.md)).

## Parsing

| option | default | |
| --- | --- | --- |
| `html` | `false` | Raw HTML. `false` shows it as text. `true` passes it through untouched; use that only for content you wrote. `'sanitize'` allows a safe subset (see [Safety](safety.md)). |
| `sanitize` | GitHub-like | What `html: 'sanitize'` lets through: `{ tags, attributes }`, each a list/map or a function that edits `SANITIZE_DEFAULTS`. |
| `plugins` | `[]` | See [Plugins](plugins.md). |
| `gfm` | `true` | `false` turns off every GFM extension. An object `{ tables, strikethrough, tasklists, autolinks, footnotes, tagfilter }` picks individually; everything except `tagfilter` defaults to on. |
| `indentedCode` | `true` | 4-space indented code blocks. |
| `keepComments` | `false` | Keep HTML comments. They only render with `html: true`. |
| `frontmatter` | `false` | Read a `---` block at the top of the document as metadata: it stays out of the output, and its keys and values land on the tree as `root.data.frontmatter`. Off by default, where `---` is a thematic break, as CommonMark says. See [Syntax](syntax.md#frontmatter). |

## Rendering

| option | default | |
| --- | --- | --- |
| `breaks` | `false` | Render single newlines as `<br>`, the way GitHub comments do. |
| `allowedSchemes` | `['http','https','mailto','tel']` | URL schemes links and images may use. Relative URLs are always allowed. |
| `urlPolicy` | | `(url, kind) => url \| null`. Full control: return a (possibly rewritten) URL, or `null` to reject. A rejected link renders as its plain label, a rejected image as its alt text. Also applies to sanitised HTML. |
| `linkAttrs` | | `(url) => attributes`, e.g. `target`/`rel` for external links. |
| `classes` | | A class per element name: `{ p: 'mb-4', a: 'text-accent', code: 'font-mono', aside: 'callout' }`. `code` is inline code only; code blocks take the `pre` class. |
| `headingIds` | `false` | GitHub-style slugs (`hello-world`, `hello-world-1`, …). An id set with `{#id}` wins. |
| `headingAnchors` | `false` | A clickable link on every heading (turns `headingIds` on): `true`, or `{ position: 'before' \| 'after' \| 'wrap', symbol: '#', className: 'anchor', label }`. |
| `figures` | `false` | A paragraph that is just one titled image becomes `<figure><img><figcaption>title</figcaption></figure>`. |
| `footnotes` | section | `{ style, heading, backref, backrefLabel }`. `style: 'section'` gives GitHub's numbered list. `'details'` gives a collapsible `<details class="footnote">` each, and a footnote starting with `**Title**` uses it as the summary. `'sidenote'` puts one-paragraph footnotes inline beside their reference, for margin notes. |
| `highlight` | | `(code, lang, meta) => html` for code blocks (HTML output). Return the code's inner HTML, or a whole `<pre>…</pre>` (shiki does), or nothing to keep plain escaped code. |
| `lazyImages` | `false` | Adds `loading="lazy"` to images. |
| `unwrapImages` | `false` | A paragraph holding only images loses its `<p>`. See [Syntax](syntax.md#additions-beyond-both-specs). |
| `tableWrapperClass` | | Wraps each table in `<div class="…">`, e.g. for sideways scrolling on phones. |
| `idPrefix` | `''` | Prefix for every generated id, when one page holds several documents. |
| `renderers` | | `{ [nodeType]: (node, ctx) => html \| undefined }`. Replaces how a node type renders; return `undefined` to fall back to the default. The context offers `ctx.children()`, `ctx.attributes` (fgmd's URL-checked attributes), `ctx.default()` (the built-in output, e.g. to wrap it) and `ctx.render(nodes)`. HTML output only. |
