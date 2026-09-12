# Breaking changes

What to change in your code when you upgrade. Minor releases (0.3 to 0.4) can break things, where a patch release (0.3.0 to 0.3.1) never does. A version that isn't listed here broke nothing.

## 0.4.0

Rendered output doesn't change. Both changes below are about what gets bundled, and they're what make [`<InlineMarkdown>`](svelte.md#inlinemarkdown) and smaller browser bundles possible.

### 1. Plugin names in the Svelte components

The components no longer import `@decbr/fgmd` itself, because importing it registers every built-in plugin and puts all of them in your bundle. Plugin names now only resolve if your own code imports `@decbr/fgmd`, and that code runs wherever the component does: on the server and in the browser.

You're affected if you pass a plugin by name to `<Markdown>` or `<InlineMarkdown>`:

```svelte
<Markdown {source} plugins={['callouts', ['emoji', { map }]]} />
```

Without such an import this fails with `fgmd: unknown plugin "callouts"`. If only server code imports `@decbr/fgmd` (a `+page.server.ts`, say), the server renders the page and hydration fails in the browser.

Import the plugins and pass them instead:

```svelte
<script>
  import { Markdown } from '@decbr/fgmd/svelte';
  import { callouts, emoji } from '@decbr/fgmd';
</script>

<Markdown {source} plugins={[callouts(), emoji({ map })]} />
```

`markdown()`, `parse()`, `markdownInline()` and the CLI still accept names.

### 2. Web workers bundled with only the `browser` condition

Browser bundles now decode named entities like `&copy;` with the browser's own HTML parser instead of shipping fgmd's table (see [Bundle size](svelte.md#bundle-size)). A web worker has no `document`, so a worker bundle that resolves only the `browser` condition now throws `fgmd: this is the browser build, which decodes entities through the DOM, and there is no document here.`

Add the `worker` condition to that bundle's resolve conditions (for esbuild, `conditions: ['worker']`) and it gets the table again.

Cloudflare Workers, edge runtimes, Node, Deno and server rendering aren't affected: they resolve the `workerd` or `worker` condition, or no `browser` condition at all.

## 0.2.0 to 0.3.1

No breaking changes. 0.3.0 added [frontmatter](options.md), which stays off unless you turn it on.
