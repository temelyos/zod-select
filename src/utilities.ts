import { ZodArray, ZodCatch, ZodDefault, ZodLazy, ZodNullable, ZodObject, ZodOptional, ZodRecord, ZodType, ZodUnion, ZodUnknown } from 'zod';

export function getInnerType(schema: ZodType, unwrapLazy = true): ZodType {
	if (
		schema instanceof ZodOptional
		|| schema instanceof ZodNullable
		|| schema instanceof ZodDefault
		|| schema instanceof ZodCatch
	) {
		return getInnerType(schema.def.innerType as ZodType, unwrapLazy);
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

export function isZodRecord(obj: unknown): obj is ZodRecord {
	return isZodType(obj) && (obj.def.type === 'record');
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
