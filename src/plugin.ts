// the plugin API. every built-in extension (callouts, typography, math, ...) is written against
// exactly this, so anything they do, your own plugin can do too.
import type { BlockContent, Container, PhrasingContent, Root } from './ast.js';
import type { RenderContext, ResolvedParseOptions } from './options.js';

// what an inline rule sees while the inline parser is at one of its trigger characters
export interface InlineState {
	// the text being parsed: one paragraph, heading or table cell
	readonly source: string;
	// where the trigger character sits. a rule that matches moves this past what it used
	pos: number;
	// storage shared by every hook of one parse (ParseContext.data)
	readonly data: Record<string, unknown>;
	// matches a regex exactly at pos (it's made sticky for you), advancing pos on success
	match(re: RegExp): RegExpExecArray | null;
	// the character before pos, or '\n' at the start
	charBefore(): string;
	// parses nested inline markdown, e.g. a custom link's label
	parseInline(text: string): PhrasingContent[];
}

// new inline syntax. the rule is only asked at its trigger characters, before fgmd's own syntax.
// return the node(s) to insert, or nothing to decline (pos is then reset for you)
export interface InlineRule {
	// characters that can start the syntax, e.g. '@' or ':'. single UTF-16 code units
	triggers: string;
	parse(state: InlineState): PhrasingContent | PhrasingContent[] | null | undefined | false;
}

// new wrapping syntax built from a repeated character, like ==this==. it goes through the same
// delimiter algorithm as *emphasis*, so it nests and interleaves with it correctly
export interface DelimiterRule {
	// the character, e.g. '='
	char: string;
	// run length -> the node type that wraps the text between an opener and a closer of that
	// length, e.g. { 2: 'mark' }. runs of other lengths stay plain text
	lengths: Record<number, string>;
	// may a run open or close inside a word, like * (true, the default), or not, like _
	intraword?: boolean;
}

// a fenced block of raw text, like $$ ... $$. the opening line may carry an info string; a run
// of the fence character at least as long as the opener closes it. `$$ x $$` on one line works too
export interface FenceRule {
	kind: 'fence';
	char: string;
	// the shortest run that opens a fence. default 3
	length?: number;
	node(content: string, info: string, ctx: ParseContext): BlockContent | null | undefined;
}

// a fenced container whose content is markdown: `:::name title` ... `:::`. a longer fence
// (`::::`) can wrap a shorter one, and a closing fence always goes to the innermost container it fits
export interface ContainerRule {
	kind: 'container';
	// default ':'
	char?: string;
	// default 3
	length?: number;
	// which names this rule accepts. default: all of them
	names?: readonly string[] | ((name: string) => boolean);
	// adjust the container (set data, collapsible, title...) or return a different node. null drops it
	node?(container: Container, ctx: ParseContext): BlockContent | null | void;
}

// one whole line that becomes a block, e.g. [[toc]] or an embed
export interface LineRule {
	kind: 'line';
	// matched against the line without its indentation; must match from the first character
	match: RegExp;
	node(match: RegExpExecArray, ctx: ParseContext): BlockContent | null | undefined;
	// may the line cut a paragraph short? default false
	interrupt?: boolean;
}

export type BlockRule = FenceRule | ContainerRule | LineRule;

// definition lines consumed from the start of a paragraph before inline parsing, the way
// `[ref]: /url` lines are, e.g. `*[HTML]: HyperText Markup Language`. matched sticky at the
// paragraph's start; the rest of the matched line is consumed with it
export interface DefinitionRule {
	match: RegExp;
	define(match: RegExpExecArray, ctx: ParseContext): void;
}

// handed to block rules, definition rules and transforms
export interface ParseContext {
	readonly options: ResolvedParseOptions;
	// storage shared by every hook of one parse, e.g. collected abbreviations
	readonly data: Record<string, unknown>;
	parseInline(text: string): PhrasingContent[];
}

export interface Plugin {
	name: string;
	inline?: readonly InlineRule[];
	delimiters?: readonly DelimiterRule[];
	block?: readonly BlockRule[];
	definitions?: readonly DefinitionRule[];
	// runs after parsing, in plugin order. edit the tree in place or return a new one
	transform?(tree: Root, ctx: ParseContext): Root | void;
	// HTML renderers for the plugin's nodes (or overrides of built-in ones). your own
	// options.renderers win over a plugin's
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	renderers?: Record<string, ((node: any, context: RenderContext) => string | undefined) | undefined>;
	// native syntax the parser switches on for this plugin
	syntax?: { definitionLists?: boolean };
}

// a plugin, or a built-in's name with optional options: 'math', ['emoji', { map }]. names make
// plugins usable from JSON: the CLI, PHP, config files
export type PluginInput = Plugin | string | readonly [string, Record<string, unknown>?];

type Factory = (options?: Record<string, unknown>) => Plugin;
const registry = new Map<string, Factory>();

// makes a plugin available by name
export function registerPlugin(name: string, factory: Factory): void {
	registry.set(name, factory);
}

export function resolvePlugins(inputs: readonly PluginInput[] = []): Plugin[] {
	return inputs.map((input) => {
		if (typeof input === 'object' && !Array.isArray(input)) return input as Plugin;
		const [name, options] = typeof input === 'string' ? [input, undefined] : (input as [string, Record<string, unknown>?]);
		const factory = registry.get(name);
		if (!factory) {
			throw new Error(`fgmd: unknown plugin "${name}" (available: ${[...registry.keys()].join(', ') || 'none'})`);
		}
		return factory(options);
	});
}
