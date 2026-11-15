/** The keys `T` declares, its index signature left out. */
type DeclaredKeys<T> = keyof { [K in keyof T as string extends K ? never : number extends K ? never : symbol extends K ? never : K]: 0 };

/** `T` read-only all the way down. A `Date` is left as it is: the types can't take its setters away. A field typed `any` or `unknown` stays so. */
export type DeepReadonly<T> = unknown extends T ? T : DeepReadonlyOf<T>;

type DeepReadonlyOf<T> =
	T extends Leaf ? T
		: T extends ReadonlyMap<infer K, infer V> ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
			: T extends ReadonlySet<infer V> ? ReadonlySet<DeepReadonly<V>>
				: { readonly [K in keyof T]: DeepReadonly<T[K]> };

/** The keys of `T`'s index signature that `TSelect` names, none for a `T` without one. */
type IndexSelected<T, TSelect> = string extends keyof T
	? { -readonly [K in Exclude<WholeKeys<TSelect>, DeclaredKeys<T>>]: T[string & keyof T] }
	& { readonly [K in Exclude<keyof TSelect, DeclaredKeys<T> | WholeKeys<TSelect>>]: SelectWritable<T[string & keyof T], TSelect[K]> }
	: unknown;

/** What has no keys to be read-only, or whose setters the types can't take away. */
type Leaf = ((...args: never[]) => unknown) | bigint | boolean | Date | null | number | string | symbol | undefined;

/**
 * A select as plain data, as a simple `ZodSelect` (`ZodSelect<T, true>`) gives it: each key selected whole (`true`),
 * by the keys within it, or not at all (`false`, or absent).
 */
export type PlainSelect = boolean | { readonly [key: string]: PlainSelect | undefined };

/** The keys of `T` that `TSelect` selects whole, writable all the way down. */
type SelectedWhole<T, TSelect> = { -readonly [K in keyof T as K extends WholeKeys<TSelect> ? K : never]: T[K] };

/** The other keys of `T`: read-only, and writable within only where `TSelect` selects keys within them. */
type SelectedWithin<T, TSelect> = { readonly [K in keyof T as K extends WholeKeys<TSelect> ? never : K]: K extends keyof TSelect ? SelectWritable<T[K], TSelect[K]> : DeepReadonly<T[K]> };

/** The selects of a `T`: of its keys, at any depth, each key's of each element of an array it holds. */
export type SelectOf<T> = unknown extends T ? PlainSelect : SelectOfValue<T>;

type SelectOfValue<T> =
	T extends Leaf ? boolean
		: T extends readonly (infer E)[] ? SelectOf<E>
			: boolean | { readonly [K in keyof T]?: SelectOf<Exclude<T[K], null | undefined>> };

/**
 * `T` writable where `TSelect` selects it and read-only everywhere else: a key selected `true` is writable all the way
 * down; a key selected by the keys within it is itself read-only, and writable only where those select. A select of an
 * array is a select of each of its elements: the array itself is writable only selected `true`. A field typed `any` or
 * `unknown` stays so: only {@link selectWritable} refuses a write through it.
 */
export type SelectWritable<T, TSelect> = unknown extends T ? T : SelectWritableOf<T, TSelect>;

type SelectWritableOf<T, TSelect> =
	TSelect extends true ? T
		: TSelect extends object
			? T extends Leaf ? T
				: T extends readonly unknown[] ? { readonly [K in keyof T]: SelectWritable<T[K], TSelect> }
					: IndexSelected<T, TSelect> & SelectedWhole<T, TSelect> & SelectedWithin<T, TSelect>
			: DeepReadonly<T>;

/** The keys `TSelect` selects whole. */
type WholeKeys<TSelect> = { [K in keyof TSelect]: TSelect[K] extends true ? K : never }[keyof TSelect];

/** A write `selectWritable` refused: at `path`, which its select doesn't select. */
export class SelectWriteError extends TypeError {
	constructor(readonly path: string) {
		super(path ? `'${path}' is not selected to be written.` : 'The value itself is not selected to be written.');
		this.name = 'SelectWriteError';
	}
}

/** The target of each view handed out, so a view written into a value is written as what it views. */
const targets = new WeakMap<object, object>();

/** The views handed out so far, by target, then by select, then by path: a value read twice at one path is one view. */
const views = new WeakMap<object, Map<PlainSelect | undefined, Map<string, object>>>();

function dateHandler(path: string): ProxyHandler<Date> {
	const refuse = (): never => {
		throw new SelectWriteError(path);
	};

	return {
		defineProperty: refuse,
		deleteProperty: refuse,
		get: (target, key) => {
			const value: unknown = Reflect.get(target, key, target);

			if (typeof value !== 'function') return value;
			if (typeof key === 'string' && key.startsWith('set')) return refuse;

			return (value as (...args: unknown[]) => unknown).bind(target);
		},
		preventExtensions: refuse,
		set: refuse,
		setPrototypeOf: refuse
	};
}

/**
 * Whether `path`, a dotted path as an update statement names one, is within `select`: at or below a key it selects
 * whole. A segment the select doesn't name that is an array's index or positional one (`0`, `$`, `$[]`, `$[name]`) is
 * skipped, as a select of an array is a select of each element; one the select names is read as its key.
 */
export function isPathSelected(select: PlainSelect, path: string): boolean {
	let node: PlainSelect | undefined = select;

	for (const segment of path.split('.')) {
		if (node === true) return true;
		if (typeof node !== 'object') return false;

		const next = selectAt(node, segment);

		if (next !== undefined) node = next;
		else if (!/^\d+$/.test(segment) && !segment.startsWith('$')) return false;
	}

	return node === true;
}

function isPlain(value: object): boolean {
	const prototype: unknown = Object.getPrototypeOf(value);

	return Array.isArray(value) || prototype === Object.prototype || prototype === null;
}

/** Whether `select` selects anything: `true`, or a key that does. */
function isSelecting(select: PlainSelect | undefined): boolean {
	return select === true || (typeof select === 'object' && Object.keys(select).some(key => isSelecting(selectAt(select, key))));
}

function objectHandler(select: PlainSelect | undefined, path: string, isArray: boolean): ProxyHandler<object> {
	// An array's select is its elements': each element is read by it, and the array itself takes a write only selected whole.
	const isIndex = (key: string | symbol): key is string => typeof key === 'string' && /^\d+$/.test(key);
	const selectOf = (key: string | symbol): PlainSelect | undefined => {
		if (select === true) return true;
		if (typeof key === 'symbol') return undefined;

		return isArray ? (isIndex(key) ? select : undefined) : selectAt(select, key);
	};
	const isWritable = (key: string | symbol): boolean => (select === true || (!isArray && selectOf(key) === true));
	const refuse = (key: string | symbol): never => {
		throw new SelectWriteError(pathOf(path, String(key)));
	};
	const read = (target: object, key: string | symbol, value: unknown): unknown => {
		const descriptor = Reflect.getOwnPropertyDescriptor(target, key);

		// A frozen property must read as itself: anything else breaks the proxy's invariants.
		if (typeof key === 'symbol' || typeof value === 'function' || (descriptor && !descriptor.configurable && descriptor.writable === false)) return value;

		return viewOf(value, selectOf(key), pathOf(path, key));
	};

	return {
		defineProperty: (target, key, descriptor) => (isWritable(key) ? Reflect.defineProperty(target, key, 'value' in descriptor ? { ...descriptor, value: unwrap(descriptor.value) } : descriptor) : refuse(key)),
		deleteProperty: (target, key) => (isWritable(key) ? Reflect.deleteProperty(target, key) : refuse(key)),
		get: (target, key) => read(target, key, Reflect.get(target, key, target)),
		getOwnPropertyDescriptor: (target, key) => {
			const descriptor = Reflect.getOwnPropertyDescriptor(target, key);

			return descriptor && 'value' in descriptor && descriptor.configurable ? { ...descriptor, value: read(target, key, descriptor.value) } : descriptor;
		},
		preventExtensions: () => refuse(''),
		set: (target, key, value) => (isWritable(key) ? Reflect.set(target, key, unwrap(value)) : refuse(key)),
		setPrototypeOf: () => refuse('')
	};
}

function pathOf(path: string, key: string): string {
	return path && key ? `${path}.${key}` : path || key;
}

/** The select `select` gives `key`: of its own keys only, so a key named as an `Object.prototype` member selects nothing. */
function selectAt(select: PlainSelect | undefined, key: string): PlainSelect | undefined {
	if (select === true) return true;
	if (typeof select !== 'object' || !Object.hasOwn(select, key)) return undefined;

	const value = select[key];

	return value === true || typeof value === 'object' ? value : undefined;
}

/**
 * Whether two selects of one value select any part of it in common: one selects a key whole the other selects any of,
 * or both select a key by keys within it that overlap in turn.
 */
export function selectsOverlap(a: PlainSelect, b: PlainSelect): boolean {
	if (a === true) return isSelecting(b);
	if (b === true) return isSelecting(a);
	if (typeof a !== 'object' || typeof b !== 'object') return false;

	return Object.keys(a).some((key) => {
		const mine = selectAt(a, key);
		const theirs = selectAt(b, key);

		return mine !== undefined && theirs !== undefined && selectsOverlap(mine, theirs);
	});
}

/**
 * `value` as `select` allows it written: through a view that writes into `value` where `select` selects it, and
 * refuses with a {@link SelectWriteError} a write anywhere else: setting, deleting or defining a key, changing an array
 * not selected whole, changing a prototype or freezing, or calling a `Date`'s setter. Reads go through as views, so a
 * view written into a key is written as the value it views. A class instance other than a `Date`, such as a `Map` or a
 * `Buffer`, is handed out as it is, and so is a property frozen in `value`.
 */
export function selectWritable<T extends object, const TSelect extends SelectOf<T>>(value: T, select: TSelect): SelectWritable<T, TSelect> {
	// `SelectOf<T>` is a `PlainSelect` for every `T`; the compiler can't see it for a `T` not yet known.
	return viewOf(value, select as PlainSelect, '') as SelectWritable<T, TSelect>;
}

/** `value` with each view in it, at any depth, replaced by what it views: a copy where it held one, else `value` itself. */
function unwrap(value: unknown, seen = new WeakSet<object>()): unknown {
	if (typeof value !== 'object' || value === null) return value;

	const target = targets.get(value);

	if (target) return target;
	if (seen.has(value) || !isPlain(value)) return value;

	seen.add(value);

	if (Array.isArray(value)) {
		const elements = value.map(element => unwrap(element, seen));

		return elements.some((element, index) => element !== value[index]) ? elements : value;
	}

	const entries = Object.entries(value).map(([key, field]) => [key, unwrap(field, seen)] as const);

	return entries.some(([key, field]) => field !== (value as Record<string, unknown>)[key]) ? Object.assign(Object.create(Object.getPrototypeOf(value) as null | object) as object, Object.fromEntries(entries)) : value;
}

/** `value`, or the view of it that `select` allows written at `path`: `undefined` as the select of what nothing selects. */
function viewOf(value: unknown, select: PlainSelect | undefined, path: string): unknown {
	if (typeof value !== 'object' || value === null || targets.has(value)) return value;

	const isDate = value instanceof Date;

	if (isDate ? select === true : !isPlain(value)) return value;

	let bySelect = views.get(value);

	if (!bySelect) views.set(value, bySelect = new Map());

	let byPath = bySelect.get(select);

	if (!byPath) bySelect.set(select, byPath = new Map());

	const existing = byPath.get(path);

	if (existing) return existing;

	const view = isDate ? new Proxy(value, dateHandler(path)) : new Proxy(value, objectHandler(select, path, Array.isArray(value)));

	byPath.set(path, view);
	targets.set(view, value);

	return view;
}
