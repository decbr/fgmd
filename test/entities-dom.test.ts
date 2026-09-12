// @vitest-environment jsdom
// the browser build decodes named references through the DOM instead of shipping the table.
// jsdom's tokenizer (parse5) implements the WHATWG spec, legacy prefix matching included, so it
// gives the answer a browser would. if these ever disagree, SSR and hydration would too.
import { describe, expect, it } from 'vitest';
import { ENTITIES } from '../src/entities.js';
import { decodeNamedEntity as viaDom } from '../src/named-entity.browser.js';
import { decodeNamedEntity as viaTable } from '../src/named-entity.js';

describe('DOM entity decoding matches the table', () => {
	it('agrees on every named reference', () => {
		const names = Object.keys(ENTITIES);
		expect(names.length).toBeGreaterThan(2000);
		expect(names.filter((name) => viaDom(name) !== viaTable(name))).toEqual([]);
	});

	it('rejects names the HTML parser would only match by a legacy prefix', () => {
		// &notit; is ¬ + "it;" to a browser, &ampxyz; is & + "xyz;". CommonMark wants them literal
		for (const name of ['notit', 'ampxyz', 'copyx', 'ltfoo', 'Amp', 'nosuchthing']) {
			expect(viaTable(name)).toBeNull();
			expect(viaDom(name)).toBeNull();
		}
	});

	it('decodes the one reference whose value is its own terminator', () => {
		expect(viaDom('semi')).toBe(';');
	});
});
