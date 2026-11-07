import { z, ZodBoolean, ZodIntersection, ZodLazy, ZodObject, ZodOptional, ZodRecord, ZodTuple, ZodType, ZodUnion } from 'zod';
import { $ZodRecordKey } from 'zod/v4/core';

import { ZodSelect } from './select.js';
import { getInnerType, isZodLazy, isZodObject, isZodObjectLoose, isZodRecord } from './utilities.js';

export type BasicSelect =
	ZodObject<
		Readonly<{
			[k: string]: Clause | ZodLazy<Clause>
		}>
	>
	| ZodRecord<
		$ZodRecordKey, Clause | ZodLazy<Clause>
	>;

type Clause = ZodOptional<ZodBoolean> | ZodOptional<ZodUnion<readonly [ZodBoolean, BasicSelect]>>;

function buildSelect(
	schema: ZodType,
	cache = new Map<ZodType, Clause | ZodLazy<Clause>>()
): Clause | ZodLazy<Clause> {
	schema = getInnerType(schema, false);

	if (cache.has(schema)) {
		return cache.get(schema)!;
	}

	if (isZodLazy(schema)) {
		const select = z.lazy(() => {
			return buildSelect(schema.def.getter() as ZodType, cache) as Clause;
		});

		cache.set(schema, select);

		return select;
	}

	if (isZodObject(schema)) {
		const shape: Record<string, Clause | ZodLazy<Clause>> = {};
		let select: BasicSelect;

		// Stands in for this object while its fields are built, so a field that comes back to it, as a getter can,
		// resolves. It is only read once parsing starts, after `result` below is set.
		cache.set(schema, z.lazy(() => result));

		for (const key in schema.shape) {
			shape[key] = buildSelect(schema.shape[key], cache);
		}

		select = z.object(shape);

		if (!isZodObjectLoose(schema)) {
			select = select.strict();
		}

		const result: Clause = z.union([z.boolean(), select]).optional();

		cache.set(schema, result);

		return result;
	}

	if (isZodRecord(schema)) {
		const valueType = schema.def.valueType as ZodType;
		const select = buildSelect(valueType, cache);

		// A record select means: either a boolean, or a record of the same key type with select-values
		const result = z.union([
			z.boolean(),
			z.record(schema.def.keyType, select)
		]).optional();

		cache.set(schema, result);

		return result;
	}

	if (schema.def.type === 'unknown') {
		const result = z
			.union([
				z.boolean(),
				z.record(
					z.string(),
					z.lazy(() => buildSelect(schema, cache) as Clause)
				)
			])
			.optional();

		cache.set(schema, result);
		return result;
	}

	let types: undefined | ZodType[];

	if (schema.def.type === 'intersection') {
		types = [(schema as ZodIntersection).def.left as ZodType, (schema as ZodIntersection).def.right as ZodType];
	}

	if (schema.def.type === 'tuple') {
		types = (schema as ZodTuple).def.items as ZodType[];
	}

	if (schema.def.type === 'union') {
		types = (schema as ZodUnion).def.options as ZodType[];
	}

	if (types) {
		return mergeSelects(types.map(type => buildSelect(type, cache)));
	}

	return z.boolean().optional();
}

export function buildSelectSchema<T extends ZodType<object> | ZodUnion>(schema: T): ZodType<ZodSelect<T, true>, ZodSelect<T, true>> {
	const result = buildSelect(schema);

	if (isZodLazy(result)) {
		return (result.def.getter().def.innerType as ZodUnion).def.options[1] as ZodType<ZodSelect<T, true>, ZodSelect<T, true>>;
	}

	return (result.def.innerType as ZodUnion).def.options[1] as ZodType<ZodSelect<T, true>, ZodSelect<T, true>>;
}

/** A select for a value of any of the clauses' types: their object selects' keys, a key two of them share merged in turn. */
function mergeClauses(clauses: Clause[]): Clause {
	const keySelects: Record<string, (Clause | ZodLazy<Clause>)[]> = {};
	let isStrict = false;

	for (const clause of clauses) {
		if (clause.def.innerType.def.type === 'union') {
			const obj = getInnerType(clause.def.innerType.def.options[1]) as ZodObject;

			for (const key in obj.shape) {
				(keySelects[key] ??= []).push(obj.shape[key]);
			}

			if (!isZodObjectLoose(obj)) {
				isStrict = true;
			}
		}
	}

	const shape: Record<string, Clause | ZodLazy<Clause>> = {};

	for (const [key, selects] of Object.entries(keySelects)) {
		const distinct = [...new Set(selects)];

		shape[key] = (distinct.length === 1) ? distinct[0]! : mergeKeySelects(distinct);
	}

	let result = z.object(shape);

	if (isStrict) {
		result = result.strict();
	}

	return z.union([z.boolean(), result]).optional();
}

/** The selects of one key that several variants share: a plain boolean when none selects into an object. */
function mergeKeySelects(selects: (Clause | ZodLazy<Clause>)[]): Clause | ZodLazy<Clause> {
	const isNested = (select: Clause | ZodLazy<Clause>) => isZodLazy(select) || (select.def.innerType.def.type === 'union');

	if (!selects.some(isNested)) {
		return selects[0]!;
	}

	return mergeSelects(selects.filter(isNested));
}

/** Selects merged into one, lazily when any is lazy, as a recursive one may not be built yet. */
function mergeSelects(selects: (Clause | ZodLazy<Clause>)[]): Clause | ZodLazy<Clause> {
	if (selects.some(select => isZodLazy(select))) {
		return z.lazy(() => mergeClauses(selects.map(select => (isZodLazy(select) ? select.def.getter() : select))));
	}

	return mergeClauses(selects as Clause[]);
}
