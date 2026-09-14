# Svelte

Svelte 5 is an optional peer dependency.

Example of 'Components/Prose.svelte':
```svelte
<script lang="ts">
    import { Markdown } from '@decbr/fgmd/svelte';

    let { source }: { source: string } = $props();

    const external = (url: string) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
    const linkAttrs = (url: string) => (external(url) ? { target: '_blank', rel: 'noreferrer' } : null);

    const classes = {
        h1: 'text-base-content text-[30px] sm:text-[38px] leading-tight mb-4',
        h2: 'text-base-content text-[22px] sm:text-[26px] leading-tight mt-10 mb-3',
        h3: 'text-base-content text-[17px] sm:text-[19px] leading-tight mt-6 mb-2',
        p: 'mb-4',
        // etc
    };
</script>

<div class="flex flex-col text-muted text-[14px] sm:text-[15px] leading-relaxed">
    <Markdown {source} {classes} {linkAttrs} />
</div>
```

`code` styles inline code only. Code blocks are styled through `pre`.

Example Usage (+page.svelte):

```svelte
<script lang="ts">
    import Prose from '$lib/components/Prose.svelte';
    import source from '$lib/assets/myawesomemarkdownfile.md?raw';
</script>

<main>
    <div>
        <Prose {source} />
    </div>
</main>
```

## Snippets

Draw any node your own way with a snippet named after its type:

```svelte
<script lang="ts">
  import { Markdown, type Code, type Image, type Link, type NodeSnippetProps } from '@decbr/fgmd/svelte';
</script>

<Markdown {source}>
  {#snippet link({ attributes, children }: NodeSnippetProps<Link>)}
    <a {...attributes} data-sveltekit-preload-data>{@render children()}</a>
  {/snippet}
  {#snippet code({ node }: NodeSnippetProps<Code>)}
    <Highlight lang={node.lang} code={node.value} />
  {/snippet}
  {#snippet image({ attributes }: NodeSnippetProps<Image>)}
    <enhanced:img {...attributes} />
  {/snippet}
</Markdown>
```

In a `lang="ts"` component, type each snippet's argument with `NodeSnippetProps` and the node's type, as above; otherwise svelte-check warns that it's implicitly `any`. Every node type is exported from `@decbr/fgmd/svelte`.

Each snippet gets:
- `node`
- `attributes`: what fgmd would put on the element, already URL-checked, with your classes
- `children`: renders the node's content normally

A link or image whose URL the policy rejects never reaches your snippet. Snippets also work for custom plugin node types. For the `html` node type, pass `html={snippet}`; the prop still accepts `true`/`'sanitize'` as the option.

## Props

The component takes every [option](options.md) except `renderers` and `highlight`, which are for HTML output; use snippets instead. It also takes:
- `source`
- `ast`: a tree you parsed yourself (see [the tree](tree.md))
- `inline`: render inline markdown with no wrapping element. For short copy, `<InlineMarkdown>` does the same with a smaller bundle

`frontmatter` is an ordinary option, so `<Markdown {source} frontmatter />` renders a file whose metadata block stays out of the page. To use the metadata as well, split the source first with `frontmatter(source)` (see [Recipes](recipes.md)).

It has no `{@html}`. Raw HTML under `html: true` appears as literal text, while `html: 'sanitize'` draws the allowed HTML as real elements. Its output matches `markdown()` element for element; the test suite checks this for every node, option and plugin.

## InlineMarkdown

For short copy (a title, a card blurb, a line of a list), use `<InlineMarkdown>`. It renders inline markdown with no wrapping element, and takes the same options, snippets, `source` and `ast` (phrasing content) as `<Markdown>`:

```svelte
<script>
  import { InlineMarkdown } from '@decbr/fgmd/svelte';
</script>

<p class="lede"><InlineMarkdown source={game.blurb} classes={{ a: 'text-accent' }} /></p>
```

Its output is the same as `<Markdown inline>`, but it never imports the block parser, so it's much lighter in a client bundle.

## Bundle size

Three things keep the components small in the browser. Run `npm run size` in the fgmd repo for current numbers.

- `<InlineMarkdown>` leaves out the block parser.
- Neither component imports `@decbr/fgmd` itself, so the built-in plugins you don't use stay out. Import the ones you do and pass them: `plugins={[callouts()]}`. Plugin names like `plugins={['callouts']}` only work if code that also runs in the browser imports `@decbr/fgmd`. If only server code imports it (such as `+page.server.ts`), the server renders the page and hydration then fails with `unknown plugin`.
- Named references like `&notin;` are decoded by the browser's own HTML parser instead of a 2,000-name table shipped with fgmd. Server rendering, Node and Workers keep the table, and both give the same text, so hydration matches. The package's `imports` field makes the choice: bundles with the `browser` condition get the DOM version, unless `workerd` or `worker` is also set, as wrangler and edge runtimes do. A web worker bundled with only the `browser` condition has no `document` and throws a clear error; add the `worker` condition to that build.
