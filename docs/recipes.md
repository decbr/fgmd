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

Short copy with a little formatting:

```svelte
{#each game.description as paragraph}
  <p><Markdown source={paragraph} inline /></p>
{/each}
```
