import { expect, test } from '@playwright/test';
import type http from 'node:http';
import { startMockJellyfin } from './mock-jellyfin.ts';

const JF_PORT = 41888;
let jellyfin: http.Server;

test.beforeAll(async () => {
	jellyfin = await startMockJellyfin(JF_PORT);
});

test.afterAll(() => {
	jellyfin.close();
});

// The suite is one continuous story: wizard → authenticated app.
test.describe.configure({ mode: 'serial' });

test('unconfigured instance redirects to the setup wizard', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/setup/);
	await expect(page.getByRole('heading', { name: 'Welcome to myoutarr' })).toBeVisible();
});

test('setup wizard: connect, authenticate, pick a library', async ({ page }) => {
	await page.goto('/setup');

	// Step 1: probe the server.
	await page.getByLabel('Jellyfin server URL').fill(`http://127.0.0.1:${JF_PORT}`);
	await page.getByRole('button', { name: 'Test connection' }).click();
	await expect(page.getByText('Connected to MockFlix')).toBeVisible();

	// Step 2: credentials (wrong password first - must surface an error).
	await page.getByLabel('Username').fill('admin');
	await page.getByLabel('Password').fill('wrong');
	await page.getByRole('button', { name: 'Sign in and continue' }).click();
	await expect(page.getByRole('alert')).toContainText('Wrong username or password');

	await page.getByLabel('Password').fill('secret');
	await page.getByRole('button', { name: 'Sign in and continue' }).click();

	// Step 3: the library pick, fed from the mock's VirtualFolders.
	await expect(page.getByText('Tunes')).toBeVisible();
	await page.getByRole('radio').first().check();
	await page.getByRole('button', { name: 'Finish setup' }).click();

	await expect(page).toHaveURL('/');
	await expect(page.getByText('Find music for your Jellyfin library')).toBeVisible();
});

/** Sessions are per-test contexts; sign in through the real login page. */
async function login(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/login');
	await page.getByLabel('Username').fill('admin');
	await page.getByLabel('Password').fill('secret');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL('/');
}

test('authenticated shell: queue, library, settings render', async ({ page }) => {
	await login(page);
	await page.goto('/queue');
	await expect(page.getByText('Nothing here yet')).toBeVisible();

	await page.goto('/library');
	await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();

	await page.goto('/settings');
	await expect(page.getByLabel('Parallel downloads (1–8)')).toHaveValue('2');
});

test('settings persist across a reload', async ({ page }) => {
	await login(page);
	await page.goto('/settings');
	await page.getByLabel('Parallel downloads (1–8)').fill('3');
	await page.getByRole('button', { name: 'Save settings' }).click();
	await expect(page.getByText('Settings saved.')).toBeVisible();

	await page.reload();
	await expect(page.getByLabel('Parallel downloads (1–8)')).toHaveValue('3');
});

test('logout returns to the login page, not the wizard', async ({ page }) => {
	await login(page);
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/login/);
	await expect(page.getByText('Sign in with your Jellyfin account')).toBeVisible();
});
