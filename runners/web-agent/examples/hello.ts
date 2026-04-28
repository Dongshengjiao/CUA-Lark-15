// M1 spike: drive headless Chromium with UI-TARS Browser Operator + Qwen3-VL-Plus.
//
// Two validation goals:
//   1. The user's local mouse must NOT move during the run (browser sandbox).
//   2. Qwen3-VL-Plus must produce action JSON in UI-TARS format
//      (e.g. click(start_box='[x,y]')) reliably enough for the agent loop.

import 'dotenv/config';
import { LocalBrowser } from '@agent-infra/browser';
import { ConsoleLogger } from '@agent-infra/logger';
import { GUIAgent } from '@ui-tars/sdk';
import { BrowserOperator } from '@ui-tars/operator-browser';

async function main() {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    console.error('DASHSCOPE_API_KEY not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  const logger = new ConsoleLogger('[lark-island/runner-spike]');

  console.log('==> Launching headless Chromium...');
  const browser = new LocalBrowser({ logger });
  await browser.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  // example.com is bot-friendly and bot-detection-free, perfect for spike.
  console.log('==> Creating page and navigating to example.com...');
  const page = await browser.createPage();
  await page.goto('https://example.com', { waitUntil: 'networkidle2' });

  console.log('==> Constructing BrowserOperator + GUIAgent...');
  const operator = new BrowserOperator({
    browser,
    browserType: 'chrome' as any,
    logger,
    highlightClickableElements: true,
    showActionInfo: false,
    showWaterFlow: false,
    onFinalAnswer: async (answer) => {
      console.log('\n========== FINAL ANSWER ==========');
      console.log(answer);
      console.log('===================================\n');
    },
  });

  let stepCount = 0;
  const agent = new GUIAgent({
    operator,
    model: {
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey,
      model: 'qwen3-vl-plus',
      // DashScope vision endpoints can take 30-90s for large screenshots.
      // OpenAI SDK's default short timeout fires too early.
      timeout: 180_000,
      maxRetries: 2,
    },
    logger,
    maxLoopCount: 5,
    onData: ({ data }) => {
      stepCount += 1;
      const lastConv = data.conversations?.[data.conversations.length - 1];
      const action = lastConv?.predictionParsed?.[0];
      console.log(
        `[step ${stepCount}] status=${data.status} action=${JSON.stringify(action ?? null).slice(0, 200)}`,
      );
    },
    onError: ({ error }) => {
      console.error('[agent error]', error);
    },
  });

  const instruction =
    'Read the page heading and the first paragraph aloud. ' +
    'Then call the finished tool with that text as your final answer. ' +
    'Do not click anything — the page is static.';

  console.log('==> Running agent...');
  console.log('    instruction:', instruction);
  const startedAt = Date.now();

  try {
    await agent.run(instruction);
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`==> Agent finished in ${elapsedSec}s after ${stepCount} steps.`);
  } catch (err) {
    console.error('[agent.run threw]', err);
  } finally {
    console.log('==> Closing browser...');
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
