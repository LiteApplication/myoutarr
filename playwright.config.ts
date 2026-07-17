import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	timeout: 60_000,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'retain-on-failure'
	},
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		// The e2e suite boots against a throwaway config dir; see e2e/setup.
		env: {
			CONFIG_DIR: process.env.CONFIG_DIR ?? './e2e/.tmp/config',
			MUSIC_DIR: process.env.MUSIC_DIR ?? './e2e/.tmp/music'
		}
	}
});
