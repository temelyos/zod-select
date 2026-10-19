/**
 * `U` merged into `T`, as types: keys in both merge deeply when both sides are objects, and by their elements when
 * both are arrays, kept `null` or `undefined` where a side may be; otherwise they widen to `T[K] | U[K]`.
 */
export type DeepMerge<T, U> = {
	[K in keyof T | keyof U]: K extends keyof T
		? K extends keyof U
			? DeepMergeValue<T[K], U[K]>
			: T[K]
		: K extends keyof U
			? U[K]
			: never;
};

export type DeepMergeAll<T> = T extends readonly any[]
	? T extends [infer First, ...infer Rest]
		? Rest extends []
			? First
			: DeepMerge<First, DeepMergeAll<Rest>>
		: unknown
	: T;

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

export type Mutable<T> = {
	-readonly [P in keyof T]: T[P];
};
