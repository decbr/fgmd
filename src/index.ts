import type { Root } from './ast.js';
import { parse } from './block.js';
import { frontmatter } from './frontmatter.js';
import { renderHtml } from './html.js';
import type { MarkdownOptions } from './options.js';
import { parseInline } from './parse-inline.js';
import { registerPlugin } from './plugin.js';
import { builtinPlugins } from './plugins/index.js';

export type * from './ast.js';
export type {
	Attributes,
	ClassKey,
	Classes,
	FootnoteOptions,
	GfmOptions,
	HeadingAnchorOptions,
	MarkdownOptions,
	ParseOptions,
	RenderContext,
	RenderOptions,
	Renderers,
	ResolvedParseOptions
} from './options.js';
export type {
	BlockRule,
	ContainerRule,
	DefinitionRule,
	DelimiterRule,
	FenceRule,
	InlineRule,
	InlineState,
	LineRule,
	ParseContext,
	Plugin,
	PluginInput
} from './plugin.js';
export type { Frontmatter } from './frontmatter.js';
export type { SanitizeOptions } from './sanitize.js';
export type { UrlKind, UrlPolicy } from './url.js';
export type { Visitor } from './visit.js';

export { frontmatter, parse, parseInline, renderHtml };
export { toString } from './inline.js';
export { registerPlugin, resolvePlugins } from './plugin.js';
export * from './plugins/index.js';
export { SANITIZE_DEFAULTS } from './sanitize.js';
export { DEFAULT_SCHEMES, allowSchemes, defaultUrlPolicy } from './url.js';
export { mapText, visit } from './visit.js';
export { VERSION } from './version.js';

// built-in plugins can be named in options: { plugins: ['callouts', ['math', {}]] }. only this
// entry registers them, so the Svelte components (which don't import it) stay free of every plugin
for (const [name, factory] of Object.entries(builtinPlugins)) registerPlugin(name, factory);

// markdown in, HTML out
export function markdown(source: string, options: MarkdownOptions = {}): string {
	return renderHtml(parse(source, options), options);
}

// inline markdown in, HTML out, with no surrounding <p>
export function markdownInline(source: string, options: MarkdownOptions = {}): string {
	return renderHtml(parseInline(source, options), options);
}

export type { Root };
