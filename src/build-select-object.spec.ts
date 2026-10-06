import { strict as assert } from 'assert';
import { describe, it } from 'node:test';
import { z } from 'zod';

import { buildSelectObject } from './build-select-object.js';
import { ZodSelect } from './select.js';
import { IsEqual } from './types.js';

describe('.buildSelectObject()', () => {
	it('should return all keys set to true for a flat object', () => {
		const schema = z.object({
			age: z.number(),
			name: z.string()
		});

		assert.deepStrictEqual(buildSelectObject(schema), { age: true, name: true });
	});

	it('should merge keys from all union members', () => {
		const schema = z.union([
			z.object({ type: z.literal('a'), valueA: z.string() }),
			z.object({ type: z.literal('b'), valueB: z.number() })
		]);

		assert.deepStrictEqual(buildSelectObject(schema), {
			type: true,
			valueA: true,
			valueB: true
		});
	});

	it('should merge keys from an intersection', () => {
		const schema = z.intersection(
			z.object({ a: z.string() }),
			z.object({ b: z.number() })
		);

		assert.deepStrictEqual(buildSelectObject(schema), { a: true, b: true });
	});

	it('should unwrap optional/nullable wrappers', () => {
		const inner = z.object({ id: z.string(), value: z.number() });
		const schema = inner.optional();

		assert.deepStrictEqual(buildSelectObject(schema as any), { id: true, value: true });
	});

	it('should unwrap lazy schemas', () => {
		const schema = z.lazy(() => z.object({ bar: z.number(), foo: z.string() }));

		assert.deepStrictEqual(buildSelectObject(schema as any), { bar: true, foo: true });
	});

	it('should handle nested unions inside intersection', () => {
		const schema = z.intersection(
			z.union([
				z.object({ a: z.string() }),
				z.object({ b: z.number() })
			]),
			z.object({ c: z.boolean() })
		);

		assert.deepStrictEqual(buildSelectObject(schema), {
			a: true,
			b: true,
			c: true
		});
	});

	it('should recursively expand nested objects', () => {
		const schema = z.object({
			active: z.boolean(),
			user: z.object({
				age: z.number(),
				name: z.string()
			})
		});

		assert.deepStrictEqual(buildSelectObject(schema), {
			active: true,
			user: { age: true, name: true }
		});
	});

	it('should recursively expand deeply nested objects', () => {
		const schema = z.object({
			name: z.string(),
			organization: z.object({
				_id: z.string(),
				address: z.object({
					city: z.string(),
					country: z.string()
				})
			})
		});

		assert.deepStrictEqual(buildSelectObject(schema), {
			name: true,
			organization: { _id: true, address: { city: true, country: true } }
		});
	});

	it('should expand optional nested objects', () => {
		const schema = z.object({
			name: z.string(),
			organization: z.object({
				_id: z.string(),
				name: z.string()
			}).optional()
		});

		assert.deepStrictEqual(buildSelectObject(schema), {
			name: true,
			organization: { _id: true, name: true }
		});
	});

	it('should not expand arrays', () => {
		const schema = z.object({
			name: z.string(),
			tags: z.array(z.string())
		});

		assert.deepStrictEqual(buildSelectObject(schema), { name: true, tags: true });
	});

	it('should expand the items of an array of objects', () => {
		const schema = z.object({
			items: z.array(z.object({ id: z.string(), value: z.number() })),
			name: z.string()
		});
		const select = buildSelectObject(schema);
		const isTyped: IsEqual<typeof select, { items: { id: true, value: true }, name: true }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(select, { items: { id: true, value: true }, name: true });
	});

	it('should expand an optional array of optional objects', () => {
		const schema = z.object({
			items: z.array(z.object({ id: z.string() }).optional()).optional()
		});
		const select = buildSelectObject(schema);
		const isTyped: IsEqual<typeof select, { items: { id: true } }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(select, { items: { id: true } });
	});

	it('should expand arrays of objects inside arrays of objects', () => {
		const schema = z.object({
			attachments: z.array(z.object({
				history: z.array(z.object({ note: z.string(), uploadedBy: z.object({ _id: z.string(), username: z.string() }) })),
				title: z.string()
			}))
		});
		const select = buildSelectObject(schema);
		const isTyped: IsEqual<typeof select, { attachments: { history: { note: true, uploadedBy: { _id: true, username: true } }, title: true } }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(select, {
			attachments: { history: { note: true, uploadedBy: { _id: true, username: true } }, title: true }
		});
	});

	it('should type nested objects as nested selects', () => {
		const schema = z.object({
			client: z.object({ _id: z.string(), name: z.string() }).optional(),
			title: z.string()
		});
		const select = buildSelectObject(schema);
		const isTyped: IsEqual<typeof select, { client: { _id: true, name: true }, title: true }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(select, { client: { _id: true, name: true }, title: true });
	});

	it('should not expand records, or arrays of anything but objects', () => {
		const schema = z.object({
			byKey: z.record(z.string(), z.object({ id: z.string() })),
			matrix: z.array(z.array(z.number())),
			tags: z.array(z.string())
		});
		const select = buildSelectObject(schema);
		const isTyped: IsEqual<typeof select, { byKey: true, matrix: true, tags: true }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(select, { byKey: true, matrix: true, tags: true });
	});

	it('should select a union field whole when a variant is not an object', () => {
		const schema = z.object({
			file: z.union([z.object({ _id: z.string(), filename: z.string() }), z.string()]),
			name: z.union([z.string(), z.object({ first: z.string(), last: z.string() })])
		});
		const select = buildSelectObject(schema);
		const isTyped: IsEqual<typeof select, { file: true, name: true }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(select, { file: true, name: true });
	});

	it('should merge the keys of every object variant of a union field', () => {
		const schema = z.object({
			party: z.union([z.object({ name: z.string(), type: z.literal('company') }), z.object({ first: z.string(), type: z.literal('person') })]).optional()
		});
		const select = buildSelectObject(schema);
		const isTyped: IsEqual<typeof select, { party: { first: true, name: true, type: true } }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(select, { party: { first: true, name: true, type: true } });
	});

	it('should not expand a union field with no object variant', () => {
		const schema = z.object({ value: z.union([z.string(), z.number()]).nullable() });
		const select = buildSelectObject(schema);
		const isTyped: IsEqual<typeof select, { value: true }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(select, { value: true });
	});

	it('should expand an array of a union of objects', () => {
		const schema = z.object({
			options: z.array(z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]))
		});
		const select = buildSelectObject(schema);
		const isTyped: IsEqual<typeof select, { options: { a: true, b: true } }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(select, { options: { a: true, b: true } });
	});

	it('should be a select the schema accepts', () => {
		const schema = z.object({
			client: z.object({ _id: z.string(), name: z.string() }),
			items: z.array(z.object({ id: z.string() }))
		});
		const select: ZodSelect<typeof schema, true> = buildSelectObject(schema);

		assert.deepStrictEqual(select, { client: { _id: true, name: true }, items: { id: true } });
	});

	it('should handle recursive schemas without infinite loop', () => {
		interface Node { children?: Node[], name: string, parent?: Node };

		const node: z.ZodType<Node> = z.lazy(() => z.object({
			children: z.array(node).optional(),
			name: z.string(),
			parent: node.optional()
		}));

		const schema = z.object({
			name: z.string(),
			root: node
		});

		// Should not throw or hang — recursive objects hit depth limit
		const result = buildSelectObject(schema);
		assert.strictEqual(result.name, true);
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		assert.ok(typeof result.root === 'object' && result.root !== null);
	});
});
