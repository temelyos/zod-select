import { z, ZodTuple, ZodType, ZodUnion } from 'zod';

import { RefinedTypeSchema, RefinedUnionSchema, RefineObject, RefineZodTuple, RefineZodUnion } from './refine-schema.js';
import { DeepMergeAll, IsAny } from './types.js';

type Flatten<T> = { [K in keyof T]: T[K] };

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
	// A schema select reads as its own shape, but can't promise a field `T` has optional
	U extends ZodType<object> ? KeepModelOptional<z.infer<U>, z.infer<T>>
		: U extends ZodUnion ? KeepModelOptional<z.infer<U>, z.infer<T>>

			// If T is a ZodUnion and U is a refined union shape
			: T extends ZodUnion
				? (U extends RefineZodUnion<T> ? z.infer<RefinedUnionSchema<T, U>> : z.infer<T>)

				// If U is a refined object shape
				: T extends ZodType<object>
					? (U extends RefineObject<z.infer<T>, false> ? z.infer<RefinedTypeSchema<z.infer<T>, U>> : z.infer<T>)

					// Default to inferring from T
					: z.infer<T>;

type KeepFieldsOptional<TSelected, TModel, TDepth extends unknown[]> = Flatten<
	{ [K in keyof TSelected as K extends OptionalKeys<TModel> ? K : never]?: KeepModelOptional<TSelected[K], ModelField<TModel, K>, TDepth> | undefined }
	& { [K in keyof TSelected as K extends OptionalKeys<TModel> ? never : K]: KeepModelOptional<TSelected[K], ModelField<TModel, K>, TDepth> }
>;

/**
 * A schema select's value `TSelected`, with every field the model `TModel` has optional kept optional, at any
 * depth: through nested objects, arrays' elements and union variants. A field `TModel` lacks is kept as the
 * select says. When the model is assignable to the select's value, the select promises nothing more and is
 * returned as is, so a sound select costs one check.
 */
type KeepModelOptional<TSelected, TModel, TDepth extends unknown[] = []> =
	IsAny<TModel, TSelected,
		[TModel] extends [TSelected] ? TSelected
			: TDepth['length'] extends 10 ? TSelected
				: KeepVariantOptional<TSelected, TModel, TDepth>
	>;

type KeepVariantOptional<TSelected, TModel, TDepth extends unknown[]> =
	TSelected extends ((...args: never[]) => unknown) | Date | Promise<unknown> | ReadonlyMap<unknown, unknown> | ReadonlySet<unknown> | RegExp ? TSelected
		: TSelected extends readonly (infer TElement)[]
			// A tuple is kept whole: its elements have no counterpart to pair with an array's
			? number extends TSelected['length']
				? TSelected extends unknown[]
					? KeepModelOptional<TElement, ModelElements<TModel>, [...TDepth, 0]>[]
					: readonly KeepModelOptional<TElement, ModelElements<TModel>, [...TDepth, 0]>[]
				: TSelected
			: TSelected extends object
				? [ModelObjects<TModel>] extends [never] ? TSelected
					: KeepFieldsOptional<TSelected, MatchingVariants<TSelected, ModelObjects<TModel>>, [...TDepth, 0]>
				: TSelected;

type MatchedVariants<TSelected, TModel> = TModel extends unknown ? [TSelected & TModel] extends [never] ? never : TModel : never;

/** The variants of `TModel` a select variant can read: those its discriminants don't rule out, or every one when none fits. */
type MatchingVariants<TSelected, TModel> = [MatchedVariants<TSelected, TModel>] extends [never] ? TModel : MatchedVariants<TSelected, TModel>;

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

type ModelElements<TModel> = TModel extends readonly (infer TElement)[] ? Exclude<TElement, null | undefined> : never;

/** What the field `TKey` holds in any variant of `TModel` that has it. */
type ModelField<TModel, TKey> = TModel extends unknown ? TKey extends keyof TModel ? Exclude<TModel[TKey], null | undefined> : never : never;

type ModelObjects<TModel> = TModel extends ((...args: never[]) => unknown) | Date | readonly unknown[] ? never : TModel extends object ? TModel : never;

export type MultiSelect<T extends ZodType<object> | ZodUnion> =
	[ZodSelect<T>, ...ZodSelect<T>[]] | undefined | ZodSelect<T>;

/** The declared keys any variant of `TModel` has optional; an index signature's are left out. */
type OptionalKeys<TModel> = TModel extends unknown
	? keyof { [K in keyof TModel as string extends K ? never : number extends K ? never : symbol extends K ? never : Partial<Pick<TModel, K>> extends Pick<TModel, K> ? K : never]: unknown }
	: never;

export type ZodSelect<
	T extends ZodTuple | ZodType<object> | ZodUnion, TIsSimple extends boolean = false
> = (
	T extends ZodUnion ? (RefineZodUnion<T> | (TIsSimple extends true ? never : ZodUnion))
		: T extends ZodTuple ? (RefineZodTuple<T> | (TIsSimple extends true ? never : ZodTuple))
			: T extends ZodType<object> ? (RefineObject<z.infer<T>, TIsSimple> | (TIsSimple extends true ? never : ZodType<object>))
				: never
);
