// the browser build of named-entity.ts. a browser already carries the WHATWG entity table, so ask
// the DOM rather than ship ~12 KB (gzipped) of it. package.json "imports" picks this for bundles
// with the "browser" condition, unless "workerd" or "worker" is also set (Cloudflare, edge
// runtimes, which have no DOM); Node, SSR and the CLI keep the table, and
// test/entities-dom.test.ts checks that the two agree on every name.

let textarea: HTMLTextAreaElement | undefined;

export function decodeNamedEntity(name: string): string | null {
	if (typeof document === 'undefined') {
		throw new Error(
			'fgmd: this is the browser build, which decodes entities through the DOM, and there is no document here. ' +
				'Bundle code that runs without a DOM (such as a web worker) with the "worker" condition, so the entity table is included.'
		);
	}
	textarea ??= document.createElement('textarea');
	// a textarea's content is text: nothing in it is parsed as markup, only references are decoded.
	// name is always [a-z][a-z0-9]{1,31} (util.ts ENTITY), so nothing else can get in anyway
	const reference = `&${name};`;
	textarea.innerHTML = reference;
	const decoded = textarea.value;
	// the HTML parser also resolves legacy references by their longest known prefix (&notit; is
	// ¬ followed by "it;"), which CommonMark doesn't allow. a whole-name match consumes our ';', so
	// anything still ending in one wasn't a match, apart from &semi; which decodes to ';' itself
	if (decoded === reference || (decoded.endsWith(';') && name !== 'semi')) return null;
	return decoded;
}
