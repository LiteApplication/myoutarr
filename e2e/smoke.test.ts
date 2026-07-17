import { expect, test } from '@playwright/test';

test('app boots and serves the shell', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('body')).toBeVisible();
});
