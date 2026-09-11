export type UrlKind = 'link' | 'image';

// decides what a link or image may point at. return the URL (possibly rewritten) to keep it,
// or null/undefined to reject it: a rejected link renders as its plain label, a rejected image
// as its alt text.
export type UrlPolicy = (url: string, kind: UrlKind) => string | null | undefined;

export const DEFAULT_SCHEMES: readonly string[] = ['http', 'https', 'mailto', 'tel'];

const reScheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

// browsers ignore leading control characters/spaces and any tab or newline when parsing a URL,
// so the scheme is read the same way. "java\tscript:" is still javascript.
export function schemeOf(url: string): string | null {
	const cleaned = url.replace(/^[\x00-\x20]+/, '').replace(/[\t\n\r]/g, '');
	return reScheme.exec(cleaned)?.[1]?.toLowerCase() ?? null;
}

// allows URLs without a scheme (relative paths, /absolute, #fragments, ?queries, //host)
// plus any scheme in the list
export function allowSchemes(schemes: readonly string[]): UrlPolicy {
	const allowed = new Set(schemes.map((s) => s.toLowerCase()));
	return (url) => {
		const scheme = schemeOf(url);
		return scheme === null || allowed.has(scheme) ? url : null;
	};
}

export const defaultUrlPolicy: UrlPolicy = allowSchemes(DEFAULT_SCHEMES);
