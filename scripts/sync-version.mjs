// copies package.json's version into src/version.ts. runs from npm's "version" lifecycle, after
// `npm version` bumps package.json and before it commits, so both land in the same commit.
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

writeFileSync(
	new URL('../src/version.ts', import.meta.url),
	`// kept in step with package.json by scripts/sync-version.mjs, checked by test/version.test.ts\nexport const VERSION = '${version}';\n`
);
console.log(`src/version.ts -> ${version}`);
