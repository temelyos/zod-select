import { ZodArray, ZodCatch, ZodDefault, ZodIntersection, ZodLazy, ZodNullable, ZodObject, ZodOptional, ZodRawShape, ZodType, ZodUnion } from 'zod';

import { ZodSelect } from './select.js';
import { getInnerType, isZodArray, isZodObject, isZodUnion } from './utilities.js';

type Depth = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

type FieldSelectAll<T, TDepth extends number> = TDepth extends 0
	? true
	: Unwrap<T> extends ZodObject<infer TShape, any>
		? ObjectSelectAll<TShape, Depth[TDepth]>
		: Unwrap<T> extends ZodArray<infer TItem>
			? Unwrap<TItem> extends ZodObject<infer TShape, any> ? ObjectSelectAll<TShape, Depth[TDepth]> : true
			: true;
type ObjectSelectAll<TShape extends ZodRawShape, TDepth extends number> = { [K in keyof TShape]-?: FieldSelectAll<TShape[K], TDepth> };

interface SelectObject { [key: string]: SelectObject | true }

type SelectValue = SelectObject | true;

type Unwrap<T> = T extends ZodCatch<infer I> | ZodDefault<infer I> | ZodNullable<infer I> | ZodOptional<infer I>
	? Unwrap<I>
	: T extends ZodLazy<infer I> ? Unwrap<I> : T;

/** What {@link buildSelectObject} answers: nested for objects and arrays of objects, `true` for anything else. */
export type ZodSelectAll<T extends ZodType<object> | ZodUnion> = Unwrap<T> extends ZodObject<infer TShape, any>
	? ObjectSelectAll<TShape, 10>
	: { [K in keyof ZodSelect<T, true>]-?: true };

/**
 * Produces a runtime select-all object for the given Zod schema.
 *
 * Every scalar key is set to `true`. Nested object fields, and arrays of
 * objects, are recursively expanded into nested select objects. Other arrays
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

			if (isZodObject(fieldInner)) {
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
