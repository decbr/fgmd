// ==highlight==, ^superscript^, ~subscript~ and smart punctuation (curly quotes, en/em dashes,
// ellipses). with subscript on, a single ~ means subscript; ~~double~~ is still strikethrough.
import type { Node, Root } from '../ast.js';
import type { InlineRule, Plugin } from '../plugin.js';
import { isBlock } from '../shared.js';
import { visit } from '../visit.js';

export interface SmartOptions {
	// opening double, closing double, opening single, closing single (also the apostrophe).
	// default '“”‘’'; try '„“‚‘' for German or '«»‹›' for French
	quotes?: string;
	// -- becomes – and --- becomes —. default true
	dashes?: boolean;
	// ... becomes …. default true
	ellipses?: boolean;
}

export interface TypographyOptions {
	mark?: boolean;
	superscript?: boolean;
	subscript?: boolean;
	// default true
	smart?: boolean | SmartOptions;
}

// ^text^ or ~text~: no unescaped spaces inside, the way Pandoc reads them
function scriptRule(char: '^' | '~', type: 'superscript' | 'subscript'): InlineRule {
	const re = new RegExp(`\\${char}((?:\\\\.|[^\\s\\\\\\${char}])+)\\${char}`);
	return {
		triggers: char,
		parse(state) {
			const m = state.match(re);
			return m ? { type, children: state.parseInline(m[1] as string) } : null;
		}
	};
}

// a quote after nothing, whitespace or opening punctuation opens; anywhere else it closes
const opens = (ch: string) => ch === '' || /[\s([{—–\-“‘«‹„‚]/u.test(ch);

function smartText(value: string, previous: string, quotes: string, dashes: boolean, ellipses: boolean): string {
	if (dashes) value = value.replace(/---/g, '—').replace(/--/g, '–');
	if (ellipses) value = value.replace(/\.\.\./g, '…');
	const [openDouble, closeDouble, openSingle, closeSingle] = [...quotes] as [string, string, string, string];
	let out = '';
	for (let i = 0; i < value.length; i++) {
		const c = value[i] as string;
		const before = i > 0 ? (out[out.length - 1] as string) : previous;
		const after = value[i + 1] ?? '';
		if (c === '"') {
			out += opens(before) ? openDouble : closeDouble;
		} else if (c === "'") {
			// between letters it's an apostrophe (don't); before a digit too ('90s)
			if (/[\p{L}\p{N}]/u.test(before)) out += closeSingle;
			else if (opens(before)) out += /\d/.test(after) ? closeSingle : openSingle;
			else out += closeSingle;
		} else {
			out += c;
		}
	}
	return out;
}

// runs through every line of text in document order, carrying the previous character across
// node boundaries (so the quote in `"*word*"` still knows what's before it). code, math and raw
// HTML are left alone, and each block starts afresh
function smarten(tree: Root, options: SmartOptions): void {
	const quotes = options.quotes && [...options.quotes].length === 4 ? options.quotes : '“”‘’';
	const dashes = options.dashes ?? true;
	const ellipses = options.ellipses ?? true;
	let previous = '';

	const visitor = (node: Node): void | false => {
		if (isBlock(node) || node.type === 'tableCell' || node.type === 'definitionTerm') previous = '';
		switch (node.type) {
			case 'code':
			case 'math':
			case 'html':
				return false;
			case 'inlineCode':
			case 'inlineMath':
				previous = 'x';
				return false;
			case 'text':
				node.value = smartText(node.value, previous, quotes, dashes, ellipses);
				previous = node.value.slice(-1) || previous;
				return;
			case 'container':
				if (node.title) {
					previous = '';
					for (const child of node.title) visit(child, visitor);
					previous = '';
				}
				return;
		}
	};
	visit(tree, visitor);
}

export function typography(options: TypographyOptions = {}): Plugin {
	const inline: InlineRule[] = [];
	if (options.superscript !== false) inline.push(scriptRule('^', 'superscript'));
	if (options.subscript !== false) inline.push(scriptRule('~', 'subscript'));
	const smart = options.smart ?? true;
	return {
		name: 'typography',
		delimiters: options.mark === false ? [] : [{ char: '=', lengths: { 2: 'mark' } }],
		inline,
		transform: smart ? (tree) => smarten(tree, smart === true ? {} : smart) : undefined
	};
}
