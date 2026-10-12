# Components

The `components()` plugin lets Markdown use your components, the way MDX does, without running any code:

````md
<Chart kind="bar" data={[3, 1, 4]} />

<Tabs>
<Tab title="npm">

```sh
npm install @decbr/fgmd
```

</Tab>
</Tabs>

Press <Kbd>Ctrl</Kbd> to continue.
````

A file names the components, and you supply them. Props are data (strings, booleans and JSON), never code, so the plugin is safe for content anyone can write.

## Using it

In Svelte, pass the components by name (see [Svelte](svelte.md#components)):

```svelte
<script>
  import { Markdown } from '@decbr/fgmd/svelte';
  import { components } from '@decbr/fgmd';
  import { Chart, Tabs, Tab, Kbd } from '$lib/components';
</script>

<Markdown {source} plugins={[components()]} components={{ Chart, Tabs, Tab, Kbd }} />
```

Each component gets its props, and its content as `children`. A name with no component renders only its content.

For `markdown()`, give each name a function that returns HTML. `context.children()` renders the content:

```js
import { markdown, components } from '@decbr/fgmd';

markdown(source, {
  plugins: [components({
    render: {
      Kbd: (props, context) => `<kbd>${context.children()}</kbd>`,
      Chart: (props) => `<figure class="chart" data-points="${props.data.length}"></figure>\n`
    }
  })]
});
```

A component without a function renders only its content, and a self-closing one renders nothing. That way a page never loses text because a component is missing.

In the [tree](tree.md), each one is a `component` node, `{ type: 'component', name, props, children }`, which you can walk, cache, or send as JSON like any other node. It isn't part of the `BlockContent` and `PhrasingContent` types, so code that handles every node type doesn't need a case for it. To read one, use `asComponent(node)`, which returns the component or `null`.

`allow` limits which names count: `components({ allow: ['Chart', 'Kbd'] })`, or a function. A tag whose name isn't allowed stays as text.

## Syntax

- **Names** start with a capital letter or contain a dot, as in MDX: `Chart`, `Tabs.Item`. Lowercase tags are HTML and follow the [`html` option](options.md), and autolinks like `<https://…>` are unaffected.
- **A block component** is a line that is only the opening tag, then Markdown, then a line that is only the closing tag. Blank lines, headings, lists, code and nested components all work inside.
- **A self-closing tag** on a line of its own is a block too, even when its props run over several lines.
- **One-line content**, like `<Badge>new</Badge>` on a line of its own, makes a block whose content stays inline, with no `<p>` around it.
- **Inline components** sit in a line of text: `Press <Kbd>Ctrl</Kbd>`. An opening tag and its closing tag must be in the same paragraph, heading or table cell. A tag that is never closed stays as text.
- **Props:**

  | Written | Value |
  | --- | --- |
  | `kind="bar"` or `kind='bar'` | the string, with entities like `&amp;` decoded |
  | `legend` | `true` |
  | `size={3}`, `open={false}`, `note={null}` | the number, boolean or null |
  | `data={[3, 1, 4]}` | the array |
  | `options={{"stacked": true}}` | the object |

  Braces must hold JSON. Anything else in them is JavaScript: `{load()}`, `{...rest}`, `{user.name}`, even `{{stacked: true}}` with its key unquoted. The plugin reads JSON and nothing else, so a tag like that stays as text rather than half-working.

## How it works

The plugin hooks into three stages of the parser, each through the ordinary [plugin API](plugins.md#writing-a-plugin):

1. **Blocks.** A `wrapper` block rule opens on a line that is exactly one opening tag and closes on a line that is exactly the matching closing tag. It works like a `:::` container, but the plugin decides which lines open and close it. A closing line goes to the innermost open component of that name. It doesn't close anything while a fenced code block inside is still open, so a closing tag shown in a code example stays in the example. A separate line rule reads self-closing tags.
2. **Inline.** An inline rule reads tags at each `<`. A self-closing tag becomes a `component` node straight away. An opening or closing tag can't: the inline parser reads left to right, so when it meets `<Kbd>` it hasn't seen `</Kbd>` yet. Each one becomes a marker instead.
3. **Pairing.** After parsing, a transform goes through each run of text and pairs the markers. Each closing tag takes the innermost open tag of its name, and what lies between becomes the component's children. Markers left without a pair turn back into the text they were written as. The same step unwraps a paragraph that holds nothing but a component.

Props are read by a small tag reader. It accepts a name, then quoted strings, bare names, and `{…}` that `JSON.parse` accepts. Nothing in fgmd ever evaluates what's inside the braces.

## Safety

- **No code runs.** A file can name components and pass them data, and that's all it can do. What a component does with its props is up to you, as with any data a user sends you.
- **URL props are checked.** Props named like URL attributes (`href`, `src`, `poster`, `cite` and the rest) go through the [`urlPolicy`](safety.md), the same as links, and a rejected one is dropped before your component or `render` function sees it. Only top-level string props are checked: a component that reads a URL out of an object or array prop has to check it itself.
- **`allow` for untrusted content.** By default every capitalised name is a component. For comments or wiki pages, list the ones people may use.
- **No prototype pollution.** A prop named `__proto__` is ignored, and JSON values are plain data.
- **Hostile input is bounded.** Inline components nest at most 100 deep, and deeper tags stay text. An inline tag longer than 1,000 characters isn't read as a tag. The pathological test suite covers runs of unclosed tags, stray closing tags, and deeply nested props.
- **`renderers.component` skips the URL check.** It replaces the whole plugin and receives the node as it is, so check URLs yourself if you use it.

## Compared with MDX

MDX compiles each file to a JavaScript module: `import`, `export`, `{expressions}` and JSX, all run at build time. That power is also the catch. An MDX file is a program, so it needs a compile step and a JavaScript parser, and it can do anything your build can.

**This plugin fits when the Markdown is content:**

- **People you don't fully trust write it**, such as writers, a CMS, contributors or users. An MDX file from them would run with your build's access, while here they can only use the components you allow.
- **It renders at runtime.** fgmd parses to a JSON tree anywhere JavaScript runs, including Workers and pages with a strict CSP, with no `eval` or `new Function`.
- **It isn't only for React.** Svelte draws the components natively, and the tree is plain data for any other renderer.
- **It should stay Markdown.** Files remain CommonMark and GFM, and a tag fgmd can't read shows up as text instead of failing the build.
- **Size matters.** It's one small plugin with no dependencies.

**MDX fits when the Markdown is code:** files that import their own components, compute values, loop over data, pass functions as props, or export metadata, in a repo where everyone who writes them could also write the app. For that, use [`@mdx-js/mdx`](https://mdxjs.com). A full MDX compiler is [not planned](roadmap.md#not-planned) for fgmd.

### From an `.mdx` file

A file that only uses components with literal props renders here as it is. Beyond that:

- Set `indentedCode: false`, as MDX does, so content indented inside a component isn't read as a code block.
- `import` and `export` lines show up as text. Remove them, and supply the components by name instead.
- `{expressions}` show up as text, and so do `{/* comments */}`. Use `<!-- comments -->`, which fgmd removes by default.
- Props with JavaScript objects need their keys quoted: `{{"stacked": true}}`.
