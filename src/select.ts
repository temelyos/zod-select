import { z, ZodTuple, ZodType, ZodUnion } from 'zod';

import { RefinedTypeSchema, RefinedUnionSchema, RefineObject, RefineZodTuple, RefineZodUnion } from './refine-schema.js';
import { DeepMergeAll } from './types.js';

export type InferMergedType<
	T extends ZodType<object> | ZodUnion,
	U extends readonly ZodSelect<T>[] | undefined | ZodSelect<T>
> = U extends undefined ? z.infer<T>
	: U extends readonly ZodSelect<T>[] ? DeepMergeAll<InferTuple<T, U>> // Ensure it's a tuple, not an indexed object
		: U extends ZodSelect<T> ? InferType<T, U>
			: never;

// Ensure U is treated as a tuple rather than an indexed object
type InferTuple<
	T extends ZodType<object> | ZodUnion,
	U extends readonly ZodSelect<T>[]
> = { [K in keyof U]: InferType<T, U[K]> };

export type InferType<
	T extends ZodType<object> | ZodUnion,
	U extends ZodSelect<T>
> =
	// If U is a ZodObject, infer directly from U
	U extends ZodType<object> ? z.infer<U>

		// If U is a ZodUnion, infer directly from U
		: U extends ZodUnion ? z.infer<U>

			// If T is a ZodUnion and U is a refined union shape
			: T extends ZodUnion
				? (U extends RefineZodUnion<T> ? z.infer<RefinedUnionSchema<T, U>> : z.infer<T>)

				// If U is a refined object shape
				: T extends ZodType<object>
					? (U extends RefineObject<z.infer<T>, false> ? z.infer<RefinedTypeSchema<z.infer<T>, U>> : z.infer<T>)

					// Default to inferring from T
					: z.infer<T>;

export type MergeSelect<
	T extends ZodType<object> | ZodUnion,
	TSelect1 extends ZodSelect<T>,
	TSelect2 extends MultiSelect<T>
> =
	TSelect2 extends undefined
		// [defined, undefined]
		? [TSelect1, T]
		: TSelect2 extends [ZodSelect<T>, ...ZodSelect<T>[]]
			// [defined, [defined]]
			? [TSelect1, ...TSelect2]
			// [defined, defined], the schema itself included
			: [TSelect1, TSelect2];

export type MultiSelect<T extends ZodType<object> | ZodUnion> =
	[ZodSelect<T>, ...ZodSelect<T>[]] | undefined | ZodSelect<T>;

export type ZodSelect<
	T extends ZodTuple | ZodType<object> | ZodUnion, TIsSimple extends boolean = false
> = (
	T extends ZodUnion ? (RefineZodUnion<T> | (TIsSimple extends true ? never : ZodUnion))
		: T extends ZodTuple ? (RefineZodTuple<T> | (TIsSimple extends true ? never : ZodTuple))
			: T extends ZodType<object> ? (RefineObject<z.infer<T>, TIsSimple> | (TIsSimple extends true ? never : ZodType<object>))
				: never
);
