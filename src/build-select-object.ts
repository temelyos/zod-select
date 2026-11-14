import { ZodArray, ZodCatch, ZodDefault, ZodIntersection, ZodLazy, ZodNonOptional, ZodNullable, ZodObject, ZodOptional, ZodPipe, ZodPrefault, ZodRawShape, ZodReadonly, ZodTransform, ZodType, ZodUnion } from 'zod';

import { mergeSelectValue, SelectValue } from './select-object.js';
import { ZodSelect } from './select.js';
import { getInnerType, isZodArray, isZodObject, isZodUnion, unwrapWrapper } from './utilities.js';

type Depth = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

type FieldSelectAll<T, TDepth extends number> = TDepth extends 0
	? true
	: Unwrap<T> extends ZodArray<infer TItem> ? ItemSelectAll<TItem, Depth[TDepth]> : ItemSelectAll<T, Depth[TDepth]>;

type ItemSelectAll<T, TDepth extends number> = Unwrap<T> extends ZodObject<infer TShape, any>
	? ObjectSelectAll<TShape, TDepth>
	: Unwrap<T> extends ZodUnion<infer TOptions>
		? [NotObject<TOptions[number]>] extends [never] ? VariantsSelectAll<TOptions[number], TDepth> : true
		: true;

/** Every key of every member of the union `T`. */
type KeysOfUnion<T> = T extends unknown ? keyof T : never;

/** Select-all objects merged as {@link buildSelectObject} merges them: a key `true` in any of them is `true`, objects merge by key. */
type MergeSelectAll<T> = [T] extends [never] ? never
	: true extends T ? true
		: { [K in KeysOfUnion<T>]-?: MergeSelectAll<T extends unknown ? K extends keyof T ? T[K] : never : never> };

type NotObject<T> = T extends unknown ? Unwrap<T> extends ZodObject<any, any> ? never : T : never;

type ObjectSelectAll<TShape extends ZodRawShape, TDepth extends number> = { [K in keyof TShape]-?: FieldSelectAll<TShape[K], TDepth> };

type Unwrap<T> = T extends ZodCatch<infer I> | ZodDefault<infer I> | ZodNonOptional<infer I> | ZodNullable<infer I> | ZodOptional<infer I> | ZodPrefault<infer I> | ZodReadonly<infer I>
	? Unwrap<I>
	: T extends ZodLazy<infer I> ? Unwrap<I>
		: T extends ZodPipe<any, infer O> ? O extends ZodTransform ? T : Unwrap<O>
			: T;

/** The select-all of each object variant in `T`, through intersections, merged. */
type VariantsSelectAll<T, TDepth extends number> = MergeSelectAll<
	T extends unknown
		? Unwrap<T> extends ZodObject<infer TShape, any> ? ObjectSelectAll<TShape, TDepth>
			: Unwrap<T> extends ZodIntersection<infer L, infer R> ? VariantsSelectAll<L | R, TDepth>
				: Unwrap<T> extends ZodUnion<infer TOptions> ? VariantsSelectAll<TOptions[number], TDepth>
					: never
		: never
>;

/** What {@link buildSelectObject} answers: nested for objects, unions of objects, and arrays of either; `true` for anything else. */
export type ZodSelectAll<T extends ZodType<object> | ZodUnion> = Unwrap<T> extends ZodObject<infer TShape, any>
	? ObjectSelectAll<TShape, 10>
	: Unwrap<T> extends ZodIntersection | ZodUnion
		? [VariantsSelectAll<T, 10>] extends [never] ? { [K in keyof ZodSelect<T, true>]-?: true } : VariantsSelectAll<T, 10>
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
 * For union schemas the result is the merged set of keys across all variants,
 * a key nested in one variant and plain in another selected whole.
 * Past the depth limit, a field is selected whole.
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
 * Unwraps optional/nullable/default/catch/readonly/pipe/lazy wrappers but NOT arrays.
 */
function unwrapField(schema: ZodType): ZodType {
	const unwrapped = unwrapWrapper(schema);

	if (unwrapped) {
		return unwrapField(unwrapped);
	}

	if (schema instanceof ZodLazy) {
		return unwrapField(schema.def.getter() as ZodType);
	}

	return schema;
}

const MAX_DEPTH = 10;

function collectKeys(schema: ZodType, result: Record<string, SelectValue>, depth = 0): void {
	schema = getInnerType(schema);

	if (isZodObject(schema)) {
		for (const key in schema.shape) {
			const field = unwrapField(schema.shape[key]);
			const fieldInner = isZodArray(field) ? unwrapField(field.def.element as ZodType) : field;
			let value: SelectValue = true;

			if ((depth < MAX_DEPTH) && (isZodObject(fieldInner) || isUnionOfObjects(fieldInner))) {
				const nested: Record<string, SelectValue> = {};
				collectKeys(fieldInner, nested, depth + 1);
				value = nested;
			}

			const existing = result[key];

			result[key] = (existing === undefined) ? value : mergeSelectValue(existing, value);
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
