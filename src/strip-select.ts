import { ZodIntersection, ZodType, ZodUnion } from 'zod';

import { mergeSelectValue, SelectObject, SelectValue } from './select-object.js';
import { InferMergedType, MultiSelect, ZodSelect } from './select.js';
import { isZodArray, isZodLazy, isZodObject, isZodType, isZodUnion, unwrapWrapper } from './utilities.js';

/** A schema select as plain data, and whether reading it was cut short: at a schema holding itself, or at the limit of the path. */
interface SchemaSelect {
	isCut: boolean,
	plain: SelectValue
}

export interface StripSelectOptions<T extends ZodType<object> | ZodUnion, TSelect extends MultiSelect<T> = undefined> {
	/** What was selected beside `select`: the first select given to `mergeSelect`. */
	added: ZodSelect<T>,
	/** The model both selects are of. As a select, it is the whole model. */
	schema: T,
	/** The select the value is handed back as the read of, never the merged one; absent, the whole model, so nothing is removed. */
	select?: TSelect,
	/** One value read by `added` and `select` merged. */
	value: object
}

/** Everything, where a read was cut short. */
const cutShort: SchemaSelect = { isCut: true, plain: true };

/** The types holding no value to pick into or to keep whole. */
const EMPTY_TYPES: readonly string[] = ['never', 'null', 'undefined', 'void'];

/** How many schemas deep a schema select is read, wrappers counted. Past it a field is whole: what stops a schema built anew at every level. */
const MAX_PATH = 40;

/** Nothing to pick, for a type that holds no value: beside the other members of a union, it adds none. */
const nothing: SchemaSelect = { isCut: false, plain: {} };

/** Everything, for a schema with nothing to pick into. */
const whole: SchemaSelect = { isCut: false, plain: true };

/** Schema selects read so far, by schema. */
const schemaSelects = new WeakMap<ZodType, SchemaSelect>();

/**
 * What a schema with nothing left to unwrap declares to pick: an object's fields, and those of every member of a
 * union or an intersection. Everything for one that declares none, or more than it names: a record, a loose object,
 * a tuple, a transform, a plain value.
 */
function declaredSelect(schema: ZodType, path: Set<ZodType>): SchemaSelect {
	if (EMPTY_TYPES.includes(schema.def.type)) {
		return nothing;
	}

	if (isZodObject(schema)) {
		const catchall = schema.def.catchall as undefined | ZodType;

		if ((catchall !== undefined) && (catchall.def.type !== 'never')) {
			return whole;
		}

		const fields = Object.entries(schema.shape).map(([key, field]) => [key, valueSelect(field as ZodType, path)] as const);

		return { isCut: fields.some(([, field]) => field.isCut), plain: Object.fromEntries(fields.map(([key, field]) => [key, field.plain])) };
	}

	if (isZodUnion(schema)) {
		return membersSelect(schema.options, path);
	}

	if (schema.def.type === 'intersection') {
		const { left, right } = (schema as ZodIntersection).def;

		return membersSelect([left as ZodType, right as ZodType], path);
	}

	return whole;
}

/** What an object select holds for one field: whole for `true` or a function refining it, a type as its schema select, else its picks. */
function fieldSelect(value: unknown): SelectValue | undefined {
	if ((value === true) || (typeof value === 'function')) {
		return true;
	}

	if (isZodType(value)) {
		return valueSelect(value).plain;
	}

	return ((typeof value === 'object') && (value !== null)) ? objectSelect(value) : undefined;
}

/** What `schema` wraps, one step in: under an optional or the like, an array's elements, what a lazy gives. Nothing for one that wraps none. */
function innerOf(schema: ZodType): undefined | ZodType {
	const unwrapped = unwrapWrapper(schema);

	if (unwrapped) {
		return unwrapped;
	}

	if (isZodArray(schema)) {
		return schema.def.element as ZodType;
	}

	return isZodLazy(schema) ? schema.def.getter() as ZodType : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if ((typeof value !== 'object') || (value === null)) {
		return false;
	}

	const prototype: unknown = Object.getPrototypeOf(value);

	return (prototype === Object.prototype) || (prototype === null);
}

/** The selects of a union's or an intersection's members merged: everything if any of them is. */
function membersSelect(members: readonly ZodType[], path: Set<ZodType>): SchemaSelect {
	return members.reduce<SchemaSelect>((merged, member) => {
		const read = schemaSelect(member, path);

		return { isCut: merged.isCut || read.isCut, plain: mergeSelectValue(merged.plain, read.plain) };
	}, { isCut: false, plain: {} });
}

/** An object select as plain data, what is `false` left out. */
function objectSelect(select: object): SelectObject {
	const plain: SelectObject = {};

	for (const [key, value] of Object.entries(select)) {
		const field = fieldSelect(value);

		if (field !== undefined) {
			plain[key] = field;
		}
	}

	return plain;
}

/** What `select` holds for `key`, as its own key only. */
function own(select: SelectObject, key: string): SelectValue | undefined {
	return Object.hasOwn(select, key) ? select[key] : undefined;
}

/** A select, or a list of them merged, as plain data: everything for none, and for the model itself. */
function plainSelect(select: unknown, schema: ZodType): SelectValue {
	if (select === undefined) {
		return true;
	}

	return (Array.isArray(select) ? select as unknown[] : [select]).reduce<SelectValue>((merged, part) => {
		const plain = (part === schema) ? true : fieldSelect(part);

		return (plain === undefined) ? merged : mergeSelectValue(merged, plain);
	}, {});
}

/**
 * A schema select as plain data: the fields it declares, and everything where it holds itself again. `path` is the
 * schemas being read, from the one the read started at: read one at a time down to what each wraps, so a schema that
 * reaches itself is found whatever wraps it there.
 */
function schemaSelect(select: ZodType, path = new Set<ZodType>()): SchemaSelect {
	const known = schemaSelects.get(select);

	// One cut short reads the same only from where its read started: further in, what cut it may be on the path.
	if (known && (!known.isCut || (path.size === 0))) {
		return known;
	}

	if (path.has(select) || (path.size >= MAX_PATH)) {
		return cutShort;
	}

	path.add(select);

	try {
		const inner = innerOf(select);
		const read = (inner === undefined) ? declaredSelect(select, path) : schemaSelect(inner, path);

		if (!read.isCut || (path.size === 1)) {
			schemaSelects.set(select, read);
		}

		return read;
	} finally {
		path.delete(select);
	}
}

/** `value` without what `added` selects beyond `kept`, in each element of an array; an object that isn't plain data is left whole. */
function strip(value: unknown, added: SelectValue, kept: SelectValue): unknown {
	if (kept === true) {
		return value;
	}

	if (Array.isArray(value)) {
		return value.map(element => strip(element, added, kept));
	}

	if (!isPlainObject(value)) {
		return value;
	}

	return Object.fromEntries(Object.entries(value).flatMap(([key, held]): [string, unknown][] => {
		// Added whole: every key is one `added` selected.
		const addedAt = (added === true) ? true : own(added, key);
		const keptAt = own(kept, key);

		if (addedAt === undefined) {
			return [[key, held]];
		}

		return (keptAt === undefined) ? [] : [[key, strip(held, addedAt, keptAt)]];
	}));
}

/**
 * A value read by `added` merged with `select`, as `select` alone reads it: what `added` selected beyond `select` is
 * removed, at any depth and in each element of an array. The pair of `mergeSelect`, for a function that reads more
 * than its caller asked for and hands back only what was asked.
 *
 * - What neither select names is left as it is, such as an id a read always returns.
 * - A field `added` selected whole and `select` in part is left with that part alone, whatever else it held.
 * - With no `select`, or the model itself (`schema`, the same instance) as one, nothing is removed.
 * - A schema select names the fields it declares. What it can't pick into is selected whole: a record, a loose
 *   object, a tuple, a transform, a union with a member that isn't an object, and a schema where it holds itself.
 * - An object that isn't plain data, such as a class instance, is left whole.
 * - The value passed in is never changed.
 *
 * @example
 * ```ts
 * const added = { email: true };
 * const user = find(mergeSelect(UserSchema, added, select));
 *
 * notify(user.email);
 *
 * return stripSelect({ added, schema: UserSchema, select, value: user });
 * ```
 */
export function stripSelect<T extends ZodType<object> | ZodUnion, TSelect extends MultiSelect<T> = undefined>(
	{ added, schema, select, value }: StripSelectOptions<T, TSelect>
): InferMergedType<T, TSelect> {
	return strip(value, plainSelect(added, schema), plainSelect(select, schema)) as InferMergedType<T, TSelect>;
}

/** The schema select of a field or a select of its own, where a type holding no value is whole: what is there is kept. */
function valueSelect(select: ZodType, path?: Set<ZodType>): SchemaSelect {
	const read = schemaSelect(select, path);

	return (read === nothing) ? whole : read;
}
