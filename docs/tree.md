# The tree

```js
import { parse, parseInline, renderHtml, toString, visit, mapText } from '@decbr/fgmd';

const tree = parse(source, { plugins: ['math'] });   // plain JSON: read it, transform it, cache it
visit(tree, (node) => { if (node.type === 'heading') console.log(toString(node.children)); });
const html = renderHtml(tree, { headingAnchors: true });
```

A tree can also go straight to the Svelte component as `<Markdown ast={tree} />`.

## Nodes

Nodes follow mdast's names and fields:
- **Block nodes:** `paragraph`, `heading{depth}`, `blockquote`, `list{ordered,start,spread}`, `listItem{checked}`, `code{lang,meta,value}`, `table{align}`, `tableRow`, `tableCell`, `thematicBreak`, `html`, `footnoteDefinition`.
- **Inline nodes:** `text`, `emphasis`, `strong`, `delete`, `inlineCode`, `break`, `link{url,title}`, `image{url,alt,title}`, `footnoteReference`.
- **From plugins and sanitising:** `container`, `math`, `inlineMath`, `mark`, `superscript`, `subscript`, `abbr`, `definitionList`/`definitionTerm`/`definitionDescription`, `element{tagName,properties}`.

Any node can carry `data: { hName, hProperties }` rendering hints. There are two differences from mdast:
- Reference links arrive already resolved as `link`/`image`.
- There are no position fields.

## Helpers

- `visit(tree, fn)` walks every node; returning `false` skips a node's children.
- `mapText(tree, fn, skip?)` replaces text nodes.
- `toString(nodes)` gives plain text.
