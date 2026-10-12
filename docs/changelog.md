# Changelog

Every release of `@decbr/fgmd`. Minor releases (0.3 to 0.4) can break things, where a patch release (0.3.0 to 0.3.1) never does. What to change when one does is in [Breaking changes](breaking-changes.md).

## 0.4.2 - 2026-10-12

### Added
- Source positions: `parse(source, { positions: true })` gives every node the parser makes an mdast `position`, down to emphasis, links, entities and table cells. `parseInline` supports it too. Off by default. See [The tree](tree.md#positions).
- `Point` and `Position` types.
- [Benchmarks](benchmarks.md) against markdown-it, marked, micromark and commonmark.js, with the runner in `bench/`.

### Fixed
- Two inputs were slow without a JIT, which is what an iOS app gets from JavaScriptCore. 20,000 reference definitions took 14.7 s and 1,000 nested lists took 4.4 s. Every pathological case now finishes in under 2 s there, and CI runs the pathological tests with V8's JIT off.

## 0.4.1 - 2026-10-12

### Added
- The [components plugin](components.md): `<Chart data={[1, 2]} />`, `<Tabs>` ... `</Tabs>` and inline `<Kbd>Ctrl</Kbd>` in Markdown, MDX-style, with literal props only and no code run. Svelte draws them from a new `components` prop, and `markdown()` from the plugin's `render` option.
- `asComponent(node)`, which returns a component node or `null`. Component nodes sit outside `BlockContent` and `PhrasingContent`, so code that handles every node type needs no new case.
- `WrapperRule`, a plugin block rule for a container opened and closed by lines of your choosing.
- `chars` on a `LineRule`, so a line rule is only tried on lines that can start it.

## 0.4.0 - 2026-09-12

### Added
- `<InlineMarkdown>` for Svelte: one line of Markdown with no surrounding `<p>`, for titles and short copy, and much smaller than `<Markdown>`.

### Changed
- Smaller browser bundles. Browsers decode named entities like `&copy;` with their own HTML parser instead of shipping fgmd's table, and Workers and Node keep the table.
- **Breaking:** the Svelte components no longer import the main entry, so they don't bundle every built-in plugin. Plugin names like `'callouts'` only resolve where your own code imports `@decbr/fgmd`. Pass plugin objects instead.
- **Breaking:** a web worker bundled with only the `browser` condition needs the `worker` condition too.

See [Breaking changes](breaking-changes.md#040) for both.

## 0.3.1 - 2026-09-12

### Changed
- The README links to the new site, [fgmd.dev](https://fgmd.dev). No code changes.

## 0.3.0 - 2026-09-12

### Added
- Frontmatter. `{ frontmatter: true }` reads a `---` block at the top as metadata. It stays out of the output, and its keys and values land on `root.data.frontmatter`, with the block itself as a `yaml` node. `frontmatter(source)` reads one without parsing the Markdown. Off by default, where `---` stays a thematic break.
- `--frontmatter` and `--data` for the CLI, and `data` in `--serve` responses.

## 0.2.3 - 2026-09-11

### Changed
- Documentation for React. No code changes.

## 0.2.2 - 2026-09-11

### Changed
- The README's reference material moved into `docs/`. No code changes.

## 0.2.1 - 2026-09-11

### Changed
- Published as `@decbr/fgmd`, with repository links and public access set up for npm. Import from `@decbr/fgmd` instead of `fgmd`.
- `npm version` keeps `VERSION` in step with `package.json`.

## 0.2.0 - 2026-09-11

The first release.

### Added
- A CommonMark 0.31.2 and GFM parser that passes every spec example, with zero runtime dependencies, safe by default.
- An HTML renderer with heading anchors, figures and footnote styles.
- `html: 'sanitize'`, which lets through an allowlist of raw HTML rebuilt as real elements.
- A plugin API and tree helpers (`visit`, `mapText`, `toString`).
- Built-in plugins: callouts, typography, attributes, definition lists, abbreviations, math, emoji and wikilinks.
- A Svelte 5 component with a snippet override per node type.
- A CLI, with a `--serve` mode for other languages and a `--plugins` flag.

## 0.1.0 - 2026-09-10

The empty project, with its configuration and no parser. Never published.
