/** A select as plain data: each key selected whole, or by the keys within it. */
export interface SelectObject { [key: string]: SelectValue }

export type SelectValue = SelectObject | true;

/** Two selects of one value: `true` if either selects it whole; else their keys merged. */
export function mergeSelectValue(a: SelectValue, b: SelectValue): SelectValue {
	if ((a === true) || (b === true)) {
		return true;
	}

	const merged: SelectObject = { ...a };

	for (const [key, value] of Object.entries(b)) {
		const existing = merged[key];

		merged[key] = (existing === undefined) ? value : mergeSelectValue(existing, value);
	}

	return merged;
}
