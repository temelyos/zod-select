# ZodSelect

**ZodSelect** is a strongly typed selection utility library built on top of [Zod](https://github.com/colinhacks/zod) (v4). It allows developers to create dynamic select statements with precise TypeScript inference — perfect for shaping responses in database queries, or APIs. `ZodSelect` ensures that both your types and runtime logic stay in sync — with no external dependencies.

- ✅ Built on Zod v4
- ✅ No external dependencies (except `zod`)
- ✅ Fully type-safe field selections
- ✅ Supports merging multiple Zod Selects
- ✅ Generate Zod schemas from Zod Selects
- ✅ Allows schema refinement and overrides

---

## Install

```bash
pnpm add zod zodselect
# or
npm install zod zodselect
```

---

## Example Schema

All examples use the following Zod schema:

```ts
const UserSchema = z.object({
	email: z.string(),
	firstName: z.string(),
	lastName: z.string(),
	address: z.object({
		street: z.string(),
		city: z.string(),
		state: z.string(),
		zip: z.string()
	})
});
```

---

## 🧠 Zod Select with Inferred Type

A single selection object returns a strongly typed result:

```ts
function find<T extends ZodSelect<typeof UserSchema>>(select: T): InferType<typeof UserSchema, T> {
	// ...Find Logic
}

const user = find({
	firstName: true,
	lastName: true,
	address: { street: true }
});
```

```ts
// user inferred as:
{
	firstName: string;
	lastName: string;
	address: { street: string };
}
```

---

## 🔀 Merging Multiple Zod Selects

You can combine multiple select statements and still get precise inference:

```ts
function find<T extends MultiSelect<typeof UserSchema>>(select: T): InferMergedType<typeof UserSchema, T> {
	// ...Find Logic
}

const user = find([
	{ lastName: true },
	{ firstName: true }
]);
```

```ts
// user inferred as:
{
	firstName: string;
	lastName: string;
}
```

---

## 🧹 Mix Zod Schemas with Zod Selects

You can mix plain field selections with Zod object schemas for flexible results:

```ts
function find<T extends MultiSelect<typeof UserSchema>>(select: T): InferMergedType<typeof UserSchema, T> {
	// ...Find Logic
}

const user = find([
	{ lastName: true },
	z.object({
		address: z.object({ state: z.string() })
	})
]);
```

```ts
// user inferred as:
{
	lastName: string;
	address: { state: string };
}
```

---

## 🛠️ Generate Zod Schemas from Zod Selects

Use `refineSchema` to turn a selection into a Zod schema:

```ts
const schema = refineSchema(UserSchema, {
	firstName: true,
	address: true
});
```

```ts
// schema.shape:
{
	firstName: z.ZodString;
	address: z.ZodObject<...>;
}
```

A field the schema doesn't have is a type error, at any depth and even beside valid fields:

```ts
refineSchema(UserSchema, { firstName: true, lastNmae: true }); // ✖ 'lastNmae' is not a field of UserSchema
```

Code that builds a selection generically, whose type the check can't evaluate, calls `refineSchemaUnchecked` instead: the same refinement, with a field the schema doesn't have skipped.

---

## 🧪 Refine Field Types Inline

Selections can refine field types inline using Zod methods:

```ts
const schema = refineSchema(UserSchema, {
	firstName: s => s.optional()
});
```

```ts
// schema.shape:
{
	firstName: z.ZodOptional<z.ZodString>;
}
```

---

## 🧬 Redefine Field Types

Selections can also redefine types entirely:

```ts
const schema = refineSchema(UserSchema, {
	firstName: z.number()
});
```

```ts
// schema.shape:
{
	firstName: z.ZodNumber;
}
```

---

## 🧵 Putting it all together

Combining all methods and types together you can build powerful, type-safe selection and inference using the zod schemas you already have.

```ts
function find<T extends MultiSelect<typeof UserSchema>>(select: T): InferMergedType<typeof UserSchema, T>[] {
	const selectArr = Array.isArray(select) ? select : [select];
	const sel: Record<string, 1> = {};

	for (let schema of selectArr) {
		if (!(schema instanceof ZodType)) {
			schema = refineSchema(UserSchema, schema);
			continue;
		}

		// Crawl each zod schema building the select statement
	}

	// Find Logic
}

function getUsersFromTexas<T extends MultiSelect<typeof UserSchema>>(
	sel: T
): InferMergedType<typeof UserSchema, MergeSelect<typeof UserSchema, { address: boolean }, T>>[] {
	const users = find(
		// Use the merge select function to combined a ZodSelect with a MultiSelect
		mergeSelect(UserSchema, { address: true }, sel)
	);

	return users.filter((user) =>
		// At this point the user object has address and whatever fields are specified in the
		// passed in select but VS code doesn't know what fields are going to be passed in at
		// runtime. It does know that address was selected inside this function so it is
		// strongly typed with a fully selected address object
		user.address.state === 'TX'
	);
}

const users = getUsersFromTexas({
	firstName: true,
	lastName: true
});

// At this point we know what fields we selected and the extra fields added by the
// getUsersFromTexas function
```

```ts
// user inferred as:
{
	firstName: string;
	lastName: string;
	address: {
		street: string;
		city: string;
		state: string;
		zip: string;
	};
}[]
```