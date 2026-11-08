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

	it('accepts a nested select into the object variants of a union with a plain one, as a join read as its record is', () => {
		const select = { name: { en: true } } as const satisfies ZodSelect<typeof policy, true>;
		const isTyped: IsEqual<InferType<typeof policy, typeof select>['name'], { en: string }> = true;

		assert.ok(isTyped);
		assert.deepEqual(refineSchema(policy, select).parse({ name: { en: 'Software' } }), { name: { en: 'Software' } });
	});

	it('accepts the select a screen builds by declaring a joined id as its record', () => {
		const file = z.object({ _id: z.string(), filename: z.string() });
		const attachment = z.object({ file: z.union([file, z.string()]), title: z.string().optional() });
		const stored = z.object({ attachments: z.array(attachment).optional() });
		const read = z.object({ attachments: z.array(attachment.extend({ file })).optional() });
		const select: ZodSelect<typeof stored, true> = buildSelectObject(read);
		const isTyped: IsEqual<
			InferType<typeof stored, { attachments: { file: { _id: true, filename: true }, title: true } }>['attachments'],
			undefined | { file: { _id: string, filename: string }, title?: string }[]
		> = true;

		assert.ok(isTyped);
		assert.deepEqual(select, { attachments: { file: { _id: true, filename: true }, title: true } });
		assert.deepEqual(refineSchema(stored, select).parse({ attachments: [{ file: { _id: 'f1', filename: 'a.pdf' } }] }), { attachments: [{ file: { _id: 'f1', filename: 'a.pdf' } }] });
	});
});
describe('InferMergedType with a tuple', () => {
	it('merges a field optional on both sides as it does a required one, keeping undefined', () => {
		const order = z.strictObject({
			_id: z.string(),
			closedAt: z.date().optional(),
			lines: z.array(z.strictObject({ note: z.string(), sku: z.string() })).optional(),
			route: z.strictObject({ _id: z.string(), key: z.string(), name: z.string() }).optional()
		});
		const orderPart = z.strictObject({
			closedAt: z.date().optional(),
			lines: z.array(z.strictObject({ sku: z.string() })).optional(),
			route: z.strictObject({ _id: z.string() }).optional()
		});
		type Merged = InferMergedType<typeof order, [typeof orderPart, { _id: true, closedAt: true, lines: { note: true }, route: { _id: true, key: true } }]>;

		const isMerged: IsEqual<
			{ [K in keyof Merged]: Merged[K] },
			{ _id: string, closedAt: Date | undefined, lines: undefined | { note: string, sku: string }[], route: undefined | { _id: string, key: string } }
		> = true;
		assert.ok(isMerged);
	});
});

describe('InferType with a schema select', () => {
	const evidenceType = z.strictObject({ _id: z.string(), name: z.string() });
	const entry = z.strictObject({ at: z.date(), evidence: z.strictObject({ note: z.string(), type: evidenceType }) });
	const stored = z.strictObject({
		_id: z.string(),
		count: z.number(),
		log: z.array(entry),
		note: z.string().nullable(),
		profile: z.strictObject({ name: z.string(), ssn: z.string() }),
		secret: z.string()
	});
	// The model a reader finds: what field access may hide is optional
	const found = z.strictObject({
		_id: z.string(),
		count: z.number().default(0),
		log: z.array(entry.extend({ evidence: entry.shape.evidence.optional() })),
		note: z.string().nullable(),
		profile: z.strictObject({ name: z.string(), ssn: z.string().optional() }).readonly(),
		secret: z.string().optional()
	});

	it('keeps a field optional that the model has optional, though the select has it required', () => {
		const select = z.strictObject({ _id: z.string(), secret: z.string() });
		const isTyped: IsEqual<InferType<typeof found, typeof select>, { _id: string, secret?: string | undefined }> = true;

		assert.ok(isTyped);
	});

	it('does so within a nested object', () => {
		const select = z.strictObject({ profile: stored.shape.profile });
		const isTyped: IsEqual<InferType<typeof found, typeof select>['profile'], { name: string, ssn?: string | undefined }> = true;

		assert.ok(isTyped);
	});

	it('does so within the elements of an array', () => {
		const select = z.strictObject({ log: stored.shape.log });
		const isTyped: IsEqual<
			InferType<typeof found, typeof select>['log'],
			{ at: Date, evidence?: undefined | { note: string, type: { _id: string, name: string } } }[]
		> = true;

		assert.ok(isTyped);
	});

	it('does so for a select refined from a stricter schema', () => {
		const select = refineSchema(stored, { log: { evidence: { type: { _id: true } } } });
		const isTyped: IsEqual<InferType<typeof found, typeof select>, { log: { evidence?: undefined | { type: { _id: string } } }[] }> = true;

		assert.ok(isTyped);
	});

	it('keeps required what the model has required, a default and a nullable included', () => {
		const select = z.strictObject({ _id: z.string(), count: z.number(), note: z.string().nullable() });
		const isTyped: IsEqual<InferType<typeof found, typeof select>, { _id: string, count: number, note: null | string }> = true;

		assert.ok(isTyped);
	});

	it('keeps optional what the select has optional, and a field the model lacks as the select has it', () => {
		const select = z.strictObject({ _id: z.string().optional(), score: z.number() });
		const isTyped: IsEqual<InferType<typeof found, typeof select>, { _id?: string | undefined, score: number }> = true;

		assert.ok(isTyped);
	});

	it('does so past any depth', () => {
		const level = <T extends z.ZodType>(inner: T) => z.strictObject({ items: z.array(inner) });
		const deep = <T extends z.ZodType>(leaf: T) => level(level(level(level(level(level(leaf))))));
		const model = deep(z.strictObject({ id: z.string(), secret: z.string().optional() }));
		const select = deep(z.strictObject({ id: z.string(), secret: z.string() }));
		type Leaf = InferType<typeof model, typeof select>['items'][number]['items'][number]['items'][number]['items'][number]['items'][number]['items'][number];
		const isTyped: IsEqual<Leaf, { id: string, secret?: string | undefined }> = true;

		assert.ok(isTyped);
	});

	it('does so through a recursive schema', () => {
		interface FoundCategory { children: FoundCategory[], name: string, note?: string }
		interface StoredCategory { children: StoredCategory[], name: string, note: string }
		const foundCategory: z.ZodType<FoundCategory> = z.lazy(() => z.strictObject({ children: z.array(foundCategory), name: z.string(), note: z.string().optional() }));
		const storedCategory: z.ZodType<StoredCategory> = z.lazy(() => z.strictObject({ children: z.array(storedCategory), name: z.string(), note: z.string() }));
		type Deep = InferType<typeof foundCategory, typeof storedCategory>['children'][number]['children'][number]['children'][number]['children'][number]['children'][number]['children'][number];
		const isNoteOptional: IsEqual<Pick<Deep, 'name' | 'note'>, { name: string, note?: string | undefined }> = true;

		assert.ok(isNoteOptional);
	});

	it('does so within the elements of a tuple, a rest element included', () => {
		const item = z.strictObject({ id: z.string(), secret: z.string().optional() });
		const storedItem = z.strictObject({ id: z.string(), secret: z.string() });
		const model = z.strictObject({ pair: z.tuple([item, z.string()]), rest: z.tuple([z.string()], item) });
		const select = z.strictObject({ pair: z.tuple([storedItem, z.string()]), rest: z.tuple([z.string()], storedItem) });
		interface Item { id: string, secret?: string | undefined }
		const isTyped: IsEqual<InferType<typeof model, typeof select>, { pair: [Item, string], rest: [string, ...Item[]] }> = true;

		assert.ok(isTyped);
	});

	it('makes optional a field only an index signature of the model holds, a declared one kept', () => {
		const label = z.strictObject({ label: z.string() });
		const model = z.strictObject({ tags: z.record(z.string(), label) });
		const select = z.strictObject({ tags: z.strictObject({ urgent: label }) });
		const isTyped: IsEqual<InferType<typeof model, typeof select>, { tags: { urgent?: undefined | { label: string } } }> = true;
		const loose = z.strictObject({ user: z.looseObject({ _id: z.string() }) });
		const looseSelect = z.strictObject({ user: z.strictObject({ _id: z.string(), name: z.string() }) });
		const isLooseTyped: IsEqual<InferType<typeof loose, typeof looseSelect>, { user: { _id: string, name?: string | undefined } }> = true;
		const isLooseItself: IsEqual<InferType<typeof loose, typeof loose>, z.infer<typeof loose>> = true;

		assert.ok(isTyped);
		assert.ok(isLooseTyped);
		assert.ok(isLooseItself);
	});

	it('makes optional a field a model variant the select could be read from lacks', () => {
		const model = z.strictObject({ value: z.union([z.strictObject({ kind: z.literal('a'), x: z.string() }), z.strictObject({ kind: z.literal('b') })]) });
		const select = z.strictObject({ value: z.strictObject({ x: z.string() }) });
		const discriminated = z.strictObject({ value: z.strictObject({ kind: z.literal('a'), x: z.string() }) });
		const isTyped: IsEqual<InferType<typeof model, typeof select>, { value: { x?: string | undefined } }> = true;
		const isDiscriminated: IsEqual<InferType<typeof model, typeof discriminated>, { value: { kind: 'a', x: string } }> = true;

		assert.ok(isTyped);
		assert.ok(isDiscriminated);
	});

	it('pairs a select variant with the model variants that have the keys it requires, when no discriminant tells', () => {
		const oauth = z.strictObject({ accountName: z.string().optional(), service: z.string(), sub: z.string() });
		const password = z.strictObject({ hash: z.string(), lockedUntil: z.date().optional() });
		const model = z.strictObject({ authorizations: z.array(z.union([oauth, password.partial({ hash: true })])) });
		const select = z.strictObject({ authorizations: z.array(z.union([oauth, password])) });
		type Authorization = { accountName?: string | undefined, service: string, sub: string } | { hash?: string | undefined, lockedUntil?: Date | undefined };
		const isTyped: IsEqual<InferType<typeof model, typeof select>, { authorizations: Authorization[] }> = true;

		assert.ok(isTyped);
	});

	it('keeps undefined that the model allows, an optional nullable and a required field included', () => {
		const model = z.strictObject({ maybe: z.custom<string | undefined>(), note: z.string().nullable().optional() });
		const select = z.strictObject({ maybe: z.string(), note: z.string().nullable() });
		const isTyped: IsEqual<InferType<typeof model, typeof select>, { maybe: string | undefined, note?: null | string | undefined }> = true;

		assert.ok(isTyped);
	});

	it('keeps a branded value and a class instance whole', () => {
		class Money {
			constructor(readonly amount: number) {}

			format(): string {
				return this.amount.toFixed(2);
			}
		}
		const model = z.strictObject({ id: z.string(), price: z.strictObject({ amount: z.number().optional() }) });
		const select = z.strictObject({ id: z.string().brand<'Id'>(), price: z.instanceof(Money) });
		const isTyped: IsEqual<InferType<typeof model, typeof select>, { id: string & z.BRAND<'Id'>, price: Money }> = true;

		assert.ok(isTyped);
	});

	it('merges with an object select', () => {
		type Merged = InferMergedType<typeof found, [typeof select, { _id: true }]>;
		const select = z.strictObject({ secret: z.string() });
		const isTyped: IsEqual<{ [K in keyof Merged]: Merged[K] }, { _id: string, secret: string | undefined }> = true;

		assert.ok(isTyped);
	});

	it('reads the model itself as the model', () => {
		const isTyped: IsEqual<InferType<typeof found, typeof found>, z.infer<typeof found>> = true;

		assert.ok(isTyped);
	});

	it('pairs a union select variant by variant with the model variants its discriminant allows', () => {
		const channel = z.strictObject({ _id: z.string(), name: z.string() });
		const storedEffect = z.discriminatedUnion('kind', [
			z.strictObject({ channel, kind: z.literal('route') }),
			z.strictObject({ field: z.string(), kind: z.literal('require') })
		]);
		const foundEffect = z.discriminatedUnion('kind', [
			z.strictObject({ channel: channel.optional(), kind: z.literal('route') }),
			z.strictObject({ field: z.string(), kind: z.literal('require') })
		]);
		const policy = z.strictObject({ effect: foundEffect, effects: z.array(foundEffect).optional() });
		const select = z.strictObject({ effect: storedEffect, effects: z.array(storedEffect) });
		type Effect = { channel?: undefined | { _id: string, name: string }, kind: 'route' } | { field: string, kind: 'require' };
		const isTyped: IsEqual<InferType<typeof policy, typeof select>, { effect: Effect, effects?: Effect[] | undefined }> = true;
		const isUnionTyped: IsEqual<InferType<typeof foundEffect, typeof storedEffect>, Effect> = true;

		assert.ok(isTyped);
		assert.ok(isUnionTyped);
	});

	it('leaves an object select as it was', () => {
		const isTyped: IsEqual<
			InferType<typeof found, { _id: true, log: { evidence: { type: { _id: true } } }, secret: true }>,
			{ _id: string, log: { evidence?: undefined | { type: { _id: string } } }[], secret?: string | undefined }
		> = true;

		assert.ok(isTyped);
	});
});
