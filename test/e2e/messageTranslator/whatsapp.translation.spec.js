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
  targetLanguageOptions: [
    { value: 'en', label: '英语' },
    { value: 'fr', label: '法语' },
    { value: 'zh', label: '中文' },
  ],
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

async function setupWhatsAppSimulation(
  page,
  failTranslation = false,
  controls = {},
) {
  await page.setContent(`
    <div id="main">
      <header><span title="Teammate">Teammate</span></header>
      <div class="message-in"><span class="selectable-text copyable-text">How are you</span></div>
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
          const gate = window.__translationGate;
          if (gate) await gate;
          return fail
            ? { text: window.__failureText || 'Provider failed', error: true }
            : {
                text: window.__sameTranslation
                  ? payload.text
                  : payload.translateToLanguage.startsWith('zh')
                    ? '你好吗'
                    : payload.translateToLanguage === 'fr'
                      ? 'Bonjour'
                      : 'Hello from translation',
                error: false,
              };
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
                  text: fail
                    ? window.__failureText || 'Provider failed'
                    : 'Hello from translation',
                  error: fail,
                },
              );
            }
          }, 0);
        }
      },
    };
    window.__translatorTestCalls = calls;
    window.__configureTranslator = patch => {
      for (const handler of handlers.get('translator:configure') || [])
        handler({}, patch);
    };
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
      window.__nativeSendAttempts = (window.__nativeSendAttempts || 0) + 1;
      if (window.__blockNativeSend) return;
      const composer = document.querySelector(
        'footer [contenteditable="true"]',
      );
      const text = String(composer?.textContent || '').trim();
      if (!text) return;
      if (window.__nativeSendDelay) {
        const delay = window.__nativeSendDelay;
        window.__nativeSendDelay = 0;
        setTimeout(() => this.click(), delay);
        return;
      }
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

  await page.evaluate(options => {
    window.__failureText = options.failureText;
    if (options.messages) {
      document.querySelector('.message-in').remove();
      for (const text of options.messages) {
        const row = document.createElement('div');
        row.className = 'message-in';
        const content = document.createElement('span');
        content.className = 'selectable-text copyable-text';
        content.textContent = text;
        row.append(content);
        document.querySelector('#main').prepend(row);
      }
    }
    if (options.hideOlder) {
      for (const row of [...document.querySelectorAll('.message-in')].slice(
        0,
        -20,
      )) {
        row.style.cssText = 'position:absolute;top:-2000px;';
      }
    }
    if (options.pending)
      window.__translationGate = new Promise(resolve => {
        window.__releaseTranslation = resolve;
      });
    if (options.same) window.__sameTranslation = true;
  }, controls);
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

test('快速连续发送每条都需要翻译确认', async ({ page }) => {
  await setupWhatsAppSimulation(page);
  const composer = page.locator('footer [contenteditable="true"]');
  // Each send must finish before starting the next one in this regression.
  /* eslint-disable no-await-in-loop */
  for (const text of ['第一条', '第二条']) {
    await composer.fill(text);
    await page.locator('button[data-testid="compose-btn-send"]').click();
    await expect(
      page.locator('[data-ferdium-translation-confirm]'),
    ).toBeVisible();
    await page.getByRole('button', { name: '发送译文', exact: true }).click();
    await expect(composer).toBeEmpty();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__translatorTestCalls.filter(
              c => c.channel === 'translator:save-outgoing-original',
            ).length,
        ),
      )
      .toBe(text === '第一条' ? 1 : 2);
  }
  /* eslint-enable no-await-in-loop */
  await expect(page.locator('.message-out')).toHaveCount(2);
});

test('发送未确认时不重复发送且不保存成功记录', async ({ page }) => {
  await setupWhatsAppSimulation(page);
  await page.evaluate(() => {
    window.__blockNativeSend = true;
  });
  await page.locator('footer [contenteditable="true"]').fill('你好');
  await page.locator('button[data-testid="compose-btn-send"]').click();
  await page.getByRole('button', { name: '发送译文', exact: true }).click();
  await expect(page.getByText(/发送状态待确认/)).toBeVisible({ timeout: 6500 });
  expect(await page.evaluate(() => window.__nativeSendAttempts)).toBe(1);
  expect(
    await page.evaluate(
      () =>
        window.__translatorTestCalls.filter(
          c => c.channel === 'translator:save-outgoing-original',
        ).length,
    ),
  ).toBe(0);
});

test('关闭接收翻译后丢弃仍在等待的结果', async ({ page }) => {
  await setupWhatsAppSimulation(page, false, { pending: true });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__translatorTestCalls.filter(
            c =>
              c.channel === 'translate' &&
              c.payload.translateToLanguage.startsWith('zh'),
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    window.__configureTranslator({ receiveTranslation: false });
    window.__releaseTranslation();
  });
  await expect(page.locator('.message-in')).not.toHaveAttribute(
    'data-ferdium-incoming-pending',
    '1',
  );
  await expect(page.locator('.message-in')).toHaveText('How are you');
  await expect(page.locator('[data-ferdium-incoming-error="1"]')).toHaveCount(
    0,
  );
});

test('译文与原文相同时不误报失败', async ({ page }) => {
  await setupWhatsAppSimulation(page, false, { same: true });
  await expect(page.locator('.message-in')).toHaveAttribute(
    'data-ferdium-incoming-unchanged',
    '1',
  );
  await expect(page.locator('[data-ferdium-incoming-error="1"]')).toHaveCount(
    0,
  );
});

test('会话语言覆盖会重新翻译并通知保存', async ({ page }) => {
  await setupWhatsAppSimulation(page);
  await page.locator('footer [contenteditable="true"]').fill('你好');
  await page.locator('button[data-testid="compose-btn-send"]').click();
  await page.getByLabel('当前会话目标语言').selectOption('fr');
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__translatorTestCalls.some(
          c =>
            c.channel === 'translator:settings-changed' &&
            Object.values(c.payload.settings.conversationLanguages).includes(
              'fr',
            ),
        ),
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__translatorTestCalls.some(
          c =>
            c.channel === 'translate' && c.payload.translateToLanguage === 'fr',
        ),
      ),
    )
    .toBe(true);
});

test('Enter 发送也确认译文且只产生一条消息', async ({ page }) => {
  await setupWhatsAppSimulation(page);
  await page.locator('footer [contenteditable="true"]').fill('你好');
  await page.locator('footer [contenteditable="true"]').press('Enter');
  await page.getByRole('button', { name: '发送译文', exact: true }).click();
  await expect(page.locator('.message-out')).toHaveCount(1);
  expect(await page.evaluate(() => window.__nativeSendAttempts)).toBe(1);
});

test('接收翻译最多三个并发且优先最新消息', async ({ page }) => {
  await setupWhatsAppSimulation(page, false, {
    pending: true,
    messages: [
      'Message six',
      'Message five',
      'Message four',
      'Message three',
      'Message two',
      'Message one',
    ],
  });
  const requests = () =>
    page.evaluate(() =>
      window.__translatorTestCalls
        .filter(c => c.channel === 'translate')
        .map(c => c.payload.text),
    );
  await expect
    .poll(requests)
    .toEqual(['Message six', 'Message five', 'Message four']);
  await page.evaluate(() => window.__releaseTranslation());
  await expect.poll(requests).toHaveLength(6);
  await expect(
    page.locator('.message-in[data-ferdium-incoming-preview="1"]'),
  ).toHaveCount(6);
});

test('译文预览期间切换聊天会关闭预览并保留草稿', async ({ page }) => {
  await setupWhatsAppSimulation(page);
  await page.locator('footer [contenteditable="true"]').fill('你好');
  await page.locator('button[data-testid="compose-btn-send"]').click();
  await expect(
    page.locator('[data-ferdium-translation-confirm]'),
  ).toBeVisible();
  await page.evaluate(() =>
    document
      .querySelector('#main header span')
      .setAttribute('title', 'Another teammate'),
  );
  await expect(page.locator('[data-ferdium-translation-confirm]')).toHaveCount(
    0,
  );
  await expect(page.locator('footer [contenteditable="true"]')).toHaveText(
    '你好',
  );
  await expect(page.locator('.message-out')).toHaveCount(0);
});

test('会话语言只影响当前聊天且用于发送记录', async ({ page }) => {
  await setupWhatsAppSimulation(page);
  const composer = page.locator('footer [contenteditable="true"]');
  await composer.fill('你好');
  await page.locator('button[data-testid="compose-btn-send"]').click();
  await page.getByLabel('当前会话目标语言').selectOption('fr');
  await expect(
    page.getByRole('textbox', { name: '将发送给对方的译文' }),
  ).toHaveValue('Bonjour');
  await page.getByRole('button', { name: '发送译文', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__translatorTestCalls.some(
          c =>
            c.channel === 'translator:save-outgoing-original' &&
            c.payload.toLanguage === 'fr',
        ),
      ),
    )
    .toBe(true);
  await composer.fill('再次问好');
  await page.locator('button[data-testid="compose-btn-send"]').click();
  await expect(page.getByLabel('当前会话目标语言')).toHaveValue('fr');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() =>
    document
      .querySelector('#main header span')
      .setAttribute('title', 'Another teammate'),
  );
  await page.locator('button[data-testid="compose-btn-send"]').click();
  await expect(page.getByLabel('当前会话目标语言')).toHaveValue('');
  await expect(
    page.getByRole('textbox', { name: '将发送给对方的译文' }),
  ).toHaveValue('Hello from translation');
});

for (const [failureText, expected] of [
  ['HTTP 429 rate limit', '请求过多'],
  ['Missing credentials', '凭据缺失'],
  ['network timeout', '网络不可用'],
]) {
  test(`翻译错误给出可操作提示：${failureText}`, async ({ page }) => {
    await setupWhatsAppSimulation(page, true, { failureText });
    await page.locator('footer [contenteditable="true"]').fill('你好');
    await page.locator('button[data-testid="compose-btn-send"]').click();
    await expect(
      page.getByText('翻译未发送：', { exact: false }),
    ).toContainText(expected);
    await expect(page.locator('.message-out')).toHaveCount(0);
  });
}

test('手动补译已加载旧消息并跳过已翻译记录', async ({ page }) => {
  await setupWhatsAppSimulation(page, false, {
    messages: Array.from({ length: 30 }, (_, i) => `History message ${i}`),
    hideOlder: true,
  });
  await expect(
    page.locator('.message-in[data-ferdium-incoming-preview="1"]'),
  ).toHaveCount(20);
  const result = await page.evaluate(() =>
    window.__ferdiumTranslatorTranslateHistory('history-first'),
  );
  expect(result).toMatchObject({
    status: 'completed',
    total: 30,
    completed: 30,
    translated: 10,
    skipped: 20,
    failed: 0,
  });
  await expect(
    page.locator('.message-in[data-ferdium-incoming-preview="1"]'),
  ).toHaveCount(30);
  const repeat = await page.evaluate(() =>
    window.__ferdiumTranslatorTranslateHistory('history-repeat'),
  );
  expect(repeat).toMatchObject({
    status: 'completed',
    translated: 0,
    skipped: 30,
  });
  expect(
    await page.evaluate(
      () =>
        window.__translatorTestCalls.filter(c => c.channel === 'translate')
          .length,
    ),
  ).toBe(30);
  expect(
    await page.evaluate(() =>
      window.__translatorTestCalls.some(
        c =>
          c.channel === 'translator:history-progress' &&
          c.payload.status === 'completed',
      ),
    ),
  ).toBe(true);
});

test('停止历史任务后丢弃在途译文并保留自动翻译', async ({ page }) => {
  await setupWhatsAppSimulation(page, false, {
    messages: Array.from({ length: 30 }, (_, i) => `History message ${i}`),
    hideOlder: true,
  });
  await expect(
    page.locator('.message-in[data-ferdium-incoming-preview="1"]'),
  ).toHaveCount(20);
  await page.evaluate(() => {
    window.__translationGate = new Promise(resolve => {
      window.__releaseTranslation = resolve;
    });
    window.__historyResult =
      window.__ferdiumTranslatorTranslateHistory('history-cancel');
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__translatorTestCalls.filter(c => c.channel === 'translate')
            .length,
      ),
    )
    .toBe(23);
  await page.evaluate(() => {
    window.__ferdiumTranslatorCancelHistory();
    window.__releaseTranslation();
  });
  const result = await page.evaluate(() => window.__historyResult);
  expect(result.status).toBe('cancelled');
  await expect(
    page.locator('.message-in[data-ferdium-incoming-preview="1"]'),
  ).toHaveCount(20);
  await page.evaluate(() => {
    const row = document.createElement('div');
    row.className = 'message-in';
    row.innerHTML =
      '<span class="selectable-text copyable-text">New live message</span>';
    document.querySelector('#main').append(row);
  });
  await expect(
    page.locator('.message-in[data-ferdium-incoming-preview="1"]'),
  ).toHaveCount(21);
});

test('历史翻译切换会话后自动停止', async ({ page }) => {
  await setupWhatsAppSimulation(page, false, {
    messages: Array.from({ length: 30 }, (_, i) => `History message ${i}`),
    hideOlder: true,
  });
  await expect(
    page.locator('.message-in[data-ferdium-incoming-preview="1"]'),
  ).toHaveCount(20);
  await page.evaluate(() => {
    window.__translationGate = new Promise(resolve => {
      window.__releaseTranslation = resolve;
    });
    window.__historyResult =
      window.__ferdiumTranslatorTranslateHistory('history-switch');
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__translatorTestCalls.filter(c => c.channel === 'translate')
            .length,
      ),
    )
    .toBe(23);
  await page.evaluate(() => {
    document
      .querySelector('#main header span')
      .setAttribute('title', 'Another teammate');
    window.__releaseTranslation();
  });
  const result = await page.evaluate(() => window.__historyResult);
  expect(result.status).toBe('cancelled');
  await expect(
    page.locator('.message-in[data-ferdium-incoming-preview="1"]'),
  ).toHaveCount(20);
});

test('历史翻译统计失败且允许再次手动重试', async ({ page }) => {
  await setupWhatsAppSimulation(page, true);
  await expect(page.locator('[data-ferdium-incoming-error="1"]')).toHaveCount(
    1,
  );
  const first = await page.evaluate(() =>
    window.__ferdiumTranslatorTranslateHistory('history-failed'),
  );
  expect(first).toMatchObject({ status: 'completed', completed: 1, failed: 1 });
  const before = await page.evaluate(
    () =>
      window.__translatorTestCalls.filter(c => c.channel === 'translate')
        .length,
  );
  await page.evaluate(() =>
    window.__ferdiumTranslatorTranslateHistory('history-retry'),
  );
  expect(
    await page.evaluate(
      () =>
        window.__translatorTestCalls.filter(c => c.channel === 'translate')
          .length,
    ),
  ).toBeGreaterThan(before);
});
