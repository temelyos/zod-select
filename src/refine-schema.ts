import { core, z, ZodAny, ZodArray, ZodBoolean, ZodDate, ZodLiteral, ZodNever, ZodNullable, ZodNumber, ZodObject, ZodOptional, ZodRawShape, ZodString, ZodTuple, ZodType, ZodUnion, ZodUnknown } from 'zod';

import { IsAny, IsJsonType, Mutable } from './types.js';
import { getInnerType, isZodArray, isZodNullable, isZodObject, isZodOptional, isZodType, isZodUnion } from './utilities.js';

type ApplyOptionalNullable<T, U extends ZodType> =
	IsAny<
		T,
		U,
		// `unknown` already admits null/undefined; wrapping it would make a required key optional.
		unknown extends T ? U
			: undefined extends T
				? null extends T
					? ZodOptional<ZodNullable<U>>
					: ZodOptional<U>
				: null extends T ? ZodNullable<U>
					: U
	>;

type DepthLimit = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// Recursive type to map a TypeScript type to a Zod schema
type InternalZodify<T, TDepth extends number = 0> =
	TDepth extends 9 ? ZodType
		: IsAny<
			T,
			ZodAny,

			T extends string
				? string extends T ? ZodString : ZodLiteral<T>
				: T extends number ? number extends T ? ZodNumber : ZodLiteral<T>
					: T extends boolean ? boolean extends T ? ZodBoolean : ZodLiteral<T>
						: T extends Date ? ZodDate
							: unknown extends T ? ZodUnknown
								: T extends Array<infer U> ? ZodArray<Zodify<U, NextDepth<TDepth>>>
									: T extends object
										? IsJsonType<
											T,
											true,
											ZodObject<{ [K in keyof T]-?: Zodify<T[K], NextDepth<TDepth>> }, core.$strict>,
											ZodType<T>
										>
										: never
		>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type IsTuple<T, TTrue = true, TFalse = false> = T extends [infer TFirst, infer TSecond, ...infer TRest] ? TTrue : TFalse;

type LastOf<T> =
	UnionToIntersection<T extends any ? () => T : never> extends () => (infer R) ? R : never;

type NextDepth<T extends number> =
	T extends 0 ? 1
		: T extends 1 ? 2
			: T extends 2 ? 3
				: T extends 3 ? 4
					: T extends 4 ? 5
						: T extends 5 ? 6
							: T extends 6 ? 7
								: T extends 7 ? 8
									: T extends 8 ? 9
										: 9;

type Push<T extends any[], V> = [...T, V];

// Helper to reapply optional and nullable wrappers
type ReapplyOptionalNullable<T, U extends z.ZodType> =
	T extends ZodOptional<ZodNullable<ZodType>>
		? ZodOptional<ZodNullable<U>>
		: T extends ZodNullable<ZodOptional<ZodType>>
			? ZodNullable<ZodOptional<U>>
			: T extends ZodOptional<ZodType>
				? ZodOptional<U>
				: T extends ZodNullable<ZodType>
					? ZodNullable<U>
					: U;

export type RefinedSchema<
	T extends ZodType<object> | ZodUnion,
	TShape extends RefineSchema<T, TIsSimple>,
	TIsSimple extends boolean
> = T extends ZodUnion ? RefinedUnionSchema<T, TShape>
	: T extends ZodType<object> ? RefinedTypeSchema<z.infer<T>, TShape>
		: never;

export type RefinedTypeSchema<T extends object, TShape, TDepth extends number = 0> =
	TDepth extends keyof DepthLimit
		? ZodObject<{
			[K in keyof T & keyof TShape]:
			// Use the result of the refinement function
			TShape[K] extends (schema: infer S) => ZodType ? ReturnType<TShape[K]>

				// Use the redefined ZodType if provided
				: TShape[K] extends ZodType ? TShape[K]

					// Keep the original type
					: TShape[K] extends boolean ? ZodifyField<T, K>

						: TShape[K] extends object
						// Handle array of nested objects
							? Exclude<T[K], null | undefined> extends Array<infer U>
								? [Extract<U, object>] extends [never]
									? Zodify<T[K]>
									: ApplyOptionalNullable<T[K], z.ZodArray<RefinedVariants<Extract<U, object>, TShape[K], NextDepth<TDepth>>>>

								// A nested select reads the object variants, of a union with a plain one too
								: [Extract<Exclude<T[K], null | undefined>, object>] extends [never]
									? ZodNever
									: ApplyOptionalNullable<T[K], RefinedVariants<Extract<Exclude<T[K], null | undefined>, object>, TShape[K], NextDepth<TDepth>>>
							: ZodNever;
		}, core.$strict> : any;

export type RefinedUnionSchema<T extends ZodUnion, TShape> = ZodUnion<
	T['options'] extends Readonly<[infer A, ...infer Rest]>
		? Rest extends ZodType[]
			? [ReapplyOptionalNullable<
				A,
				A extends ZodType<object>
					? RefinedTypeSchema<z.infer<A>, TShape>
					: Extract<A, ZodType>
			>,
			...{
				[K in keyof Rest]: Rest[K] extends ZodType
					? z.infer<Rest[K]> extends object
						? RefinedTypeSchema<z.infer<Rest[K]>, TShape>
						: Extract<Rest[K], ZodType>
					: Extract<Rest[K], ZodType>;
			}
			]
			: never
		: never
>;

/** One refined schema per variant of a union of objects (a plain object is its own one variant), so the result narrows by variant. */
type RefinedVariants<T, TShape, TDepth extends number> = T extends object ? RefinedTypeSchema<T, TShape, TDepth> : never;

type Refinement<T extends ZodType, TIsSimple extends boolean> =
	TIsSimple extends true ? boolean
		: ((schema: T) => ZodType) | boolean | ZodType;

// Recursive type to define shape of fields to pick, redefine, or refine.
//
// The `as` clause strips index-signature keys (a `z.looseObject` carries a
// `[k: string]: unknown` catchall). Without it `keyof T` collapses to `string | number`
// and every declared field's value type would come from the catchall (`unknown` ->
// scalar `boolean`), so declared sub-objects could not be drilled into. Filtering inside
// `[K in keyof T as ...]` keeps the mapped type homomorphic, so it still distributes over
// unions (e.g. drilling into a union-of-objects array element). For a plain object with
// no index signature this is just `keyof T`.
export type RefineObject<T extends object, TIsSimple extends boolean> = {
	[K in keyof T as string extends K ? never : number extends K ? never : symbol extends K ? never : K]?: RefineType<T[K], TIsSimple>
};

export type RefineSchema<
	T extends ZodType<object> | ZodUnion, TIsSimple extends boolean
> = T extends ZodUnion
	? RefineZodUnion<T>
	: T extends ZodType<object>
		? RefineObject<z.infer<T>, TIsSimple>
		: never;

type RefineType<T, TIsSimple extends boolean> =
	IsTuple<
		TuplifyUnion<Exclude<T, null | undefined>>,

		// A union's object variants can be selected into, variant by variant: an effect read by kind,
		// or a joined id read as its record. Selecting into a union with a plain variant misses it.
		([Extract<Exclude<T, null | undefined>, object>] extends [never] ? never : RefineObject<Extract<Exclude<T, null | undefined>, object>, TIsSimple>)
		| Refinement<Zodify<T>, TIsSimple>,

		Exclude<T, null | undefined> extends string ? Refinement<ApplyOptionalNullable<T, ZodString>, TIsSimple>
			: Exclude<T, null | undefined> extends number ? Refinement<ApplyOptionalNullable<T, ZodNumber>, TIsSimple>
				: Exclude<T, null | undefined> extends boolean ? Refinement<ApplyOptionalNullable<T, ZodBoolean>, TIsSimple>
					: Exclude<T, null | undefined> extends Date ? Refinement<ApplyOptionalNullable<T, ZodDate>, TIsSimple>
						: Exclude<T, null | undefined> extends Array<infer U>
							? [Extract<U, object>] extends [never]
								? Refinement<Zodify<T>, TIsSimple>
								: Refinement<Zodify<T>, TIsSimple> | RefineObject<Extract<U, object>, TIsSimple>
							: Exclude<T, null | undefined> extends object
								? IsJsonType<
									Exclude<T, null | undefined>,
									false,
									Refinement<Zodify<T>, TIsSimple> | RefineObject<Extract<T, object>, TIsSimple>,
									Refinement<Zodify<T>, TIsSimple>
								>
								: unknown extends Exclude<T, null | undefined>
									? Refinement<Zodify<T>, TIsSimple>
									: never
	>;

export type RefineZodTuple<T extends ZodTuple> =
	{
		[K in keyof UnionToIntersection<
			T['def']['items'][number] extends ZodObject<infer Shape extends ZodRawShape> ? Shape : object
		>]?: boolean;
	};

export type RefineZodUnion<T extends ZodUnion> =
	{
		[K in keyof UnionMergedShape<T>]?: UnionMergedShape<T>[K] extends ZodType
			? UnionFieldType<UnionMergedShape<T>[K]>
			: boolean;
	};

// Because Zod handles undefined and nulls as type wrappers instead of unions this type does
// not handle null and undefined types. They must be stripped out before using this type.
//
// The depth cap spends one level per union MEMBER, so members past nine are dropped. Pure
// string-literal unions (enums) bypass this via the ZodLiteral shortcut in Zodify; the cap
// cannot simply be removed — unbounded recursion trips TS2589 in generic contexts.
// eslint-disable-next-line @typescript-eslint/naming-convention
export type TuplifyUnion<T, TDepth extends number = 0, L = LastOf<T>, N = [T] extends [never] ? true : false> =
	TDepth extends 9 ? [] // Stop recursion at depth 9
		: true extends N ? []
			: Push<TuplifyUnion<Exclude<T, L>, NextDepth<TDepth>>, InternalZodify<L>>;

type UnionFieldType<T extends ZodType> =
	Exclude<z.infer<T>, null | undefined> extends Array<infer U>
		? Exclude<U, null | undefined> extends object
			? boolean | RefineObject<Extract<U, object>, true>
			: boolean
		: Exclude<z.infer<T>, null | undefined> extends object
			? boolean | RefineObject<Exclude<z.infer<T>, null | undefined>, true>
			: boolean;

type UnionMergedShape<T extends ZodUnion> = UnionToIntersection<
	T['options'][number] extends ZodObject<infer Shape extends ZodRawShape> ? Shape : object
>;

export type UnionToIntersection<U> =
	(U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

export type Zodify<T, TDepth extends number = 0> =
	ApplyOptionalNullable<T,
		IsAny<
			T,
			ZodAny,

			ZodifyLiteral<
				Exclude<T, null | undefined>,
				IsTuple<
					TuplifyUnion<Exclude<T, null | undefined>, TDepth>,
					ZodUnion<TuplifyUnion<Exclude<T, null | undefined>, TDepth>>,
					InternalZodify<Exclude<T, null | undefined>, TDepth>
				>
			>
		>
	>;

// Zodify a field, keeping an optional `unknown`/`any` key optional: those types already
// admit undefined, so the key's optionality can't be read from the value type.
type ZodifyField<T, TKey extends keyof T> =
	unknown extends T[TKey]
		? Partial<Pick<T, TKey>> extends Pick<T, TKey> ? ZodOptional<Zodify<T[TKey]>> : Zodify<T[TKey]>
		: Zodify<T[TKey]>;

// A union of string/number/boolean literals becomes one multi-value ZodLiteral. Routing it
// through TuplifyUnion instead would spend one recursion level per option (silently
// dropping options past the depth cap: a 12-option enum kept only 9) and widen each
// number/boolean literal. Wide `string`/`number`/`boolean` keep their plain schema;
// anything else (objects, mixed wide unions) falls through to TElse.
type ZodifyLiteral<T, TElse> =
	[T] extends [boolean | number | string]
		? [T] extends [boolean] ? boolean extends T ? ZodBoolean : ZodLiteral<T>
			: string extends T ? [T] extends [string] ? ZodString : TElse
				: number extends T ? [T] extends [number] ? ZodNumber : TElse
					: ZodLiteral<T>
		: TElse;

// Main function to refine the schema
export function refineSchema<
	T extends ZodType<object> | ZodUnion,
	TShape extends RefineSchema<T, false>
>(
	schema: T,
	shape: TShape
): RefinedSchema<T, TShape, false> {
	if (isZodObject(schema)) {
		const refinedShape: Mutable<ZodRawShape> = {};
		const schemaShape = schema.shape;

		for (const key in shape) {
			if (key in schemaShape && shape[key] !== false) {
				refinedShape[key] = refineSchemaField(schemaShape[key], shape[key]);
			}
		}

		return z.object(refinedShape) as RefinedSchema<T, TShape, false>;
	} else if (isZodUnion(schema)) {
		const refinedOptions = schema.options.map(option => refineSchemaField(option, shape));

		return z.union(refinedOptions as any) as RefinedSchema<T, TShape, false>;
	}

	throw new Error('Unsupported schema type for refinement');
}

// Helper function to refine a single schema field
function refineSchemaField<T extends ZodType, TShape>(fieldSchema: T, fieldShape: TShape): ZodType {
	if (fieldShape === true) {
		return fieldSchema; // Keep original type
	} else if (typeof fieldShape === 'function') {
		return fieldShape(fieldSchema); // Apply refinement function
	} else if (isZodType(fieldShape)) {
		return fieldShape; // Use redefined type
	} else if (isZodObject(fieldSchema)) {
		return refineSchema(fieldSchema, fieldShape as any); // Recursively refine nested objects
	} else if (isZodUnion(fieldSchema)) {
		return refineSchema(fieldSchema, fieldShape as any);
	} else if (isZodArray(fieldSchema)) {
		// Recursively refine array items
		return z.array(
			refineSchemaField(fieldSchema.element, fieldShape)
		);
	} else if (isZodOptional(fieldSchema)) {
		return refineSchemaField(fieldSchema.def.innerType, fieldShape).optional();
	} else if (isZodNullable(fieldSchema)) {
		return refineSchemaField(fieldSchema.def.innerType, fieldShape).nullable();
	} else {
		const innerType = getInnerType(fieldSchema);

		// There are wrapper types we can't forward because the underlying object structures are changing.
		if (innerType !== fieldSchema) {
			return refineSchemaField(innerType, fieldShape);
		}
	}

	return fieldSchema;
}
