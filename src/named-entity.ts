import { ENTITIES } from './entities.js';

// the characters a named character reference stands for, given the name between & and ;. null
// when it names nothing. browser bundles get named-entity.browser.ts instead (package.json "imports")
export function decodeNamedEntity(name: string): string | null {
	return Object.hasOwn(ENTITIES, name) ? (ENTITIES[name] ?? null) : null;
}
