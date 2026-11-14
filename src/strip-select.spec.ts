import { strict as assert } from 'assert';
import { describe, it } from 'node:test';
import { z } from 'zod';

import { mergeSelect } from './merge-select.js';
import { InferMergedType, MultiSelect } from './select.js';
import { stripSelect } from './strip-select.js';
import { IsEqual } from './types.js';

const addressSchema = z.object({ _id: z.string(), city: z.string(), state: z.string(), zip: z.string() });
const orderSchema = z.object({ number: z.string(), total: z.number() });
const userSchema = z.object({
	_id: z.string(),
	address: addressSchema,
	email: z.string(),
	name: z.string(),
	orders: z.array(orderSchema),
	settings: z.looseObject({ theme: z.string() })
});
const partySchema = z.union([
	z.object({ email: z.string(), kind: z.literal('person'), name: z.string() }),
	z.object({ kind: z.literal('company'), name: z.string(), taxId: z.string() })
]);

const treeSchema = z.object({
	get children() {
		return z.array(treeSchema);
	},
	label: z.string(),
	name: z.string()
});

type User = z.infer<typeof userSchema>;

const user = {
	_id: 'u1',
	address: { _id: 'a1', city: 'Austin', state: 'TX', zip: '78701' },
	email: 'ada@example.com',
	name: 'Ada',
	orders: [{ number: 'A-1', total: 10 }, { number: 'A-2', total: 25 }],
	settings: { density: 'compact', theme: 'dark' }
} satisfies User;

/** `row` typed as the read of `select`, as a find hands one back. */
function readAs<TSelect extends MultiSelect<typeof userSchema>>(_select: TSelect, row: object): InferMergedType<typeof userSchema, TSelect> {
	return row as InferMergedType<typeof userSchema, TSelect>;
}

/** A function reading more than its caller asked for, generic over the caller's select. */
function withEmailRead<TSelect extends MultiSelect<typeof userSchema> = undefined>(row: object, select?: TSelect): InferMergedType<typeof userSchema, TSelect> {
	const added = { email: true };
	const value = readAs(mergeSelect(userSchema, added, select), row);

	return stripSelect({ added, schema: userSchema, select, value });
}

/** An address that isn't plain data. */
class Place {
	constructor(readonly city: string, readonly zip: string) {}
}

describe('.stripSelect()', () => {
	it('should remove a field the select does not name', () => {
		const stripped = stripSelect({ added: { email: true }, schema: userSchema, select: { name: true }, value: { email: user.email, name: user.name } });
		const isTyped: IsEqual<typeof stripped, { name: string }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(stripped, { name: user.name });
	});

	it('should hand back a read by a merged select as the select alone types it', () => {
		const added = { email: true };
		const select = { name: true };
		const value = readAs(mergeSelect(userSchema, added, select), { email: user.email, name: user.name });
		const stripped = stripSelect({ added, schema: userSchema, select, value });
		const isTyped: IsEqual<typeof stripped, { name: string }> = true;

		assert.ok(isTyped);
		assert.equal(value.email, user.email);
		assert.deepStrictEqual(stripped, { name: user.name });
	});

	it('should type and strip through a function generic over its caller\'s select', () => {
		const stripped = withEmailRead({ _id: user._id, email: user.email, name: user.name }, { name: true });
		const whole = withEmailRead(user);
		const isTyped: IsEqual<typeof stripped, { name: string }> = true;
		const isWholeTyped: IsEqual<typeof whole, User> = true;

		assert.ok(isTyped);
		assert.ok(isWholeTyped);
		assert.deepStrictEqual(stripped, { _id: user._id, name: user.name });
		assert.deepStrictEqual(whole, user);
	});

	it('should keep an added field the select names too', () => {
		const stripped = stripSelect({ added: { email: true }, schema: userSchema, select: { email: true, name: true }, value: { email: user.email, name: user.name } });
		const isTyped: IsEqual<typeof stripped, { email: string, name: string }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(stripped, { email: user.email, name: user.name });
	});

	it('should remove nothing when no select is given: the whole model was asked for', () => {
		const stripped = stripSelect({ added: { email: true, settings: true }, schema: userSchema, value: user });
		const isTyped: IsEqual<typeof stripped, User> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(stripped, user);
	});

	it('should remove nothing when the select is the model itself, alone or in the list a merge makes of no select', () => {
		const added = { settings: true };

		// `density` is a key the loose `settings` declares nowhere: reading the model as its declared keys would drop it.
		assert.deepStrictEqual(stripSelect({ added, schema: userSchema, select: userSchema, value: user }), user);
		assert.deepStrictEqual(stripSelect({ added, schema: userSchema, select: mergeSelect(userSchema, { name: true }), value: user }), user);
	});

	it('should leave what neither select names as it is', () => {
		const stripped = stripSelect({ added: { email: true }, schema: userSchema, select: { name: true }, value: { _id: user._id, email: user.email, name: user.name } });

		assert.deepStrictEqual(stripped, { _id: user._id, name: user.name });
	});

	it('should remove, within a field both selects pick into, only what was added', () => {
		const stripped = stripSelect({ added: { address: { state: true, zip: true } }, schema: userSchema, select: { address: { city: true, zip: true }, name: true }, value: { address: user.address, name: user.name } });
		const isTyped: IsEqual<typeof stripped, { address: { city: string, zip: string }, name: string }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(stripped, { address: { _id: user.address._id, city: user.address.city, zip: user.address.zip }, name: user.name });
	});

	it('should leave a field added whole and selected in part with that part alone', () => {
		const stripped = stripSelect({ added: { address: true }, schema: userSchema, select: { address: { city: true } }, value: { address: user.address } });
		const isTyped: IsEqual<typeof stripped, { address: { city: string } }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(stripped, { address: { city: user.address.city } });
	});

	it('should keep whole a field added in part and selected whole', () => {
		const stripped = stripSelect({ added: { address: { zip: true } }, schema: userSchema, select: { address: true }, value: { address: user.address } });

		assert.deepStrictEqual(stripped, { address: user.address });
	});

	it('should strip each element of an array', () => {
		const stripped = stripSelect({ added: { orders: { total: true } }, schema: userSchema, select: { orders: { number: true } }, value: { orders: user.orders } });
		const isTyped: IsEqual<typeof stripped, { orders: { number: string }[] }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(stripped, { orders: [{ number: 'A-1' }, { number: 'A-2' }] });
	});

	it('should leave what is not an object where a select picks into one, in a field or an array', () => {
		const value = { address: null, name: user.name, orders: [null, 'A-0', user.orders[0]] };
		const stripped = stripSelect({ added: { address: { zip: true }, orders: { total: true } }, schema: userSchema, select: { address: { city: true }, name: true, orders: { number: true } }, value });

		assert.deepStrictEqual(stripped, { address: null, name: user.name, orders: [null, 'A-0', { number: 'A-1' }] });
	});

	it('should keep what any select of a list names, their picks into one field merged', () => {
		const select = [{ address: { city: true } }, { address: { zip: true }, name: true }] satisfies MultiSelect<typeof userSchema>;
		const stripped = stripSelect({ added: { address: true, email: true }, schema: userSchema, select, value: { address: user.address, email: user.email, name: user.name } });
		const isTyped: IsEqual<typeof stripped, { address: { city: string, zip: string }, name: string }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(stripped, { address: { city: user.address.city, zip: user.address.zip }, name: user.name });
	});

	it('should treat a field selected as false as not selected, by either select', () => {
		const value = { email: user.email, name: user.name };

		assert.deepStrictEqual(stripSelect({ added: { email: true }, schema: userSchema, select: { email: false, name: true }, value }), { name: user.name });
		assert.deepStrictEqual(stripSelect({ added: { email: true, name: false }, schema: userSchema, select: { _id: true }, value }), { name: user.name });
	});

	it('should read a field a function refines as selected whole, by either select', () => {
		const value = { email: user.email, name: user.name };
		const kept = stripSelect({ added: { email: true }, schema: userSchema, select: { email: (email: z.ZodString) => email.optional(), name: true }, value });
		const isTyped: IsEqual<typeof kept, { email?: string, name: string }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(kept, value);
		assert.deepStrictEqual(stripSelect({ added: { email: (email: z.ZodString) => email.optional() }, schema: userSchema, select: { name: true }, value }), { name: user.name });
	});

	it('should read a field given a type as that type\'s schema select', () => {
		const picked = stripSelect({ added: { address: true }, schema: userSchema, select: { address: z.object({ city: z.string() }) }, value: { address: user.address } });
		const whole = stripSelect({ added: { settings: true }, schema: userSchema, select: { settings: z.record(z.string(), z.string()) }, value: { settings: user.settings } });

		assert.deepStrictEqual(picked, { address: { city: user.address.city } });
		assert.deepStrictEqual(whole, { settings: user.settings });
		assert.deepStrictEqual(stripSelect({ added: { address: z.any() }, schema: userSchema, select: { address: { city: true } }, value: { address: user.address } }), picked);
	});

	it('should read a schema select as all it declares, added or selected, through objects and arrays', () => {
		const contact = z.object({ email: z.string(), name: z.string() });
		const located = z.object({ address: z.object({ city: z.string() }), name: z.string(), orders: z.array(z.object({ number: z.string() })) });
		const value = { address: user.address, email: user.email, name: user.name, orders: user.orders };
		const stripped = stripSelect({ added: contact, schema: userSchema, select: located, value });
		const isTyped: IsEqual<typeof stripped, { address: { city: string }, name: string, orders: { number: string }[] }> = true;

		assert.ok(isTyped);
		assert.deepStrictEqual(stripped, { address: user.address, name: user.name, orders: user.orders });
		assert.deepStrictEqual(
			stripSelect({ added: { address: true, orders: true }, schema: userSchema, select: located, value }),
			{ address: { city: user.address.city }, email: user.email, name: user.name, orders: [{ number: 'A-1' }, { number: 'A-2' }] }
		);
	});

	it('should remove nothing for a schema select that declares no fields to pick, whichever kind it is', () => {
		const value = { email: user.email, name: user.name };

		for (const select of [z.record(z.string(), z.unknown()), userSchema.transform(read => read), z.custom<User>()]) {
			assert.deepStrictEqual(stripSelect({ added: { email: true }, schema: userSchema, select, value }), value);
		}
	});

	it('should keep whole what a schema select cannot pick into', () => {
		const select = z.object({
			address: z.union([z.custom<{ city: string }>(), z.null()]),
			orders: z.array(z.union([z.object({ number: z.string() }), z.string()])),
			settings: z.looseObject({ theme: z.string() })
		});
		const value = { address: user.address, orders: user.orders, settings: user.settings };

		assert.deepStrictEqual(stripSelect({ added: { address: true, orders: true, settings: true }, schema: userSchema, select, value }), value);
		assert.deepStrictEqual(stripSelect({ added: { settings: true }, schema: userSchema, select: z.object({ settings: z.object({ theme: z.string() }).catchall(z.string()) }), value }), value);
	});

	it('should read a union in a schema select as the fields of every member, one holding no value aside', () => {
		const select = z.union([z.object({ kind: z.literal('person'), name: z.string() }), z.object({ kind: z.literal('company'), taxId: z.string() })]);
		const person = { email: user.email, kind: 'person', name: user.name };
		const company = { kind: 'company', name: 'Acme', taxId: 'T-1' };
		const located = z.object({ address: z.union([z.object({ city: z.string() }), z.null(), z.undefined(), z.void(), z.never()]) });

		assert.deepStrictEqual(stripSelect({ added: { email: true, name: true }, schema: partySchema, select, value: person }), { kind: 'person', name: user.name });
		assert.deepStrictEqual(stripSelect({ added: { name: true, taxId: true }, schema: partySchema, select, value: company }), company);
		assert.deepStrictEqual(stripSelect({ added: { address: true }, schema: userSchema, select: located, value: { address: user.address } }), { address: { city: user.address.city } });
	});

	it('should read an intersection in a schema select as the fields of both sides, whole if either can\'t be picked into', () => {
		const value = { _id: user._id, email: user.email, name: user.name };
		const both = z.intersection(z.object({ _id: z.string() }), z.object({ name: z.string() }));
		const open = z.intersection(z.object({ name: z.string() }), z.record(z.string(), z.unknown()));

		assert.deepStrictEqual(stripSelect({ added: { _id: true, email: true, name: true }, schema: userSchema, select: both, value }), { _id: user._id, name: user.name });
		assert.deepStrictEqual(stripSelect({ added: { email: true }, schema: userSchema, select: open, value }), value);
	});

	it('should stop where a lazy schema select reaches itself: as the select, as a field\'s type and as what was added', () => {
		interface Labelled { children: Labelled[], label: string }
		interface Named { children: Named[], name: string }

		const labelled: z.ZodType<Labelled> = z.lazy(() => z.object({ children: z.array(labelled), label: z.string() }));
		const named: z.ZodType<Named> = z.lazy(() => z.object({ children: z.array(named), name: z.string() }));
		const tree = { children: [{ children: [], label: 'leaf', name: 'Leaf' }], label: 'root', name: 'Root' };

		assert.deepStrictEqual(stripSelect({ added: { label: true }, schema: treeSchema, select: named, value: tree }), { children: tree.children, name: tree.name });
		assert.deepStrictEqual(stripSelect({ added: { children: true }, schema: treeSchema, select: { children: named }, value: tree }), { children: [{ children: [], name: 'Leaf' }], label: tree.label, name: tree.name });
		assert.deepStrictEqual(stripSelect({ added: labelled, schema: treeSchema, select: { children: { name: true }, name: true }, value: tree }), { children: [{ name: 'Leaf' }], name: tree.name });
	});

	it('should stop at a schema built anew at every level, and at one that only wraps itself', () => {
		const nest = (): z.ZodType<unknown> => z.lazy(() => z.array(nest()));
		const wrapped: z.ZodType<unknown> = z.lazy(() => z.array(wrapped));
		const value = { orders: user.orders, settings: user.settings };

		assert.deepStrictEqual(stripSelect({ added: { orders: true }, schema: userSchema, select: { orders: nest() }, value }), value);
		assert.deepStrictEqual(stripSelect({ added: { settings: true }, schema: userSchema, select: { settings: z.union([z.string(), wrapped]) }, value }), value);
	});

	it('should read schemas that hold each other the same whichever was read first', () => {
		const linked = () => {
			const person = z.object({
				get employer() {
					return company;
				},
				name: z.string()
			});
			const company = z.object({
				get owner() {
					return person;
				},
				title: z.string()
			});

			return { company, person };
		};
		const firmSchema = z.object({ owner: z.object({ _id: z.string(), name: z.string() }), title: z.string() });
		const value = { owner: { _id: user._id, name: user.name }, title: 'Acme' };
		const strip = (added: z.ZodType<object>) => stripSelect({ added, schema: firmSchema, select: { owner: { name: true } }, value });
		const fresh = linked();
		const read = linked();

		stripSelect({ added: read.person, schema: firmSchema, select: { title: true }, value });

		// `_id` is a key `person` doesn't declare: reading `owner` as whole, as it is where `company` reaches itself, would remove it.
		assert.deepStrictEqual(strip(fresh.company), { owner: value.owner });
		assert.deepStrictEqual(strip(read.company), { owner: value.owner });
	});

	it('should read a schema select afresh after a read of it failed', () => {
		let isFailing = true;
		const select = z.lazy(() => {
			if (isFailing) {
				throw new Error('not ready');
			}

			return z.object({ name: z.string() });
		});
		const strip = () => stripSelect({ added: { email: true }, schema: userSchema, select, value: { email: user.email, name: user.name } });

		assert.throws(strip, /not ready/);

		isFailing = false;

		assert.deepStrictEqual(strip(), { name: user.name });
	});

	it('should keep whole a schema select from where it holds itself, the same on every call', () => {
		const named = z.object({
			get children() {
				return z.array(named);
			},
			name: z.string()
		});
		const labelled = z.object({
			get children() {
				return z.array(labelled);
			},
			label: z.string()
		});
		const tree = { children: [{ children: [], label: 'leaf', name: 'Leaf' }], label: 'root', name: 'Root' };
		const strip = () => stripSelect({ added: labelled, schema: treeSchema, select: named, value: tree });

		assert.deepStrictEqual(strip(), { children: tree.children, name: tree.name });
		assert.deepStrictEqual(strip(), { children: tree.children, name: tree.name });
	});

	it('should leave an object that is not plain data whole', () => {
		const place = new Place(user.address.city, user.address.zip);
		const stripped = stripSelect({ added: { address: { zip: true } }, schema: userSchema, select: { address: { city: true } }, value: { address: place } });

		assert.deepStrictEqual(stripped, { address: place });
	});

	it('should never change the value passed in', () => {
		const value = structuredClone(user);

		stripSelect({
			added: { address: { zip: true }, email: true, orders: { total: true }, settings: true },
			schema: userSchema,
			select: { address: { city: true }, orders: { number: true } },
			value
		});

		assert.deepStrictEqual(value, user);
	});
});
