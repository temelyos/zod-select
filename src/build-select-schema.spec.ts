import { strict as assert } from 'assert';
import { describe, it } from 'node:test';
import { z, ZodBoolean, ZodLazy, ZodObject, ZodOptional, ZodType, ZodUnion } from 'zod';

import { BasicSelect, buildSelectSchema } from './build-select-schema.js';
import { ZodSelect } from './select.js';
import { getInnerType, isZodObjectLoose } from './utilities.js';

describe('.buildSelectSchema()', () => {
	it('should build select schema for a flat object', () => {
		const schema = z.object({
			age: z.number(),
			name: z.string()
		});
		const selectSchema = buildSelectSchema(schema);

		assert(selectSchema instanceof ZodObject);

		assert.deepEqual(selectSchema.parse({ name: true }), { name: true });
		assert.deepEqual(selectSchema.parse({}), {});

		assert.throws(() =>
			selectSchema.parse({ name: 'yes' }), /expected boolean/
		);

		assert.throws(() =>
			selectSchema.parse({ unknown: true }), /Unrecognized key/
		);
	});

	it('should handle nested objects', () => {
		const schema = z.object({
			user: z.object({
				id: z.string(),
				profile: z.object({
					displayName: z.string()
				})
			})
		});
		const selectSchema = buildSelectSchema(schema);

		const result = selectSchema.parse({
			user: {
				id: true,
				profile: {
					displayName: true
				}
			}
		});

		assert.deepEqual(result, {
			user: {
				id: true,
				profile: {
					displayName: true
				}
			}
		});
	});

	it('should build select schema for a union of objects', () => {
		const schema = z.union([
			z.object({ type: z.literal('a'), valueA: z.string() }).strict(),
			z.object({ type: z.literal('b'), valueB: z.number() }).strict()
		]);
		const selectSchema = buildSelectSchema(schema);

		assert(selectSchema instanceof ZodObject);

		const result = selectSchema.parse({
			type: true,
			valueA: true
		});

		assert.deepEqual(result, {
			type: true,
			valueA: true
		});

		assert.throws(() =>
			selectSchema.parse({ valueC: true }), /Unrecognized key/
		);
	});

	it('z.infer of a union select schema should be a plain select type', () => {
		const schema = z.union([
			z.object({ shared: z.string(), type: z.literal('a'), valueA: z.string() }).strict(),
			z.object({ shared: z.string(), type: z.literal('b'), valueB: z.number() }).strict()
		]);
		const selectSchema = buildSelectSchema(schema);

		// Runtime: the schema correctly parses a plain select object
		assert.deepEqual(
			selectSchema.parse({ shared: true, type: true, valueA: true }),
			{ shared: true, type: true, valueA: true }
		);

		// Type-level: z.infer should produce a plain object like
		// { type?: boolean, shared?: boolean, valueA?: boolean, valueB?: boolean }.
		// Currently ZodSelect<ZodUnion, true> = RefineZodUnion<T> | ZodUnion,
		// so the inferred type includes the ZodUnion class, making it
		// unassignable to a plain record.
		type Inferred = z.infer<typeof selectSchema>;

		const plain: Record<string, boolean | undefined> = {} as Inferred;

		void plain;

		assert.ok(true);
	});

	it('should support intersections of objects', () => {
		const schema = z.intersection(
			z.object({ a: z.string() }),
			z.object({ b: z.number() })
		);

		const select = buildSelectSchema(schema);

		assert.strictEqual(getInnerType((select as ZodObject).shape.a).def.type, 'boolean');
		assert.strictEqual(getInnerType((select as ZodObject).shape.b).def.type, 'boolean');
	});

	it('should support tuples of objects', () => {
		const schema = z.tuple([
			z.object({ foo: z.string() }),
			z.object({ bar: z.number() })
		]);

		const select = buildSelectSchema(schema);

		assert.strictEqual(getInnerType((select as ZodObject).shape.foo).def.type, 'boolean');
		assert.strictEqual(getInnerType((select as ZodObject).shape.bar).def.type, 'boolean');
	});

	it('should return a strict schema if any member is strict', () => {
		const schema = z.union([
			z.object({ strictA: z.string() }).strict(),
			z.object({ strictB: z.number() }).strict()
		]);

		const select = buildSelectSchema(schema);

		assert.strictEqual(isZodObjectLoose((select as ZodObject)), false);
	});

	it('should return a strict schema when only one union member is strict', () => {
		const schema = z.union([
			z.object({ strictA: z.string() }).strict(),
			z.looseObject({ looseB: z.number() })
		]);

		const select = buildSelectSchema(schema);

		// Any strict member makes the merged select strict so callers cannot
		// accidentally reference fields outside any member's defined shape.
		assert.strictEqual(isZodObjectLoose((select as ZodObject)), false);
	});

	it('should allow optional keys in the select schema', () => {
		const schema = z.object({
			optionalField: z.string().optional()
		});

		const select = buildSelectSchema(schema);
		assert.strictEqual(getInnerType((select as ZodObject).shape.optionalField).def.type, 'boolean');
	});

	it('should handle direct recursion', () => {
		interface Role {
			name: string,
			roles: Role[]
		}

		const roleSchema: ZodType<Role> = z.lazy(() => {
			return (
				z.object({
					name: z.string(),
					roles: z.array(roleSchema)
				})
			);
		});

		const select = buildSelectSchema(roleSchema);

		assert.deepStrictEqual(Object.keys((select as ZodObject).shape), ['name', 'roles']);

		const nameSelect = (select as ZodObject).shape.name;
		assert.strictEqual(nameSelect.def.type, 'optional');
		assert.strictEqual(nameSelect.def.innerType.def.type, 'boolean');

		const rolesSelect = (select as ZodObject).shape.roles;
		assert.strictEqual(rolesSelect.def.type, 'lazy');

		const innerUnion = rolesSelect.def.getter().def.innerType;
		assert.strictEqual(innerUnion.def.type, 'union');

		const booleanItem = innerUnion.def.options[0];
		assert.strictEqual(booleanItem.def.type, 'boolean');

		const roleItem = innerUnion.def.options[1];
		assert.strictEqual(roleItem.def.type, 'object');
	});

	it('should support mutual recursion (cross-recursive)', () => {
		interface A { b: B }
		interface B { a: A }

		const schemaA: z.ZodType<A> = z.lazy(() =>
			z.object({
				b: schemaB
			})
		);

		const schemaB: z.ZodType<B> = z.lazy(() =>
			z.object({
				a: schemaA
			})
		);

		const select = buildSelectSchema(schemaA);
		assert.strictEqual((select as any as ZodObject).shape.b.def.type, 'lazy');

		const bUnion = (select as any as ZodObject).shape.b.def.getter();

		assert.strictEqual(bUnion.def.innerType.def.type, 'union');

		const bObj = bUnion.def.innerType.def.options[1];
		assert.strictEqual(bObj.shape.a.def.type, 'lazy');
	});

	it('should share the same instance in recursion (no infinite loop)', () => {
		interface Role {
			name: string,
			roles: Role[]
		}

		const role: ZodType<Role> = z.lazy(() =>
			z.object({
				name: z.string(),
				roles: z.array(role)
			})
		);

		const select = buildSelectSchema(role);
		const rolesSelect = (select as ZodObject).shape.roles;
		const unionSelect = (rolesSelect as ZodLazy<ZodOptional<ZodUnion<readonly [ZodBoolean, BasicSelect]>>>).def.getter().def.innerType;
		const nestedRoleSelect = (unionSelect.def.options[1] as ZodObject).shape.roles;

		// Should be the same object (by reference)
		assert.strictEqual(rolesSelect, nestedRoleSelect);
	});

	it('should support record types', () => {
		const schema = z.object({
			tags: z.record(z.string(), z.string())
		});

		const select = buildSelectSchema(schema);

		const tagsSelect = (select as ZodObject).shape.tags as
			z.ZodOptional<z.ZodUnion<[z.ZodBoolean, z.ZodRecord<z.ZodString, z.ZodOptional<z.ZodBoolean>>]>>;

		assert.strictEqual(tagsSelect.type, 'optional');

		const union = tagsSelect.def.innerType;

		assert.strictEqual(union.type, 'union');
		assert.strictEqual(union.def.options[0].type, 'boolean');
		assert.strictEqual(union.def.options[1].type, 'record');
		assert.strictEqual(union.def.options[1].def.keyType.type, 'string');
		assert.strictEqual(union.def.options[1].def.valueType.type, 'optional');
		assert.strictEqual(union.def.options[1].def.valueType.def.innerType.type, 'boolean');
	});

	it('should share the same lazy instance for a recursive schema referenced by multiple union members', () => {
		interface Nested { children: Nested[] }
		const nested: ZodType<Nested> = z.lazy(() =>
			z.object({ children: z.array(nested) })
		);

		const schema = z.union([
			z.object({ a: nested }),
			z.object({ b: nested })
		]);

		const select = buildSelectSchema(schema);

		// Both 'a' and 'b' reference the same `nested` schema.
		// Their select schemas must be the same lazy instance (shared cache).
		const aSelect = (select as ZodObject).shape.a;
		const bSelect = (select as ZodObject).shape.b;

		assert.strictEqual(aSelect, bSelect);
	});

	it('should support unknown types', () => {
		const schema = z.object({
			tags: z.unknown()
		});

		const select = buildSelectSchema(schema);

		const result = select.safeParse({
			tags: {
				any: {
					damn: true
				},
				thing: true
			}
		});

		assert.strictEqual(result.success, true);
		assert.deepStrictEqual(
			result.data,
			{
				tags: {
					any: {
						damn: true
					},
					thing: true
				}
			}
		);
	});

	it('should allow nested object sub-selection in union members', () => {
		const account = z.object({
			_id: z.string(),
			name: z.string()
		});

		const individual = z.object({
			account: account.optional(),
			name: z.object({ first: z.string(), last: z.string() }),
			type: z.literal('individual')
		});

		const organization = z.object({
			account: account.optional(),
			name: z.string(),
			type: z.literal('organization')
		});

		const contact = z.union([individual, organization]);
		const selectSchema = buildSelectSchema(contact);

		// Runtime: nested sub-selection on a shared nested object field should parse
		const result = selectSchema.parse({
			account: { _id: true, name: true },
			type: true
		});

		assert.deepStrictEqual(result, {
			account: { _id: true, name: true },
			type: true
		});

		// Type-level: ZodSelect<typeof Contact, true> should accept nested object selection
		type Select = ZodSelect<typeof contact, true>;
		const nested: Select = { account: { _id: true, name: true }, type: true };
		void nested;
	});
});

describe('.buildSelectSchema() regressions', () => {
	it('should handle recursion written with getters', () => {
		const category = z.object({
			get children() {
				return z.array(category);
			},
			name: z.string()
		});
		const select = buildSelectSchema(category);

		assert.ok(select.safeParse({ children: { children: { name: true }, name: true }, name: true }).success);
		assert.ok(!select.safeParse({ children: { bogus: true } }).success);
	});

	it('should handle getter recursion through a union', () => {
		const node = z.object({
			name: z.string(),
			get parent() {
				return z.union([node, z.null()]);
			}
		});
		const select = buildSelectSchema(node);

		assert.ok(select.safeParse({ name: true, parent: { name: true, parent: { name: true } } }).success);
		assert.ok(!select.safeParse({ parent: { bogus: true } }).success);
	});

	it('should accept a nested select into any union variant that shares the key', () => {
		const schema = z.union([
			z.object({ kind: z.literal('a'), meta: z.object({ a: z.string() }) }),
			z.object({ kind: z.literal('b'), meta: z.object({ b: z.string() }) })
		]);
		const select = buildSelectSchema(schema);

		assert.ok(select.safeParse({ meta: { a: true } }).success);
		assert.ok(select.safeParse({ meta: { b: true } }).success);
		assert.ok(select.safeParse({ meta: { a: true, b: true } }).success);
		assert.ok(!select.safeParse({ meta: { c: true } }).success);
	});

	it('should accept a nested select into either side of an intersection that shares the key', () => {
		const schema = z.intersection(
			z.object({ m: z.object({ a: z.string() }) }),
			z.object({ m: z.object({ b: z.string() }) })
		);
		const select = buildSelectSchema(schema);

		assert.ok(select.safeParse({ m: { a: true, b: true } }).success);
		assert.ok(!select.safeParse({ m: { c: true } }).success);
	});

	it('should accept a nested select through readonly, prefault, nonoptional and pipe wrappers', () => {
		const address = () => z.object({ city: z.string(), zip: z.string() });
		const schema = z.object({
			nonOptional: address().optional().nonoptional(),
			piped: z.preprocess(value => value, address()),
			prefault: address().prefault({ city: 'x', zip: 'y' }),
			readonly: address().readonly()
		});
		const select = buildSelectSchema(schema);

		assert.ok(select.safeParse({ nonOptional: { city: true }, piped: { city: true }, prefault: { city: true }, readonly: { city: true } }).success);
		assert.ok(!select.safeParse({ readonly: { bogus: true } }).success);
	});
});
