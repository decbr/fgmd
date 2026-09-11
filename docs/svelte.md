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

## Snippets

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

## Props

The component takes every [option](options.md) except `renderers` and `highlight`, which are for HTML output; use snippets instead. It also takes:
- `source`
- `ast`: a tree you parsed yourself (see [the tree](tree.md))
- `inline`

`frontmatter` is an ordinary option, so `<Markdown {source} frontmatter />` renders a file whose metadata block stays out of the page. To use the metadata as well, split the source first with `frontmatter(source)` (see [Recipes](recipes.md)).

It has no `{@html}`. Raw HTML under `html: true` appears as literal text, while `html: 'sanitize'` draws the allowed HTML as real elements. Its output matches `markdown()` element for element; the test suite checks this for every node, option and plugin.
