# Recipes

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

A page whose title and blurb live in the file, above the copy:

```svelte
<script>
  import { frontmatter } from '@decbr/fgmd';
  import { Markdown } from '@decbr/fgmd/svelte';
  import source from './detour.md?raw';

  const { data, body } = frontmatter(source);
</script>

<h1>{data.title}</h1>
<h2>{data.blurb}</h2>
<Markdown source={body} />
```

Short copy with a little formatting. `InlineMarkdown` keeps the block parser out of the bundle (see [Svelte](svelte.md#inlinemarkdown)):

```svelte
{#each game.description as paragraph}
  <p><InlineMarkdown source={paragraph} /></p>
{/each}
```
