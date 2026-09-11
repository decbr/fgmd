// builds dist/:
//   dist/**          the npm package: JS + .d.ts from src/, and the Svelte component (via svelte-package)
//   dist/fgmd.mjs    the CLI as one self-contained file, for vendoring into non-JS projects
import { execFileSync } from 'node:child_process';
import { chmodSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

process.chdir(new URL('..', import.meta.url).pathname);

rmSync('dist', { recursive: true, force: true });
execFileSync('npx', ['svelte-package', '--input', 'src', '--output', 'dist'], { stdio: 'inherit' });

await build({
	entryPoints: ['src/cli.ts'],
	bundle: true,
	format: 'esm',
	platform: 'node',
	target: 'node18',
	outfile: 'dist/fgmd.mjs',
	legalComments: 'none',
	logLevel: 'warning'
});

chmodSync('dist/cli.js', 0o755);
chmodSync('dist/fgmd.mjs', 0o755);
console.log('built dist/ and dist/fgmd.mjs');
