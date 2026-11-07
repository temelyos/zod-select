import { ZodArray, ZodCatch, ZodDefault, ZodLazy, ZodNonOptional, ZodNullable, ZodObject, ZodOptional, ZodPipe, ZodPrefault, ZodReadonly, ZodRecord, ZodType, ZodUnion, ZodUnknown } from 'zod';

export function getInnerType(schema: ZodType, unwrapLazy = true): ZodType {
	const unwrapped = unwrapWrapper(schema);

	if (unwrapped) {
		return getInnerType(unwrapped, unwrapLazy);
	}

	if (schema instanceof ZodArray) {
		return getInnerType(schema.def.element as ZodType, unwrapLazy);
	}

	if (unwrapLazy && schema instanceof ZodLazy) {
		return getInnerType(schema.def.getter() as ZodType);
	}

	return schema;
}

export function isZodArray(obj: unknown): obj is ZodArray<ZodType> {
	return isZodType(obj) && (obj.def.type === 'array');
}

export function isZodCatch(obj: unknown): obj is ZodCatch<ZodType> {
	return isZodType(obj) && (obj.def.type === 'catch');
}

export function isZodDefault(obj: unknown): obj is ZodDefault<ZodType> {
	return isZodType(obj) && (obj.def.type === 'default');
}

export function isZodLazy(obj: unknown): obj is ZodLazy {
	return isZodType(obj) && (obj.def.type === 'lazy');
}

export function isZodNonOptional(obj: unknown): obj is ZodNonOptional<ZodType> {
	return isZodType(obj) && (obj.def.type === 'nonoptional');
}

export function isZodNullable(obj: unknown): obj is ZodNullable<ZodType> {
	return isZodType(obj) && (obj.def.type === 'nullable');
}

export function isZodObject(obj: unknown, isLoose?: boolean): obj is ZodObject {
	if (!isZodType(obj) || (obj.def.type !== 'object')) {
		return false;
	}

	if (typeof isLoose === 'undefined') {
		return true;
	}

	return isLoose === isZodUnknown((obj as ZodObject).def.catchall);
}

export function isZodObjectLoose(obj: ZodObject): boolean {
	return !!isZodUnknown(obj.def.catchall as ZodType);
}

export function isZodOptional(obj: unknown): obj is ZodOptional<ZodType> {
	return isZodType(obj) && (obj.def.type === 'optional');
}

export function isZodPipe(obj: unknown): obj is ZodPipe {
	return isZodType(obj) && (obj.def.type === 'pipe');
}

export function isZodPrefault(obj: unknown): obj is ZodPrefault<ZodType> {
	return isZodType(obj) && (obj.def.type === 'prefault');
}

export function isZodReadonly(obj: unknown): obj is ZodReadonly<ZodType> {
	return isZodType(obj) && (obj.def.type === 'readonly');
}

export function isZodRecord(obj: unknown): obj is ZodRecord {
	return isZodType(obj) && (obj.def.type === 'record');
}

export function isZodTransform(obj: unknown): boolean {
	return isZodType(obj) && (obj.def.type === 'transform');
}

export function isZodType(obj: unknown): obj is ZodType {
	return typeof obj === 'object' && obj !== null && 'def' in obj && 'safeParse' in obj && typeof (obj as ZodType).safeParse === 'function';
}

export function isZodUnion(obj: unknown): obj is ZodUnion<ZodType[]> {
	return isZodType(obj) && (obj.def.type === 'union');
}

export function isZodUnknown(obj: unknown): obj is ZodUnknown {
	return isZodType(obj) && (obj.def.type === 'unknown');
}

/**
 * The schema a value-preserving wrapper holds: optional, nullable, default, prefault, catch, nonoptional, readonly,
 * or a pipe's output side. `undefined` for anything else, including a pipe into a transform, whose output has no schema.
 */
export function unwrapWrapper(schema: ZodType): undefined | ZodType {
	if (
		schema instanceof ZodOptional
		|| schema instanceof ZodNullable
		|| schema instanceof ZodDefault
		|| schema instanceof ZodPrefault
		|| schema instanceof ZodCatch
		|| schema instanceof ZodNonOptional
		|| schema instanceof ZodReadonly
	) {
		return schema.def.innerType as ZodType;
	}

	if (schema instanceof ZodPipe && !isZodTransform(schema.def.out)) {
		return schema.def.out as ZodType;
	}

	return undefined;
}
