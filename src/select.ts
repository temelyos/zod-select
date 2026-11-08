import { z, ZodTuple, ZodType, ZodUnion } from 'zod';

import { RefinedTypeSchema, RefinedUnionSchema, RefineObject, RefineZodTuple, RefineZodUnion } from './refine-schema.js';
import { DeepMergeAll, IsAny } from './types.js';

/** The declared keys of every variant of `TModel`; an index signature's are left out. */
type DeclaredKeys<TModel> = TModel extends unknown ? { [K in keyof TModel]-?: string extends K ? never : number extends K ? never : symbol extends K ? never : K }[keyof TModel] : never;

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
	// A schema select reads as its own shape, but can't promise more than `T` has
	U extends ZodType<object> | ZodUnion ? KeepModelOptional<z.infer<U>, z.infer<T>>

		// If T is a ZodUnion and U is a refined union shape
		: T extends ZodUnion
			? (U extends RefineZodUnion<T> ? z.infer<RefinedUnionSchema<T, U>> : z.infer<T>)

			// If U is a refined object shape
			: T extends ZodType<object>
				? (U extends RefineObject<z.infer<T>, false> ? z.infer<RefinedTypeSchema<z.infer<T>, U>> : z.infer<T>)

				// Default to inferring from T
				: z.infer<T>;

/** The elements of an array or tuple select, each read over the model's elements at its place. */
type KeepElementsOptional<TSelected, TModel> =
	[TModel] extends [never] ? TSelected
		: { [I in keyof TSelected]: KeepValue<TSelected[I], ModelElement<TModel, I>> };

/** The fields of an object select, a field the model may lack made optional. */
type KeepFieldsOptional<TSelected, TModel, TAbsent = MaybeAbsentKeys<TSelected, TModel>> =
	[TAbsent] extends [never] ? { [K in keyof TSelected]: KeepValue<TSelected[K], ModelField<TModel, K>> }
		: [Exclude<keyof TSelected, TAbsent>] extends [never] ? { [K in keyof TSelected]+?: KeepValue<TSelected[K], ModelField<TModel, K>> }
			// The keys and their modifiers come from the two halves; their values are read once, here
			: { [K in keyof (MaybeAbsentFields<TSelected, TAbsent> & PresentFields<TSelected, TAbsent>)]: KeepValue<K extends keyof TSelected ? TSelected[K] : never, ModelField<TModel, K>> };

/**
 * A schema select's value `TSelected`, read over the model's value `TModel`: the select's shape, never promising
 * more than the model has. A field the model may lack (optional, behind an index signature, or missing from a
 * variant that could be read) is optional, and one whose value the model allows `undefined` keeps it, at any depth:
 * through objects, the elements of arrays and tuples, and union variants. A field no variant of the model has is
 * kept as the select has it. Unbounded, a recursive schema included: each level's values are read lazily, and a
 * recursion comes back to arguments already instantiated.
 */
type KeepModelOptional<TSelected, TModel> =
	TSelected extends ((...args: never[]) => unknown) | bigint | boolean | null | number | string | symbol | undefined ? TSelected
		: IsAny<TModel, TSelected, KeepObjectOptional<TSelected, TModel>>;

/** {@link KeepModelOptional} for an array, a tuple or an object. */
type KeepObjectOptional<TSelected, TModel> =
	TSelected extends readonly unknown[] ? KeepElementsOptional<TSelected, Extract<TModel, readonly unknown[]>>
		// An object with methods (a Date, a Map, a class instance) is kept whole: its fields aren't data to pair
		: TSelected extends object
			? [Extract<TSelected[keyof TSelected], (...args: never[]) => unknown>] extends [never]
				? [ModelObjects<TModel>] extends [never] ? TSelected
					: KeepFieldsOptional<TSelected, VariantsFor<TSelected, ModelObjects<TModel>>>
				: TSelected
			: TSelected;

/** A field's or element's value over what the model holds there, inferred back out so that hovers show the value. */
type KeepValue<TValue, TModelValue> =
	[KeepModelOptional<TValue, Exclude<TModelValue, null | undefined>> | UndefinedIn<TModelValue>] extends [infer TResult] ? TResult : never;

/** Each key of `T` as its own value, with `T`'s modifiers: an optional key reads as possibly `undefined`. */
type KeyMap<T> = { [K in keyof T]: K };

type MaybeAbsentFields<TSelected, TAbsent> = { [K in keyof TSelected as K extends TAbsent ? K : never]?: unknown };

/** The keys of `TSelected` that a variant of `TModel` may lack, of those some variant has. */
type MaybeAbsentKeys<TSelected, TModel> = Extract<keyof TSelected, VariantAbsentKeys<TSelected, TModel, DeclaredKeys<TModel>>>;

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

/** What the element at `TIndex` holds in any array or tuple of `TModel`. */
type ModelElement<TModel, TIndex> = TModel extends readonly unknown[] ? TIndex extends keyof TModel ? TModel[TIndex] : TModel[number] : never;

/** What the field `TKey` holds in any variant of `TModel` that has it. */
type ModelField<TModel, TKey> = TModel extends unknown ? TKey extends keyof TModel ? TModel[TKey] : never : never;

type ModelObjects<TModel> = TModel extends ((...args: never[]) => unknown) | readonly unknown[] ? never : TModel extends object ? TModel : never;

export type MultiSelect<T extends ZodType<object> | ZodUnion> =
	[ZodSelect<T>, ...ZodSelect<T>[]] | undefined | ZodSelect<T>;

/** Variants that may be read as {@link VariantsFor} pairs them, the rest ruled out by a discriminant. */
type PairedVariants<TSelected, TModel> = TModel extends unknown ? [TSelected & TModel] extends [never] ? never : TModel : never;

type PresentFields<TSelected, TAbsent> = { [K in keyof TSelected as K extends TAbsent ? never : K]: unknown };

/** The declared keys `TModel` has required; an index signature's are left out. */
type RequiredKeys<TModel> = {
	[K in keyof TModel]-?: string extends K ? never : number extends K ? never : symbol extends K ? never : undefined extends KeyMap<TModel>[K] ? never : K
}[keyof TModel];

/** `undefined` when the model allows it; an `any` model allows nothing in particular. */
type UndefinedIn<T> = IsAny<T, never, undefined extends T ? undefined : never>;

/** Per variant of `TModel`: the declared keys of any variant it doesn't have required, and the keys of `TSelected` only its index signature holds. */
type VariantAbsentKeys<TSelected, TModel, TDeclared> = TModel extends unknown
	? Exclude<TDeclared, RequiredKeys<TModel>> | (string extends keyof TModel ? Exclude<keyof TSelected, DeclaredKeys<TModel>> : never)
	: never;

/** The variants of `TModel` a select variant could be read from: those its discriminants allow, or every one when none does. */
type VariantsFor<TSelected, TModel> = [PairedVariants<TSelected, TModel>] extends [never] ? TModel : PairedVariants<TSelected, TModel>;

export type ZodSelect<
	T extends ZodTuple | ZodType<object> | ZodUnion, TIsSimple extends boolean = false
> = (
	T extends ZodUnion ? (RefineZodUnion<T> | (TIsSimple extends true ? never : ZodUnion))
		: T extends ZodTuple ? (RefineZodTuple<T> | (TIsSimple extends true ? never : ZodTuple))
			: T extends ZodType<object> ? (RefineObject<z.infer<T>, TIsSimple> | (TIsSimple extends true ? never : ZodType<object>))
				: never
);
