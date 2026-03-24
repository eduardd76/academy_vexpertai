// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Welcome Modal Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8001');
  });

  test('should display welcome modal on page load', async ({ page }) => {
    // Wait for modal to appear
    const modal = page.locator('#welcome-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test('should close modal when clicking close button', async ({ page }) => {
    // Wait for modal
    const modal = page.locator('#welcome-modal');
    await expect(modal).toBeVisible();

    // Click close button
    const closeButton = page.locator('.modal-close');
    await closeButton.click();

    // Modal should be hidden
    await expect(modal).not.toHaveClass(/active/);
  });

  test('should close modal when clicking outside', async ({ page }) => {
    const modal = page.locator('#welcome-modal');
    await expect(modal).toBeVisible();

    // Click on modal backdrop (outside content)
    await modal.click({ position: { x: 10, y: 10 } });

    // Modal should be hidden
    await expect(modal).not.toHaveClass(/active/);
  });

  test('should close modal and load first chapter on Start Learning', async ({ page }) => {
    const modal = page.locator('#welcome-modal');
    await expect(modal).toBeVisible();

    // Click Start Learning button
    const startButton = page.locator('#start-learning');
    await startButton.click();

    // Modal should close
    await expect(modal).not.toHaveClass(/active/);

    // First module should load
    await expect(page.locator('#theory-content')).toContainText('Welcome to Volume 1', {
      timeout: 3000
    });
  });

  test('should show toast on Take a Tour click', async ({ page }) => {
    const modal = page.locator('#welcome-modal');
    await expect(modal).toBeVisible();

    // Click Take a Tour button
    const tourButton = page.locator('#take-tour');
    await tourButton.click();

    // Modal should close
    await expect(modal).not.toHaveClass(/active/);

    // Toast should appear
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 2000 });
    await expect(toast).toContainText('Tour feature');
  });
});

test.describe('Modal Interaction Tests', () => {
  test('ESC key should close modal', async ({ page }) => {
    await page.goto('http://localhost:8001');

    const modal = page.locator('#welcome-modal');
    await expect(modal).toBeVisible();

    // Press ESC
    await page.keyboard.press('Escape');

    // Modal should be hidden
    await expect(modal).not.toHaveClass(/active/);
  });

  test('modal should not reappear after closing', async ({ page }) => {
    await page.goto('http://localhost:8001');

    const modal = page.locator('#welcome-modal');
    await expect(modal).toBeVisible();

    // Close modal
    await page.locator('.modal-close').click();
    await expect(modal).not.toHaveClass(/active/);

    // Wait a bit
    await page.waitForTimeout(1000);

    // Modal should still be hidden
    await expect(modal).not.toHaveClass(/active/);
  });
});
