# The site

fgmd.dev: a Cloudflare Worker that renders this repo's Markdown, and nothing else.

Every page is a `.md` file. The Worker parses it with fgmd and `html: false`, so nothing on the
site can reach for HTML - what lays the pages out is Markdown: `:::` containers, `> [!NOTE]`
callouts and `{.class}` attributes, all of them fgmd features. The only HTML written by hand is
`<head>` and the frame around the rendered content, in `src/render.ts`.

## Running it

```sh
npm install          # links @decbr/fgmd from the parent directory
npm run preview      # http://localhost:8788, plain node, no wrangler
npm run dev          # the same site under workerd
npm run deploy       # wrangler deploy
```

`npm install` in the parent directory and `npm run build` there come first: the site imports the
parser's build output, so a change to `src/` only reaches the site once `dist/` is rebuilt.

## Where things are

| path | what it is |
| --- | --- |
| `content/*.md` | the site's own pages. `index.md` is `/`, `about.md` would be `/about` |
| `content/_*.md` | fragments, not pages: `_nav.md` and `_footer.md` |
| `../docs/*.md` | the docs, served at `/docs/<name>` - the same files npm and GitHub read |
| `src/render.ts` | fgmd's options, the URL rewriting, and the page frame |
| `src/highlight.ts` | the syntax highlighter, wired into fgmd's `highlight` option |
| `src/style.css` | the whole design |
| `scripts/collect.mjs` | bundles every `.md` into `src/generated/content.ts` before a build |

To add a page, put a `.md` file in `content/`. To add a doc, put one in `../docs/` and link to it
from `docs/README.md`. Nothing else needs editing.

Links in the docs are written for GitHub - `syntax.md`, `../README.md` - and rewritten to site
routes on the way out by `rewriteUrl`, so the same file reads correctly in both places.

## What the routes are

- `/` and `/docs/<name>` - pages
- `/<any page>.md` - that page's source, as `text/markdown`. `/docs/syntax.md` is the file
  `/docs/syntax` was rendered from
- `/style.<hash>.css` - the stylesheet, immutable; `/style.css` redirects to it
- `/robots.txt`, `/sitemap.xml`
