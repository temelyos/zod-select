import { promisify } from 'node:util';
import { exec, spawnSync } from 'node:child_process';
import { cwd } from 'node:process';
import { readFileSync } from 'node:fs';

function getPackageJson() {
	return JSON.parse(readFileSync(`${cwd()}\\package.json`, 'utf8'));
}

async function getPublishedVersion(pgk) {
	try {
		return (await promisify(exec)(`npm view ${pgk} version`)).stdout.trimEnd();
	} catch (err) {
		if (err.stderr && err.stderr.indexOf(' code E404\n') > -1) {
			return '0.0.0';
		}

		throw err;
	}
}

const packageJson = getPackageJson();
const publishdVersion = await getPublishedVersion(packageJson.name);

console.log(packageJson.name);
console.log(`Published Version: ${publishdVersion}`);
console.log(`Package Version: ${packageJson.version}`);

if (packageJson.version !== publishdVersion) {
	console.log('Publishing...');
	// Attached to the terminal, so npm can ask for a one-time password or a browser sign-in.
	const { status } = spawnSync('pnpm publish --access public', { shell: true, stdio: 'inherit' });

	if (status !== 0) process.exit(status ?? 1);
} else {
	console.log('Skipping Publish.');
}