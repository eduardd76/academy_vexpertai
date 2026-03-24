// @ts-check
const { test, expect } = require('@playwright/test');

test('debug modal event listeners', async ({ page }) => {
    // Capture console logs
    const consoleLogs = [];
    page.on('console', msg => {
        consoleLogs.push(`${msg.type()}: ${msg.text()}`);
    });

    // Capture errors
    const pageErrors = [];
    page.on('pageerror', error => {
        pageErrors.push(error.message);
    });

    await page.goto('http://localhost:8001');

    // Wait for modal to appear
    await page.waitForTimeout(1000);

    console.log('\n=== Console Logs ===');
    consoleLogs.forEach(log => console.log(log));

    console.log('\n=== Page Errors ===');
    if (pageErrors.length > 0) {
        pageErrors.forEach(err => console.log(err));
    } else {
        console.log('No page errors');
    }

    // Check if close button exists and is clickable
    const closeButton = page.locator('.modal-close');
    const closeButtonCount = await closeButton.count();
    console.log(`\n=== Close buttons found: ${closeButtonCount} ===`);

    // Get modal state
    const modal = page.locator('#welcome-modal');
    const modalClass = await modal.getAttribute('class');
    console.log(`\n=== Modal classes before click: ${modalClass} ===`);

    // Try clicking
    await closeButton.click();
    await page.waitForTimeout(500);

    // Check console logs after click
    console.log('\n=== Console Logs After Click ===');
    consoleLogs.forEach(log => console.log(log));

    const modalClassAfter = await modal.getAttribute('class');
    console.log(`\n=== Modal classes after click: ${modalClassAfter} ===`);

    // Check if event listener is attached
    const hasEventListener = await page.evaluate(() => {
        const btn = document.querySelector('.modal-close');
        return btn ? 'Event listener check not possible from browser context' : 'Button not found';
    });
    console.log(`\n=== Event listener check: ${hasEventListener} ===`);
});
