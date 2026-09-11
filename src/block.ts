// the block half of the parser: splits a document into paragraphs, headings, lists, quotes,
// code, tables and the rest, then hands each leaf's text to the inline parser. the structure is
// CommonMark's line-by-line open/close container algorithm, following commonmark.js, extended
// with GFM tables, task list items and footnote definitions, definition lists, and plugin
// block rules (raw fences, markdown containers, single lines).
import type {
	AlignType,
	BlockContent,
	Container,
	DefinitionDescription,
	DefinitionTerm,
	FootnoteDefinition,
	ListItem,
	PhrasingContent,
	Root,
	TableRow
} from './ast.js';
import { extractFrontmatter } from './frontmatter.js';
import { InlineParser, toSticky, trimMd, type FootnoteLabel, type LinkDefinition } from './inline.js';
import { resolveParseOptions, type ParseOptions, type ResolvedParseOptions } from './options.js';
import type { ContainerRule, DefinitionRule, FenceRule, LineRule, ParseContext } from './plugin.js';
import { sanitizeTree } from './sanitize.js';
import { CLOSETAG, OPENTAG, normalizeLabel, stripComments, tagfilter, unescapeString } from './util.js';

const CODE_INDENT = 4;
// how deep quotes, lists, containers and footnotes may nest. deeper markers are kept as text: real
// documents never get close, and unbounded depth would let "> > > > ..." overflow the stack
const MAX_NESTING = 100;
const C_TAB = 9;
const C_SPACE = 32;
const C_GREATERTHAN = 62;
const C_LESSTHAN = 60;
const C_OPEN_BRACKET = 91;

const reHtmlBlockOpen: RegExp[] = [
	/./, // types are 1-based
	/^<(?:script|pre|textarea|style)(?:\s|>|$)/i,
	/^<!--/,
	/^<[?]/,
	/^<![A-Za-z]/,
	/^<!\[CDATA\[/,
	/^<[/]?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[123456]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|search|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|[/]?[>]|$)/i,
	new RegExp(`^(?:${OPENTAG}|${CLOSETAG})\\s*$`, 'i')
];

const reHtmlBlockClose: RegExp[] = [/./, /<\/(?:script|pre|textarea|style)>/i, /-->/, /\?>/, />/, /\]\]>/];

const reThematicBreak = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;
// first characters that could start some block other than a paragraph; plugins add theirs
const MAYBE_SPECIAL = '#`~*+_=<>|:[-0123456789';
const reNonSpace = /[^ \t\f\v\r\n]/;
const reBulletListMarker = /^[*+-]/;
const reOrderedListMarker = /^(\d{1,9})([.)])/;
const reATXHeadingMarker = /^#{1,6}(?:[ \t]+|$)/;
const reCodeFence = /^`{3,}(?!.*`)|^~{3,}/;
const reSetextHeadingLine = /^(?:=+|-+)[ \t]*$/;
const reLineEnding = /\r\n|\n|\r/;
const reTableDelimiterRow = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const reFootnoteDefinition = /^\[\^([^\]\s]+)\]:/;
const reTaskMarker = /^\[([ xX])\](?=[ \t\n]|$)[ \t]*/;
const reDefinitionMarker = /^:[ \t]/;
const reContainerOpening = /^[ \t]*([A-Za-z][\w-]*)(?:[ \t]+(.*?))?[ \t]*$/;
// the start of a [//]: # (...) comment line; the balanced (...) is scanned by hand
const reCommentLine = /^\[(?:\/\/|comment)\]:[ \t]*(?:#|<>)[ \t]*\(/;

type BlockType =
	| 'document'
	| 'blockquote'
	| 'list'
	| 'item'
	| 'paragraph'
	| 'heading'
	| 'thematicBreak'
	| 'codeBlock'
	| 'htmlBlock'
	| 'table'
	| 'footnoteDefinition'
	| 'container'
	| 'definitionList'
	| 'definitionTerm'
	| 'definitionDescription'
	// a finished node from a plugin's line rule or one-line fence
	| 'custom';

interface ListData {
	type: 'bullet' | 'ordered';
	tight: boolean;
	bulletChar: string | null;
	start: number | null;
	delimiter: string | null;
	padding: number;
	markerOffset: number;
}

class Block {
	parent: Block | null = null;
	children: Block[] = [];
	open = true;
	endLine = 0;
	content = '';
	// set on blocks that finalised into nothing (e.g. a comment-only HTML block)
	removed = false;
	// how many containers deep this block sits; the document is 0
	depth = 0;

	level = 0;
	fenced = false;
	fenceChar = '';
	fenceLength = 0;
	fenceOffset = 0;
	fenceRule: FenceRule | null = null;
	info = '';
	htmlType = 0;
	listData: ListData | null = null;
	checked: boolean | null = null;
	align: AlignType[] = [];
	rows: string[][] = [];
	label = '';
	inlines: PhrasingContent[] = [];
	cells: PhrasingContent[][][] = [];
	containerRule: ContainerRule | null = null;
	containerName = '';
	containerTitle = '';
	customNode: BlockContent | null = null;

	constructor(
		public type: BlockType,
		public startLine: number
	) {}

	get lastChild(): Block | null {
		return this.children[this.children.length - 1] ?? null;
	}

	append(child: Block): void {
		child.parent = this;
		child.depth = this.depth + 1;
		this.children.push(child);
	}

	// only ever called on a block that is its parent's last child, so the search from the end
	// finds it straight away
	replaceWith(other: Block): void {
		const siblings = this.parent?.children;
		if (!siblings) return;
		other.parent = this.parent;
		other.depth = this.depth;
		siblings[siblings.lastIndexOf(this)] = other;
		this.parent = null;
	}
}

// true when a blank line separates the block from the sibling after it
function endsWithBlankLine(block: Block, next: Block | undefined): boolean {
	return next !== undefined && block.endLine !== next.startLine - 1;
}

function isSpaceOrTab(c: number): boolean {
	return c === C_SPACE || c === C_TAB;
}

function peek(s: string, pos: number): number {
	return pos < s.length ? s.charCodeAt(pos) : -1;
}

// how many times ch repeats at the start of s
function countRun(s: string, ch: string): number {
	let n = 0;
	while (s[n] === ch) n++;
	return n;
}

// splits a table row into cells. a backslash-escaped pipe stays in the cell as a plain pipe.
function splitRow(line: string): string[] {
	let row = line.trim();
	if (row.startsWith('|')) row = row.slice(1);
	if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);

	const cells: string[] = [];
	let cell = '';
	for (let i = 0; i < row.length; i++) {
		const ch = row[i];
		if (ch === '\\' && row[i + 1] === '|') {
			cell += '|';
			i++;
		} else if (ch === '|') {
			cells.push(cell.trim());
			cell = '';
		} else {
			cell += ch;
		}
	}
	cells.push(cell.trim());
	return cells;
}

function parseAlign(cell: string): AlignType {
	const left = cell.startsWith(':');
	const right = cell.endsWith(':');
	if (left && right) return 'center';
	if (right) return 'right';
	if (left) return 'left';
	return null;
}

// length of a [//]: # (...) comment line at the start of s (parens may nest), or 0
function commentLineLength(s: string): number {
	const m = reCommentLine.exec(s);
	if (!m) return 0;
	let i = m[0].length;
	let depth = 1;
	for (; i < s.length && depth > 0; i++) {
		const ch = s[i];
		if (ch === '\\') i++;
		else if (ch === '(') depth++;
		else if (ch === ')') depth--;
	}
	if (depth !== 0) return 0;
	while (s[i] === ' ' || s[i] === '\t') i++;
	if (i < s.length && s[i] !== '\n') return 0;
	return i < s.length ? i + 1 : i;
}

// a list item's marker is followed by 1-4 spaces of padding; 5 or more mean the content is
// indented code, so the padding is 1. shared by list items and definition descriptions.
// the parser must be just past the marker.
function markerPadding(parser: BlockParser, markerLength: number): number {
	const spacesStartCol = parser.column;
	const spacesStartOffset = parser.offset;
	do {
		parser.advanceOffset(1, true);
	} while (parser.column - spacesStartCol < 5 && isSpaceOrTab(peek(parser.line, parser.offset)));

	const blankItem = peek(parser.line, parser.offset) === -1;
	const spacesAfterMarker = parser.column - spacesStartCol;
	if (spacesAfterMarker >= 5 || spacesAfterMarker < 1 || blankItem) {
		parser.column = spacesStartCol;
		parser.offset = spacesStartOffset;
		if (isSpaceOrTab(peek(parser.line, parser.offset))) parser.advanceOffset(1, true);
		return markerLength + 1;
	}
	return markerLength + spacesAfterMarker;
}

type BlockStart = (parser: BlockParser, container: Block) => 0 | 1 | 2;

interface BlockSpec {
	// 0 = the line continues this block, 1 = it doesn't, 2 = the line is fully consumed
	continue(parser: BlockParser, block: Block): 0 | 1 | 2;
	finalize(parser: BlockParser, block: Block): void;
	canContain(type: BlockType): boolean;
	acceptsLines: boolean;
}

const noop = () => {};

// continuation for blocks whose content is indented under a marker (list items, definitions)
function continueIndented(parser: BlockParser, block: Block): 0 | 1 {
	const data = block.listData as ListData;
	if (parser.blank) {
		// a blank line after an empty item ends it
		if (block.children.length === 0) return 1;
		parser.advanceNextNonspace();
	} else if (parser.indent >= data.markerOffset + data.padding) {
		parser.advanceOffset(data.markerOffset + data.padding, true);
	} else {
		return 1;
	}
	return 0;
}

const endAtLastChild = (_parser: BlockParser, block: Block) => {
	block.endLine = block.lastChild ? block.lastChild.endLine : block.startLine;
};

const specs: Record<BlockType, BlockSpec> = {
	document: {
		continue: () => 0,
		finalize: (parser, block) => parser.removeLinkReferenceDefinitions(block),
		canContain: (t) => t !== 'item' && t !== 'definitionDescription',
		acceptsLines: false
	},
	list: {
		continue: () => 0,
		finalize: (_parser, block) => {
			const data = block.listData as ListData;
			const items = block.children;
			outer: for (let i = 0; i < items.length; i++) {
				const item = items[i] as Block;
				if (endsWithBlankLine(item, items[i + 1])) {
					data.tight = false;
					break;
				}
				const subs = item.children;
				for (let j = 0; j < subs.length; j++) {
					if (endsWithBlankLine(subs[j] as Block, subs[j + 1])) {
						data.tight = false;
						break outer;
					}
				}
			}
			block.endLine = block.lastChild?.endLine ?? block.endLine;
		},
		canContain: (t) => t === 'item',
		acceptsLines: false
	},
	blockquote: {
		continue: (parser) => {
			const line = parser.line;
			if (!parser.indented && peek(line, parser.nextNonspace) === C_GREATERTHAN) {
				parser.advanceNextNonspace();
				parser.advanceOffset(1, false);
				if (isSpaceOrTab(peek(line, parser.offset))) parser.advanceOffset(1, true);
				return 0;
			}
			return 1;
		},
		finalize: noop,
		canContain: (t) => t !== 'item' && t !== 'definitionDescription',
		acceptsLines: false
	},
	item: {
		continue: continueIndented,
		finalize: endAtLastChild,
		canContain: (t) => t !== 'item' && t !== 'definitionDescription',
		acceptsLines: false
	},
	footnoteDefinition: {
		continue: (parser, block) => {
			if (parser.blank) {
				if (block.children.length === 0) return 1;
				parser.advanceNextNonspace();
			} else if (parser.indent >= CODE_INDENT) {
				parser.advanceOffset(CODE_INDENT, true);
			} else {
				return 1;
			}
			return 0;
		},
		finalize: (parser, block) => {
			block.endLine = block.lastChild ? block.lastChild.endLine : block.startLine;
			const key = normalizeLabel(block.label);
			if (!parser.footnotes.has(key)) {
				parser.footnotes.set(key, { identifier: key.toLowerCase(), label: block.label });
			} else {
				// a duplicate definition is ignored, like a duplicate link reference
				block.removed = true;
			}
		},
		canContain: (t) => t !== 'item' && t !== 'definitionDescription',
		acceptsLines: false
	},
	container: {
		continue: (parser, block) => {
			if (!parser.indented) {
				const from = parser.nextNonspace;
				const run = countRun(parser.line.slice(from), block.fenceChar);
				if (run >= block.fenceLength && !reNonSpace.test(parser.line.slice(from + run))) {
					// the fence belongs to a code block or a deeper container if one is open
					if (!parser.innerTakesFence(block, run)) {
						while (parser.tip !== block) parser.finalize(parser.tip, parser.lineNumber - 1);
						parser.finalize(block, parser.lineNumber);
						return 2;
					}
				}
			}
			return 0;
		},
		finalize: noop,
		canContain: (t) => t !== 'item' && t !== 'definitionDescription',
		acceptsLines: false
	},
	definitionList: {
		continue: () => 0,
		finalize: (_parser, block) => {
			const children = block.children;
			for (let i = 0; i < children.length; i++) {
				const child = children[i] as Block;
				if (child.type !== 'definitionDescription') continue;
				const data = child.listData as ListData;
				const previous = children[i - 1];
				// a blank line before it (after its term), after it, or between its own blocks
				if (previous && child.startLine - previous.endLine > 1) data.tight = false;
				if (endsWithBlankLine(child, children[i + 1])) data.tight = false;
				const subs = child.children;
				for (let j = 0; j < subs.length; j++) {
					if (endsWithBlankLine(subs[j] as Block, subs[j + 1])) data.tight = false;
				}
			}
			block.endLine = block.lastChild?.endLine ?? block.endLine;
		},
		canContain: (t) => t === 'definitionDescription',
		acceptsLines: false
	},
	definitionTerm: {
		continue: () => 1,
		finalize: noop,
		canContain: () => false,
		acceptsLines: false
	},
	definitionDescription: {
		continue: continueIndented,
		finalize: endAtLastChild,
		canContain: (t) => t !== 'item' && t !== 'definitionDescription',
		acceptsLines: false
	},
	heading: {
		continue: () => 1,
		finalize: noop,
		canContain: () => false,
		acceptsLines: false
	},
	thematicBreak: {
		continue: () => 1,
		finalize: noop,
		canContain: () => false,
		acceptsLines: false
	},
	custom: {
		continue: () => 1,
		finalize: noop,
		canContain: () => false,
		acceptsLines: false
	},
	table: {
		continue: (parser) => (parser.blank ? 1 : 0),
		finalize: noop,
		canContain: () => false,
		acceptsLines: false
	},
	codeBlock: {
		continue: (parser, block) => {
			const line = parser.line;
			const indent = parser.indent;
			if (block.fenced) {
				const from = parser.nextNonspace;
				const run = indent <= 3 && line.charAt(from) === block.fenceChar ? countRun(line.slice(from), block.fenceChar) : 0;
				if (run >= block.fenceLength && !reNonSpace.test(line.slice(from + run))) {
					parser.finalize(block, parser.lineNumber);
					return 2;
				}
				// skip the fence's own indentation on content lines
				let i = block.fenceOffset;
				while (i > 0 && isSpaceOrTab(peek(line, parser.offset))) {
					parser.advanceOffset(1, true);
					i--;
				}
			} else if (indent >= CODE_INDENT) {
				parser.advanceOffset(CODE_INDENT, true);
			} else if (parser.blank) {
				parser.advanceNextNonspace();
			} else {
				return 1;
			}
			return 0;
		},
		finalize: (_parser, block) => {
			if (block.fenced) {
				const newline = block.content.indexOf('\n');
				block.info = unescapeString(trimMd(block.content.slice(0, newline)));
				block.content = block.content.slice(newline + 1);
			} else {
				const lines = block.content.split('\n');
				while (lines.length > 0 && /^[ \t]*$/.test(lines[lines.length - 1] as string)) lines.pop();
				block.content = lines.join('\n') + '\n';
				block.endLine = block.startLine + lines.length - 1;
			}
		},
		canContain: () => false,
		acceptsLines: true
	},
	htmlBlock: {
		continue: (parser, block) => (parser.blank && (block.htmlType === 6 || block.htmlType === 7) ? 1 : 0),
		finalize: (parser, block) => {
			block.content = block.content.replace(/\n$/, '');
			if (parser.options.keepComments) return;
			const stripped = stripComments(block.content);
			if (stripped === block.content) return;
			if (!reNonSpace.test(stripped)) {
				block.removed = true;
			} else if (!parser.options.html) {
				// only comments open HTML blocks without { html }; whatever shared the comment's
				// line is ordinary text
				block.type = 'paragraph';
				block.content = trimMd(stripped) + '\n';
			} else {
				block.content = stripped;
			}
		},
		canContain: () => false,
		acceptsLines: true
	},
	paragraph: {
		continue: (parser) => (parser.blank ? 1 : 0),
		finalize: noop,
		canContain: () => false,
		acceptsLines: true
	}
};

function parseListMarker(parser: BlockParser, container: Block): ListData | null {
	if (parser.indent >= CODE_INDENT) return null;
	const rest = parser.line.slice(parser.nextNonspace);
	const data: ListData = {
		type: 'bullet',
		tight: true,
		bulletChar: null,
		start: null,
		delimiter: null,
		padding: 0,
		markerOffset: parser.indent
	};

	let match: RegExpExecArray | null;
	if ((match = reBulletListMarker.exec(rest))) {
		data.bulletChar = match[0];
	} else if (
		(match = reOrderedListMarker.exec(rest)) &&
		// only a list starting at 1 may interrupt a paragraph
		(container.type !== 'paragraph' || match[1] === '1')
	) {
		data.type = 'ordered';
		data.start = parseInt(match[1] as string, 10);
		data.delimiter = match[2] as string;
	} else {
		return null;
	}

	const markerLength = match[0].length;
	const nextc = peek(parser.line, parser.nextNonspace + markerLength);
	if (!(nextc === -1 || isSpaceOrTab(nextc))) return null;

	// an empty item can't interrupt a paragraph
	if (container.type === 'paragraph' && !reNonSpace.test(parser.line.slice(parser.nextNonspace + markerLength))) {
		return null;
	}

	parser.advanceNextNonspace();
	parser.advanceOffset(markerLength, true);
	data.padding = markerPadding(parser, markerLength);
	return data;
}

function listsMatch(a: ListData, b: ListData): boolean {
	return a.type === b.type && a.delimiter === b.delimiter && a.bulletChar === b.bulletChar;
}

// block starts tried before plugin rules
const startsBefore: BlockStart[] = [
	// block quote
	(parser, container) => {
		if (parser.indented || peek(parser.line, parser.nextNonspace) !== C_GREATERTHAN) return 0;
		if (container.depth >= MAX_NESTING) return 0;
		parser.advanceNextNonspace();
		parser.advanceOffset(1, false);
		if (isSpaceOrTab(peek(parser.line, parser.offset))) parser.advanceOffset(1, true);
		parser.closeUnmatchedBlocks();
		parser.addChild('blockquote');
		return 1;
	},

	// ATX heading
	(parser) => {
		if (parser.indented) return 0;
		const match = reATXHeadingMarker.exec(parser.line.slice(parser.nextNonspace));
		if (!match) return 0;
		parser.advanceNextNonspace();
		parser.advanceOffset(match[0].length, false);
		parser.closeUnmatchedBlocks();
		const heading = parser.addChild('heading');
		heading.level = match[0].trim().length;
		// drop a closing run of #s
		heading.content = parser.line
			.slice(parser.offset)
			.replace(/^[ \t]*#+[ \t]*$/, '')
			.replace(/[ \t]+#+[ \t]*$/, '');
		parser.advanceOffset(parser.line.length - parser.offset, false);
		return 2;
	},

	// fenced code block
	(parser) => {
		if (parser.indented) return 0;
		const match = reCodeFence.exec(parser.line.slice(parser.nextNonspace));
		if (!match) return 0;
		const fenceLength = match[0].length;
		parser.closeUnmatchedBlocks();
		const code = parser.addChild('codeBlock');
		code.fenced = true;
		code.fenceLength = fenceLength;
		code.fenceChar = match[0][0] as string;
		code.fenceOffset = parser.indent;
		parser.advanceNextNonspace();
		parser.advanceOffset(fenceLength, false);
		return 2;
	}
];

// block starts tried after plugin rules
const startsAfter: BlockStart[] = [
	// HTML block
	(parser, container) => {
		if (parser.indented || peek(parser.line, parser.nextNonspace) !== C_LESSTHAN) return 0;
		const { html, keepComments } = parser.options;
		// without { html } only comments are recognised, and only so they can be removed
		if (!html && keepComments) return 0;
		const s = parser.line.slice(parser.nextNonspace);
		for (let type = 1; type <= 7; type++) {
			if (!html && type !== 2) continue;
			if (
				(reHtmlBlockOpen[type] as RegExp).test(s) &&
				(type < 7 || (container.type !== 'paragraph' && !parser.lazyParagraph()))
			) {
				parser.closeUnmatchedBlocks();
				// no offset adjustment: leading spaces are part of the HTML
				const block = parser.addChild('htmlBlock');
				block.htmlType = type;
				return 2;
			}
		}
		return 0;
	},

	// GFM table: the paragraph's last line is the header, this line is the delimiter row
	(parser, container) => {
		if (!parser.options.gfm.tables || parser.indented || container.type !== 'paragraph') return 0;
		const delimiterRow = parser.line.slice(parser.nextNonspace);
		if (!reTableDelimiterRow.test(delimiterRow) || !/[|:]/.test(delimiterRow)) return 0;

		const lines = container.content.slice(0, -1).split('\n');
		const headerLine = lines[lines.length - 1] as string;
		const header = splitRow(headerLine);
		const delimiters = splitRow(delimiterRow);
		if (header.length !== delimiters.length) return 0;

		parser.closeUnmatchedBlocks();
		const table = new Block('table', parser.lineNumber - 1);
		table.align = delimiters.map(parseAlign);
		table.rows = [header];

		if (lines.length > 1) {
			container.content = lines.slice(0, -1).join('\n') + '\n';
			parser.finalize(container, parser.lineNumber - 2);
			parser.tip.append(table);
		} else {
			table.startLine = container.startLine;
			container.replaceWith(table);
		}
		parser.tip = table;
		parser.advanceOffset(parser.line.length - parser.offset, false);
		return 2;
	},

	// setext heading
	(parser, container) => {
		if (parser.indented || container.type !== 'paragraph') return 0;
		const match = reSetextHeadingLine.exec(parser.line.slice(parser.nextNonspace));
		if (!match) return 0;
		parser.closeUnmatchedBlocks();
		container.content = parser.consumeDefinitions(container.content);
		if (container.content.length === 0) return 0;
		const heading = new Block('heading', container.startLine);
		heading.level = match[0][0] === '=' ? 1 : 2;
		heading.content = container.content;
		container.replaceWith(heading);
		parser.tip = heading;
		parser.advanceOffset(parser.line.length - parser.offset, false);
		return 2;
	},

	// thematic break
	(parser) => {
		if (parser.indented || !reThematicBreak.test(parser.line.slice(parser.nextNonspace))) return 0;
		parser.closeUnmatchedBlocks();
		parser.addChild('thematicBreak');
		parser.advanceOffset(parser.line.length - parser.offset, false);
		return 2;
	},

	// definition list description: `: text` under one or more term lines
	(parser, container) => {
		if (!parser.definitionLists || parser.indented) return 0;
		if (!reDefinitionMarker.test(parser.line.slice(parser.nextNonspace))) return 0;
		if (container.depth + 2 > MAX_NESTING) return 0;
		const markerOffset = parser.indent;
		let loose = false;

		if (container.type === 'paragraph') {
			// the paragraph's lines are the terms
			parser.closeUnmatchedBlocks();
			parser.termsToList(container);
		} else if (container.type === 'definitionList') {
			parser.closeUnmatchedBlocks();
		} else {
			// a blank line between the terms and their first definition makes it loose
			const previous = container.lastChild;
			if (!previous || previous.open || previous.type !== 'paragraph' || previous.removed) return 0;
			parser.closeUnmatchedBlocks();
			parser.termsToList(previous);
			loose = true;
		}

		parser.advanceNextNonspace();
		parser.advanceOffset(1, true);
		const padding = markerPadding(parser, 1);
		const description = parser.addChild('definitionDescription');
		description.listData = {
			type: 'bullet',
			tight: !loose,
			bulletChar: null,
			start: null,
			delimiter: null,
			padding,
			markerOffset
		};
		return 1;
	},

	// GFM footnote definition: [^label]: text, continued by indented lines
	(parser, container) => {
		if (!parser.options.gfm.footnotes || parser.indented || container.type === 'paragraph') return 0;
		if (container.depth >= MAX_NESTING) return 0;
		if (peek(parser.line, parser.nextNonspace) !== C_OPEN_BRACKET) return 0;
		const match = reFootnoteDefinition.exec(parser.line.slice(parser.nextNonspace));
		if (!match) return 0;
		parser.closeUnmatchedBlocks();
		parser.advanceNextNonspace();
		parser.advanceOffset(match[0].length, false);
		const def = parser.addChild('footnoteDefinition');
		def.label = match[1] as string;
		return 1;
	},

	// list item
	(parser, container) => {
		if (parser.indented && container.type !== 'list') return 0;
		// a new item may need a new list around it: two levels
		if (container.depth + 2 > MAX_NESTING) return 0;
		const data = parseListMarker(parser, container);
		if (!data) return 0;
		parser.closeUnmatchedBlocks();
		if (parser.tip.type !== 'list' || !listsMatch(container.listData as ListData, data)) {
			const list = parser.addChild('list');
			list.listData = data;
		}
		const item = parser.addChild('item');
		item.listData = data;
		return 1;
	},

	// indented code block
	(parser) => {
		if (!parser.options.indentedCode) return 0;
		if (!parser.indented || parser.tip.type === 'paragraph' || parser.blank) return 0;
		parser.advanceOffset(CODE_INDENT, true);
		parser.closeUnmatchedBlocks();
		parser.addChild('codeBlock');
		return 2;
	}
];

// a plugin's raw fence, like $$ ... $$
function fenceStart(rule: FenceRule): BlockStart {
	const minimum = rule.length ?? 3;
	return (parser) => {
		if (parser.indented) return 0;
		const rest = parser.line.slice(parser.nextNonspace);
		const run = countRun(rest, rule.char);
		if (run < minimum) return 0;
		const info = rest.slice(run).trimEnd();

		// opener and closer on one line: `$$ x $$`
		let body = info.length;
		while (body > 0 && info[body - 1] === rule.char) body--;
		if (info.length - body >= run && reNonSpace.test(info.slice(0, body))) {
			const node = rule.node(info.slice(0, body).trim(), '', parser.context);
			if (!node) return 0;
			parser.closeUnmatchedBlocks();
			parser.addChild('custom').customNode = node;
			parser.advanceOffset(parser.line.length - parser.offset, false);
			return 2;
		}

		parser.closeUnmatchedBlocks();
		const code = parser.addChild('codeBlock');
		code.fenced = true;
		code.fenceChar = rule.char;
		code.fenceLength = run;
		code.fenceOffset = parser.indent;
		code.fenceRule = rule;
		parser.advanceNextNonspace();
		parser.advanceOffset(run, false);
		return 2;
	};
}

// a plugin's markdown container: `:::name title` ... `:::`
function containerStart(rule: ContainerRule): BlockStart {
	const char = rule.char ?? ':';
	const minimum = rule.length ?? 3;
	const names = rule.names;
	const accepts =
		typeof names === 'function' ? names : names ? (name: string) => names.includes(name) : () => true;
	return (parser, container) => {
		if (parser.indented) return 0;
		const rest = parser.line.slice(parser.nextNonspace);
		const run = countRun(rest, char);
		if (run < minimum) return 0;
		const opening = reContainerOpening.exec(rest.slice(run));
		if (!opening || !accepts(opening[1] as string)) return 0;
		if (container.depth >= MAX_NESTING) return 0;
		parser.closeUnmatchedBlocks();
		const block = parser.addChild('container');
		block.fenceChar = char;
		block.fenceLength = run;
		block.containerName = opening[1] as string;
		block.containerTitle = opening[2] ?? '';
		block.containerRule = rule;
		parser.advanceOffset(parser.line.length - parser.offset, false);
		return 2;
	};
}

// a plugin's single-line block
function lineStart(rule: LineRule): BlockStart {
	return (parser, container) => {
		if (parser.indented) return 0;
		if (!rule.interrupt && (container.type === 'paragraph' || parser.lazyParagraph())) return 0;
		rule.match.lastIndex = 0;
		const match = rule.match.exec(parser.line.slice(parser.nextNonspace));
		if (!match || match.index !== 0) return 0;
		const node = rule.node(match, parser.context);
		if (!node) return 0;
		parser.closeUnmatchedBlocks();
		parser.addChild('custom').customNode = node;
		parser.advanceOffset(parser.line.length - parser.offset, false);
		return 2;
	};
}

function charClass(chars: string): RegExp {
	const escaped = [...new Set(chars)].map((c) => `\\u{${(c.codePointAt(0) as number).toString(16)}}`).join('');
	return new RegExp(`^[${escaped}]`, 'u');
}

export class BlockParser {
	readonly refmap = new Map<string, LinkDefinition>();
	readonly footnotes = new Map<string, FootnoteLabel>();
	readonly inline: InlineParser;
	readonly context: ParseContext;
	readonly definitionLists: boolean;
	private readonly starts: BlockStart[];
	// null when a plugin line rule could start with anything, so every line is tried
	private readonly maybeSpecial: RegExp | null;
	private readonly definitionRules: DefinitionRule[] = [];

	doc = new Block('document', 1);
	tip: Block = this.doc;
	oldtip: Block = this.doc;
	lastMatchedContainer: Block = this.doc;
	line = '';
	lineNumber = 0;
	offset = 0;
	column = 0;
	nextNonspace = 0;
	nextNonspaceColumn = 0;
	indent = 0;
	indented = false;
	blank = false;
	partiallyConsumedTab = false;
	allClosed = true;

	constructor(readonly options: ResolvedParseOptions) {
		this.context = {
			options,
			data: {},
			parseInline: (text) => new InlineParser(options, this.refmap, this.footnotes, this.context).parse(text)
		};
		this.inline = new InlineParser(options, this.refmap, this.footnotes, this.context);

		const pluginStarts: BlockStart[] = [];
		let special = MAYBE_SPECIAL;
		let anyLine = false;
		let definitionLists = false;
		for (const plugin of options.plugins) {
			for (const rule of plugin.block ?? []) {
				if (rule.kind === 'fence') {
					pluginStarts.push(fenceStart(rule));
					special += rule.char;
				} else if (rule.kind === 'container') {
					pluginStarts.push(containerStart(rule));
					special += rule.char ?? ':';
				} else {
					pluginStarts.push(lineStart(rule));
					anyLine = true;
				}
			}
			this.definitionRules.push(...(plugin.definitions ?? []));
			if (plugin.syntax?.definitionLists) definitionLists = true;
		}
		this.starts = [...startsBefore, ...pluginStarts, ...startsAfter];
		this.maybeSpecial = anyLine ? null : charClass(special);
		this.definitionLists = definitionLists;
	}

	parse(input: string): Root {
		const front = this.options.frontmatter ? extractFrontmatter(input) : null;
		if (front) input = front.body;
		const lines = input.split(reLineEnding);
		let length = lines.length;
		// a final newline doesn't make one more (blank) line
		if (input.endsWith('\n') || input.endsWith('\r')) length -= 1;
		for (let i = 0; i < length; i++) this.incorporateLine(lines[i] as string);
		while (this.tip.parent) this.finalize(this.tip, length);
		this.finalize(this.doc, length);
		this.processInlines(this.doc);
		const root: Root = { type: 'root', children: this.convertChildren(this.doc) };
		if (front) {
			root.children.unshift({ type: 'yaml', value: front.raw as string });
			root.data = { ...root.data, frontmatter: front.data };
		}
		return this.finish(root);
	}

	// inline markdown only, with the same plugin transforms (and sanitising) as a document
	parseInlineContent(text: string): PhrasingContent[] {
		const root = this.finish({ type: 'root', children: [{ type: 'paragraph', children: this.inline.parse(text) }] });
		const first = root.children[0];
		return first?.type === 'paragraph' ? first.children : [];
	}

	// plugin transforms, in order, then the sanitiser last so nothing a transform makes skips it
	private finish(root: Root): Root {
		for (const plugin of this.options.plugins) {
			if (plugin.transform) root = plugin.transform(root, this.context) ?? root;
		}
		if (this.options.sanitize) root = sanitizeTree(root, this.options.sanitize);
		return root;
	}

	// --- line bookkeeping

	findNextNonspace(): void {
		const line = this.line;
		let i = this.offset;
		let cols = this.column;
		let c = '';
		while ((c = line.charAt(i)) !== '') {
			if (c === ' ') {
				i++;
				cols++;
			} else if (c === '\t') {
				i++;
				cols += 4 - (cols % 4);
			} else {
				break;
			}
		}
		this.blank = c === '\n' || c === '\r' || c === '';
		this.nextNonspace = i;
		this.nextNonspaceColumn = cols;
		this.indent = cols - this.column;
		this.indented = this.indent >= CODE_INDENT;
	}

	// moves forward count characters, or count columns when columns is true (a tab may then be
	// only partly consumed)
	advanceOffset(count: number, columns: boolean): void {
		const line = this.line;
		let c: string | undefined;
		while (count > 0 && (c = line[this.offset]) !== undefined) {
			if (c === '\t') {
				const charsToTab = 4 - (this.column % 4);
				if (columns) {
					this.partiallyConsumedTab = charsToTab > count;
					const advance = charsToTab > count ? count : charsToTab;
					this.column += advance;
					this.offset += this.partiallyConsumedTab ? 0 : 1;
					count -= advance;
				} else {
					this.partiallyConsumedTab = false;
					this.column += charsToTab;
					this.offset += 1;
					count -= 1;
				}
			} else {
				this.partiallyConsumedTab = false;
				this.offset += 1;
				this.column += 1;
				count -= 1;
			}
		}
	}

	advanceNextNonspace(): void {
		this.offset = this.nextNonspace;
		this.column = this.nextNonspaceColumn;
		this.partiallyConsumedTab = false;
	}

	// this line would lazily continue an open paragraph it didn't match its way into
	lazyParagraph(): boolean {
		return !this.allClosed && !this.blank && this.tip.type === 'paragraph';
	}

	// --- tree building

	addLine(): void {
		if (this.partiallyConsumedTab) {
			this.offset += 1;
			const charsToTab = 4 - (this.column % 4);
			this.tip.content += ' '.repeat(charsToTab);
		}
		this.tip.content += this.line.slice(this.offset) + '\n';
	}

	// adds a child to the tip, first closing whatever can't contain it
	addChild(type: BlockType): Block {
		while (!specs[this.tip.type].canContain(type)) this.finalize(this.tip, this.lineNumber - 1);
		const block = new Block(type, this.lineNumber);
		this.tip.append(block);
		this.tip = block;
		return block;
	}

	closeUnmatchedBlocks(): void {
		if (this.allClosed) return;
		while (this.oldtip !== this.lastMatchedContainer) {
			const parent = this.oldtip.parent as Block;
			this.finalize(this.oldtip, this.lineNumber - 1);
			this.oldtip = parent;
		}
		this.allClosed = true;
	}

	finalize(block: Block, lineNumber: number): void {
		const above = block.parent;
		block.open = false;
		block.endLine = lineNumber;
		specs[block.type].finalize(this, block);
		this.tip = above ?? this.doc;
	}

	// turns a paragraph's lines into the terms of a new, open definition list in its place
	termsToList(paragraph: Block): Block {
		const list = new Block('definitionList', paragraph.startLine);
		paragraph.replaceWith(list);
		paragraph.content
			.replace(/\n$/, '')
			.split('\n')
			.forEach((line, i) => {
				const term = new Block('definitionTerm', paragraph.startLine + i);
				term.content = line;
				term.open = false;
				term.endLine = term.startLine;
				list.append(term);
			});
		this.tip = list;
		return list;
	}

	// whether a closing fence seen by an open container really belongs to something inside it:
	// an open fenced code or HTML block (whose content it is), or a deeper container it can close
	innerTakesFence(container: Block, run: number): boolean {
		for (let block: Block | null = this.tip; block && block !== container; block = block.parent) {
			if (!block.open) continue;
			if ((block.type === 'codeBlock' && block.fenced) || block.type === 'htmlBlock') return true;
			if (block.type === 'container' && block.fenceChar === container.fenceChar && block.fenceLength <= run) return true;
		}
		return false;
	}

	incorporateLine(input: string): void {
		let container = this.doc;
		this.oldtip = this.tip;
		this.offset = 0;
		this.column = 0;
		this.blank = false;
		this.partiallyConsumedTab = false;
		this.lineNumber += 1;
		const line = input.includes('\0') ? input.replace(/\0/g, '�') : input;
		this.line = line;

		// walk down the open blocks, checking the line continues each one
		let last: Block | null;
		while ((last = container.lastChild) !== null && last.open) {
			container = last;
			this.findNextNonspace();
			const result = specs[container.type].continue(this, container);
			if (result === 2) return;
			if (result === 1) {
				container = container.parent as Block;
				break;
			}
		}

		this.allClosed = container === this.oldtip;
		this.lastMatchedContainer = container;

		let matchedLeaf = container.type !== 'paragraph' && specs[container.type].acceptsLines;

		// then look for new block starts inside the last matched container
		while (!matchedLeaf) {
			this.findNextNonspace();
			if (!this.indented && this.maybeSpecial && !this.maybeSpecial.test(line.slice(this.nextNonspace))) {
				this.advanceNextNonspace();
				break;
			}
			let i = 0;
			for (; i < this.starts.length; i++) {
				const res = (this.starts[i] as BlockStart)(this, container);
				if (res === 1) {
					container = this.tip;
					break;
				}
				if (res === 2) {
					container = this.tip;
					matchedLeaf = true;
					break;
				}
			}
			if (i === this.starts.length) {
				this.advanceNextNonspace();
				break;
			}
		}

		// what's left of the line is text
		if (this.lazyParagraph()) {
			this.addLine();
			return;
		}

		this.closeUnmatchedBlocks();
		const type = container.type;
		if (specs[type].acceptsLines) {
			this.addLine();
			if (
				type === 'htmlBlock' &&
				container.htmlType >= 1 &&
				container.htmlType <= 5 &&
				(reHtmlBlockClose[container.htmlType] as RegExp).test(line.slice(this.offset))
			) {
				this.finalize(container, this.lineNumber);
			}
		} else if (type === 'table') {
			if (this.offset < line.length && !this.blank) container.rows.push(splitRow(line.slice(this.offset)));
		} else if (this.offset < line.length && !this.blank) {
			this.addChild('paragraph');
			this.advanceNextNonspace();
			this.addLine();
		}
	}

	// --- post-processing

	// strips link reference definitions, [//]: # comment lines and plugin definition lines off
	// the front of a paragraph's text, recording the definitions
	consumeDefinitions(content: string): string {
		outer: for (;;) {
			if (peek(content, 0) === C_OPEN_BRACKET) {
				const comment = commentLineLength(content);
				if (comment) {
					content = content.slice(comment);
					continue;
				}
				const used = this.inline.parseReference(content);
				if (used) {
					content = content.slice(used);
					continue;
				}
			}
			for (const rule of this.definitionRules) {
				const re = toSticky(rule.match);
				re.lastIndex = 0;
				const match = re.exec(content);
				if (!match || match[0].length === 0) continue;
				rule.define(match, this.context);
				// the rest of the matched line goes with it
				let end = match[0].length;
				if (content[end - 1] !== '\n') {
					const newline = content.indexOf('\n', end);
					end = newline === -1 ? content.length : newline + 1;
				}
				content = content.slice(end);
				continue outer;
			}
			return content;
		}
	}

	removeLinkReferenceDefinitions(root: Block): void {
		const walk = (block: Block) => {
			if (block.type === 'paragraph') {
				const before = block.content;
				block.content = this.consumeDefinitions(block.content);
				// a paragraph that was nothing but definitions disappears
				if (block.content !== before && !reNonSpace.test(block.content)) block.removed = true;
			}
			for (const child of block.children) walk(child);
		};
		walk(root);
	}

	processInlines(block: Block): void {
		const { gfm } = this.options;
		if (block.type === 'item' && gfm.tasklists) {
			const first = block.children[0];
			if (first?.type === 'paragraph') {
				const task = reTaskMarker.exec(first.content);
				if (task) {
					block.checked = task[1] !== ' ';
					first.content = first.content.slice(task[0].length);
				}
			}
		}

		if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'definitionTerm') {
			block.inlines = this.inline.parse(block.content);
		} else if (block.type === 'container' && block.containerTitle) {
			block.inlines = this.inline.parse(block.containerTitle);
		} else if (block.type === 'table') {
			const width = block.align.length;
			block.cells = block.rows.map((row) => {
				const cells: PhrasingContent[][] = [];
				for (let i = 0; i < width; i++) cells.push(this.inline.parse(row[i] ?? ''));
				return cells;
			});
		}
		for (const child of block.children) this.processInlines(child);
	}

	// --- working tree -> AST

	convertChildren(block: Block): BlockContent[] {
		const out: BlockContent[] = [];
		for (const child of block.children) {
			const node = this.convert(child);
			if (!node) continue;
			// entries separated by blank lines were parsed as separate lists; they're one list
			const previous = out[out.length - 1];
			if (node.type === 'definitionList' && previous?.type === 'definitionList') {
				previous.children.push(...node.children);
				previous.spread ||= node.spread;
				continue;
			}
			out.push(node);
		}
		return out;
	}

	convert(block: Block): BlockContent | null {
		if (block.removed) return null;
		switch (block.type) {
			case 'paragraph':
				return { type: 'paragraph', children: block.inlines };
			case 'heading':
				return { type: 'heading', depth: block.level as 1 | 2 | 3 | 4 | 5 | 6, children: block.inlines };
			case 'thematicBreak':
				return { type: 'thematicBreak' };
			case 'blockquote':
				return { type: 'blockquote', children: this.convertChildren(block) };
			case 'codeBlock': {
				if (block.fenceRule) return block.fenceRule.node(block.content, block.info, this.context) ?? null;
				const info = block.info;
				const space = info.search(/[ \t]/);
				const lang = space === -1 ? info : info.slice(0, space);
				const meta = space === -1 ? '' : info.slice(space).trim();
				return { type: 'code', lang: lang || null, meta: meta || null, value: block.content };
			}
			case 'htmlBlock':
				return { type: 'html', value: this.options.gfm.tagfilter ? tagfilter(block.content) : block.content };
			case 'custom':
				return block.customNode;
			case 'list': {
				const data = block.listData as ListData;
				const spread = !data.tight;
				return {
					type: 'list',
					ordered: data.type === 'ordered',
					start: data.start,
					spread,
					children: block.children.map(
						(item): ListItem => ({
							type: 'listItem',
							checked: item.checked,
							spread,
							children: this.convertChildren(item)
						})
					)
				};
			}
			case 'table':
				return {
					type: 'table',
					align: block.align,
					children: block.cells.map(
						(cells): TableRow => ({
							type: 'tableRow',
							children: cells.map((children) => ({ type: 'tableCell', children }))
						})
					)
				};
			case 'footnoteDefinition': {
				const def = this.footnotes.get(normalizeLabel(block.label)) as FootnoteLabel;
				const node: FootnoteDefinition = {
					type: 'footnoteDefinition',
					identifier: def.identifier,
					label: block.label,
					children: this.convertChildren(block)
				};
				return node;
			}
			case 'container': {
				const node: Container = {
					type: 'container',
					name: block.containerName,
					title: block.containerTitle ? block.inlines : null,
					collapsible: null,
					children: this.convertChildren(block)
				};
				const out = block.containerRule?.node?.(node, this.context);
				return out === undefined ? node : out;
			}
			case 'definitionList': {
				const children = block.children
					.filter((child) => !child.removed)
					.map(
						(child): DefinitionTerm | DefinitionDescription =>
							child.type === 'definitionTerm'
								? { type: 'definitionTerm', children: child.inlines }
								: {
										type: 'definitionDescription',
										spread: !(child.listData as ListData).tight,
										children: this.convertChildren(child)
									}
					);
				return {
					type: 'definitionList',
					spread: children.some((c) => c.type === 'definitionDescription' && c.spread),
					children
				};
			}
			default:
				return null;
		}
	}
}

export function parse(markdown: string, options?: ParseOptions): Root {
	return new BlockParser(resolveParseOptions(options)).parse(markdown);
}
