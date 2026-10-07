import { test, expect } from '@playwright/test';

test('diagnose receipt state flow', async ({ browser }) => {
  const contextAnkit = await browser.newContext();
  const contextRahul = await browser.newContext();

  const pageAnkit = await contextAnkit.newPage();
  const pageRahul = await contextRahul.newPage();

  // Attach WS loggers
  pageAnkit.on('websocket', ws => {
    console.log(`[Ankit WS Connected]: ${ws.url()}`);
    ws.on('framesent', frame => console.log(`[Ankit WS SENT]: ${frame.payload}`));
    ws.on('framereceived', frame => console.log(`[Ankit WS RECV]: ${frame.payload}`));
  });

  pageRahul.on('websocket', ws => {
    console.log(`[Rahul WS Connected]: ${ws.url()}`);
    ws.on('framesent', frame => console.log(`[Rahul WS SENT]: ${frame.payload}`));
    ws.on('framereceived', frame => console.log(`[Rahul WS RECV]: ${frame.payload}`));
  });

  // Attach API loggers for GET /conversations
  pageAnkit.on('response', async res => {
    if (res.url().includes('/conversations') && res.request().method() === 'GET') {
      try {
        const json = await res.json();
        console.log(`[Ankit GET /conversations Response]: ${JSON.stringify(json)}`);
      } catch (e) {}
    }
  });

  pageRahul.on('response', async res => {
    if (res.url().includes('/conversations') && res.request().method() === 'GET') {
      try {
        const json = await res.json();
        console.log(`[Rahul GET /conversations Response]: ${JSON.stringify(json)}`);
      } catch (e) {}
    }
  });

  // Step 1: Log in Ankit
  console.log('--- Logging in Ankit ---');
  await pageAnkit.goto('http://localhost:3000');
  await pageAnkit.fill('input[name="identifier"]', 'ankit');
  await pageAnkit.fill('input[name="password"]', 'Demo@1234');
  await pageAnkit.click('button[type="submit"]');
  await expect(pageAnkit.locator('text=Ankit Kumar').first()).toBeVisible({ timeout: 15000 });
  console.log('--- Ankit Logged In ---');

  // Step 2: Log in Rahul
  console.log('--- Logging in Rahul ---');
  await pageRahul.goto('http://localhost:3000');
  await pageRahul.fill('input[name="identifier"]', 'rahul');
  await pageRahul.fill('input[name="password"]', 'Demo@1234');
  await pageRahul.click('button[type="submit"]');
  await expect(pageRahul.locator('text=Rahul Sharma').first()).toBeVisible({ timeout: 15000 });
  console.log('--- Rahul Logged In ---');

  // Step 3: Ankit opens chat with Rahul
  console.log('--- Ankit opening chat with Rahul ---');
  await pageAnkit.click('text=+ New message'); 
  await pageAnkit.fill('input[placeholder="Search people..."]', 'rahul');
  await pageAnkit.click('text=Rahul Sharma');
  await expect(pageAnkit.locator('text=Rahul Sharma').first()).toBeVisible();

  // Wait a bit to ensure WS is settled
  await pageAnkit.waitForTimeout(1000);
  await pageRahul.waitForTimeout(1000);

  // Step 4: Ankit sends TEST_RECEIPT_001
  console.log('--- Ankit sending TEST_RECEIPT_001 ---');
  const msgFromAnkit = 'TEST_RECEIPT_001';
  await pageAnkit.fill('textarea', msgFromAnkit);
  await pageAnkit.keyboard.press('Enter');

  // Verify Ankit sees it
  await expect(pageAnkit.locator(`text=${msgFromAnkit}`).first()).toBeVisible();

  // Wait 2 seconds for delivery receipts to flow BEFORE Rahul reads it
  await pageAnkit.waitForTimeout(2000);

  // Step 5: Rahul opens the chat (triggering read receipt)
  console.log('--- Rahul opening chat with Ankit ---');
  await expect(pageRahul.locator('text=Ankit Kumar').first()).toBeVisible({ timeout: 10000 });
  await pageRahul.click('text=Ankit Kumar');
  
  // Verify Rahul sees the message
  await expect(pageRahul.locator(`text=${msgFromAnkit}`).first()).toBeVisible();

  // Wait 2 seconds for read receipts to flow
  await pageAnkit.waitForTimeout(2000);

  console.log('--- Test script done ---');
  await contextAnkit.close();
  await contextRahul.close();
});
