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
- **Block nodes:** `paragraph`, `heading{depth}`, `blockquote`, `list{ordered,start,spread}`, `listItem{checked}`, `code{lang,meta,value}`, `table{align}`, `tableRow`, `tableCell`, `thematicBreak`, `html`, `footnoteDefinition`, `yaml{value}`.
- **Inline nodes:** `text`, `emphasis`, `strong`, `delete`, `inlineCode`, `break`, `link{url,title}`, `image{url,alt,title}`, `footnoteReference`.
- **From plugins and sanitising:** `container`, `math`, `inlineMath`, `mark`, `superscript`, `subscript`, `abbr`, `definitionList`/`definitionTerm`/`definitionDescription`, `element{tagName,properties}`.
- **From the [components plugin](components.md):** `component{name,props}`.

A `component` holds blocks when it came from its own lines, and inline content when it sat in a line of text. Its `props` are plain JSON. It isn't in the `BlockContent` or `PhrasingContent` types, so a `switch` over every node type needs no case for it, and checking `node.type === 'component'` doesn't narrow. Use `asComponent(node)`, which returns the `Component` or `null`.

With `{ frontmatter: true }`, the `---` block becomes a `yaml` node at the top of the tree, holding the text between the fences, and its parsed keys and values sit on the root as `root.data.frontmatter`. Neither renderer draws the node; a `renderers.yaml` or a `yaml` snippet can, to show the metadata. To read a block without parsing the Markdown, use `frontmatter(source)` (see [Syntax](syntax.md#frontmatter)).

Any node can carry `data: { hName, hProperties }` rendering hints. One difference from mdast: reference links arrive already resolved as `link`/`image`.

## Positions

With `{ positions: true }`, every node the parser makes says where it came from, the way mdast does:

```js
parse('# Hi *there*', { positions: true }).children[0].position;
// { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 13, offset: 12 } }
```

Lines and columns count from 1, offsets from 0, and `end` points just past the last character. A block ends at the end of its last line, without trailing spaces. Inline nodes cover their source exactly, so `&amp;` and `\*` span the characters typed, not the text they became. A text node that runs over several lines includes whatever the containers put at the start of those lines, such as `> `.

Positions are off by default: they make trees bigger and parsing about a third slower. A node a plugin's transform creates has none unless the plugin sets one, which mdast allows.

## Helpers

- `visit(tree, fn)` walks every node; returning `false` skips a node's children.
- `mapText(tree, fn, skip?)` replaces text nodes.
- `toString(nodes)` gives plain text.
- `frontmatter(source)` gives `{ data, body, raw }` for a document's `---` block.
