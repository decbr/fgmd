# Safety

With the defaults, `markdown()` output is safe to put on a page even when anyone can write the input:
- raw HTML is escaped
- `javascript:`, `data:`, `vbscript:` and every other non-listed scheme are refused (including `JaVaScRiPt:`, entity-encoded and tab-split spellings)
- all text and attributes are escaped
- quotes, lists, containers and inline formatting nested more than 100 deep are kept as text
- the inputs that make naive parsers quadratic are covered by tests, following cmark's pathological suite

## `html: 'sanitize'`

This is for content like comments or wiki edits, where people should get *some* HTML.
- **How it works:** raw HTML is tokenised and rebuilt as real element nodes, not filtered as a string. Each tag's scope is its own paragraph or container, so a user can't leave a tag open across your page or close your layout with a stray `</div>`.
- **Allowed by default:** GitHub-like, including `b`, `i`, `em`, `strong`, `code`, `kbd`, `sub`, `sup`, `mark`, `del`, `ins`, `s`, `u`, `br`, `hr`, `p`, `div`, `span`, `details`, `summary`, lists, tables, `img`, `picture`/`source`, `video`/`audio`, `figure`/`figcaption`, `abbr`, `q`, `time` and `ruby`.
- **Removed:** `script`, `style`, `iframe`, `object`, `svg`, `math`, `template` and similar, together with their content. Event handlers and `style` attributes are always dropped.
- **URLs:** `href`/`src`/`cite`/`poster` go through `urlPolicy`.
- **`class` and `id`:** off by default. They'd let a comment dress up as your UI or clobber globals your scripts read.

The allowlist can be changed with the [`sanitize` option](options.md#parsing).

## `html: true`

This hands authors the whole of HTML, including `<script>` and `onerror=`. Use it only for content you wrote. `gfm: { tagfilter: true }` is GitHub's filter for a few dangerous tags, but it is not a sanitiser.
