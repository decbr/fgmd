// the inline half of the parser: turns the text of one paragraph, heading or table cell into
// phrasing nodes. the algorithm is CommonMark's (delimiter stack for emphasis, bracket stack for
// links) following commonmark.js, extended with GFM strikethrough, footnote references and
// bare-URL autolinks, plus plugin rules: new syntax at trigger characters, and new delimiter
// runs (like ==mark==) that go through the same algorithm as *emphasis*.
import type { Node, PhrasingContent } from './ast.js';
import type { ResolvedParseOptions } from './options.js';
import type { InlineRule, InlineState, ParseContext } from './plugin.js';
import {
	ENTITY,
	ESCAPABLE,
	HTMLCOMMENT,
	decodeEntity,
	normalizeLabel,
	normalizeUrl,
	reHtmlTag,
	tagfilter,
	unescapeString
} from './util.js';

const C_NEWLINE = 10;
const C_BANG = 33;
const C_AMPERSAND = 38;
const C_OPEN_PAREN = 40;
const C_CLOSE_PAREN = 41;
const C_ASTERISK = 42;
const C_COLON = 58;
const C_LESSTHAN = 60;
const C_OPEN_BRACKET = 91;
const C_BACKSLASH = 92;
const C_CLOSE_BRACKET = 93;
const C_CARET = 94;
const C_UNDERSCORE = 95;
const C_BACKTICK = 96;
const C_TILDE = 126;

const ESCAPED_CHAR = '\\\\' + ESCAPABLE;

// every pattern here is sticky: it matches at lastIndex or not at all
const reLinkTitle = new RegExp(
	`"(?:${ESCAPED_CHAR}|\\\\[^\\\\]|[^\\\\"\\x00])*"` +
		`|'(?:${ESCAPED_CHAR}|\\\\[^\\\\]|[^\\\\'\\x00])*'` +
		`|\\((?:${ESCAPED_CHAR}|\\\\[^\\\\]|[^\\\\()\\x00])*\\)`,
	'y'
);
const reLinkDestinationBraces = /<(?:[^<>\n\\\x00]|\\.)*>/y;
const reEscapable = new RegExp(`^${ESCAPABLE}`);
const reEntityHere = new RegExp(ENTITY, 'iy');
const reTicksHere = /`+/y;
const reTicks = /`+/g;
const reEmailAutolink =
	/<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/y;
const reAutolink = /<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>/y;
const reHtmlTagHere = new RegExp(reHtmlTag.source.slice(1), 'y');
const reHtmlCommentHere = new RegExp(HTMLCOMMENT, 'y');
const reSpnl = / *(?:\n *)?/y;
const reWhitespaceChar = /^[ \t\n\x0b\x0c\x0d]/;
const reUnicodeWhitespaceChar = /^\s/;
const rePunctuation = /^[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~\p{P}\p{S}]/u;
const reFinalSpace = / *$/;
const reInitialSpace = / */y;
const reSpaceAtEndOfLine = / *(?:\n|$)/y;
const reLinkLabel = /\[(?:[^\\[\]]|\\.){0,1000}\]/sy;
const reFootnoteRef = /\[\^([^\]\s]+)\]/y;

// characters with inline meaning. plugin triggers and delimiter characters join these per parser
const BASE_SPECIAL = '\n`[]\\!<&*_~';

// a run of characters with no inline meaning, for this parser's set of special characters
function mainPattern(extra: string): RegExp {
	const chars = [...new Set(BASE_SPECIAL + extra)];
	return new RegExp(`[^${chars.map((c) => `\\u{${(c.codePointAt(0) as number).toString(16)}}`).join('')}]+`, 'uy');
}

// plugin rules get their regexes made sticky once
const stickyCache = new WeakMap<RegExp, RegExp>();
export function toSticky(re: RegExp): RegExp {
	if (re.sticky && !re.global) return re;
	let sticky = stickyCache.get(re);
	if (!sticky) {
		sticky = new RegExp(re.source, re.flags.replace('g', '').replace('y', '') + 'y');
		stickyCache.set(re, sticky);
	}
	return sticky;
}

// a mutable, doubly linked working node. emphasis processing needs cheap unlink/insertAfter,
// so the parser builds these and converts them to the plain AST at the end.
class Inl {
	parent: Inl | null = null;
	first: Inl | null = null;
	last: Inl | null = null;
	prev: Inl | null = null;
	next: Inl | null = null;
	url = '';
	title: string | null = null;
	identifier = '';
	label = '';
	// a finished node from a plugin rule, carried through untouched (type 'node')
	payload: PhrasingContent | null = null;
	// made by the delimiter algorithm (emphasis, strong, delete, mark...): becomes { type, children }
	wrapper = false;

	constructor(
		public type: string,
		public literal = ''
	) {}

	append(child: Inl): void {
		child.unlink();
		child.parent = this;
		if (this.last) {
			this.last.next = child;
			child.prev = this.last;
			this.last = child;
		} else {
			this.first = this.last = child;
		}
	}

	unlink(): void {
		if (this.prev) this.prev.next = this.next;
		else if (this.parent) this.parent.first = this.next;
		if (this.next) this.next.prev = this.prev;
		else if (this.parent) this.parent.last = this.prev;
		this.parent = this.prev = this.next = null;
	}

	insertAfter(sibling: Inl): void {
		sibling.unlink();
		sibling.next = this.next;
		if (sibling.next) sibling.next.prev = sibling;
		sibling.prev = this;
		this.next = sibling;
		sibling.parent = this.parent;
		if (!sibling.next && sibling.parent) sibling.parent.last = sibling;
	}
}

const text = (s: string) => new Inl('text', s);

// how deep emphasis, links and images may nest before the rest is kept as plain text
const MAX_INLINE_NESTING = 100;

// the text inside a working node, walked with an explicit stack so depth can't overflow
function flatText(root: Inl): string {
	let out = '';
	const stack: Inl[] = [];
	for (let child = root.last; child; child = child.prev) stack.push(child);
	while (stack.length > 0) {
		const node = stack.pop() as Inl;
		if (node.type === 'text' || node.type === 'inlineCode') out += node.literal;
		else if (node.type === 'softbreak' || node.type === 'break') out += '\n';
		else if (node.payload) out += toString([node.payload]);
		for (let child = node.last; child; child = child.prev) stack.push(child);
	}
	return out;
}

// how a delimiter character behaves
interface DelimSpec {
	// null for CommonMark emphasis (* and _). otherwise run length -> wrapper node type, and an
	// opener only pairs with a closer of exactly its length
	exact: Map<number, string> | null;
	// may a run open or close inside a word, like * (true) or not, like _ (false)
	intraword: boolean;
}

interface Delimiter {
	cc: number;
	spec: DelimSpec;
	numdelims: number;
	origdelims: number;
	node: Inl;
	previous: Delimiter | null;
	next: Delimiter | null;
	canOpen: boolean;
	canClose: boolean;
}

interface Bracket {
	node: Inl;
	previous: Bracket | null;
	previousDelimiter: Delimiter | null;
	index: number;
	image: boolean;
	active: boolean;
	bracketAfter: boolean;
}

export interface LinkDefinition {
	url: string;
	title: string | null;
}

export interface FootnoteLabel {
	identifier: string;
	label: string;
}

function codePointBefore(s: string, i: number): string {
	if (i <= 0) return '\n';
	const low = s.charCodeAt(i - 1);
	if (low >= 0xdc00 && low <= 0xdfff && i >= 2) {
		const high = s.charCodeAt(i - 2);
		if (high >= 0xd800 && high <= 0xdbff) return s.slice(i - 2, i);
	}
	return s.charAt(i - 1);
}

function codePointAt(s: string, i: number): string {
	if (i >= s.length) return '\n';
	return String.fromCodePoint(s.codePointAt(i) as number);
}

// trims only markdown whitespace. String#trim would also eat a deliberate non-breaking space.
export function trimMd(s: string): string {
	return s.replace(/^[ \t\n]+|[ \t\n]+$/g, '');
}

export class InlineParser {
	private subject = '';
	private pos = 0;
	private delimiters: Delimiter | null = null;
	private brackets: Bracket | null = null;
	private tickRuns: Map<number, number[]> | null = null;
	private readonly tickCursor = new Map<number, number>();
	private readonly lastIndexCache = new Map<string, number>();
	private readonly rules = new Map<number, InlineRule[]>();
	private readonly delimiterSpecs = new Map<number, DelimSpec>();
	private readonly reMain: RegExp;
	private readonly state: InlineState;

	constructor(
		private readonly options: ResolvedParseOptions,
		readonly refmap: Map<string, LinkDefinition>,
		readonly footnotes: Map<string, FootnoteLabel>,
		private readonly context: ParseContext,
		// how many plugin-driven parseInline calls deep this parser is
		private readonly depth = 0
	) {
		this.delimiterSpecs.set(C_ASTERISK, { exact: null, intraword: true });
		this.delimiterSpecs.set(C_UNDERSCORE, { exact: null, intraword: false });
		if (options.gfm.strikethrough) {
			// strikethrough takes one or two tildes, and a closer must match its opener's length
			this.delimiterSpecs.set(C_TILDE, {
				exact: new Map([
					[1, 'delete'],
					[2, 'delete']
				]),
				intraword: true
			});
		}

		let extra = '';
		for (const plugin of options.plugins) {
			for (const rule of plugin.delimiters ?? []) {
				const lengths = new Map(Object.entries(rule.lengths).map(([n, type]) => [Number(n), type] as const));
				this.delimiterSpecs.set(rule.char.charCodeAt(0), { exact: lengths, intraword: rule.intraword ?? true });
				extra += rule.char;
			}
			for (const rule of plugin.inline ?? []) {
				for (const trigger of rule.triggers) {
					const code = trigger.charCodeAt(0);
					const list = this.rules.get(code);
					if (list) list.push(rule);
					else this.rules.set(code, [rule]);
					extra += trigger;
				}
			}
		}
		this.reMain = mainPattern(extra);

		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const parser = this;
		this.state = {
			get source() {
				return parser.subject;
			},
			get pos() {
				return parser.pos;
			},
			set pos(value: number) {
				parser.pos = value;
			},
			data: context.data,
			match(re) {
				const sticky = toSticky(re);
				sticky.lastIndex = parser.pos;
				const m = sticky.exec(parser.subject);
				if (m) parser.pos = sticky.lastIndex;
				return m;
			},
			charBefore: () => codePointBefore(parser.subject, parser.pos),
			parseInline: (text) => parser.parseNested(text)
		};
	}

	// a fresh parser for text a plugin wants parsed as markdown, so this one's state is untouched
	private parseNested(text: string): PhrasingContent[] {
		if (this.depth >= MAX_INLINE_NESTING) return [{ type: 'text', value: text }];
		return new InlineParser(this.options, this.refmap, this.footnotes, this.context, this.depth + 1).parse(text);
	}

	// asks each plugin rule for this character in turn; the first to consume something wins
	private tryRules(rules: InlineRule[], block: Inl): boolean {
		for (const rule of rules) {
			const start = this.pos;
			const result = rule.parse(this.state);
			if (result && this.pos > start) {
				for (const node of Array.isArray(result) ? result : [result]) {
					const inl = new Inl('node');
					inl.payload = node;
					block.append(inl);
				}
				return true;
			}
			this.pos = start;
		}
		return false;
	}

	// parses one block's text into phrasing content
	parse(content: string): PhrasingContent[] {
		const root = new Inl('root');
		this.subject = trimMd(content);
		this.pos = 0;
		this.delimiters = null;
		this.brackets = null;
		this.tickRuns = null;
		this.tickCursor.clear();
		this.lastIndexCache.clear();
		while (this.parseInline(root));
		this.processEmphasis(null);
		return this.convert(root, false);
	}

	private match(re: RegExp): string | null {
		re.lastIndex = this.pos;
		const m = re.exec(this.subject);
		if (m === null) return null;
		this.pos = re.lastIndex;
		return m[0];
	}

	private peek(): number {
		return this.pos < this.subject.length ? this.subject.charCodeAt(this.pos) : -1;
	}

	private spnl(): true {
		this.match(reSpnl);
		return true;
	}

	private parseInline(block: Inl): boolean {
		const c = this.peek();
		if (c === -1) return false;
		const rules = this.rules.get(c);
		if (rules !== undefined && this.tryRules(rules, block)) return true;
		let res = false;
		switch (c) {
			case C_NEWLINE:
				res = this.parseNewline(block);
				break;
			case C_BACKSLASH:
				res = this.parseBackslash(block);
				break;
			case C_BACKTICK:
				res = this.parseBackticks(block);
				break;
			case C_OPEN_BRACKET:
				res = this.parseFootnoteReference(block) || this.parseOpenBracket(block);
				break;
			case C_BANG:
				res = this.parseBang(block);
				break;
			case C_CLOSE_BRACKET:
				res = this.parseCloseBracket(block);
				break;
			case C_LESSTHAN:
				res = this.parseAutolink(block) || this.parseHtmlTag(block);
				break;
			case C_AMPERSAND:
				res = this.parseEntity(block);
				break;
			default: {
				// * _ ~ and plugin delimiter characters
				const spec = this.delimiterSpecs.get(c);
				res = spec ? this.handleDelim(c, spec, block) : this.parseString(block);
			}
		}
		if (!res) {
			this.pos += 1;
			block.append(text(String.fromCharCode(c)));
		}
		return true;
	}

	private parseBackticks(block: Inl): boolean {
		const ticks = this.match(reTicksHere);
		if (ticks === null) return false;
		const afterOpen = this.pos;
		const closer = this.findTicks(ticks.length, afterOpen);
		if (closer === -1) {
			block.append(text(ticks));
			return true;
		}
		let contents = this.subject.slice(afterOpen, closer).replace(/\n/g, ' ');
		// one space of padding on each side is stripped, unless the span is all spaces
		if (contents[0] === ' ' && contents.endsWith(' ') && /[^ ]/.test(contents)) {
			contents = contents.slice(1, -1);
		}
		this.pos = closer + ticks.length;
		block.append(new Inl('inlineCode', contents));
		return true;
	}

	// start of the first backtick run of exactly `length` at or after `from`, or -1. every run in
	// the subject is indexed on first use, so a line full of unmatched runs stays linear instead of
	// rescanning to the end for each one. `from` only grows during a parse, so a cursor per length
	// is enough.
	private findTicks(length: number, from: number): number {
		if (this.tickRuns === null) {
			this.tickRuns = new Map();
			reTicks.lastIndex = 0;
			let m: RegExpExecArray | null;
			while ((m = reTicks.exec(this.subject)) !== null) {
				const runs = this.tickRuns.get(m[0].length);
				if (runs) runs.push(m.index);
				else this.tickRuns.set(m[0].length, [m.index]);
			}
		}
		const runs = this.tickRuns.get(length);
		if (!runs) return -1;
		let i = this.tickCursor.get(length) ?? 0;
		while (i < runs.length && (runs[i] as number) < from) i++;
		this.tickCursor.set(length, i);
		return runs[i] ?? -1;
	}

	// last index of a marker in the subject, cached per parse
	private lastIndex(marker: string): number {
		let at = this.lastIndexCache.get(marker);
		if (at === undefined) {
			at = this.subject.lastIndexOf(marker);
			this.lastIndexCache.set(marker, at);
		}
		return at;
	}

	private parseBackslash(block: Inl): boolean {
		this.pos += 1;
		if (this.peek() === C_NEWLINE) {
			this.pos += 1;
			block.append(new Inl('break'));
		} else if (reEscapable.test(this.subject.charAt(this.pos))) {
			block.append(text(this.subject.charAt(this.pos)));
			this.pos += 1;
		} else {
			block.append(text('\\'));
		}
		return true;
	}

	private parseAutolink(block: Inl): boolean {
		let m: string | null;
		let dest: string;
		let url: string;
		if ((m = this.match(reEmailAutolink)) !== null) {
			dest = m.slice(1, -1);
			url = normalizeUrl('mailto:' + dest);
		} else if ((m = this.match(reAutolink)) !== null) {
			dest = m.slice(1, -1);
			url = normalizeUrl(dest);
		} else {
			return false;
		}
		const node = new Inl('link');
		node.url = url;
		node.append(text(dest));
		block.append(node);
		return true;
	}

	private parseHtmlTag(block: Inl): boolean {
		const { html, keepComments } = this.options;
		// without { html } the only tag worth recognising is a comment, and only to delete it
		if (!html && keepComments) return false;

		// a construct whose closing marker never appears later can't match. checking that first
		// stops a run of unclosed "<!--" (or "<?", "<![CDATA[", "<!A") from rescanning to the end
		// of the text once per opener
		const s = this.subject;
		const p = this.pos;
		if (s.startsWith('<!--', p)) {
			if (!s.startsWith('<!-->', p) && !s.startsWith('<!--->', p) && this.lastIndex('-->') < p + 4) return false;
		} else if (s.startsWith('<?', p)) {
			if (this.lastIndex('?>') < p + 2) return false;
		} else if (s.startsWith('<![CDATA[', p)) {
			if (this.lastIndex(']]>') < p + 9) return false;
		} else if (this.lastIndex('>') < p) {
			return false;
		}

		const m = this.match(html ? reHtmlTagHere : reHtmlCommentHere);
		if (m === null) return false;
		if (!keepComments && m.startsWith('<!--')) return true;
		block.append(new Inl('html', this.options.gfm.tagfilter ? tagfilter(m) : m));
		return true;
	}

	// works out whether a run of a delimiter character can open and/or close
	private scanDelims(cc: number, intraword: boolean): { numdelims: number; canOpen: boolean; canClose: boolean } | null {
		const startpos = this.pos;
		let numdelims = 0;
		while (this.peek() === cc) {
			numdelims++;
			this.pos++;
		}
		if (numdelims === 0) return null;

		const before = codePointBefore(this.subject, startpos);
		const after = codePointAt(this.subject, this.pos);
		const afterWhitespace = reUnicodeWhitespaceChar.test(after);
		const afterPunctuation = rePunctuation.test(after);
		const beforeWhitespace = reUnicodeWhitespaceChar.test(before);
		const beforePunctuation = rePunctuation.test(before);

		const leftFlanking = !afterWhitespace && (!afterPunctuation || beforeWhitespace || beforePunctuation);
		const rightFlanking = !beforeWhitespace && (!beforePunctuation || afterWhitespace || afterPunctuation);

		let canOpen: boolean;
		let canClose: boolean;
		if (!intraword) {
			// underscore rules: inside a word a run can neither open nor close
			canOpen = leftFlanking && (!rightFlanking || beforePunctuation);
			canClose = rightFlanking && (!leftFlanking || afterPunctuation);
		} else {
			canOpen = leftFlanking;
			canClose = rightFlanking;
		}
		this.pos = startpos;
		return { numdelims, canOpen, canClose };
	}

	private handleDelim(cc: number, spec: DelimSpec, block: Inl): boolean {
		const res = this.scanDelims(cc, spec.intraword);
		if (!res) return false;
		const startpos = this.pos;
		this.pos += res.numdelims;
		const node = text(this.subject.slice(startpos, this.pos));
		block.append(node);

		// an exact rule only knows some run lengths (strikethrough: 1 or 2); any other run is text
		if (spec.exact && !spec.exact.has(res.numdelims)) return true;

		if (res.canOpen || res.canClose) {
			this.delimiters = {
				cc,
				spec,
				numdelims: res.numdelims,
				origdelims: res.numdelims,
				node,
				previous: this.delimiters,
				next: null,
				canOpen: res.canOpen,
				canClose: res.canClose
			};
			if (this.delimiters.previous) this.delimiters.previous.next = this.delimiters;
		}
		return true;
	}

	private removeDelimiter(delim: Delimiter): void {
		if (delim.previous) delim.previous.next = delim.next;
		if (delim.next === null) this.delimiters = delim.previous;
		else delim.next.previous = delim.previous;
	}

	private static removeDelimitersBetween(bottom: Delimiter, top: Delimiter): void {
		if (bottom.next !== top) {
			bottom.next = top;
			top.previous = bottom;
		}
	}

	// wraps the nodes strictly between two delimiter nodes into a new parent
	private static wrapBetween(type: string, opener: Inl, closer: Inl): void {
		const wrapper = new Inl(type);
		wrapper.wrapper = true;
		let tmp = opener.next;
		while (tmp && tmp !== closer) {
			const next: Inl | null = tmp.next;
			wrapper.append(tmp);
			tmp = next;
		}
		opener.insertAfter(wrapper);
	}

	private processEmphasis(stackBottom: Delimiter | null): void {
		// the lowest point an opener search needs to look, per class of closer. emphasis classes
		// are by character, can-open and length mod 3 (CommonMark's bookkeeping); exact rules by
		// character and length
		const openersBottom = new Map<string, Delimiter | null>();

		let closer = this.delimiters;
		while (closer !== null && closer.previous !== stackBottom) closer = closer.previous;

		while (closer !== null) {
			if (!closer.canClose) {
				closer = closer.next;
				continue;
			}
			const cc = closer.cc;
			const exact = closer.spec.exact;
			const key = exact ? `${cc}:${closer.origdelims}` : `${cc}:${closer.canOpen ? 1 : 0}:${closer.origdelims % 3}`;
			const bottom = openersBottom.has(key) ? openersBottom.get(key) : stackBottom;

			let opener = closer.previous;
			let found = false;
			while (opener !== null && opener !== stackBottom && opener !== bottom) {
				if (opener.cc === cc && opener.canOpen) {
					if (exact) {
						if (opener.numdelims === closer.numdelims) {
							found = true;
							break;
						}
					} else {
						// the "rule of 3": a run that can both open and close can't pair with one
						// whose combined length is a multiple of 3, unless both are
						const oddMatch =
							(closer.canOpen || opener.canClose) &&
							closer.origdelims % 3 !== 0 &&
							(opener.origdelims + closer.origdelims) % 3 === 0;
						if (!oddMatch) {
							found = true;
							break;
						}
					}
				}
				opener = opener.previous;
			}

			const oldCloser = closer;

			if (found && opener) {
				if (exact) {
					InlineParser.wrapBetween(exact.get(closer.numdelims) as string, opener.node, closer.node);
					InlineParser.removeDelimitersBetween(opener, closer);
					opener.node.unlink();
					this.removeDelimiter(opener);
					closer.node.unlink();
					const next: Delimiter | null = closer.next;
					this.removeDelimiter(closer);
					closer = next;
				} else {
					const use = closer.numdelims >= 2 && opener.numdelims >= 2 ? 2 : 1;
					const openerInl = opener.node;
					const closerInl = closer.node;
					opener.numdelims -= use;
					closer.numdelims -= use;
					openerInl.literal = openerInl.literal.slice(0, openerInl.literal.length - use);
					closerInl.literal = closerInl.literal.slice(0, closerInl.literal.length - use);

					InlineParser.wrapBetween(use === 1 ? 'emphasis' : 'strong', openerInl, closerInl);
					InlineParser.removeDelimitersBetween(opener, closer);

					if (opener.numdelims === 0) {
						openerInl.unlink();
						this.removeDelimiter(opener);
					}
					if (closer.numdelims === 0) {
						closerInl.unlink();
						const next: Delimiter | null = closer.next;
						this.removeDelimiter(closer);
						closer = next;
					}
				}
			} else {
				closer = closer.next;
				openersBottom.set(key, oldCloser.previous);
				// a closer that can't open and found nothing will never be useful again
				if (!oldCloser.canOpen) this.removeDelimiter(oldCloser);
			}
		}

		while (this.delimiters !== null && this.delimiters !== stackBottom) {
			this.removeDelimiter(this.delimiters);
		}
	}

	private parseLinkTitle(): string | null {
		const title = this.match(reLinkTitle);
		return title === null ? null : unescapeString(title.slice(1, -1));
	}

	private parseLinkDestination(): string | null {
		const braced = this.match(reLinkDestinationBraces);
		if (braced !== null) return normalizeUrl(unescapeString(braced.slice(1, -1)));
		if (this.peek() === C_LESSTHAN) return null;

		// parentheses may nest as long as they balance, so a URL like .../Mull_of_Kintyre_(song)
		// keeps its closing paren while an unmatched ')' still ends the destination
		const savepos = this.pos;
		let openparens = 0;
		let c: number;
		while ((c = this.peek()) !== -1) {
			if (c === C_BACKSLASH && reEscapable.test(this.subject.charAt(this.pos + 1))) {
				this.pos += 1;
				if (this.peek() !== -1) this.pos += 1;
			} else if (c === C_OPEN_PAREN) {
				this.pos += 1;
				openparens += 1;
				// the spec lets implementations cap paren nesting; cmark uses 32. without a cap,
				// "[a](b[a](b[a](b..." rescans the rest of the text at every ]
				if (openparens > 32) return null;
			} else if (c === C_CLOSE_PAREN) {
				if (openparens < 1) break;
				this.pos += 1;
				openparens -= 1;
			} else if (reWhitespaceChar.test(String.fromCharCode(c))) {
				break;
			} else {
				this.pos += 1;
			}
		}
		if (this.pos === savepos && c !== C_CLOSE_PAREN) return null;
		if (openparens !== 0) return null;
		return normalizeUrl(unescapeString(this.subject.slice(savepos, this.pos)));
	}

	private parseLinkLabel(): number {
		const m = this.match(reLinkLabel);
		return m === null || m.length > 1001 ? 0 : m.length;
	}

	private addBracket(node: Inl, index: number, image: boolean): void {
		if (this.brackets !== null) this.brackets.bracketAfter = true;
		this.brackets = {
			node,
			previous: this.brackets,
			previousDelimiter: this.delimiters,
			index,
			image,
			active: true,
			bracketAfter: false
		};
	}

	private removeBracket(): void {
		if (this.brackets) this.brackets = this.brackets.previous;
	}

	private parseFootnoteReference(block: Inl): boolean {
		if (!this.options.gfm.footnotes || this.footnotes.size === 0) return false;
		if (this.subject.charCodeAt(this.pos + 1) !== C_CARET) return false;
		reFootnoteRef.lastIndex = this.pos;
		const m = reFootnoteRef.exec(this.subject);
		if (!m) return false;
		const label = m[1] as string;
		const def = this.footnotes.get(normalizeLabel(label));
		if (!def) return false;
		this.pos += m[0].length;
		const node = new Inl('footnoteReference');
		node.identifier = def.identifier;
		node.label = label;
		block.append(node);
		return true;
	}

	private parseOpenBracket(block: Inl): boolean {
		const startpos = this.pos;
		this.pos += 1;
		const node = text('[');
		block.append(node);
		this.addBracket(node, startpos, false);
		return true;
	}

	private parseBang(block: Inl): boolean {
		const startpos = this.pos;
		this.pos += 1;
		if (this.peek() === C_OPEN_BRACKET) {
			this.pos += 1;
			const node = text('![');
			block.append(node);
			this.addBracket(node, startpos + 1, true);
		} else {
			block.append(text('!'));
		}
		return true;
	}

	private parseCloseBracket(block: Inl): boolean {
		this.pos += 1;
		const startpos = this.pos;
		let opener = this.brackets;

		if (opener === null) {
			block.append(text(']'));
			return true;
		}
		if (!opener.active) {
			block.append(text(']'));
			this.removeBracket();
			return true;
		}

		const isImage = opener.image;
		const savepos = this.pos;
		let dest: string | null = null;
		let title: string | null = null;
		let matched = false;

		// inline link: [text](dest "title")
		if (this.peek() === C_OPEN_PAREN) {
			this.pos++;
			if (this.spnl() && (dest = this.parseLinkDestination()) !== null && this.spnl()) {
				// a title needs whitespace before it
				if (reWhitespaceChar.test(this.subject.charAt(this.pos - 1))) title = this.parseLinkTitle();
				if (this.spnl() && this.peek() === C_CLOSE_PAREN) {
					this.pos += 1;
					matched = true;
				}
			}
			if (!matched) this.pos = savepos;
		}

		// reference link: [text][label], [text][] or [text]
		if (!matched) {
			const beforeLabel = this.pos;
			const n = this.parseLinkLabel();
			let reflabel: string | null = null;
			if (n > 2) reflabel = this.subject.slice(beforeLabel, beforeLabel + n);
			else if (!opener.bracketAfter) reflabel = this.subject.slice(opener.index, startpos);
			if (n === 0) this.pos = savepos;

			if (reflabel) {
				const def = this.refmap.get(normalizeLabel(reflabel.slice(1, -1)));
				if (def) {
					dest = def.url;
					title = def.title;
					matched = true;
				}
			}
		}

		if (!matched) {
			this.removeBracket();
			this.pos = startpos;
			block.append(text(']'));
			return true;
		}

		const node = new Inl(isImage ? 'image' : 'link');
		node.url = dest ?? '';
		node.title = title || null;
		let tmp = opener.node.next;
		while (tmp) {
			const next: Inl | null = tmp.next;
			node.append(tmp);
			tmp = next;
		}
		block.append(node);
		this.processEmphasis(opener.previousDelimiter);
		this.removeBracket();
		opener.node.unlink();

		// links can't contain links, so every earlier [ is now dead
		if (!isImage) {
			opener = this.brackets;
			while (opener !== null) {
				if (!opener.image) opener.active = false;
				opener = opener.previous;
			}
		}
		return true;
	}

	private parseEntity(block: Inl): boolean {
		reEntityHere.lastIndex = this.pos;
		const m = reEntityHere.exec(this.subject);
		if (!m) return false;
		const decoded = decodeEntity(m[0]);
		if (decoded === null) return false;
		this.pos += m[0].length;
		block.append(text(decoded));
		return true;
	}

	private parseString(block: Inl): boolean {
		const m = this.match(this.reMain);
		if (m === null) return false;
		block.append(text(m));
		return true;
	}

	// a newline is a hard break when two or more spaces precede it, otherwise a soft one
	private parseNewline(block: Inl): boolean {
		this.pos += 1;
		const last = block.last;
		if (last && last.type === 'text' && last.literal.endsWith(' ')) {
			const hard = last.literal[last.literal.length - 2] === ' ';
			last.literal = last.literal.replace(reFinalSpace, '');
			block.append(new Inl(hard ? 'break' : 'softbreak'));
		} else {
			block.append(new Inl('softbreak'));
		}
		this.match(reInitialSpace);
		return true;
	}

	// tries to read a link reference definition at the start of s. records it (first one wins)
	// and returns how many characters it used, or 0 if s doesn't start with one.
	parseReference(s: string): number {
		this.subject = s;
		this.pos = 0;
		const startpos = 0;

		const labelLength = this.parseLinkLabel();
		if (labelLength === 0) return 0;
		const rawlabel = this.subject.slice(0, labelLength);

		if (this.peek() !== C_COLON) return 0;
		this.pos++;

		this.spnl();
		const dest = this.parseLinkDestination();
		if (dest === null) return 0;

		const beforeTitle = this.pos;
		this.spnl();
		let title: string | null = null;
		if (this.pos !== beforeTitle) title = this.parseLinkTitle();
		if (title === null) this.pos = beforeTitle;

		let atLineEnd = true;
		if (this.match(reSpaceAtEndOfLine) === null) {
			if (title === null) {
				atLineEnd = false;
			} else {
				// the title isn't followed by the line end, but the definition may still stand
				// without it
				title = null;
				this.pos = beforeTitle;
				atLineEnd = this.match(reSpaceAtEndOfLine) !== null;
			}
		}
		if (!atLineEnd) return 0;

		const normlabel = normalizeLabel(rawlabel.slice(1, -1));
		if (normlabel === '') return 0;

		if (!this.refmap.has(normlabel)) this.refmap.set(normlabel, { url: dest, title });
		return this.pos - startpos;
	}

	// working tree -> AST. adjacent text and soft breaks merge into one text node, which is also
	// where bare URLs get linked (never inside an existing link).
	private convert(parent: Inl, inLink: boolean, depth = 0): PhrasingContent[] {
		// deeper than any real document nests; flattening here keeps every later recursive walk
		// (renderers included) off the edge of the stack
		if (depth > MAX_INLINE_NESTING) return [{ type: 'text', value: flatText(parent) }];
		const out: PhrasingContent[] = [];
		let buffer = '';
		const flush = () => {
			if (!buffer) return;
			if (this.options.gfm.autolinks && !inLink) out.push(...autolinkLiterals(buffer));
			else out.push({ type: 'text', value: buffer });
			buffer = '';
		};

		for (let node = parent.first; node; node = node.next) {
			switch (node.type) {
				case 'text':
					buffer += node.literal;
					break;
				case 'softbreak':
					buffer += '\n';
					break;
				case 'break':
					flush();
					out.push({ type: 'break' });
					break;
				case 'node':
					flush();
					out.push(node.payload as PhrasingContent);
					break;
				case 'inlineCode':
					flush();
					out.push({ type: 'inlineCode', value: node.literal });
					break;
				case 'html':
					flush();
					out.push({ type: 'html', value: node.literal });
					break;
				case 'link':
					flush();
					out.push({ type: 'link', url: node.url, title: node.title, children: this.convert(node, true, depth + 1) });
					break;
				case 'image':
					flush();
					out.push({
						type: 'image',
						url: node.url,
						title: node.title,
						alt: toString(this.convert(node, true, depth + 1))
					});
					break;
				case 'footnoteReference':
					flush();
					out.push({ type: 'footnoteReference', identifier: node.identifier, label: node.label });
					break;
				default:
					// emphasis, strong, delete, and plugin delimiter wrappers like mark
					if (node.wrapper) {
						flush();
						out.push({ type: node.type, children: this.convert(node, inLink, depth + 1) } as PhrasingContent);
					}
			}
		}
		flush();
		return out;
	}
}

// the plain text of some nodes, e.g. for alt attributes, heading slugs and excerpts
export function toString(nodes: readonly Node[]): string {
	let out = '';
	for (const node of nodes) {
		if (node.type === 'image') out += node.alt;
		else if (node.type === 'break') out += '\n';
		else if ('value' in node && typeof node.value === 'string') out += node.value;
		else if ('children' in node) out += toString(node.children as Node[]);
	}
	return out;
}

// --- GFM autolink literals: www.example.com, https://example.com, someone@example.com

const reDomainChar = /[\p{L}\p{N}_-]/u;

function validPreceding(s: string, i: number): boolean {
	return i === 0 || /[\s*_~(]/.test(s[i - 1] as string);
}

// end of a valid domain starting at i, or -1
function scanDomain(s: string, i: number): number {
	let end = i;
	while (end < s.length && (s[end] === '.' || reDomainChar.test(codePointAt(s, end)))) {
		end += codePointAt(s, end).length;
	}
	let domain = s.slice(i, end);
	while (domain.endsWith('.')) domain = domain.slice(0, -1);
	const segments = domain.split('.');
	if (segments.length < 2 || segments.some((seg) => seg === '')) return -1;
	// no underscores in the last two segments
	if (segments.slice(-2).some((seg) => seg.includes('_'))) return -1;
	return end;
}

// trailing punctuation belongs to the sentence, not the link
function trimLinkEnd(link: string): string {
	for (;;) {
		const last = link[link.length - 1];
		if (last === undefined) return link;
		if ('?!.,:*_~\'"'.includes(last)) {
			link = link.slice(0, -1);
		} else if (last === ')') {
			let open = 0;
			let close = 0;
			for (const ch of link) {
				if (ch === '(') open++;
				else if (ch === ')') close++;
			}
			if (close <= open) return link;
			link = link.slice(0, -1);
		} else if (last === ';') {
			const entity = /&[a-zA-Z0-9]+;$/.exec(link);
			if (!entity) return link;
			link = link.slice(0, entity.index);
		} else {
			return link;
		}
	}
}

interface Found {
	start: number;
	end: number;
	url: string;
}

function matchWebLink(s: string, i: number): Found | null {
	let domainStart: number;
	let prefix = '';
	const lower = s.slice(i, i + 8).toLowerCase();
	if (lower.startsWith('www.')) {
		domainStart = i;
		prefix = 'http://';
	} else if (lower.startsWith('http://')) {
		domainStart = i + 7;
	} else if (lower.startsWith('https://')) {
		domainStart = i + 8;
	} else if (lower.startsWith('ftp://')) {
		domainStart = i + 6;
	} else {
		return null;
	}

	const domainEnd = scanDomain(s, domainStart);
	if (domainEnd === -1) return null;

	let end = domainEnd;
	while (end < s.length && !/[\s<]/.test(s[end] as string)) end++;
	const link = trimLinkEnd(s.slice(i, end));
	if (link.length <= domainStart - i) return null;
	return { start: i, end: i + link.length, url: prefix + link };
}

const reEmailLocal = /[a-zA-Z0-9._+-]/;
const reEmailDomain = /[a-zA-Z0-9._-]/;

function matchEmail(s: string, at: number, floor: number): Found | null {
	let start = at;
	while (start > floor && reEmailLocal.test(s[start - 1] as string)) start--;
	if (start === at) return null;

	let end = at + 1;
	while (end < s.length && reEmailDomain.test(s[end] as string)) end++;
	while (end > at + 1 && s[end - 1] === '.') end--;
	const domain = s.slice(at + 1, end);
	if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/.test(domain)) return null;
	const lastChar = domain[domain.length - 1];
	if (lastChar === '-' || lastChar === '_') return null;

	let protocol = '';
	const before = s.slice(Math.max(floor, start - 7), start).toLowerCase();
	if (before.endsWith('mailto:')) protocol = 'mailto:';
	else if (before.endsWith('xmpp:')) protocol = 'xmpp:';
	start -= protocol.length;
	if (!validPreceding(s, start)) return null;

	// xmpp addresses may carry a /resource
	if (protocol === 'xmpp:' && s[end] === '/') {
		let resourceEnd = end + 1;
		while (resourceEnd < s.length && /[a-zA-Z0-9@.]/.test(s[resourceEnd] as string)) resourceEnd++;
		while (resourceEnd > end + 1 && s[resourceEnd - 1] === '.') resourceEnd--;
		if (resourceEnd > end + 1) end = resourceEnd;
	}

	const linkText = s.slice(start, end);
	return { start, end, url: protocol ? linkText : 'mailto:' + linkText };
}

export function autolinkLiterals(value: string): PhrasingContent[] {
	const out: PhrasingContent[] = [];
	let last = 0;
	let i = 0;
	while (i < value.length) {
		const ch = value[i] as string;
		let found: Found | null = null;
		if ('wWhHfF'.includes(ch) && validPreceding(value, i)) {
			found = matchWebLink(value, i);
		} else if (ch === '@') {
			found = matchEmail(value, i, last);
		}
		if (found) {
			if (found.start > last) out.push({ type: 'text', value: value.slice(last, found.start) });
			out.push({
				type: 'link',
				url: normalizeUrl(found.url),
				title: null,
				children: [{ type: 'text', value: value.slice(found.start, found.end) }]
			});
			last = i = found.end;
		} else {
			i++;
		}
	}
	if (last === 0) return [{ type: 'text', value }];
	if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
	return out;
}
