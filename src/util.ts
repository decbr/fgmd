import { ENTITIES } from './entities.js';

// the ASCII punctuation a backslash can escape
export const ESCAPABLE = '[!"#$%&\'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]';
export const ENTITY = '&(?:#x[a-f0-9]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});';

export const TAGNAME = '[A-Za-z][A-Za-z0-9-]*';
export const ATTRIBUTENAME = '[a-zA-Z_:][a-zA-Z0-9:._-]*';
export const ATTRIBUTEVALUE = '(?:[^"\'=<>`\\x00-\\x20]+|\'[^\']*\'|"[^"]*")';
export const ATTRIBUTE = `(?:\\s+${ATTRIBUTENAME}(?:\\s*=\\s*${ATTRIBUTEVALUE})?)`;
export const OPENTAG = `<${TAGNAME}${ATTRIBUTE}*\\s*/?>`;
export const CLOSETAG = `</${TAGNAME}\\s*[>]`;
export const HTMLCOMMENT = '<!-->|<!--->|<!--[\\s\\S]*?-->';
const PROCESSING = '[<][?][\\s\\S]*?[?][>]';
const DECLARATION = '<![A-Za-z]+[^>]*>';
const CDATA = '<!\\[CDATA\\[[\\s\\S]*?\\]\\]>';

export const reHtmlTag = new RegExp(
	`^(?:${OPENTAG}|${CLOSETAG}|${HTMLCOMMENT}|${PROCESSING}|${DECLARATION}|${CDATA})`
);
export const reHtmlComment = new RegExp(`^(?:${HTMLCOMMENT})`);

// every complete comment, plus one left open at the end (it would hide the rest of the page anyway)
const reAnyComment = /<!---?>|<!--[\s\S]*?-->|<!--[\s\S]*$/g;

export function stripComments(html: string): string {
	return html.replace(reAnyComment, '');
}

// GFM's disallowed raw HTML: the leading < of these tags becomes &lt; so they render as text
const reTagFilter = /<(?=\/?(?:title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)(?:[\s/>]|$))/gi;

export function tagfilter(html: string): string {
	return html.replace(reTagFilter, '&lt;');
}

// decodes one entity reference (including the & and ;). null when it names nothing, in which
// case CommonMark says the text is literal.
export function decodeEntity(entity: string): string | null {
	if (entity[1] === '#') {
		const hex = entity[2] === 'x' || entity[2] === 'X';
		const code = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
		if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
		return String.fromCodePoint(code);
	}
	const name = entity.slice(1, -1);
	return Object.hasOwn(ENTITIES, name) ? (ENTITIES[name] ?? null) : null;
}

const reEntity = new RegExp(ENTITY, 'gi');

// replaces entities (only; backslashes mean nothing in HTML) with the characters they stand for
export function decodeEntities(s: string): string {
	return s.includes('&') ? s.replace(reEntity, (m) => decodeEntity(m) ?? m) : s;
}

const reEntityOrEscape = new RegExp(`\\\\${ESCAPABLE}|${ENTITY}`, 'gi');

// replaces backslash escapes and entities with the characters they stand for
export function unescapeString(s: string): string {
	if (!s.includes('\\') && !s.includes('&')) return s;
	return s.replace(reEntityOrEscape, (m) => (m[0] === '\\' ? m.slice(1) : (decodeEntity(m) ?? m)));
}

// percent-encodes a URL the way commonmark.js does (via mdurl): anything outside the
// unreserved/reserved set is encoded, existing %XX escapes are kept, lone surrogates become U+FFFD
const URL_SAFE = /^[A-Za-z0-9;/?:@&=+$,\-_.!~*'()#]$/;

export function normalizeUrl(url: string): string {
	let out = '';
	for (let i = 0; i < url.length; i++) {
		const ch = url[i] as string;
		const code = url.charCodeAt(i);

		if (code === 0x25 && /^[0-9a-f]{2}$/i.test(url.slice(i + 1, i + 3))) {
			out += url.slice(i, i + 3);
			i += 2;
		} else if (code < 128) {
			out += URL_SAFE.test(ch) ? ch : '%' + code.toString(16).toUpperCase().padStart(2, '0');
		} else if (code >= 0xd800 && code <= 0xdfff) {
			const next = url.charCodeAt(i + 1);
			if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
				out += encodeURIComponent(ch + url[i + 1]);
				i++;
			} else {
				out += '%EF%BF%BD';
			}
		} else {
			out += encodeURIComponent(ch);
		}
	}
	return out;
}

const reHtmlSpecial = /[&<>"]/g;
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export function escapeHtml(s: string): string {
	return reHtmlSpecial.test(s) ? s.replace(reHtmlSpecial, (c) => HTML_ESCAPES[c] as string) : s;
}

// link and footnote labels match case-insensitively with whitespace collapsed.
// lower-then-upper is the cheap approximation of Unicode case folding commonmark.js uses (ẞ vs SS).
export function normalizeLabel(label: string): string {
	return label.trim().replace(/[ \t\r\n]+/g, ' ').toLowerCase().toUpperCase();
}
