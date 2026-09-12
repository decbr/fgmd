// the whole site: a route table built from the markdown files that were bundled at build time,
// and one renderer.
//
// nothing is fetched at runtime and nothing is stored - the Worker holds every page's source,
// renders one on first request, and keeps the HTML in memory for the life of the isolate.
import { css, cssHash, sources } from './generated/content.js';
import { SITE, document, render, renderFragment, sitemapStylesheet, type Page } from './render.js';

interface Route {
	path: string;
	layout: 'home' | 'doc';
}

// files whose name starts with _ are fragments, not pages.
function routeFor(path: string): Route | null {
	const name = path.slice(path.lastIndexOf('/') + 1, -'.md'.length);
	if (name.startsWith('_')) return null;
	if (path.startsWith('docs/')) return { path, layout: 'doc' };
	if (name === 'index') return { path, layout: 'home' };
	return { path, layout: 'doc' };
}

function routePath(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1, -'.md'.length);
	if (path.startsWith('docs/')) return name.toLowerCase() === 'readme' ? '/docs' : `/docs/${name.toLowerCase()}`;
	return name === 'index' ? '/' : `/${name.toLowerCase()}`;
}

const routes = new Map<string, Route>();
for (const path of Object.keys(sources)) {
	const route = routeFor(path);
	if (route) routes.set(routePath(path), route);
}

const NOT_FOUND = 'site/content/404.md';
const NAV = 'site/content/_nav.md';
const FOOTER = 'site/content/_footer.md';

function source(path: string): string {
	return sources[path] ?? '';
}

// rendered once per isolate, then reused
const cache = new Map<string, { html: string; etag: string }>();
let chrome: { nav: string; footer: string } | null = null;

function parts(): { nav: string; footer: string } {
	if (!chrome) chrome = { nav: renderFragment(source(NAV)), footer: renderFragment(source(FOOTER)) };
	return chrome;
}

// FNV-1a: enough for an ETag, and far cheaper than hashing with WebCrypto on every response
function etagOf(value: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return `"${(hash >>> 0).toString(36)}${value.length.toString(36)}"`;
}

function page(route: string, entry: Route): { html: string; etag: string } {
	const hit = cache.get(route);
	if (hit) return hit;
	const rendered: Page = render(source(entry.path), entry.path);
	const html = document({ page: rendered, ...parts(), route, cssHash, layout: entry.layout });
	const built = { html, etag: etagOf(html) };
	cache.set(route, built);
	return built;
}

// the pages have no scripts, no inline styles and no embeds; say so
const CSP =
	"default-src 'none'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// an XSLT stylesheet is script-like to Chromium, which checks it against script-src: under the
// policy above the sitemap would render as bare XML. this is that policy plus same-origin XSLT,
// and it applies to nothing but the sitemap.
const CSP_SITEMAP = CSP.replace("default-src 'none';", "default-src 'none'; script-src 'self';");

function respond(
	request: Request,
	body: string,
	type: string,
	cacheControl: string,
	etag: string,
	status = 200,
	csp = CSP
): Response {
	const headers = new Headers({
		'content-type': type,
		'cache-control': cacheControl,
		etag,
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'strict-origin-when-cross-origin',
		'content-security-policy': csp
	});
	if (status === 200 && request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304, headers });
	}
	return new Response(request.method === 'HEAD' ? null : body, { status, headers });
}

const HTML = 'text/html; charset=utf-8';
const MARKDOWN = 'text/markdown; charset=utf-8';
const PAGE_CACHE = 'public, max-age=300, stale-while-revalidate=86400';
const ASSET_CACHE = 'public, max-age=31536000, immutable';

function sitemap(): string {
	const urls = [...routes.keys()]
		.filter((route) => route !== '/404')
		.sort()
		.map((route) => `\t<url><loc>${SITE.origin}${route}</loc></url>`)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export default {
	fetch(request: Request): Response {
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
		}

		const url = new URL(request.url);
		let path = decodeURIComponent(url.pathname);

		// /docs/ and /docs are the same page, and only one of them is canonical
		if (path.length > 1 && path.endsWith('/')) {
			return Response.redirect(`${url.origin}${path.replace(/\/+$/, '')}${url.search}`, 301);
		}

		if (path === `/style.${cssHash}.css`) {
			return respond(request, css, 'text/css; charset=utf-8', ASSET_CACHE, etagOf(cssHash));
		}
		if (path === '/style.css') {
			return Response.redirect(`${url.origin}/style.${cssHash}.css`, 302);
		}
		if (path === '/robots.txt') {
			const body = `User-agent: *\nAllow: /\nSitemap: ${SITE.origin}/sitemap.xml\n`;
			return respond(request, body, 'text/plain; charset=utf-8', PAGE_CACHE, etagOf(body));
		}
		if (path === '/sitemap.xml') {
			const body = sitemap();
			return respond(request, body, 'application/xml; charset=utf-8', PAGE_CACHE, etagOf(body), 200, CSP_SITEMAP);
		}
		if (path === '/sitemap.xsl') {
			const body = sitemapStylesheet(cssHash);
			return respond(request, body, 'text/xsl; charset=utf-8', PAGE_CACHE, etagOf(body), 200, CSP_SITEMAP);
		}

		// every page is served as markdown at its own URL + .md, so the claim on the home page is
		// checkable: /docs/syntax.md is the file /docs/syntax was rendered from
		if (path.endsWith('.md')) {
			const route = path === '/index.md' ? '/' : path.slice(0, -'.md'.length);
			const entry = routes.get(route);
			if (entry) {
				const body = source(entry.path);
				return respond(request, body, MARKDOWN, PAGE_CACHE, etagOf(body));
			}
			path = route;
		}

		const entry = routes.get(path);
		if (entry) {
			const { html, etag } = page(path, entry);
			return respond(request, html, HTML, PAGE_CACHE, etag);
		}

		const missing = page('/404', { path: NOT_FOUND, layout: 'doc' });
		return respond(request, missing.html, HTML, 'no-store', missing.etag, 404);
	}
};
