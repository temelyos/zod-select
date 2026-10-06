import { ZodArray, ZodCatch, ZodDefault, ZodIntersection, ZodLazy, ZodNullable, ZodObject, ZodOptional, ZodRawShape, ZodType, ZodUnion } from 'zod';

import { UnionToIntersection } from './refine-schema.js';
import { ZodSelect } from './select.js';
import { getInnerType, isZodArray, isZodObject, isZodUnion } from './utilities.js';

type Depth = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

type FieldSelectAll<T, TDepth extends number> = TDepth extends 0
	? true
	: Unwrap<T> extends ZodArray<infer TItem> ? ItemSelectAll<TItem, Depth[TDepth]> : ItemSelectAll<T, Depth[TDepth]>;

type ItemSelectAll<T, TDepth extends number> = Unwrap<T> extends ZodObject<infer TShape, any>
	? ObjectSelectAll<TShape, TDepth>
	: Unwrap<T> extends ZodUnion<infer TOptions>
		? [NotObject<TOptions[number]>] extends [never] ? UnionShape<TOptions> extends infer TShape extends ZodRawShape ? ObjectSelectAll<TShape, TDepth> : true : true
		: true;
type NotObject<T> = T extends unknown ? Unwrap<T> extends ZodObject<any, any> ? never : T : never;

type ObjectSelectAll<TShape extends ZodRawShape, TDepth extends number> = { [K in keyof TShape]-?: FieldSelectAll<TShape[K], TDepth> };

interface SelectObject { [key: string]: SelectObject | true }

type SelectValue = SelectObject | true;

type ShapeOf<T> = T extends unknown ? Unwrap<T> extends ZodObject<infer TShape, any> ? TShape : never : never;

/** The shapes of a union's object variants, merged; `unknown` when it has none. */
type UnionShape<TOptions> = UnionToIntersection<TOptions extends readonly (infer TOption)[] ? ShapeOf<TOption> : never>;

type Unwrap<T> = T extends ZodCatch<infer I> | ZodDefault<infer I> | ZodNullable<infer I> | ZodOptional<infer I>
	? Unwrap<I>
	: T extends ZodLazy<infer I> ? Unwrap<I> : T;

/** What {@link buildSelectObject} answers: nested for objects, unions of objects, and arrays of either; `true` for anything else. */
export type ZodSelectAll<T extends ZodType<object> | ZodUnion> = Unwrap<T> extends ZodObject<infer TShape, any>
	? ObjectSelectAll<TShape, 10>
	: { [K in keyof ZodSelect<T, true>]-?: true };

/**
 * Produces a runtime select-all object for the given Zod schema.
 *
 * Every scalar key is set to `true`. Nested object fields, and arrays of
 * objects, are recursively expanded into nested select objects. A union field
 * whose every variant is an object expands into their merged keys. A union
 * with any other variant, such as a name that is a string or a structured
 * name, remains `true`: its sub-fields would miss the plain value. Other arrays
 * and records remain `true`.
 * For union schemas the result is the merged set of keys across all variants.
 *
 * @example
 * ```ts
 * const select = buildSelectObject(AuthenticationService);
 * // { name: true, type: true, isEnabled: true, ... }
 * ```
 */
export function buildSelectObject<T extends ZodType<object> | ZodUnion>(schema: T): ZodSelectAll<T> {
	const result: Record<string, SelectValue> = {};
	collectKeys(schema, result);
	return result as ZodSelectAll<T>;
}

/**
 * Unwraps optional/nullable/default/catch/lazy wrappers but NOT arrays.
 */
function unwrapField(schema: ZodType): ZodType {
	if (
		schema instanceof ZodOptional
		|| schema instanceof ZodNullable
		|| schema instanceof ZodDefault
		|| schema instanceof ZodCatch
	) {
		return unwrapField(schema.def.innerType as ZodType);
	}

	if (schema instanceof ZodLazy) {
		return unwrapField(schema.def.getter() as ZodType);
	}

	return schema;
}

const MAX_DEPTH = 10;

function collectKeys(schema: ZodType, result: Record<string, SelectValue>, depth = 0): void {
	if (depth >= MAX_DEPTH) {
		return;
	}

	schema = getInnerType(schema);

	if (isZodObject(schema)) {
		for (const key in schema.shape) {
			const field = unwrapField(schema.shape[key]);
			const fieldInner = isZodArray(field) ? unwrapField(field.def.element as ZodType) : field;

			if (isZodObject(fieldInner) || isUnionOfObjects(fieldInner)) {
				const nested: Record<string, SelectValue> = {};
				collectKeys(fieldInner, nested, depth + 1);
				result[key] = nested;
			} else {
				result[key] = true;
			}
		}
	} else if (isZodUnion(schema)) {
		for (const option of schema.options) {
			collectKeys(option, result, depth);
		}
	} else if (schema.def.type === 'intersection') {
		collectKeys((schema as ZodIntersection).def.left as ZodType, result, depth);
		collectKeys((schema as ZodIntersection).def.right as ZodType, result, depth);
	}
}

function isUnionOfObjects(schema: ZodType): boolean {
	return isZodUnion(schema) && schema.options.every(option => isZodObject(unwrapField(option)));
}
