import { test, expect } from '@playwright/test';

test('real-time messaging Ankit <-> Rahul', async ({ browser }) => {
  const contextAnkit = await browser.newContext();
  const contextRahul = await browser.newContext();

  const pageAnkit = await contextAnkit.newPage();
  const pageRahul = await contextRahul.newPage();

  // Step 1: Log in Ankit
  await pageAnkit.goto('http://localhost:3000');
  await pageAnkit.fill('input[name="identifier"]', 'ankit');
  await pageAnkit.fill('input[name="password"]', 'Demo@1234');
  await pageAnkit.click('button[type="submit"]');
  // Should land on conversations
  await expect(pageAnkit.locator('text=Ankit Kumar').first()).toBeVisible({ timeout: 15000 });

  // Step 2: Log in Rahul
  await pageRahul.goto('http://localhost:3000');
  await pageRahul.fill('input[name="identifier"]', 'rahul');
  await pageRahul.fill('input[name="password"]', 'Demo@1234');
  await pageRahul.click('button[type="submit"]');
  // Wait for Rahul's UI
  await expect(pageRahul.locator('text=Rahul Sharma').first()).toBeVisible({ timeout: 15000 });

  // Step 3: Ankit starts a new conversation with Rahul
  await pageAnkit.click('text=+ New message'); 
  await pageAnkit.fill('input[placeholder="Search people..."]', 'rahul');
  await pageAnkit.click('text=Rahul Sharma');
  
  // Verify Ankit is in chat with Rahul
  await expect(pageAnkit.locator('text=Rahul Sharma').first()).toBeVisible();

  // Step 4: Ankit sends a message to Rahul
  const msgFromAnkit = 'Hello Rahul ' + Date.now();
  await pageAnkit.fill('textarea', msgFromAnkit);
  await pageAnkit.keyboard.press('Enter');

  // Verify Ankit sees it
  await expect(pageAnkit.locator(`text=${msgFromAnkit}`).first()).toBeVisible();

  // Step 5: Rahul should see Ankit Kumar in his conversation list
  await expect(pageRahul.locator('text=Ankit Kumar').first()).toBeVisible({ timeout: 10000 });
  await pageRahul.click('text=Ankit Kumar');
  
  // Verify Rahul sees the message
  await expect(pageRahul.locator(`text=${msgFromAnkit}`).first()).toBeVisible();

  // Wait a moment for read receipts to sync to Ankit
  await pageAnkit.waitForTimeout(2000);

  // Step 6: Rahul sends a message to Ankit
  const msgFromRahul = 'Hi Ankit ' + Date.now();
  await pageRahul.fill('textarea', msgFromRahul);
  await pageRahul.keyboard.press('Enter');

  // Verify Rahul sees it
  await expect(pageRahul.locator(`text=${msgFromRahul}`).first()).toBeVisible();

  // Verify Ankit sees it
  await expect(pageAnkit.locator(`text=${msgFromRahul}`).first()).toBeVisible();

  await contextAnkit.close();
  await contextRahul.close();
});
