import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../dist');

import fs from 'fs/promises';

async function runTest() {
    console.log('Starting automated test...');
    console.log('Extension path:', EXTENSION_PATH);

    const browser = await puppeteer.launch({
        headless: false,
        dumpio: true, // Capture all stdout/stderr
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ],
        defaultViewport: { width: 1280, height: 800 }
    });

    try {
        // --- 1. Find Extension Background Worker & Inject Settings ---
        console.log('Identifying extension background worker...');

        // Wait for service worker
        let backgroundTarget;
        for (let i = 0; i < 10; i++) {
            const targets = await browser.targets();
            backgroundTarget = targets.find(t => t.type() === 'service_worker');
            if (backgroundTarget) break;
            await new Promise(r => setTimeout(r, 1000));
        }

        if (backgroundTarget) {
            console.log('Skipping FULL settings injection to test FRESH config generation.');
            console.log('BUT injecting API Key/URL to allow AI execution...');

            const worker = await backgroundTarget.worker();
            worker.on('console', msg => console.log('[WORKER CONSOLE]', msg.text()));

            const settingsPath = path.resolve('d:\\WorkDir\\comments-insight\\comments-insight-settings-1766989016834.json');
            const settingsContent = await fs.readFile(settingsPath, 'utf-8');
            const fullSettings = JSON.parse(settingsContent);

            // Only inject AI Model settings, keeping other things default (empty selector cache, no crawling configs if any)
            const minimalSettings = {
                ...fullSettings,
                crawlingConfigs: [], // Ensure no crawling configs
                selectorCache: []    // Ensure no selector cache
            };

            await worker.evaluate((data) => {
                return new Promise((resolve, reject) => {
                    console.log('[Worker] Injecting MINIMAL settings (API Config only):', data.aiModel);
                    chrome.storage.local.set({ settings: data }, () => {
                        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                        else {
                            console.log('[Worker] Minimal Settings saved.');
                            resolve();
                        }
                    });
                });
            }, minimalSettings);
        } else {
            console.warn('⚠️ Could not find background service worker used default settings.');
            const targets = await browser.targets();
            console.log('Available targets:', targets.map(t => `${t.type()} - ${t.url()}`).join('\n'));
        }

        // --- 2. Open Page & Test ---
        const page = await browser.newPage();

        // Enhanced logging
        page.on('console', msg => {
            const text = msg.text();
            console.log('[PAGE CONSOLE]', text);
            if (text.includes('__TEST_RESULT__:')) {
                const jsonStr = text.replace('__TEST_RESULT__:', '').trim();
                try {
                    const result = JSON.parse(jsonStr);
                    console.log('\n----------------------------------------');
                    if (result.success) {
                        console.log('✅ EXTRACTION SUCCESSFUL!');
                        console.log(`Extracted ${result.comments?.length || 0} comments.`);
                        if (result.comments && result.comments.length > 0) {
                            console.log('Sample Comment:', JSON.stringify(result.comments[0], null, 2));
                        }
                        process.exit(0);
                    } else {
                        console.error('❌ EXTRACTION FAILED:', result.error);
                        process.exit(1);
                    }
                } catch (e) {
                    console.error('Failed to parse test result:', e);
                }
            }
        });

        page.on('pageerror', err => console.error('[PAGE ERROR]', err));
        page.on('requestfailed', req => console.error('[REQUEST FAILED]', req.url(), req.failure().errorText));

        // TEST 1: Check simple page
        console.log('Navigating to example.com to check injection...');
        await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 2000));

        // TEST 2: YouTube
        const VIDEO_URL = 'https://www.youtube.com/watch?v=gQySzdR2k74';
        console.log(`Navigating to ${VIDEO_URL}...`);
        await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('Waiting for completion (timeout 60s)... or hook injection');

        // Wait and scroll
        await new Promise(r => setTimeout(r, 5000));
        await page.evaluate(() => window.scrollBy(0, 500));
        await new Promise(r => setTimeout(r, 2000));

        console.log('Triggering extraction test via postMessage...');
        await page.evaluate(() => {
            window.postMessage({ type: 'COMMENTS_INSIGHT_TEST_TRIGGER', maxComments: 20 }, '*');
        });

        // Keep alive
        await new Promise(r => setTimeout(r, 180000));

        console.error('❌ Test timed out (180s)!');
        process.exit(1);

    } catch (error) {
        console.error('❌ Unexpected error:', error);
        process.exit(1);
    } finally {
        try { await browser.close(); } catch (e) { }
    }
}

runTest();
