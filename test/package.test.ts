// how a bundler picks the entity decoder. conditions are matched in key order, so a Worker build
// (wrangler sets workerd, worker and browser) must hit the table before the DOM version, which
// throws where there's no document
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('package.json entity decoder', () => {
	const map: Record<string, string> = pkg.imports['#named-entity'];

	it('gives Workers and the default the table', () => {
		expect(map.workerd).toBe('./dist/named-entity.js');
		expect(map.worker).toBe('./dist/named-entity.js');
		expect(map.default).toBe('./dist/named-entity.js');
		expect(map.browser).toBe('./dist/named-entity.browser.js');
	});

	it('checks workerd and worker before browser', () => {
		const keys = Object.keys(map);
		expect(keys.indexOf('workerd')).toBeLessThan(keys.indexOf('browser'));
		expect(keys.indexOf('worker')).toBeLessThan(keys.indexOf('browser'));
		expect(keys.at(-1)).toBe('default');
	});

	it('has no browser field, which would swap the decoder in Workers too', () => {
		expect(pkg.browser).toBeUndefined();
	});
});
