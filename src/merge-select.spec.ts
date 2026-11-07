import { strict as assert } from 'assert';
import { describe, it } from 'node:test';
import { z } from 'zod';

import { mergeSelect } from './merge-select.js';
import { InferMergedType } from './select.js';
import { IsEqual } from './types.js';

const userSchema = z.object({ email: z.string(), name: z.string() });

describe('.mergeSelect()', () => {
	it('should type a merge with the whole schema as the runtime returns it: every field', () => {
		const select = { name: true };
		const merged = mergeSelect(userSchema, select, userSchema);

		assert.deepStrictEqual(merged, [select, userSchema]);

		const isTyped: IsEqual<InferMergedType<typeof userSchema, typeof merged>, { email: string, name: string }> = true;
		assert.ok(isTyped);
	});

	it('should merge with the whole schema when no second select is given', () => {
		const select = { name: true };
		const merged = mergeSelect(userSchema, select);

		assert.deepStrictEqual(merged, [select, userSchema]);

		const isTyped: IsEqual<InferMergedType<typeof userSchema, typeof merged>, { email: string, name: string }> = true;
		assert.ok(isTyped);
	});

	it('should spread a list of selects after the first', () => {
		const merged = mergeSelect(userSchema, { name: true }, [{ email: true }]);

		assert.deepStrictEqual(merged, [{ name: true }, { email: true }]);

		const isTyped: IsEqual<InferMergedType<typeof userSchema, typeof merged>, { email: string, name: string }> = true;
		assert.ok(isTyped);
	});
});
