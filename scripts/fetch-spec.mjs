// downloads the official conformance examples into test/spec/. run once; the output is committed
// so tests never touch the network.
//
//   commonmark.json  every example from the CommonMark 0.31.2 spec
//   gfm.json         the GFM-only examples (tables, strikethrough, autolinks, tasklists, footnotes)
//                    pulled out of cmark-gfm's spec.txt
import { mkdir, writeFile } from 'node:fs/promises';

const COMMONMARK = 'https://spec.commonmark.org/0.31.2/spec.json';
const GFM = 'https://raw.githubusercontent.com/github/cmark-gfm/master/test/spec.txt';
const OUT = new URL('../test/spec/', import.meta.url);

async function get(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url}: ${res.status}`);
	return res.text();
}

// spec.txt fences each example in 32 backticks, markdown and html split by a lone '.'.
// tabs are written as → so they're visible in the prose; put them back.
function extractExamples(text) {
	const fence = '`'.repeat(32);
	const lines = text.split('\n');
	const examples = [];
	let section = '';

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const heading = line.match(/^#{1,6} (.*)$/);
		if (heading) section = heading[1].trim();

		if (!line.startsWith(`${fence} example`)) continue;
		const extension = line.slice(`${fence} example`.length).trim() || null;

		const md = [];
		const html = [];
		let target = md;
		for (i++; i < lines.length && lines[i] !== fence; i++) {
			if (lines[i] === '.' && target === md) target = html;
			else target.push(lines[i]);
		}

		const untab = (s) => s.replace(/→/g, '\t');
		examples.push({
			markdown: untab(md.join('\n') + '\n'),
			html: untab(html.length ? html.join('\n') + '\n' : ''),
			section,
			extension
		});
	}
	return examples;
}

await mkdir(OUT, { recursive: true });

const commonmark = JSON.parse(await get(COMMONMARK));
await writeFile(new URL('commonmark.json', OUT), JSON.stringify(commonmark, null, '\t') + '\n');

const gfm = extractExamples(await get(GFM))
	.filter((e) => e.extension)
	.map((e, n) => ({ ...e, example: n + 1 }));
await writeFile(new URL('gfm.json', OUT), JSON.stringify(gfm, null, '\t') + '\n');

console.log(`commonmark: ${commonmark.length} examples, gfm: ${gfm.length} extension examples`);
