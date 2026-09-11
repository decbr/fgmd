# Development

```sh
npm test               # unit, plugin, sanitiser, CLI, Svelte parity, pathological and spec tests
npm run spec           # every failing spec example, expected vs actual
npm run spec -- --summary
npm run check          # tsc + svelte-check
npm run build          # dist/ and dist/fgmd.mjs
npm run fetch-spec     # re-download the spec examples into test/spec/
npm run gen-entities   # regenerate src/entities.ts from the WHATWG table
node scripts/gen-emoji.mjs   # regenerate src/emoji-data.ts from GitHub's gemoji
```

The test suite fails if the number of passing CommonMark or GFM spec examples ever drops.

The block and inline algorithms follow [commonmark.js](https://github.com/commonmark/commonmark.js), and the GFM extensions follow [cmark-gfm](https://github.com/github/cmark-gfm).
