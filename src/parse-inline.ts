// inline parsing on its own. deliberately imports neither block.ts nor index.ts: the Svelte
// InlineMarkdown component pulls this in, and a page that only renders short copy shouldn't ship
// the block parser or every built-in plugin
import type { PhrasingContent } from './ast.js';
import { finishTree } from './finish.js';
import { InlineParser, type FootnoteLabel, type LinkDefinition } from './inline.js';
import { resolveParseOptions, type ParseOptions } from './options.js';
import type { ParseContext } from './plugin.js';

// parses a single line of inline markdown (no paragraphs, lists or headings), e.g. for a
// title or a short description. plugin transforms and sanitising run as they do for a document
export function parseInline(markdown: string, options?: ParseOptions): PhrasingContent[] {
	const resolved = resolveParseOptions(options);
	// inline text has no definitions, but the parser and plugin hooks expect somewhere to look
	const refmap = new Map<string, LinkDefinition>();
	const footnotes = new Map<string, FootnoteLabel>();
	const context: ParseContext = {
		options: resolved,
		data: {},
		parseInline: (text) => new InlineParser(resolved, refmap, footnotes, context).parse(text)
	};
	const children = new InlineParser(resolved, refmap, footnotes, context).parse(markdown);
	const root = finishTree({ type: 'root', children: [{ type: 'paragraph', children }] }, context);
	const first = root.children[0];
	return first?.type === 'paragraph' ? first.children : [];
}
