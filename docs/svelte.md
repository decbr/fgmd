# Svelte

Svelte 5 is an optional peer dependency.

```svelte
<script>
  import { Markdown } from '@decbr/fgmd/svelte';
  import { callouts } from '@decbr/fgmd';
  import source from './privacy.md?raw';
</script>

<Markdown {source} plugins={[callouts()]} classes={{ h2: 'text-2xl mt-10', p: 'mb-4 text-muted' }} />

<!-- short copy: inline markdown, no <p> -->
<p class="lede"><Markdown source={game.blurb} inline /></p>
```

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

It has no `{@html}`. Raw HTML under `html: true` appears as literal text, while `html: 'sanitize'` draws the allowed HTML as real elements. Its output matches `markdown()` element for element; the test suite checks this for every node, option and plugin.
