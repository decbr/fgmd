// builds fgmd.js: the library and entry.ts as one plain script for the goja engine.
// `go generate` runs it. commit the result: `go get` fetches the repo as it is and never runs a build
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

process.chdir(fileURLToPath(new URL('.', import.meta.url)));

await build({
	entryPoints: ['entry.ts'],
	bundle: true,
	format: 'iife',
	platform: 'neutral',
	target: 'es2020',
	outfile: 'fgmd.js',
	legalComments: 'none',
	logLevel: 'warning',
	plugins: [
		{
			name: 'unicode-properties',
			setup(build) {
				const ranges = new Map();
				const expand = (name) => {
					if (!ranges.has(name)) {
						const re = new RegExp(`^\\p{${name}}$`, 'u');
						const out = [];
						for (let cp = 0; cp <= 0x10ffff; cp++) {
							if (!re.test(String.fromCodePoint(cp))) continue;
							const last = out.at(-1);
							if (last && last[1] === cp - 1) last[1] = cp;
							else out.push([cp, cp]);
						}
						ranges.set(name, out);
					}
					return ranges.get(name);
				};
				build.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, async ({ path }) => {
					const source = await readFile(path, 'utf8');
					// the backslashes are kept as found: one in a regex literal, two in a string
					const contents = source.replace(/(\\+)p\{(\w+)\}/g, (_, slash, name) =>
						expand(name)
							.map(([a, b]) => `${slash}u{${a.toString(16)}}` + (a === b ? '' : `-${slash}u{${b.toString(16)}}`))
							.join('')
					);
					return { contents, loader: 'ts' };
				});
			}
		},
		{
			name: 'named-entity',
			setup(build) {
				build.onResolve({ filter: /^#named-entity$/ }, () => ({
					path: fileURLToPath(new URL('../src/named-entity.ts', import.meta.url))
				}));
			}
		}
	]
});
console.log('built go/fgmd.js');
