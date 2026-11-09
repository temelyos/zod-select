/**
 * `U` merged into `T`, as types: keys in both merge deeply when both sides are objects, and by their elements when
 * both are arrays, kept `null` or `undefined` where a side may be; otherwise they widen to `T[K] | U[K]`. A key is
 * optional when it is optional on every side that has it: one side's required key is there whatever the other says.
 */
export type DeepMerge<T, U> = DeepMergeFields<T, U, Exclude<OptionalKeys<T> | OptionalKeys<U>, RequiredKeys<T> | RequiredKeys<U>>>;

export type DeepMergeAll<T> = T extends readonly any[]
	? T extends [infer First, ...infer Rest]
		? Rest extends []
			? First
			: DeepMerge<First, DeepMergeAll<Rest>>
		: unknown
	: T;

type DeepMergeField<T, U, TKey> = TKey extends keyof T
	? TKey extends keyof U
		? DeepMergeValue<T[TKey], U[TKey]>
		: T[TKey]
	: TKey extends keyof U
		? U[TKey]
		: never;

// The keys and their modifiers come from the two halves; their values are read once, here
type DeepMergeFields<T, U, TOptional> = [TOptional] extends [never]
	? { [K in keyof T | keyof U]: DeepMergeField<T, U, K> }
	: { [K in keyof (MergedOptionalKeys<T, U, TOptional> & MergedRequiredKeys<T, U, TOptional>)]: DeepMergeField<T, U, K> };

type DeepMergeValue<T, U> = [NonNullable<T>, NonNullable<U>] extends [infer A, infer B]
	? [A] extends [never] ? T | U
		: [B] extends [never] ? T | U
			: [Extract<A | B, ((...args: never[]) => unknown) | Date>] extends [never]
				? [A, B] extends [readonly (infer AItem)[], readonly (infer BItem)[]]
					? DeepMergeValue<AItem, BItem>[] | Extract<T | U, null | undefined>
					: [A, B] extends [object, object]
						? [Extract<A | B, readonly unknown[]>] extends [never] ? DeepMerge<A, B> | Extract<T | U, null | undefined> : T | U
						: T | U
				: T | U
	: never;

export type IsAny<T, TTrue = true, TFalse = false> = 0 extends (1 & T) ? TTrue : TFalse;

export type IsEqual<T, U, TTrue = true, TFalse = false> =
	(<V>() => V extends T ? 1 : 2) extends
	(<V>() => V extends U ? 1 : 2) ? TTrue : TFalse;

/** Whether `TKey` names an index signature rather than one property: `string`, `number`, `symbol` or a template literal. */
export type IsIndexKey<TKey> = string extends TKey ? true : number extends TKey ? true : symbol extends TKey ? true
	: TKey extends string ? Partial<Record<TKey, unknown>> extends Record<TKey, unknown> ? true : false
		: false;

export type IsJsonType<T, TDeep extends boolean = true, TTrue = true, TFalse = false> =
	T extends JsonType
		? TTrue
		// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
		: T extends Function
			? TFalse
			: T extends Array<infer U>
				? TDeep extends false
					? TTrue
					: IsJsonType<U, TDeep, TTrue, TFalse>
				: T extends object
					? TDeep extends false
						? TTrue
						: {
							[K in keyof T]: IsJsonType<T[K], true, false>
						} extends { [K in keyof T]: true }
							? TTrue
							: TFalse
					: TFalse;

type JsonType = boolean | null | number | string | undefined;

/** Each key of `T` as its own value, with `T`'s modifiers: an optional key reads as possibly `undefined`. */
type KeyMap<T> = { [K in keyof T]: K };

type MergedOptionalKeys<T, U, TOptional> = { [K in keyof T | keyof U as K extends TOptional ? K : never]?: unknown };

type MergedRequiredKeys<T, U, TOptional> = { [K in keyof T | keyof U as K extends TOptional ? never : K]: unknown };

export type Mutable<T> = {
	-readonly [P in keyof T]: T[P];
};

/** The literal keys `T` has optional. */
export type OptionalKeys<T> = keyof {
	[K in keyof T as IsIndexKey<K> extends true ? never : undefined extends KeyMap<T>[K] ? K : never]: unknown
};

/** The literal keys `T` has required. */
export type RequiredKeys<T> = keyof {
	[K in keyof T as IsIndexKey<K> extends true ? never : undefined extends KeyMap<T>[K] ? never : K]: unknown
};
