import type { Attributes, Node } from './ast.js';
import { resolvePlugins, type Plugin, type PluginInput } from './plugin.js';
import { resolveSanitize, type SanitizeConfig, type SanitizeOptions } from './sanitize.js';
import { allowSchemes, defaultUrlPolicy, type UrlKind, type UrlPolicy } from './url.js';

export type { Attributes };

export interface GfmOptions {
	tables?: boolean;
	strikethrough?: boolean;
	tasklists?: boolean;
	// bare www. / http(s):// / email links
	autolinks?: boolean;
	footnotes?: boolean;
	// GFM's "disallowed raw HTML": neuters <script>, <iframe>, <style> and friends inside raw
	// HTML. off by default - raw HTML is only parsed when you opt in with { html: true }, which
	// is for trusted authors, and tagfilter is no sanitiser. see html: 'sanitize' for that.
	tagfilter?: boolean;
}

export interface ParseOptions {
	// raw HTML. false (default): shown as literal text, the safe choice for anything a user can
	// type. true: passed through untouched, for content you wrote yourself. 'sanitize': allowed
	// through an allowlist and rebuilt as real elements (see the sanitize option)
	html?: boolean | 'sanitize';
	// what html: 'sanitize' lets through. defaults are GitHub-like; see SANITIZE_DEFAULTS
	sanitize?: SanitizeOptions;
	// true (default) enables every GFM extension except tagfilter, false disables them all
	gfm?: boolean | GfmOptions;
	// 4-space indented code blocks. default true
	indentedCode?: boolean;
	// HTML comments are removed by default, so a note left in the source never ships to
	// readers. set true to keep them as raw HTML (only visible with { html: true }).
	keepComments?: boolean;
	// read a `---` block at the top of the document as frontmatter: it stays out of the rendered
	// output, and its keys and values land on the tree as root.data.frontmatter.
	frontmatter?: boolean;
	// extra syntax. plugin objects, or built-in names: ['callouts', 'math', ['emoji', { map }]]
	plugins?: readonly PluginInput[];
}

export interface ResolvedParseOptions {
	// whether raw HTML is recognised at all
	html: boolean;
	// set when raw HTML goes through the sanitiser
	sanitize: SanitizeConfig | null;
	indentedCode: boolean;
	keepComments: boolean;
	frontmatter: boolean;
	gfm: Required<GfmOptions>;
	plugins: Plugin[];
}

export function resolveParseOptions(options: ParseOptions = {}): ResolvedParseOptions {
	const on = options.gfm !== false;
	const gfm = typeof options.gfm === 'object' ? options.gfm : {};
	return {
		html: options.html === true || options.html === 'sanitize',
		sanitize: options.html === 'sanitize' ? resolveSanitize(options.sanitize) : null,
		indentedCode: options.indentedCode ?? true,
		keepComments: options.keepComments ?? false,
		frontmatter: options.frontmatter ?? false,
		gfm: {
			tables: on && (gfm.tables ?? true),
			strikethrough: on && (gfm.strikethrough ?? true),
			tasklists: on && (gfm.tasklists ?? true),
			autolinks: on && (gfm.autolinks ?? true),
			footnotes: on && (gfm.footnotes ?? true),
			tagfilter: on && (gfm.tagfilter ?? false)
		},
		plugins: resolvePlugins(options.plugins)
	};
}

// element names a class can be attached to via the classes option. any other tag name works too
// (for elements from plugins or sanitised HTML); these are just the ones fgmd itself writes
export type ClassKey =
	| 'p'
	| 'h1'
	| 'h2'
	| 'h3'
	| 'h4'
	| 'h5'
	| 'h6'
	| 'blockquote'
	| 'ul'
	| 'ol'
	| 'li'
	| 'hr'
	| 'pre'
	| 'code'
	| 'a'
	| 'strong'
	| 'em'
	| 'del'
	| 'img'
	| 'table'
	| 'thead'
	| 'tbody'
	| 'tr'
	| 'th'
	| 'td'
	| 'input'
	| 'sup'
	| 'sub'
	| 'mark'
	| 'abbr'
	| 'dl'
	| 'dt'
	| 'dd'
	| 'figure'
	| 'figcaption'
	| 'details'
	| 'summary'
	| 'aside'
	| 'div'
	| 'section';

export type Classes = { [K in ClassKey]?: string } & { [tag: string]: string | undefined };

export interface RenderContext {
	options: RenderOptions;
	// renders any node (or list of nodes) with the default rules plus any overrides
	render(node: Node | readonly Node[]): string;
	// this node's children, rendered normally
	children(): string;
	// the attributes fgmd would give this node's element: URL-checked, with classes and data.hProperties
	attributes: Attributes;
	// what fgmd would output for this node without your renderer, e.g. to wrap it
	default(): string;
}

export type Renderers = {
	[K in Node['type']]?: (node: Extract<Node, { type: K }>, context: RenderContext) => string | undefined;
};

export interface HeadingAnchorOptions {
	// where the link goes: before the text, after it, or wrapping it. default 'before'
	position?: 'before' | 'after' | 'wrap';
	// the link's text for before/after. default '#'
	symbol?: string;
	// default 'anchor'
	className?: string;
	// accessible name for before/after; the heading text is appended. default 'Link to this section'
	label?: string;
}

export interface FootnoteOptions {
	// section (default): numbered list at the end, like GitHub.
	// details: a collapsible <details> per footnote at the end. a footnote starting with
	//   **Title** uses it as the summary.
	// sidenote: single-paragraph footnotes appear inline, beside their first reference, for
	//   margin notes; any others still go to the end.
	style?: 'section' | 'details' | 'sidenote';
	// a heading above the footnotes, e.g. 'Footnotes'. default none
	heading?: string | null;
	// back link text. default '↩'
	backref?: string;
	// back link accessible name; {n} is replaced with the reference number. default 'Back to reference {n}'
	backrefLabel?: string;
}

export interface RenderOptions {
	// render single newlines inside a paragraph as <br>, the way GitHub comments do
	breaks?: boolean;
	// URL schemes links and images may use. relative URLs are always allowed.
	// default ['http', 'https', 'mailto', 'tel']. ignored when urlPolicy is set.
	allowedSchemes?: readonly string[];
	// full control over URLs. see UrlPolicy
	urlPolicy?: UrlPolicy;
	// extra attributes for each link, e.g. target/rel for external ones
	linkAttrs?: (url: string) => Attributes | null | undefined;
	// add loading="lazy" to images
	lazyImages?: boolean;
	// a paragraph holding nothing but images (and raw inline HTML such as <video>) is emitted
	// without its <p>, and its line breaks as plain newlines. handy for CSS photo grids.
	unwrapImages?: boolean;
	// a paragraph that is just one image with a title becomes <figure> with the title as <figcaption>
	figures?: boolean;
	// wrap each table in <div class="...">, e.g. for horizontal scrolling on phones
	tableWrapperClass?: string | null;
	// give headings GitHub-style id slugs
	headingIds?: boolean;
	// clickable # links on headings (turns headingIds on)
	headingAnchors?: boolean | HeadingAnchorOptions;
	// prefix for every generated id (heading slugs, footnotes), for pages holding several documents
	idPrefix?: string;
	// how footnotes are laid out
	footnotes?: FootnoteOptions;
	// syntax highlighting for code blocks (HTML output). return HTML for the code's contents, or a
	// whole <pre>...</pre> (shiki does), or nothing to keep the plain escaped code
	highlight?: (code: string, lang: string | null, meta: string | null) => string | null | undefined;
	// a class per element name, e.g. { p: 'mb-4', a: 'text-accent' }
	classes?: Classes;
	// replace how a node type renders. return undefined to fall back to the default.
	renderers?: Renderers;
	// plugins, for the renderers they bring
	plugins?: readonly PluginInput[];
}

export type MarkdownOptions = ParseOptions & RenderOptions;

// the URL an element should get, or null when the policy rejects it
export function resolveUrl(url: string, kind: UrlKind, options: RenderOptions): string | null {
	const policy =
		options.urlPolicy ?? (options.allowedSchemes ? allowSchemes(options.allowedSchemes) : defaultUrlPolicy);
	return policy(url, kind) ?? null;
}
