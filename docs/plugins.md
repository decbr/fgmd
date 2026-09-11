# Plugins

fgmd has eight built-in plugins, each written against the same [plugin API](#writing-a-plugin) you can use yourself.

Pass plugins as objects, or by name so plain JSON configs (the CLI, PHP) can use them:

```js
import { markdown, callouts, typography, emoji } from '@decbr/fgmd';
import { gemoji } from '@decbr/fgmd/emoji';

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
| `emoji({ map, lookup })` | `:shortcode:` | the emoji. `@decbr/fgmd/emoji` exports GitHub's full set (`gemoji`); `lookup` can return nodes, e.g. custom images |
| `wikilinks({ resolve, exists, embeds, resolveEmbed })` | `[[Page]]`, `[[Page\|label]]`, `[[Page#Heading]]`, `![[image.png]]` | `<a class="wikilink">`, plus `wikilink-new` when `exists(page)` is false |

## Writing a plugin

A plugin is a plain object. Every hook is optional:

```ts
import { mapText, type Plugin } from '@decbr/fgmd';

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
declare module '@decbr/fgmd' {
  interface PhrasingContentMap { insert: { type: 'insert'; children: PhrasingContent[] } }
}
```

To let JSON configs name your plugin, call `registerPlugin('mentions', () => mentions)`.
