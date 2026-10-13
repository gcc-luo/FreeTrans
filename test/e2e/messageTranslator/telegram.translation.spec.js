const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const source = readFileSync(
  resolve(
    __dirname,
    '../../../src/features/messageTranslator/telegram-interceptor.ts',
  ),
  'utf8',
);
const compiled = esbuild.transformSync(source, {
  loader: 'ts',
  format: 'cjs',
  target: 'es2022',
}).code;
const scriptModule = { exports: {} };
vm.runInNewContext(compiled, {
  module: scriptModule,
  exports: scriptModule.exports,
});

const settings = {
  myLanguage: 'zh',
  targetLanguage: 'en',
  translatorEngine: 'Google',
  sendTranslation: true,
  receiveTranslation: true,
};

async function setup(page, profile) {
  const webK = profile === 'k';
  const incoming = webK
    ? '<div class="bubble is-in"><div class="bubble-content"><div class="message">Good morning</div></div></div>'
    : '<div class="Message message-list-item"><div class="message-content"><div class="text-content">Good morning</div></div></div>';
  const html = webK
    ? `<div class="chat-info"><div class="peer-title">Teammate</div></div><div class="bubbles">${incoming}</div><div class="chat-input"><div class="input-message-input" contenteditable="true">你好</div><button class="btn-send">Send</button></div>`
    : `<div class="middle-column"><div class="chat-info"><div class="title">Teammate</div></div>${incoming}<div id="editable-message-text" contenteditable="true">你好</div><button class="main-button send">Send</button></div>`;
  await page.route(`https://web.telegram.org/${profile}/`, route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html,
    }),
  );
  await page.goto(`https://web.telegram.org/${profile}/`);
  await page.evaluate(isWebK => {
    const handlers = new Map();
    window.__translationCalls = [];
    window.__sentTexts = [];
    window.ferdium = {
      ipcRenderer: {
        on(name, handler) {
          handlers.set(name, [...(handlers.get(name) || []), handler]);
        },
        removeListener(name, handler) {
          handlers.set(
            name,
            (handlers.get(name) || []).filter(item => item !== handler),
          );
        },
        sendToHost() {},
        async invoke(name, payload) {
          window.__translationCalls.push({ name, payload });
          if (window.__failTranslation)
            return { text: 'provider-error', error: true };
          return {
            text: payload.translateToLanguage === 'zh' ? '早上好' : 'Hello',
            error: false,
          };
        },
      },
    };
    const composer = document.querySelector(
      isWebK ? '.input-message-input' : '#editable-message-text',
    );
    const button = document.querySelector(
      isWebK ? '.btn-send' : '.main-button.send',
    );
    button.addEventListener('click', () => {
      const text = composer.textContent.trim();
      if (!text) return;
      window.__sentTexts.push(text);
      const row = document.createElement('div');
      row.className = isWebK
        ? 'bubble is-out'
        : 'Message message-list-item own';
      row.innerHTML = isWebK
        ? '<div class="bubble-content"><div class="message"></div></div>'
        : '<div class="message-content"><div class="text-content"></div></div>';
      row.querySelector(isWebK ? '.message' : '.text-content').textContent =
        text;
      document
        .querySelector(isWebK ? '.bubbles' : '.middle-column')
        .append(row);
      composer.textContent = '';
    });
  }, webK);
  const script = scriptModule.exports.buildTelegramInterceptorScript(
    'service-telegram',
    settings,
  );
  await page.addScriptTag({ content: script });
  expect(
    await page.evaluate(() => window.__freetransTelegramInterceptor?.version),
  ).toBe('2026-10-13-v1');
}

for (const profile of ['k', 'a']) {
  test(`Telegram Web ${profile.toUpperCase()} translates incoming and outgoing messages`, async ({
    page,
  }) => {
    await setup(page, profile);
    await expect(
      page.locator('[data-freetrans-telegram-preview="incoming"]'),
    ).toContainText('早上好');

    await page
      .locator(profile === 'k' ? '.btn-send' : '.main-button.send')
      .click();
    await expect(
      page.locator('[data-freetrans-telegram-confirm]'),
    ).toBeVisible();
    await page
      .locator('[data-freetrans-telegram-confirm] button', {
        hasText: '发送译文',
      })
      .click();

    await expect
      .poll(() => page.evaluate(() => window.__sentTexts))
      .toEqual(['Hello']);
    await expect(
      page.locator('[data-freetrans-telegram-preview="outgoing"]'),
    ).toContainText('你好');
    const outgoingCalls = await page.evaluate(() =>
      window.__translationCalls.filter(
        call => call.payload.translateToLanguage === 'en',
      ),
    );
    expect(outgoingCalls).toHaveLength(1);
  });
}

test('Telegram keeps the original draft when translation fails', async ({
  page,
}) => {
  await setup(page, 'k');
  await page.evaluate(() => {
    window.__failTranslation = true;
  });
  await page.locator('.btn-send').click();
  await expect(page.locator('#freetrans-telegram-status')).toContainText(
    '翻译未发送',
  );
  await expect(page.locator('.input-message-input')).toHaveText('你好');
  expect(await page.evaluate(() => window.__sentTexts)).toEqual([]);
});

test('Telegram Web K translates Enter before sending', async ({ page }) => {
  await setup(page, 'k');
  await page.locator('.input-message-input').press('Enter');
  await expect(page.locator('[data-freetrans-telegram-confirm]')).toBeVisible();
  expect(await page.evaluate(() => window.__sentTexts)).toEqual([]);
  await page
    .locator('[data-freetrans-telegram-confirm] button', {
      hasText: '发送译文',
    })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.__sentTexts))
    .toEqual(['Hello']);
});
