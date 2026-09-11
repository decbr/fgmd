import type { PhrasingContent, Root } from './ast.js';
import { BlockParser, parse } from './block.js';
import { renderHtml } from './html.js';
import { resolveParseOptions, type MarkdownOptions, type ParseOptions } from './options.js';
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
export type { SanitizeOptions } from './sanitize.js';
export type { UrlKind, UrlPolicy } from './url.js';
export type { Visitor } from './visit.js';

export { parse, renderHtml };
export { toString } from './inline.js';
export { registerPlugin, resolvePlugins } from './plugin.js';
export * from './plugins/index.js';
export { SANITIZE_DEFAULTS } from './sanitize.js';
export { DEFAULT_SCHEMES, allowSchemes, defaultUrlPolicy } from './url.js';
export { mapText, visit } from './visit.js';
export { VERSION } from './version.js';

// built-in plugins can be named in options: { plugins: ['callouts', ['math', {}]] }
for (const [name, factory] of Object.entries(builtinPlugins)) registerPlugin(name, factory);

// parses a single line of inline markdown (no paragraphs, lists or headings), e.g. for a
// title or a short description
export function parseInline(markdown: string, options?: ParseOptions): PhrasingContent[] {
	return new BlockParser(resolveParseOptions(options)).parseInlineContent(markdown);
}

// markdown in, HTML out
export function markdown(source: string, options: MarkdownOptions = {}): string {
	return renderHtml(parse(source, options), options);
}

// inline markdown in, HTML out, with no surrounding <p>
export function markdownInline(source: string, options: MarkdownOptions = {}): string {
	return renderHtml(parseInline(source, options), options);
}

export type { Root };
