import type { Point, Position } from './ast.js';

export class Locator {
	private readonly starts = [0];
	private readonly ends: number[] = [];

	constructor(private readonly source: string) {
		for (let i = 0; i < source.length; i++) {
			const c = source.charCodeAt(i);
			if (c !== 10 && c !== 13) continue;
			this.ends.push(i);
			if (c === 13 && source.charCodeAt(i + 1) === 10) i++;
			this.starts.push(i + 1);
		}
		this.ends.push(source.length);
	}

	lineStart(line: number): number {
		return this.starts[line - 1] ?? this.source.length;
	}

	lineEnd(line: number): number {
		let end = this.ends[line - 1] ?? this.source.length;
		const start = this.lineStart(line);
		while (end > start && (this.source[end - 1] === ' ' || this.source[end - 1] === '\t')) end--;
		return end;
	}

	point(offset: number): Point {
		let lo = 0;
		let hi = this.starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if ((this.starts[mid] as number) <= offset) lo = mid;
			else hi = mid - 1;
		}
		return { line: lo + 1, column: offset - (this.starts[lo] as number) + 1, offset };
	}

	position(start: number, end: number): Position {
		return { start: this.point(start), end: this.point(Math.max(start, end)) };
	}
}

export type SourceMap = (index: number) => number;

export function segmentMap(segments: readonly number[], base = 0): SourceMap {
	return (index) => {
		const i = index + base;
		let lo = 0;
		let hi = segments.length / 2 - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if ((segments[mid * 2] as number) <= i) lo = mid;
			else hi = mid - 1;
		}
		return (segments[lo * 2 + 1] as number) + i - (segments[lo * 2] as number);
	};
}
