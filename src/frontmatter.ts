// the `---` block at the top of a document, holding a page's metadata
//
// frontmatter(source) gives { data: { title, blurb }, body: 'detour copy\n' }, and parse() with
// { frontmatter: true } keeps the block out of the rendered output.
//
// the YAML here is the subset that belongs in frontmatter - mappings, sequences, quoted and plain
// scalars, flow collections, block scalars and comments - not the whole language. anything it
// can't make sense of stays a string, and nothing it reads can throw.

// how deep mappings, sequences and flow collections may nest. real metadata never gets close,
// and unbounded depth would let '- - - - ...' overflow the stack
const MAX_DEPTH = 32;

const reBreak = /\r\n|\n|\r/g;
const reOpenFence = /^---[ \t]*$/;
const reCloseFence = /^(?:---|\.\.\.)[ \t]*$/;
const reBlank = /^[ \t]*$/;
// | or > with optional chomping and indentation indicators: |, >-, |2, |2-
const reBlockHeader = /^([|>])((?:[-+]|[1-9])*)$/;
const reNumber = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const reHex = /^0x[0-9a-fA-F]+$/;
const reOctal = /^0o[0-7]+$/;

export interface Frontmatter {
	// the block's keys and values. {} when the document has no frontmatter
	data: Record<string, unknown>;
	// the document with the block removed. the whole source when there is none
	body: string;
	// the text between the fences, or null when the document has none
	raw: string | null;
}

// splits a document into its frontmatter and the markdown after it
export function frontmatter(source: string): Frontmatter {
	return extractFrontmatter(source) ?? { data: {}, body: source, raw: null };
}

// the same, but null when the document doesn't open with a frontmatter block
export function extractFrontmatter(source: string): Frontmatter | null {
	const found = splitFences(source);
	if (found === null) return null;
	const lines = toLines(found.raw);
	// a `---` line followed by prose is a thematic break, not metadata: only a block whose first
	// real line is a `key:` (or one with nothing in it at all) counts as frontmatter
	const first = significant(lines, 0);
	if (first !== -1 && splitKey((lines[first] as Line).text) === null) return null;
	return { data: parseYaml(lines), body: found.body, raw: found.raw };
}

// --- finding the block

function splitFences(source: string): { raw: string; body: string } | null {
	const start = source.charCodeAt(0) === 0xfeff ? 1 : 0;
	reBreak.lastIndex = start;
	let match = reBreak.exec(source);
	// '---' alone, or a first line that is anything else
	if (match === null || !reOpenFence.test(source.slice(start, match.index))) return null;
	const content: string[] = [];
	let from = reBreak.lastIndex;
	for (;;) {
		match = reBreak.exec(source);
		const line = source.slice(from, match === null ? source.length : match.index);
		if (reCloseFence.test(line)) return { raw: content.join('\n'), body: match === null ? '' : source.slice(reBreak.lastIndex) };
		// unterminated: the document has no frontmatter
		if (match === null) return null;
		content.push(line);
		from = reBreak.lastIndex;
	}
}

// --- lines

interface Line {
	// columns of leading whitespace. tabs aren't legal YAML indentation; they count as one
	indent: number;
	// the line without its indentation or trailing whitespace
	text: string;
	// the line as written, for block scalars
	raw: string;
}

interface State {
	lines: Line[];
	i: number;
}

function toLines(raw: string): Line[] {
	return raw.split(reBreak).map((line) => {
		let i = 0;
		while (i < line.length) {
			const c = line.charCodeAt(i);
			if (c !== 32 && c !== 9) break;
			i++;
		}
		return { indent: i, text: line.slice(i).replace(/[ \t]+$/, ''), raw: line };
	});
}

// the next line with something on it: blank lines and whole-line comments are skipped
function significant(lines: Line[], from: number): number {
	for (let i = from; i < lines.length; i++) {
		const line = lines[i] as Line;
		if (line.text !== '' && !line.text.startsWith('#')) return i;
	}
	return -1;
}

function isSequenceItem(text: string): boolean {
	return text === '-' || text.startsWith('- ') || text.startsWith('-\t');
}

// --- mappings and sequences

function parseYaml(lines: Line[]): Record<string, unknown> {
	const state: State = { lines, i: 0 };
	const first = significant(lines, 0);
	if (first === -1) return {};
	state.i = first;
	return parseMapping(state, (lines[first] as Line).indent, 0);
}

function parseBlock(state: State, indent: number, depth: number): unknown {
	const idx = significant(state.lines, state.i);
	if (idx === -1) return null;
	const line = state.lines[idx] as Line;
	state.i = idx;
	return isSequenceItem(line.text) ? parseSequence(state, indent, depth) : parseMapping(state, indent, depth);
}

function parseMapping(state: State, indent: number, depth: number): Record<string, unknown> {
	const map: Record<string, unknown> = {};
	for (;;) {
		const idx = significant(state.lines, state.i);
		if (idx === -1) {
			state.i = state.lines.length;
			break;
		}
		const line = state.lines[idx] as Line;
		// a dedent ends this mapping; a sequence at our own level isn't part of it
		if (line.indent < indent || isSequenceItem(line.text)) break;
		state.i = idx + 1;
		// an over-indented stray line, or a line that isn't `key: value`: ignored, not fatal
		if (line.indent > indent) continue;
		const entry = splitKey(line.text);
		if (entry === null) continue;
		map[entry.key] = parseValue(state, indent, entry.rest, depth);
	}
	return map;
}

function parseSequence(state: State, indent: number, depth: number): unknown[] {
	const out: unknown[] = [];
	for (;;) {
		const idx = significant(state.lines, state.i);
		if (idx === -1) {
			state.i = state.lines.length;
			break;
		}
		const line = state.lines[idx] as Line;
		if (line.indent !== indent || !isSequenceItem(line.text)) break;
		state.i = idx + 1;
		const inner = line.text.slice(1).replace(/^[ \t]+/, '');
		if (inner === '' || inner.startsWith('#')) {
			out.push(nested(state, indent, depth));
			continue;
		}
		// '- key: value' and '- - value' put a collection on the dash's own line: the item's
		// contents line up at the column the text starts in
		const column = indent + (line.text.length - inner.length);
		const compound = depth < MAX_DEPTH && (splitKey(inner) !== null || isSequenceItem(inner));
		if (compound) {
			state.lines[idx] = { indent: column, text: inner, raw: line.raw };
			state.i = idx;
			out.push(
				isSequenceItem(inner) ? parseSequence(state, column, depth + 1) : parseMapping(state, column, depth + 1)
			);
			continue;
		}
		out.push(parseValue(state, column, inner, depth));
	}
	return out;
}

// the value written after a 'key:' or a '-', and any lines it runs on to
function parseValue(state: State, indent: number, rest: string, depth: number): unknown {
	const text = stripComment(rest).trim();
	const header = reBlockHeader.exec(text);
	if (header !== null) return blockScalar(state, indent, header[1] as string, header[2] as string);
	if (text === '') return nested(state, indent, depth);
	const first = text.charAt(0);
	// a plain scalar may run on over more-indented lines, which fold into spaces
	if (first !== '"' && first !== "'" && first !== '[' && first !== '{') return parseScalar(continuation(state, indent, text));
	return parseScalar(text, depth);
}

// a collection on the lines below a 'key:' or a bare '-'
function nested(state: State, indent: number, depth: number): unknown {
	const idx = significant(state.lines, state.i);
	if (idx === -1) {
		state.i = state.lines.length;
		return null;
	}
	const line = state.lines[idx] as Line;
	// a sequence may sit at its key's own indentation; a mapping has to be deeper
	const sequence = line.indent === indent && isSequenceItem(line.text);
	if (line.indent <= indent && !sequence) return null;
	if (depth >= MAX_DEPTH) {
		while (state.i < state.lines.length && (state.lines[state.i] as Line).indent > indent) state.i++;
		return null;
	}
	state.i = idx;
	return sequence ? parseSequence(state, indent, depth + 1) : parseBlock(state, line.indent, depth + 1);
}

function continuation(state: State, indent: number, first: string): string {
	let text = first;
	while (state.i < state.lines.length) {
		const line = state.lines[state.i] as Line;
		// a blank line, a comment, a dedent or the next entry ends the value
		if (line.text === '' || line.text.startsWith('#') || line.indent <= indent) break;
		if (isSequenceItem(line.text) || splitKey(line.text) !== null) break;
		text += ' ' + stripComment(line.text).trim();
		state.i++;
	}
	return text;
}

function blockScalar(state: State, indent: number, style: string, modifiers: string): string {
	const chomp = modifiers.includes('-') ? 'strip' : modifiers.includes('+') ? 'keep' : 'clip';
	const indicator = /\d/.exec(modifiers)?.[0];
	// the indentation stripped from every line: given, or taken from the first line with text
	let content = indicator === undefined ? -1 : indent + Number(indicator);
	const parts: string[] = [];
	while (state.i < state.lines.length) {
		const line = state.lines[state.i] as Line;
		const blank = reBlank.test(line.raw);
		if (!blank && line.indent <= indent) break;
		if (!blank && content < 0) content = line.indent;
		parts.push(blank ? '' : dedent(line.raw, content));
		state.i++;
	}
	let trailing = 0;
	while (parts.length > 0 && parts[parts.length - 1] === '') {
		parts.pop();
		trailing++;
	}
	const body = style === '|' ? parts.join('\n') : fold(parts);
	if (chomp === 'strip') return body;
	if (chomp === 'clip') return body === '' ? '' : body + '\n';
	return body + '\n'.repeat(body === '' ? trailing : trailing + 1);
}

// '>' folds the break between two lines of text into a space, and keeps blank lines as breaks
function fold(parts: readonly string[]): string {
	let out = '';
	let blanks = 0;
	for (const part of parts) {
		if (part === '') {
			blanks++;
			continue;
		}
		if (out !== '') out += blanks > 0 ? '\n'.repeat(blanks) : ' ';
		out += part;
		blanks = 0;
	}
	return out;
}

function dedent(raw: string, columns: number): string {
	let i = 0;
	while (i < raw.length && i < columns) {
		const c = raw.charCodeAt(i);
		if (c !== 32 && c !== 9) break;
		i++;
	}
	return raw.slice(i);
}

// --- keys

// 'key: value' split in two, or null when the line isn't a mapping entry
function splitKey(text: string): { key: string; rest: string } | null {
	const first = text.charAt(0);
	if (first === '"' || first === "'") {
		const end = quoteEnd(text, 0);
		if (end < 0) return null;
		const after = text.slice(end + 1).replace(/^[ \t]+/, '');
		if (!after.startsWith(':')) return null;
		const rest = after.slice(1);
		if (rest !== '' && !rest.startsWith(' ') && !rest.startsWith('\t')) return null;
		return { key: unquote(text.slice(0, end + 1)), rest };
	}
	for (let i = 0; i < text.length; i++) {
		const c = text.charAt(i);
		// a comment before any colon: not an entry
		if (c === '#' && (i === 0 || text.charAt(i - 1) === ' ' || text.charAt(i - 1) === '\t')) return null;
		if (c !== ':') continue;
		// 'a:b' is a plain scalar; a key's colon is followed by space or nothing
		const next = text.charAt(i + 1);
		if (next !== '' && next !== ' ' && next !== '\t') continue;
		const key = text.slice(0, i).trimEnd();
		return key === '' ? null : { key, rest: text.slice(i + 1) };
	}
	return null;
}

// --- scalars

function parseScalar(text: string, depth = 0): unknown {
	const t = text.trim();
	if (t === '' || t === '~' || t === 'null' || t === 'Null' || t === 'NULL') return null;
	if (t === 'true' || t === 'True' || t === 'TRUE') return true;
	if (t === 'false' || t === 'False' || t === 'FALSE') return false;
	const first = t.charAt(0);
	if (first === '"' || first === "'") {
		// a stray quote in the middle keeps the value as it was written
		return quoteEnd(t, 0) === t.length - 1 ? unquote(t) : t;
	}
	if (first === '[' || first === '{') return flowValue({ text: t, i: 0 }, depth);
	if (reNumber.test(t) || reHex.test(t) || reOctal.test(t)) return Number(t);
	// dates, versions and everything else stay strings, as written
	return t;
}

function quoteEnd(text: string, start: number): number {
	const quote = text.charAt(start);
	for (let i = start + 1; i < text.length; i++) {
		const c = text.charAt(i);
		if (quote === '"' && c === '\\') {
			i++;
			continue;
		}
		if (c !== quote) continue;
		// '' inside a single-quoted string is an escaped quote
		if (quote === "'" && text.charAt(i + 1) === "'") {
			i++;
			continue;
		}
		return i;
	}
	return -1;
}

const ESCAPES: Record<string, string> = {
	'0': '\0',
	a: '\x07',
	b: '\b',
	e: '\x1b',
	f: '\f',
	n: '\n',
	r: '\r',
	t: '\t',
	v: '\v',
	'\\': '\\',
	'"': '"',
	'/': '/',
	' ': ' ',
	N: '\x85',
	_: '\xa0'
};

function unquote(token: string): string {
	const body = token.slice(1, -1);
	if (token.charAt(0) === "'") return body.replace(/''/g, "'");
	return body.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, escape: string) => {
		const kind = escape.charAt(0);
		if ((kind === 'u' || kind === 'x') && escape.length > 1) return String.fromCodePoint(parseInt(escape.slice(1), 16));
		return ESCAPES[escape] ?? escape;
	});
}

// a '#' that follows whitespace starts a comment, unless it sits inside a quoted string
function stripComment(text: string): string {
	for (let i = 0; i < text.length; i++) {
		const c = text.charAt(i);
		if (c === '"' || c === "'") {
			const end = quoteEnd(text, i);
			if (end < 0) break;
			i = end;
			continue;
		}
		if (c === '#' && (i === 0 || text.charAt(i - 1) === ' ' || text.charAt(i - 1) === '\t')) return text.slice(0, i);
	}
	return text;
}

// --- flow collections: [a, b] and { a: 1 }

interface Flow {
	text: string;
	i: number;
}

function flowValue(flow: Flow, depth: number): unknown {
	skipSpace(flow);
	const c = flow.text.charAt(flow.i);
	if (c === '[' || c === '{') {
		if (depth >= MAX_DEPTH) {
			flow.i = flow.text.length;
			return null;
		}
		return c === '[' ? flowSequence(flow, depth + 1) : flowMapping(flow, depth + 1);
	}
	if (c === '"' || c === "'") return flowQuoted(flow);
	const start = flow.i;
	while (flow.i < flow.text.length && !',]}'.includes(flow.text.charAt(flow.i))) flow.i++;
	return parseScalar(flow.text.slice(start, flow.i), depth);
}

function flowQuoted(flow: Flow): string {
	const end = quoteEnd(flow.text, flow.i);
	// unterminated: the rest of the line, as written
	if (end < 0) {
		const token = flow.text.slice(flow.i + 1);
		flow.i = flow.text.length;
		return token;
	}
	const token = flow.text.slice(flow.i, end + 1);
	flow.i = end + 1;
	return unquote(token);
}

function flowSequence(flow: Flow, depth: number): unknown[] {
	const out: unknown[] = [];
	flow.i++;
	for (;;) {
		skipSpace(flow);
		const c = flow.text.charAt(flow.i);
		if (c === '' || c === ']') {
			flow.i++;
			return out;
		}
		if (c === ',') {
			flow.i++;
			continue;
		}
		out.push(flowValue(flow, depth));
	}
}

function flowMapping(flow: Flow, depth: number): Record<string, unknown> {
	const map: Record<string, unknown> = {};
	flow.i++;
	for (;;) {
		skipSpace(flow);
		const c = flow.text.charAt(flow.i);
		if (c === '' || c === '}') {
			flow.i++;
			return map;
		}
		if (c === ',') {
			flow.i++;
			continue;
		}
		let key: string;
		if (c === '"' || c === "'") {
			key = flowQuoted(flow);
		} else {
			const start = flow.i;
			while (flow.i < flow.text.length && !':,}'.includes(flow.text.charAt(flow.i))) flow.i++;
			key = flow.text.slice(start, flow.i).trim();
		}
		skipSpace(flow);
		let value: unknown = null;
		if (flow.text.charAt(flow.i) === ':') {
			flow.i++;
			value = flowValue(flow, depth);
		}
		if (key !== '') map[key] = value;
	}
}

function skipSpace(flow: Flow): void {
	while (flow.i < flow.text.length) {
		const c = flow.text.charAt(flow.i);
		if (c !== ' ' && c !== '\t') break;
		flow.i++;
	}
}
