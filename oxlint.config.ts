import { defineConfig } from 'oxlint';

import temelyos from '@temelyos/oxlint-config';

export default defineConfig({
	extends: [temelyos],
	ignorePatterns: ['.claude/**', '**/dist/**', '**/scripts/**', 'oxlint.config.ts', 'test.ts'],
	options: { typeAware: true }
});
