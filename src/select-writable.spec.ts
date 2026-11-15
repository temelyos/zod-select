import { strict as assert } from 'assert';
import { describe, it } from 'node:test';

import { DeepReadonly, isPathSelected, selectsOverlap, SelectWritable, selectWritable, SelectWriteError } from './select-writable.js';
import { IsEqual } from './types.js';

interface Address { city: string, country: string, location?: { lat: number, lng: number } }

interface Customer {
	address: Address,
	billing?: Address,
	createdAt: Date,
	lines: Line[],
	name: string,
	notes?: string,
	tags: string[]
}

interface Line { amount: number, item: string }

const SIGNED_UP_AT = Date.UTC(2020, 0, 1);

const stored: Customer = {
	address: { city: 'Lyon', country: 'FR' },
	createdAt: new Date(SIGNED_UP_AT),
	lines: [{ amount: 300, item: 'Soup' }, { amount: 600, item: 'Cake' }],
	name: 'Acme',
	tags: ['vendor']
};

const geocoded = { lat: 45.76, lng: 4.84 };

function customer(): Customer {
	return structuredClone(stored);
}

function refused(path: string) {
	return (error: unknown) => error instanceof SelectWriteError && error.path === path;
}

describe('selectsOverlap()', () => {
	it('should find a key both select, whole or by keys within it', () => {
		assert.equal(selectsOverlap({ tags: true }, { tags: true }), true);
		assert.equal(selectsOverlap({ address: true }, { address: { country: true } }), true);
		assert.equal(selectsOverlap({ address: { country: true } }, { address: true }), true);
		assert.equal(selectsOverlap({ address: { country: true } }, { address: { country: true, location: true } }), true);
	});

	it('should find no overlap between keys that differ, at any depth', () => {
		assert.equal(selectsOverlap({ tags: true }, { name: true }), false);
		assert.equal(selectsOverlap({ address: { location: true } }, { address: { country: true } }), false);
	});

	it('should take a select of the whole value as overlapping any select that selects something', () => {
		assert.equal(selectsOverlap(true, { name: true }), true);
		assert.equal(selectsOverlap({ address: { city: true } }, true), true);
		assert.equal(selectsOverlap(true, true), true);
	});

	it('should take a select of nothing as overlapping nothing: an empty one, or one of keys selected false', () => {
		assert.equal(selectsOverlap({}, true), false);
		assert.equal(selectsOverlap(true, { address: {} }), false);
		assert.equal(selectsOverlap({ address: {} }, { address: true }), false);
		assert.equal(selectsOverlap({ tags: false }, { tags: true }), false);
		assert.equal(selectsOverlap(false, true), false);
	});

	it('should read only a select\'s own keys, so a key named as an Object.prototype member is a key like any other', () => {
		assert.equal(selectsOverlap({ constructor: { name: true } }, {}), false);
		assert.equal(selectsOverlap({ constructor: { name: true } }, { team: true }), false);
		assert.equal(selectsOverlap({ constructor: { name: true } }, { constructor: true }), true);
	});
});

describe('isPathSelected()', () => {
	it('should take a path at or below a key selected whole', () => {
		assert.equal(isPathSelected({ address: true }, 'address'), true);
		assert.equal(isPathSelected({ address: true }, 'address.location.lat'), true);
		assert.equal(isPathSelected({ address: { location: true } }, 'address.location'), true);
		assert.equal(isPathSelected(true, 'name'), true);
	});

	it('should refuse a path above what is selected, beside it, or selected false', () => {
		assert.equal(isPathSelected({ address: { location: true } }, 'address'), false);
		assert.equal(isPathSelected({ address: { location: true } }, 'address.city'), false);
		assert.equal(isPathSelected({ address: true }, 'name'), false);
		assert.equal(isPathSelected({ address: false }, 'address'), false);
		assert.equal(isPathSelected(false, 'name'), false);
	});

	it('should skip an array\'s index and positional segments, as a select of an array selects each element', () => {
		assert.equal(isPathSelected({ lines: { amount: true } }, 'lines.0.amount'), true);
		assert.equal(isPathSelected({ lines: { amount: true } }, 'lines.$.amount'), true);
		assert.equal(isPathSelected({ lines: { amount: true } }, 'lines.$[].amount'), true);
		assert.equal(isPathSelected({ lines: { amount: true } }, 'lines.$[line].amount'), true);
		assert.equal(isPathSelected({ lines: { amount: true } }, 'lines.0.item'), false);
		assert.equal(isPathSelected({ lines: { amount: true } }, 'lines'), false);
	});

	it('should read a segment the select names as its key, though it looks like an index', () => {
		assert.equal(isPathSelected({ byYear: { 2024: true } }, 'byYear.2024'), true);
		assert.equal(isPathSelected({ byYear: { 2024: true } }, 'byYear.2025'), false);
	});

	it('should read only a select\'s own keys', () => {
		assert.equal(isPathSelected({ address: true }, '__proto__.__proto__.x'), false);
		assert.equal(isPathSelected({ address: true }, 'constructor.name'), false);
	});
});

describe('selectWritable()', () => {
	it('should write into the value where the select selects it, at any depth', () => {
		const value = customer();
		const view = selectWritable(value, { address: { location: true }, notes: true });

		view.address.location = geocoded;
		view.notes = 'Geocoded';

		assert.deepEqual(value.address.location, geocoded);
		assert.equal(value.notes, 'Geocoded');
	});

	it('should write anywhere below a key selected whole: replacing it, within it, or deleting or defining it', () => {
		const value = customer();
		const view = selectWritable(value, { address: true, notes: true, tags: true });

		view.address.city = 'Paris';
		assert.equal(value.address.city, 'Paris');

		view.address = { city: 'Nice', country: 'FR' };
		assert.deepEqual(value.address, { city: 'Nice', country: 'FR' });

		Object.defineProperty(view, 'notes', { configurable: true, enumerable: true, value: 'Moved', writable: true });
		assert.equal(value.notes, 'Moved');

		view.tags.push('partner');
		assert.deepEqual(value.tags, ['vendor', 'partner']);

		delete view.notes;
		assert.equal('notes' in value, false);
	});

	it('should refuse setting, deleting or defining a key it doesn\'t select, naming its path, and leave the value as it was', () => {
		const value = customer();
		const view = selectWritable(value, { address: { location: true } });

		assert.throws(() => Reflect.set(view, 'name', 'Acme Ltd'), refused('name'));
		assert.throws(() => Reflect.deleteProperty(view, 'tags'), refused('tags'));
		assert.throws(() => Object.defineProperty(view, 'notes', { value: 'x' }), refused('notes'));
		assert.throws(() => Reflect.set(view.address, 'city', 'Paris'), refused('address.city'));
		assert.throws(() => Reflect.set(view, 'address', {}), refused('address'));

		assert.deepEqual(value, stored);
	});

	it('should hand out what it doesn\'t select read-only all the way down', () => {
		const value = customer();
		const view = selectWritable(value, { notes: true });

		assert.throws(() => Reflect.set(view.address, 'city', 'Paris'), refused('address.city'));
		assert.throws(() => (view.tags as string[]).push('partner'), refused('tags.1'));
		assert.throws(() => Reflect.set(view.lines[0]!, 'amount', 0), refused('lines.0.amount'));

		assert.deepEqual(value, stored);
	});

	it('should refuse a change made through a descriptor, a prototype or a freeze, and leave the value extensible', () => {
		const value = customer();
		const view = selectWritable(value, { notes: true });

		assert.throws(() => Reflect.set(Object.getOwnPropertyDescriptor(view, 'address')!.value as Address, 'country', 'DE'), refused('address.country'));
		assert.throws(() => Object.setPrototypeOf(view.address, null), refused('address'));
		assert.throws(() => Object.freeze(view.address), refused('address'));
		assert.throws(() => Object.preventExtensions(view), (error: unknown) => error instanceof SelectWriteError && error.path === '');

		assert.equal(value.address.country, 'FR');
		assert.equal(Object.isExtensible(value.address), true);
		assert.equal(Object.getPrototypeOf(value.address), Object.prototype);
	});

	it('should read a select of an array as a select of each element, and the array itself as written only selected whole', () => {
		const value = customer();
		const view = selectWritable(value, { lines: { amount: true } });

		for (const line of view.lines) line.amount *= 2;

		assert.deepEqual(value.lines.map(line => line.amount), [600, 1200]);
		assert.throws(() => (view.lines as Line[]).push({ amount: 1, item: 'Tea' }), refused('lines.2'));
		assert.throws(() => Reflect.set(view.lines, 0, { amount: 1, item: 'Tea' }), refused('lines.0'));
		assert.throws(() => Reflect.set(view.lines[0]!, 'item', 'Tea'), refused('lines.0.item'));
		assert.throws(() => (view.lines as Line[]).reverse(), refused('lines.0'));
		assert.throws(() => (view.lines as Line[]).splice(0, 1), (error: unknown) => error instanceof SelectWriteError);
		assert.deepEqual(value.lines.map(line => line.item), ['Soup', 'Cake']);
	});

	it('should write a view written into a selected key as the value it views, so the stored value holds no view', () => {
		const value = customer();
		const view = selectWritable(value, { billing: true, tags: true });

		view.billing = view.address;
		view.tags.push(view.lines[0]!.item);

		assert.equal(value.billing, value.address);
		assert.deepEqual(structuredClone(value).billing, stored.address);

		const next = selectWritable(value, { billing: true });

		next.billing!.city = 'Paris';
		assert.equal(value.address.city, 'Paris');
	});

	it('should write a view nested in a new value as the value it views, through a key selected whole', () => {
		const value = customer();
		const view = selectWritable(value, { billing: true });

		view.billing = { ...view.address, location: view.address.location ?? geocoded };
		assert.doesNotThrow(() => structuredClone(value));
	});

	it('should read what it doesn\'t select as it is stored, through one view per path', () => {
		const value = customer();
		const view = selectWritable(value, { notes: true });

		assert.notEqual(view.address, value.address);
		assert.deepEqual(view.address, stored.address);
		assert.equal(view.address, view.address);
		assert.deepEqual(JSON.parse(JSON.stringify(view)), JSON.parse(JSON.stringify(stored)));
	});

	it('should name the path a value was reached by, when it is reached by two', () => {
		const value = customer();
		const view = selectWritable(Object.assign(value, { billing: value.address }), { notes: true });

		assert.throws(() => Reflect.set(view.billing!, 'city', 'Paris'), refused('billing.city'));
		assert.throws(() => Reflect.set(view.address, 'city', 'Paris'), refused('address.city'));
	});

	it('should read a date it doesn\'t select as itself, refusing its setters, and write a date it selects whole', () => {
		const value = customer();
		const view = selectWritable(value, { notes: true });

		assert.equal(view.createdAt.getTime(), SIGNED_UP_AT);
		assert.equal(view.createdAt.toISOString(), stored.createdAt.toISOString());
		assert.ok(view.createdAt instanceof Date);
		assert.equal(view.createdAt, view.createdAt);
		assert.throws(() => view.createdAt.setUTCFullYear(1999), refused('createdAt'));
		assert.equal(value.createdAt.getTime(), SIGNED_UP_AT);

		selectWritable(value, { createdAt: true }).createdAt.setUTCFullYear(1999);
		assert.equal(value.createdAt.getUTCFullYear(), 1999);
	});

	it('should read a frozen value as it is, where a view of it would break the proxy', () => {
		const frozen = Object.freeze({ address: Object.freeze({ ...stored.address }), notes: 'Frozen' });
		const view = selectWritable(frozen, { notes: true });

		assert.equal(view.address, frozen.address);
		assert.equal(view.notes, 'Frozen');
	});

	it('should write through a select of the whole value, keeping views out of it', () => {
		const value = customer();
		const view = selectWritable(value, true);

		view.name = 'Acme Ltd';
		view.billing = view.address;

		assert.equal(value.name, 'Acme Ltd');
		assert.equal(value.billing, value.address);
	});

	it('should refuse every write through a select of nothing', () => {
		const value = customer();

		assert.throws(() => Reflect.set(selectWritable(value, false), 'name', 'x'), refused('name'));
		assert.throws(() => Reflect.set(selectWritable(value, {}), 'name', 'x'), refused('name'));
	});
});

describe('SelectWritable', () => {
	it('should type the keys a select selects whole as writable, all the way down', () => {
		type Writable = SelectWritable<Customer, { notes: true, tags: true }>;

		const isNotesWritable: IsEqual<Pick<Writable, 'notes'>, { notes?: string }> = true;
		const isTagsWritable: IsEqual<Pick<Writable, 'tags'>, { tags: string[] }> = true;

		assert.ok(isNotesWritable);
		assert.ok(isTagsWritable);
	});

	it('should type everything else read-only, and a key selected by keys within it read-only but for those', () => {
		const view = selectWritable(customer(), { address: { location: true }, lines: { amount: true } });

		view.address.location = geocoded;
		for (const line of view.lines) line.amount += 1;

		// Each refused by the types, and by the view if the types are got past.
		assert.throws(() => {
			// @ts-expect-error a key it doesn't select
			view.name = 'Acme Ltd';
		}, refused('name'));
		assert.throws(() => {
			// @ts-expect-error a key beside the one it selects
			view.address.city = 'Paris';
		}, refused('address.city'));
		assert.throws(() => {
			// @ts-expect-error a key selected only by keys within it
			view.address = { city: 'Nice', country: 'FR' };
		}, refused('address'));
		assert.throws(() => {
			// @ts-expect-error an array selected only by its elements' keys
			view.lines.push({ amount: 1, item: 'Tea' });
		}, refused('lines.2'));
		assert.throws(() => {
			// @ts-expect-error a key of an element it doesn't select
			view.lines[0]!.item = 'Tea';
		}, refused('lines.0.item'));
		assert.throws(() => {
			// @ts-expect-error an array it doesn't select
			view.tags.push('partner');
		}, refused('tags.1'));
	});

	it('should check the select against the value, refusing a key it doesn\'t have', () => {
		const value = customer();

		// @ts-expect-error a misspelled key
		assert.ok(selectWritable(value, { nmae: true }));
		// @ts-expect-error a key the nested value doesn't have
		assert.ok(selectWritable(value, { address: { street: true } }));
	});

	it('should keep a field typed `any` or `unknown` as it is, and an unselected date as a date', () => {
		const isAny: IsEqual<SelectWritable<{ data: any }, { name: true }>['data'], any> = true;
		const isUnknown: IsEqual<SelectWritable<{ data: unknown }, { name: true }>['data'], unknown> = true;
		const isDate: IsEqual<DeepReadonly<Date>, Date> = true;

		assert.ok(isAny);
		assert.ok(isUnknown);
		assert.ok(isDate);
	});

	it('should keep a tuple a tuple, read-only', () => {
		const isTuple: IsEqual<DeepReadonly<{ pair: [number, string] }>['pair'], readonly [number, string]> = true;

		assert.ok(isTuple);
	});

	it('should type a key a select names under an index signature as the select has it', () => {
		const counts: Record<string, Record<string, number>> = { byDay: { mon: 1 }, byYear: { 2024: 3 } };
		const view = selectWritable(counts, { byDay: true, byYear: { 2024: true } });

		view.byDay = { tue: 2 };
		view.byYear['2024'] = 4;

		assert.deepEqual(counts, { byDay: { tue: 2 }, byYear: { 2024: 4 } });
	});

	it('should type a union by each variant, and an optional value as optional', () => {
		type Party = { kind: 'company', taxId: string } | { kind: 'person', name: string };
		type Writable = SelectWritable<{ party: Party, previous?: Address | null }, { party: true, previous: { city: true } }>;

		const isParty: IsEqual<Writable['party'], Party> = true;
		const isOptional: IsEqual<undefined extends Writable['previous'] ? true : false, true> = true;

		assert.ok(isParty);
		assert.ok(isOptional);
	});
});
