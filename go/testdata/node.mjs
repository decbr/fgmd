// runs fgmd.js, the same bundle goja runs, under Node, so the Go tests can check goja's output and
// speed against V8's. input is JSON on stdin, output JSON on stdout
//
//   node node.mjs parity   [{src, settings, inline?, allowAllUrls?}]  ->  [{html} | {error}]
//   node node.mjs bench    [{name, docs, settings}]                   ->  [{name, nsPerOp, ops}]
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';

runInThisContext(readFileSync(new URL('../fgmd.js', import.meta.url), 'utf8'));
const { render } = globalThis.fgmd;
const input = JSON.parse(readFileSync(0, 'utf8'));
const allowAll = { urlPolicy: (url) => url };

let output;
if (process.argv[2] === 'parity') {
	output = input.map(({ src, settings, inline, allowAllUrls }) => {
		try {
			return { html: render(src, settings, Boolean(inline), allowAllUrls ? allowAll : undefined)[0] };
		} catch (err) {
			return { error: String(err?.message ?? err) };
		}
	});
} else if (process.argv[2] === 'bench') {
	output = input.map(({ name, docs, settings }) => {
		const once = () => {
			for (const doc of docs) render(doc, settings, false);
		};
		// a second of warm-up lets the JIT settle before timing
		for (const start = performance.now(); performance.now() - start < 1000; ) once();
		let ops = 0;
		let elapsed;
		const start = performance.now();
		do {
			once();
			ops++;
		} while ((elapsed = performance.now() - start) < 3000);
		return { name, nsPerOp: (elapsed * 1e6) / ops, ops };
	});
} else {
	console.error('usage: node node.mjs parity|bench < input.json');
	process.exit(2);
}
process.stdout.write(JSON.stringify(output));
