import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import Path from 'node:path';

// oxlint applies one pass of fixes and skips any that overlap, where ESLint repeats up to ten
// times; run it until the files stop changing, so `lint:fix` lands every fix ESLint's would.
const MAX_PASSES = 10;
const oxlint = Path.join(Path.dirname(createRequire(import.meta.url).resolve('oxlint/package.json')), 'bin', 'oxlint');
const args = process.argv.slice(2);

function hashSources(dir, hash = createHash('sha1')) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === 'dist') continue;

		const path = Path.join(dir, entry.name);

		if (entry.isDirectory()) hashSources(path, hash);
		else hash.update(path).update(fs.readFileSync(path));
	}

	return hash;
}

const run = extra => spawnSync(process.execPath, [oxlint, ...args, ...extra], { stdio: 'inherit' }).status ?? 1;

for (let pass = 0; pass < MAX_PASSES; pass++) {
	const before = hashSources(process.cwd()).digest('hex');

	spawnSync(process.execPath, [oxlint, ...args, '--fix', '--quiet'], { stdio: 'ignore' });

	if (hashSources(process.cwd()).digest('hex') === before) break;
}

process.exit(run([]));
