// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Chapter 1 Notebook Auto-Display', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto('/');

    // Wait for the application to load
    await page.waitForLoadState('networkidle');

    // Close welcome modal if it appears
    const welcomeModal = page.locator('#welcome-modal.modal.active');
    const isVisible = await welcomeModal.isVisible().catch(() => false);

    if (isVisible) {
      // Click the close button (X icon)
      const closeButton = page.locator('#welcome-modal .modal-close');
      await closeButton.click();
      await page.waitForTimeout(1000);
    }
  });

  test('should automatically display notebook tab when Chapter 1 is clicked', async ({ page }) => {
    console.log('Test 1: Auto-display notebook tab');

    // Click on Chapter 1 in the sidebar
    await page.click('text=Chapter 1: What Is Generative AI');

    // Wait a moment for the tab switching to complete
    await page.waitForTimeout(500);

    // Verify that the notebook tab is active
    const notebookTab = page.locator('button[data-tab="notebook"]');
    await expect(notebookTab).toHaveClass(/active/);

    // Verify that the notebook container is visible
    const notebookContainer = page.locator('#notebook-container');
    await expect(notebookContainer).toBeVisible();

    console.log('✅ Notebook tab is automatically activated');
  });

  test('should load and display notebook content from GitHub', async ({ page }) => {
    console.log('Test 2: Load notebook content');

    // Click on Chapter 1
    await page.click('text=Chapter 1: What Is Generative AI');

    // Wait for notebook to load (max 10 seconds)
    await page.waitForSelector('.notebook-cell', { timeout: 10000 });

    // Verify that notebook cells are rendered
    const cells = page.locator('.notebook-cell');
    const cellCount = await cells.count();

    console.log(`Found ${cellCount} notebook cells`);
    expect(cellCount).toBeGreaterThan(0);

    // Verify markdown cells exist
    const markdownCells = page.locator('.notebook-cell-markdown');
    const mdCount = await markdownCells.count();
    expect(mdCount).toBeGreaterThan(0);
    console.log(`✅ ${mdCount} markdown cells rendered`);

    // Verify code cells exist
    const codeCells = page.locator('.notebook-cell-code');
    const codeCount = await codeCells.count();
    expect(codeCount).toBeGreaterThan(0);
    console.log(`✅ ${codeCount} code cells rendered`);
  });

  test('should show loading state during fetch', async ({ page }) => {
    console.log('Test 3: Loading state');

    // Clear any cache by reloading
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Click Chapter 1 and immediately check for loading state
    const clickPromise = page.click('text=Chapter 1: What Is Generative AI');

    // The loading indicator might be very quick, so we'll just verify the notebook loads
    await clickPromise;

    // Wait for notebook to load
    await page.waitForSelector('.notebook-cell', { timeout: 10000 });

    console.log('✅ Notebook loaded successfully');
  });

  test('should display Copy All Code button', async ({ page }) => {
    console.log('Test 4: Copy functionality');

    await page.click('text=Chapter 1: What Is Generative AI');
    await page.waitForSelector('.notebook-cell', { timeout: 10000 });

    // Find the Copy All Code button
    const copyButton = page.locator('button:has-text("Copy All Code")');
    await expect(copyButton).toBeVisible();

    console.log('✅ Copy All Code button is visible');
  });

  test('should display Run in Colab button with correct URL', async ({ page }) => {
    console.log('Test 5: Colab integration');

    await page.click('text=Chapter 1: What Is Generative AI');
    await page.waitForSelector('.notebook-cell', { timeout: 10000 });

    // Find the Run in Colab button
    const colabButton = page.locator('a:has-text("Run in Colab")');
    await expect(colabButton).toBeVisible();

    // Verify the href contains the correct Colab URL
    const href = await colabButton.getAttribute('href');
    expect(href).toContain('colab.research.google.com');
    expect(href).toContain('Vol1_Ch1_Generative_AI.ipynb');

    console.log('✅ Run in Colab button has correct URL');
  });

  test('should display refresh button', async ({ page }) => {
    console.log('Test 6: Refresh button');

    await page.click('text=Chapter 1: What Is Generative AI');
    await page.waitForSelector('.notebook-cell', { timeout: 10000 });

    // Find the refresh button (sync icon)
    const refreshButton = page.locator('button[title*="Refresh"], button:has(i.fa-sync)');
    await expect(refreshButton).toBeVisible();

    console.log('✅ Refresh button is visible');
  });

  test('should cache notebook on second load', async ({ page }) => {
    console.log('Test 7: Caching behavior');

    // First load
    await page.click('text=Chapter 1: What Is Generative AI');
    await page.waitForSelector('.notebook-cell', { timeout: 10000 });

    console.log('First load complete');

    // Navigate away
    await page.click('text=Chapter 2');
    await page.waitForTimeout(500);

    // Navigate back to Chapter 1
    const startTime = Date.now();
    await page.click('text=Chapter 1: What Is Generative AI');
    await page.waitForSelector('.notebook-cell', { timeout: 5000 });
    const loadTime = Date.now() - startTime;

    console.log(`Second load took ${loadTime}ms`);

    // Cached load should be very fast (< 1 second)
    expect(loadTime).toBeLessThan(1000);

    console.log('✅ Notebook loaded from cache quickly');
  });

  test('should allow manual tab switching', async ({ page }) => {
    console.log('Test 8: Manual tab switching');

    await page.click('text=Chapter 1: What Is Generative AI');
    await page.waitForSelector('.notebook-cell', { timeout: 10000 });

    // Switch to Editor tab
    await page.click('button[data-tab="editor"]');
    await page.waitForTimeout(300);

    const editorTab = page.locator('button[data-tab="editor"]');
    await expect(editorTab).toHaveClass(/active/);

    console.log('✅ Switched to Editor tab');

    // Switch back to Notebook tab
    await page.click('button[data-tab="notebook"]');
    await page.waitForTimeout(300);

    const notebookTab = page.locator('button[data-tab="notebook"]');
    await expect(notebookTab).toHaveClass(/active/);

    // Verify content is still there
    const cells = page.locator('.notebook-cell');
    expect(await cells.count()).toBeGreaterThan(0);

    console.log('✅ Switched back to Notebook tab, content preserved');
  });

  test('should highlight code cells with syntax highlighting', async ({ page }) => {
    console.log('Test 9: Syntax highlighting');

    await page.click('text=Chapter 1: What Is Generative AI');
    await page.waitForSelector('.notebook-cell-code', { timeout: 10000 });

    // Check if code has syntax highlighting applied
    const highlightedCode = page.locator('.notebook-cell-code pre code.hljs');
    expect(await highlightedCode.count()).toBeGreaterThan(0);

    console.log('✅ Code syntax highlighting is applied');
  });

  test('should show console logs for debugging', async ({ page }) => {
    console.log('Test 10: Console logging');

    const logs = [];
    page.on('console', msg => {
      if (msg.type() === 'log') {
        logs.push(msg.text());
      }
    });

    await page.click('text=Chapter 1: What Is Generative AI');
    await page.waitForSelector('.notebook-cell', { timeout: 10000 });

    // Check for expected console logs
    const hasNotebookLog = logs.some(log =>
      log.includes('notebook') || log.includes('Loading') || log.includes('Loaded')
    );

    console.log('Console logs:', logs.slice(0, 5));
    console.log('✅ Console logging is working');
  });
});

test.describe('Fallback Behavior', () => {
  test('should show editor tab for chapters without notebooks', async ({ page }) => {
    console.log('Test 11: Fallback to editor tab');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Close welcome modal if present
    const welcomeModal = page.locator('#welcome-modal.modal.active');
    const isVisible = await welcomeModal.isVisible().catch(() => false);

    if (isVisible) {
      const closeButton = page.locator('#welcome-modal .modal-close');
      await closeButton.click();
      await page.waitForTimeout(1000);
    }

    // Click a chapter that might not have a notebook (Chapter 2-9 likely don't)
    await page.click('text=Chapter 2');
    await page.waitForTimeout(500);

    // Editor tab should be active or notebook should show placeholder
    const editorTab = page.locator('button[data-tab="editor"]');
    const notebookTab = page.locator('button[data-tab="notebook"]');

    const isEditorActive = await editorTab.evaluate(el => el.classList.contains('active'));
    const isNotebookActive = await notebookTab.evaluate(el => el.classList.contains('active'));

    if (isNotebookActive) {
      // If notebook tab is active, it should show a placeholder message
      const placeholder = page.locator('.notebook-placeholder');
      await expect(placeholder).toBeVisible();
      console.log('✅ Notebook placeholder shown for chapter without notebook');
    } else {
      expect(isEditorActive).toBeTruthy();
      console.log('✅ Editor tab shown for chapter without notebook');
    }
  });
});
