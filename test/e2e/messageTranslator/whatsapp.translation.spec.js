const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const settings = {
  myLanguage: 'zh',
  targetLanguage: 'en',
  translatorEngine: 'Baidu',
  panelTheme: 'light',
  sendTranslation: true,
  receiveTranslation: true,
  showOriginalText: false,
  forbidSendingOriginal: false,
  panelVisible: true,
};

function injectedScript() {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../../src/features/messageTranslator/store.ts'),
    'utf8',
  );
  const startToken = 'const script = `';
  const start = source.indexOf(startToken) + startToken.length;
  const end = source.indexOf('\n    `;', start);
  expect(start).toBeGreaterThan(startToken.length);
  expect(end).toBeGreaterThan(start);
  return source
    .slice(start, end)
    .replaceAll('\\\\', '\\')
    .replace(`\${initialSettingsJson}`, JSON.stringify(settings))
    .replace(`\${interceptorPlatformJson}`, JSON.stringify('whatsapp'))
    .replaceAll(`\${serviceId}`, 'service-whatsapp');
}

async function setupWhatsAppSimulation(page, failTranslation = false) {
  await page.setContent(`
    <div id="main">
      <header><span title="Teammate">Teammate</span></header>
      <div class="message-in"><span class="selectable-text">How are you</span></div>
      <footer>
        <div contenteditable="true" role="textbox" data-tab="10" style="min-height:30px;border:1px solid #ccc"></div>
        <button data-testid="compose-btn-send" aria-label="Send"><span data-icon="send">Send</span></button>
      </footer>
    </div>
  `);

  await page.evaluate(fail => {
    const handlers = new Map();
    const calls = [];
    const sentOriginals = new Map();
    const ipcRenderer = {
      on(channel, handler) {
        handlers.set(channel, [...(handlers.get(channel) || []), handler]);
      },
      removeListener(channel, handler) {
        handlers.set(
          channel,
          (handlers.get(channel) || []).filter(item => item !== handler),
        );
      },
      async invoke(channel, payload) {
        calls.push({ channel, payload });
        if (channel === 'translate') {
          return fail
            ? { text: 'Provider failed', error: true }
            : { text: 'Hello from translation', error: false };
        }
        if (channel === 'detect-language') {
          return /[\u4E00-\u9FFF]/.test(String(payload?.sample || ''))
            ? 'zh'
            : 'en';
        }
        if (channel === 'translator:save-outgoing-original') {
          sentOriginals.set(payload.translatedText, payload.originalText);
          return { saved: true };
        }
        if (channel === 'translator:lookup-original') {
          const text = sentOriginals.get(payload.translatedText) || '';
          return { found: !!text, text };
        }
        return '';
      },
      sendToHost(channel, payload) {
        calls.push({ channel, payload });
        if (channel === 'translator:translate-message') {
          setTimeout(() => {
            for (const handler of handlers.get(
              'translator:translation-result',
            ) || []) {
              handler(
                {},
                {
                  requestId: payload.requestId,
                  success: !fail,
                  text: fail ? 'Provider failed' : 'Hello from translation',
                  error: fail,
                },
              );
            }
          }, 0);
        }
      },
    };
    window.__translatorTestCalls = calls;
    window.ferdium = { ipcRenderer };
    window.Ferdium = { ipcRenderer };
    window.require = moduleName =>
      moduleName === 'electron' ? { ipcRenderer } : {};

    const originalClick = HTMLButtonElement.prototype.click;
    /* eslint-disable sonar/class-prototype -- test: simulate WhatsApp native send */
    HTMLButtonElement.prototype.click = function simulatedClick(...args) {
      if (this.dataset.testid !== 'compose-btn-send') {
        originalClick.apply(this, args);
        return;
      }
      const composer = document.querySelector(
        'footer [contenteditable="true"]',
      );
      const text = String(composer?.textContent || '').trim();
      if (!text) return;
      const row = document.createElement('div');
      row.className = 'message-out';
      const content = document.createElement('span');
      content.className = 'selectable-text';
      content.textContent = text;
      row.append(content);
      document
        .querySelector('#main')
        ?.insertBefore(row, document.querySelector('footer'));
      if (composer) composer.textContent = '';
    };
    /* eslint-enable sonar/class-prototype */
  }, failTranslation);

  const status = await page.evaluate(script => {
    // eslint-disable-next-line no-eval, sonar/code-eval -- test: execute injected script in an isolated page
    return eval(script);
  }, injectedScript());
  expect(status).toBe('ok');
}

test.describe('WhatsApp translator e2e simulation', () => {
  test('发送译文并在本地气泡保留原文', async ({ page }) => {
    await setupWhatsAppSimulation(page);
    const composer = page.locator('footer [contenteditable="true"]');
    await composer.click();
    await page.keyboard.type('你好，WhatsApp');
    await page.locator('button[data-testid="compose-btn-send"]').click();
    await page
      .locator('[data-ferdium-translation-confirm] button', {
        hasText: '发送译文',
      })
      .click();

    await expect(page.locator('.message-out')).toContainText(
      'Hello from translation',
    );
    await expect(page.locator('.message-out')).toContainText('你好，WhatsApp');
  });

  test('翻译失败时不发送且保留草稿', async ({ page }) => {
    await setupWhatsAppSimulation(page, true);
    const composer = page.locator('footer [contenteditable="true"]');
    await composer.click();
    await page.keyboard.type('你好，失败草稿');
    await page.locator('button[data-testid="compose-btn-send"]').click();

    await expect(composer).toContainText('你好，失败草稿');
    await expect(page.locator('.message-out')).toHaveCount(0);
  });

  test('编辑译文后页面重绘仍恢复原文', async ({ page }) => {
    await setupWhatsAppSimulation(page);
    const composer = page.locator('footer [contenteditable="true"]');
    await composer.click();
    await page.keyboard.type('你好，重绘');
    await page.locator('button[data-testid="compose-btn-send"]').click();
    await page
      .getByRole('textbox', { name: '将发送给对方的译文' })
      .fill('Hola amigo');
    await page
      .locator('[data-ferdium-translation-confirm] button', {
        hasText: '发送译文',
      })
      .click();
    await expect(page.locator('.message-out')).toContainText('Hola amigo');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__translatorTestCalls.filter(
              call => call.channel === 'translator:save-outgoing-original',
            ).length,
        ),
      )
      .toBe(1);

    await page.evaluate(() => {
      const row = document.querySelector('.message-out');
      const replacement = document.createElement('div');
      replacement.className = 'message-out';
      replacement.innerHTML =
        '<span class="selectable-text copyable-text">Hola amigo</span>';
      row.replaceWith(replacement);
    });

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__translatorTestCalls.filter(
              call => call.channel === 'translator:lookup-original',
            ).length,
        ),
      )
      .toBeGreaterThan(0);

    await expect(page.locator('.message-out')).toContainText('你好，重绘');
  });
});
