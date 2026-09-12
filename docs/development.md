# Development

```sh
npm test               # unit, plugin, sanitiser, CLI, Svelte parity, browser entity, pathological and spec tests
npm run spec           # every failing spec example, expected vs actual
npm run spec -- --summary
npm run check          # tsc + svelte-check
npm run build          # dist/ and dist/fgmd.mjs
npm run size           # what each entry adds to a browser bundle, gzipped (build first)
npm run fetch-spec     # re-download the spec examples into test/spec/
npm run gen-entities   # regenerate src/entities.ts from the WHATWG table
node scripts/gen-emoji.mjs   # regenerate src/emoji-data.ts from GitHub's gemoji
```

The test suite fails if the number of passing CommonMark or GFM spec examples ever drops.

Named entities are decoded by `src/named-entity.ts` (the table) or, in browser bundles, `src/named-entity.browser.ts` 
(the DOM). `package.json` `imports` chooses between them as `#named-entity`, with `workerd` and `worker` ahead of 
`browser` so Workers keep the table. Tests resolve `#named-entity` to the table version (an alias in `vitest.config.ts`)
and type checks use `types/named-entity.d.ts`. Don't add it to tsconfig `paths`: esbuild reads those too and would 
bundle the table everywhere. `test/entities-dom.test.ts` checks the DOM version against the table under jsdom.

The block and inline algorithms follow [commonmark.js](https://github.com/commonmark/commonmark.js), and the GFM extensions follow [cmark-gfm](https://github.com/github/cmark-gfm).
