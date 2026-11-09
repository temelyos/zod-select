import { z, ZodTuple, ZodType, ZodUnion } from 'zod';

import { RefinedTypeSchema, RefinedUnionSchema, RefineObject, RefineZodTuple, RefineZodUnion } from './refine-schema.js';
import { DeepMergeAll, IsAny, IsIndexKey, RequiredKeys } from './types.js';

type AnyFunction = (...args: never[]) => unknown;

/** The literal keys of every variant of `T`: an index signature's, template-literal ones included, are left out. */
type DeclaredKeys<T> = T extends unknown ? keyof { [K in keyof T as IsIndexKey<K> extends true ? never : K]: unknown } : never;

/** Whether a value of `TModel` could be read as the select variant `TSelected`: it has every key the select requires. */
type Fits<TSelected, TModel> = [Exclude<RequiredKeys<TSelected>, keyof TModel>] extends [never] ? true : false;

/** For each object variant of the select, whether it fits `TModel` (see {@link Fits}): `true` among them when any does. */
type FitsAny<TSelectedAll, TModel> = TSelectedAll extends readonly unknown[] ? false
	: TSelectedAll extends object ? [TSelectedAll & TModel] extends [never] ? false : Fits<TSelectedAll, TModel>
		: false;

/** The keys of `TSelected` holding a method; an `any` field holds none. */
type FunctionKeys<TSelected> = keyof {
	[K in keyof TSelected as IsAny<TSelected[K], never, [Extract<TSelected[K], AnyFunction>] extends [never] ? never : K>]: unknown
};

/** The select's literal keys that only an index signature of the model holds: a numeric one under a number signature too. */
type IndexOnlyKeys<TSelected, TModel> =
	Exclude<Extract<DeclaredKeys<TSelected>, keyof TModel | (number extends keyof TModel ? `${number}` : never)>, DeclaredKeys<TModel>>;

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
	U extends ZodType<object> | ZodUnion ? SchemaSelectType<T, U>

		// If T is a ZodUnion and U is a refined union shape
		: T extends ZodUnion
			? (U extends RefineZodUnion<T> ? z.infer<RefinedUnionSchema<T, U>> : z.infer<T>)

			// If U is a refined object shape
			: T extends ZodType<object>
				? (U extends RefineObject<z.infer<T>, false> ? z.infer<RefinedTypeSchema<z.infer<T>, U>> : z.infer<T>)

				// Default to inferring from T
				: z.infer<T>;

/** Whether an object is plain data: a copy of its fields is still one (a class instance with private members isn't). */
type IsPlainObject<T> = [{ [K in keyof T]: T[K] }] extends [T] ? true : false;

/** The elements of an array or tuple select, each read over the model's elements at its place. */
type KeepElementsOptional<TSelected, TModel, TElements = { [I in keyof TSelected]: KeepValue<TSelected[I], ModelElement<TModel, I>> }> =
	[TModel] extends [never] ? TSelected
		// Past the elements every model tuple has, the select's are optional
		: RequiredCount<TModel> extends RequiredCount<TSelected> ? TElements
			: TSelected extends unknown[] ? OptionalFrom<TElements, RequiredCount<TModel>>
				: Readonly<OptionalFrom<TElements, RequiredCount<TModel>>>;

/** The fields of an object select, a field the model may lack made optional. */
type KeepFieldsOptional<TSelected, TModel, TAbsent = MaybeAbsentKeys<TSelected, TModel>> =
	[TAbsent] extends [never] ? { [K in keyof TSelected]: KeepValue<TSelected[K], ModelField<TModel, K>> }
		: [Exclude<keyof TSelected, TAbsent>] extends [never] ? { [K in keyof TSelected]+?: KeepValue<TSelected[K], ModelField<TModel, K>> }
			// The keys and their modifiers come from the two halves; their values are read once, here
			: { [K in keyof (MaybeAbsentFields<TSelected, TAbsent> & PresentFields<TSelected, TAbsent>)]: KeepValue<K extends keyof TSelected ? TSelected[K] : never, ModelField<TModel, K>> };

/**
 * A schema select's value `TSelected`, read over the model's value `TModel`: the select's shape, never promising
 * more than the model has, at any depth: through objects, the elements of arrays and tuples, the values of maps and
 * sets, and union variants. A field the model may lack (optional, held only by an index signature, or missing from a
 * variant that could be read) is optional, and a value the model allows `undefined` for keeps it; an `any` model
 * allows nothing in particular. A field no variant of the model has is kept as the select has it, and so are
 * primitives, branded ones included, and objects that aren't plain data (with a method, or a class instance with
 * private members). Unbounded, a recursive schema included: each level's values are read lazily, and a recursion comes
 * back to arguments already instantiated. `TSelectedAll` is the whole select union, which each variant is paired within.
 */
type KeepModelOptional<TSelected, TModel, TSelectedAll = TSelected> =
	TSelected extends AnyFunction | bigint | boolean | null | number | string | symbol | undefined ? TSelected
		: IsAny<TModel, TSelected, KeepObjectOptional<TSelected, TModel, TSelectedAll>>;

/** {@link KeepModelOptional} for an array, a tuple, a map, a set or an object. */
type KeepObjectOptional<TSelected, TModel, TSelectedAll> =
	TSelected extends readonly unknown[] ? KeepElementsOptional<TSelected, Extract<TModel, readonly unknown[]>>
		: TSelected extends Map<infer K, infer V> ? Map<K, KeepValue<V, ModelMapValue<TModel>>>
			: TSelected extends Set<infer E> ? Set<KeepValue<E, ModelSetValue<TModel>>>
				: [FunctionKeys<TSelected>] extends [never]
					? IsPlainObject<TSelected> extends true
						? [ModelObjects<TModel>] extends [never] ? TSelected
							: KeepFieldsOptional<TSelected, VariantsFor<TSelected, ModelObjects<TModel>, TSelectedAll>>
						: TSelected
					: TSelected;

/** A field's or element's value over what the model holds there, inferred back out so that hovers show the value. */
type KeepValue<TValue, TModelValue> =
	[KeepModelOptional<TValue, Exclude<TModelValue, null | undefined>> | UndefinedIn<TModelValue>] extends [infer TResult] ? TResult : never;

/** The keys {@link KeepFieldsOptional} makes optional, with that modifier; their values are read there. */
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

/** What the element at `TIndex` holds in any array or tuple of `TModel`: past a tuple's fixed elements, its rest element. */
type ModelElement<TModel, TIndex> = TModel extends readonly unknown[]
	? number extends TIndex ? RestElement<TModel>
		: TIndex extends keyof TModel ? TModel[TIndex] : RestElement<TModel>
	: never;

/** What the field `TKey` holds in any variant of `TModel` that has it. */
type ModelField<TModel, TKey> = TModel extends unknown ? TKey extends keyof TModel ? TModel[TKey] : never : never;

type ModelMapValue<TModel> = TModel extends ReadonlyMap<unknown, infer V> ? V : never;

/** The object variants of `TModel` a select object reads over: neither arrays nor functions. */
type ModelObjects<TModel> = TModel extends AnyFunction | readonly unknown[] ? never : TModel extends object ? TModel : never;

type ModelSetValue<TModel> = TModel extends ReadonlySet<infer E> ? E : never;

export type MultiSelect<T extends ZodType<object> | ZodUnion> =
	[ZodSelect<T>, ...ZodSelect<T>[]] | undefined | ZodSelect<T>;

/** `T` with every element from `TIndex` on optional. */
type OptionalFrom<T, TIndex extends number, TTaken extends unknown[] = []> =
	T extends readonly unknown[]
		? TTaken['length'] extends TIndex ? [...TTaken, ...Partial<[...T]>]
			: T extends readonly [infer THead, ...infer TRest] ? OptionalFrom<TRest, TIndex, [...TTaken, THead]>
				: [...TTaken, ...T]
		: T;

/**
 * The variants of `TModel` a select variant may be the read of, as {@link VariantsFor} pairs them: those no discriminant
 * rules out that have every key it requires, and those no select variant fits, which it may be read from all the same.
 */
type PairedVariants<TSelected, TModel, TSelectedAll> = TModel extends unknown
	? [TSelected & TModel] extends [never] ? never
		: Fits<TSelected, TModel> extends true ? TModel
			: true extends FitsAny<TSelectedAll, TModel> ? never : TModel
	: never;

/** The keys {@link KeepFieldsOptional} keeps as the select has them, with the select's modifiers. */
type PresentFields<TSelected, TAbsent> = { [K in keyof TSelected as K extends TAbsent ? never : K]: unknown };

/** How many leading elements every array or tuple of `T` has: `0` for an array. */
type RequiredCount<T, TCount extends unknown[] = []> =
	[T] extends [readonly [unknown, ...unknown[]]] ? RequiredCount<T extends readonly [unknown, ...infer TRest] ? TRest : never, [...TCount, 0]> : TCount['length'];

/** The element past a tuple's fixed ones, or any element of one without a rest. */
type RestElement<T extends readonly unknown[]> = TupleRest<T> extends readonly [] ? T[number] : TupleRest<T>[number];

/**
 * A schema select's result over `T`. Distributed over both, so that in generic code, where they are type parameters,
 * the compiler reads it over their constraints rather than leaving its fields unknown.
 */
type SchemaSelectType<T, U> = T extends unknown ? U extends unknown ? KeepModelOptional<z.infer<U>, z.infer<T>> : never : never;

/** What follows a tuple's fixed elements: its rest array, or `[]`. */
type TupleRest<T> = T extends readonly [unknown, ...infer TRest] ? TupleRest<TRest>
	: T extends readonly [unknown?, ...infer TRest] ? T extends TRest ? T : TupleRest<TRest>
		: T;

/**
 * `undefined` when the model allows it: a `z.unknown()` or `z.custom()` value may be `undefined`, so it is kept;
 * an `any` one tells nothing, so it adds nothing.
 */
type UndefinedIn<T> = IsAny<T, never, undefined extends T ? undefined : never>;

/** Per variant of `TModel`: the literal keys of any variant it doesn't have required, and the select's keys only its index signature holds. */
type VariantAbsentKeys<TSelected, TModel, TDeclared> = TModel extends unknown
	? Exclude<TDeclared, RequiredKeys<TModel>> | IndexOnlyKeys<TSelected, TModel>
	: never;

/** The variants of `TModel` a select variant could be read from, or every one when none is paired with it. */
type VariantsFor<TSelected, TModel, TSelectedAll> = [PairedVariants<TSelected, TModel, TSelectedAll>] extends [never] ? TModel : PairedVariants<TSelected, TModel, TSelectedAll>;

export type ZodSelect<
	T extends ZodTuple | ZodType<object> | ZodUnion, TIsSimple extends boolean = false
> = (
	T extends ZodUnion ? (RefineZodUnion<T> | (TIsSimple extends true ? never : ZodUnion))
		: T extends ZodTuple ? (RefineZodTuple<T> | (TIsSimple extends true ? never : ZodTuple))
			: T extends ZodType<object> ? (RefineObject<z.infer<T>, TIsSimple> | (TIsSimple extends true ? never : ZodType<object>))
				: never
);
