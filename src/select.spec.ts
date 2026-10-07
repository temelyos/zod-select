import { strict as assert } from 'assert';
import { describe, it } from 'node:test';
import { z } from 'zod';

import { buildSelectObject } from './build-select-object.js';
import { refineSchema } from './refine-schema.js';
import { InferMergedType, InferType, ZodSelect } from './select.js';
import { IsEqual } from './types.js';

const internalService = z.object({
	name: z.string(),
	type: z.literal('internal')
}).strict();

const externalService = z.object({
	iconUrl: z.string().optional(),
	name: z.string(),
	type: z.literal('external')
}).strict();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const serviceType = z.union([internalService, externalService]);

describe('InferMergedType', () => {
	it('should resolve to z.infer<T> when used in a generic function with TSelect = undefined', () => {
		function getServices<TSelect extends undefined | ZodSelect<typeof serviceType, true> = undefined>(
			options: { select?: TSelect }
		): Record<string, InferMergedType<typeof serviceType, TSelect>> {
			void options;
			return {} as any;
		}

		// When called without select, TSelect defaults to undefined
		// InferMergedType<typeof Service, undefined> should resolve to z.infer<typeof Service>
		const services = getServices({});
		const service = Object.values(services)[0];

		// This is a compile-time test: the assertion below must type-check (all
		// union members have `name: string`). The impl returns `{}`, so guard the
		// dereference — the block never runs but TS still checks it.
		if (service) {
			const name: string = service.name;
			void name;
		}
	});

	it('should resolve to projected type when used in a generic function with a select', () => {
		function getServices<TSelect extends undefined | ZodSelect<typeof serviceType, true> = undefined>(
			options: { select?: TSelect }
		): Record<string, InferMergedType<typeof serviceType, TSelect>> {
			void options;
			return {} as any;
		}

		// When called with a select, the return type should be the projected type
		const services = getServices({ select: { name: true } });
		const service = Object.values(services)[0];

		// This is a compile-time test: the assertion below must type-check (name
		// was selected). The impl returns `{}`, so guard the dereference — the
		// block never runs but TS still checks it.
		if (service) {
			const name: string = service.name;
			void name;
		}
	});
});

describe('a field whose value is a union of objects', () => {
	const channel = z.object({ _id: z.string(), key: z.string(), name: z.string() });
	const effect = z.discriminatedUnion('kind', [
		z.object({ channel, kind: z.literal('route') }),
		z.object({ field: z.string(), kind: z.literal('require') })
	]);
	const policy = z.object({
		_id: z.string(),
		effect,
		effects: z.array(effect).optional(),
		name: z.union([z.string(), z.object({ en: z.string() })])
	});

	it('accepts a nested select into the variants, and refines each variant by it', () => {
		const select = { effect: { channel: { _id: true, name: true }, field: true, kind: true } } as const satisfies ZodSelect<typeof policy, true>;
		const parsed = refineSchema(policy, select).parse({ effect: { channel: { _id: 'c1', key: 'rpo', name: 'RPO' }, kind: 'route' } });

		assert.deepEqual(parsed, { effect: { channel: { _id: 'c1', name: 'RPO' }, kind: 'route' } });
	});

	it('types the result variant by variant, so checking the kind narrows to what that variant selected', () => {
		const select = { effect: { channel: { _id: true, name: true }, field: true, kind: true } } as const;
		const isTyped: IsEqual<
			InferType<typeof policy, typeof select>['effect'],
			{ channel: { _id: string, name: string }, kind: 'route' } | { field: string, kind: 'require' }
		> = true;

		assert.ok(isTyped);
		assert.deepEqual(refineSchema(policy, select).parse({ effect: { field: 'rationale', kind: 'require' } }), { effect: { field: 'rationale', kind: 'require' } });
	});

	it('does the same for an array of such a union', () => {
		const select = { effects: { channel: { name: true }, kind: true } } as const satisfies ZodSelect<typeof policy, true>;
		const isTyped: IsEqual<
			InferType<typeof policy, typeof select>['effects'],
			({ channel: { name: string }, kind: 'route' } | { kind: 'require' })[] | undefined
		> = true;
		const effects = [{ channel: { _id: 'c1', key: 'rpo', name: 'RPO' }, kind: 'route' }, { field: 'rationale', kind: 'require' }];

		assert.ok(isTyped);
		assert.deepEqual(refineSchema(policy, select).parse({ effects }), { effects: [{ channel: { name: 'RPO' }, kind: 'route' }, { kind: 'require' }] });
	});

	it('accepts the select buildSelectObject builds for it', () => {
		const select: ZodSelect<typeof policy, true> = buildSelectObject(policy);

		assert.deepEqual(select, {
			_id: true,
			effect: { channel: { _id: true, key: true, name: true }, field: true, kind: true },
			effects: { channel: { _id: true, key: true, name: true }, field: true, kind: true },
			name: true
		});
	});

	it('still refuses a nested select into a union with a plain variant, which would miss the plain value', () => {
		// @ts-expect-error `name` may be a string, so only the whole value can be selected.
		const select: ZodSelect<typeof policy, true> = { name: { en: true } };

		assert.ok(select);
	});
});
