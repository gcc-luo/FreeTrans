const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TRANSLATOR_SETTINGS = {
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

async function captureInjectedScript() {
  const storePath = path.resolve(
    __dirname,
    '../../../src/features/messageTranslator/store.ts',
  );
  const source = fs.readFileSync(storePath, 'utf8');
  const startToken = 'const script = `';
  const endToken = '\n    `;';
  const startIdx = source.indexOf(startToken);
  expect(startIdx).toBeGreaterThan(-1);
  const scriptStart = startIdx + startToken.length;
  const endIdx = source.indexOf(endToken, scriptStart);
  expect(endIdx).toBeGreaterThan(scriptStart);
  const initialPlaceholder = `\${initialSettingsJson}`;
  const platformPlaceholder = `\${interceptorPlatformJson}`;
  const serviceIdPlaceholder = `\${serviceId}`;
  return source
    .slice(scriptStart, endIdx)
    .replace(
      initialPlaceholder,
      JSON.stringify({ ...DEFAULT_TRANSLATOR_SETTINGS }),
    )
    .replace(platformPlaceholder, JSON.stringify('googlechat'))
    .replaceAll(serviceIdPlaceholder, 'service-googlechat');
}

async function setupGoogleChatSimulation(page, options = {}) {
  const forceHostFallback = !!options.forceHostFallback;
  const translationFails = !!options.translationFails;
  await page.setContent(`
    <div role="main" style="padding: 12px;">
      <header><h1>Teammate</h1></header>
      <div role="listitem" aria-label="You said" data-is-own-message="true">
        <div dir="auto">Hello from history</div>
      </div>
      <div role="listitem" aria-label="Teammate said">
        <div dir="auto">How are you</div>
      </div>
      <form id="composer-form" style="margin-top: 12px;">
        <div
          contenteditable="true"
          role="textbox"
          aria-label="Message"
          style="border: 1px solid #ccc; min-height: 26px; padding: 6px;"
        ></div>
        <button aria-label="Send message" style="margin-top: 8px;">Send</button>
      </form>
    </div>
  `);

  await page.evaluate(
    ({ forceHostFallback: fallback, translationFails: fail }) => {
      /* eslint-disable no-console -- test: capture console in page for assertions */
      const logs = [];
      const originalLog = console.log.bind(console);
      const originalWarn = console.warn.bind(console);
      console.log = (...args) => {
        logs.push(args.map(String).join(' '));
        originalLog(...args);
      };
      console.warn = (...args) => {
        logs.push(args.map(String).join(' '));
        originalWarn(...args);
      };
      /* eslint-enable no-console */
      window.__translatorTestLogs = logs;

      const channelHandlers = new Map();
      const invokeCalls = [];
      const hostMessages = [];
      const mockHistoryMap = {
        'Hello from history': '历史中文',
      };
      const emitChannel = (channel, payload) => {
        const handlers = channelHandlers.get(channel) || [];
        for (const handler of handlers) {
          try {
            handler({ channel }, payload);
          } catch {
            /* ignore handler errors in test mock */
          }
        }
      };

      window.__translatorTestBridge = {
        invokeCalls,
        hostMessages,
        forceHostFallback: fallback,
      };

      const ipcRenderer = {
        on(channel, handler) {
          const handlers = channelHandlers.get(channel) || [];
          handlers.push(handler);
          channelHandlers.set(channel, handlers);
        },
        removeListener(channel, handler) {
          const handlers = channelHandlers.get(channel) || [];
          channelHandlers.set(
            channel,
            handlers.filter(item => item !== handler),
          );
        },
        off(channel, handler) {
          this.removeListener(channel, handler);
        },
        async invoke(channel, payload) {
          invokeCalls.push({ channel, payload });
          if (channel === 'translate') {
            if (fallback) throw new Error('invoke-forced-failure');
            if (fail) return { text: 'Translation unavailable', error: true };
            const source = String(payload?.text || '');
            if (/[\u4E00-\u9FFF]/.test(source)) {
              return { text: 'Hello from translation', error: false };
            }
            return { text: `Translated(${source})`, error: false };
          }
          if (channel === 'detect-language') {
            const sample = String(payload?.sample || '');
            if (/[\u4E00-\u9FFF]/.test(sample)) return 'zh';
            if (/[A-Za-z]/.test(sample)) return 'en';
            return 'auto';
          }
          if (channel === 'translator:lookup-original') {
            const translated = String(payload?.translatedText || '');
            const original = mockHistoryMap[translated] || '';
            return { found: !!original, text: original };
          }
          return '';
        },
        sendToHost(channel, payload) {
          hostMessages.push({ channel, payload });
          if (channel === 'translator:translate-message') {
            setTimeout(() => {
              emitChannel('translator:translation-result', {
                requestId: payload?.requestId,
                success: !fail,
                text: fail
                  ? 'Translation unavailable'
                  : 'Host translated fallback',
                error: fail,
              });
            }, 0);
          }
        },
      };

      window.ferdium = { ipcRenderer };
      window.Ferdium = { ipcRenderer };
      window.require = moduleName =>
        moduleName === 'electron' ? { ipcRenderer } : {};

      const originalButtonClick = HTMLButtonElement.prototype.click;
      /* eslint-disable sonar/class-prototype -- test: patch send button to simulate history */
      HTMLButtonElement.prototype.click = function clickPatched(...args) {
        const aria = String(
          this.getAttribute('aria-label') || '',
        ).toLowerCase();
        const isSend =
          aria.includes('send') ||
          aria.includes('发送') ||
          aria.includes('發送');
        if (!isSend) {
          originalButtonClick.apply(this, args);
          return;
        }
        const composer =
          document.querySelector(
            'div[contenteditable="true"][role="textbox"]',
          ) || document.querySelector('[contenteditable="true"]');
        const message = String(composer?.textContent ?? '').trim();
        if (!message) return;
        const row = document.createElement('div');
        row.setAttribute('role', 'listitem');
        row.setAttribute('aria-label', 'You said');
        const textNode = document.createElement('div');
        textNode.setAttribute('dir', 'auto');
        textNode.textContent = message;
        row.append(textNode);
        (document.querySelector('div[role="main"]') || document.body).append(
          row,
        );
        if (composer) composer.textContent = '';
      };
      /* eslint-enable sonar/class-prototype */
    },
    { forceHostFallback, translationFails },
  );

  const script = await captureInjectedScript();
  const initStatus = await page.evaluate(scriptText => {
    // eslint-disable-next-line no-eval, sonar/code-eval -- test: run injected script in page context
    return eval(scriptText);
  }, script);
  expect(initStatus).toBe('ok');
}

async function triggerSendAndWait(page, expectedText, expectedOriginal = '') {
  await page.locator('div[contenteditable="true"][role="textbox"]').click();
  await page.keyboard.type('你好，今天过得怎么样？');
  await page.locator('button[aria-label="Send message"]').click();
  await page
    .locator('[data-ferdium-translation-confirm] button', {
      hasText: '发送译文',
    })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const rows = [...document.querySelectorAll('div[role="listitem"]')];
        return String(rows.at(-1)?.textContent || '').trim();
      }),
    )
    .toContain(expectedText);
  if (expectedOriginal) {
    const latestRow = page.locator('div[role="listitem"]').last();
    await expect(latestRow).not.toContainText(expectedOriginal);
  }
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelectorAll(
            'span[data-ferdium-local-preview-original="1"]',
          ).length,
      ),
    )
    .toBeGreaterThan(0);
}

async function triggerSubmitAndWait(page, expectedText) {
  await page.locator('div[contenteditable="true"][role="textbox"]').click();
  await page.keyboard.type('你好，今天过得怎么样？');
  await page.evaluate(() => {
    const form = document.querySelector('#composer-form');
    if (form) {
      const event = new Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(event);
    }
  });
  await page
    .locator('[data-ferdium-translation-confirm] button', {
      hasText: '发送译文',
    })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const rows = [...document.querySelectorAll('div[role="listitem"]')];
        return String(rows.at(-1)?.textContent || '').trim();
      }),
    )
    .toContain(expectedText);
  await expect(page.locator('div[role="listitem"]').last()).not.toContainText(
    '你好',
  );
}

test.describe('Google Chat translator e2e simulation (Playwright)', () => {
  test('翻译服务失败时不发送并保留原文', async ({ page }) => {
    await setupGoogleChatSimulation(page, { translationFails: true });
    const composer = page.locator(
      'div[contenteditable="true"][role="textbox"]',
    );
    await composer.click();
    await page.keyboard.type('你好，保留原文');
    await page.locator('button[aria-label="Send message"]').click();

    await expect(composer).toContainText('你好，保留原文');
    await expect(page.locator('div[role="listitem"]')).toHaveCount(2);
  });

  test('确认前切换会话时不会把译文发送到新会话', async ({ page }) => {
    await setupGoogleChatSimulation(page);
    const composer = page.locator(
      'div[contenteditable="true"][role="textbox"]',
    );
    await composer.click();
    await page.keyboard.type('你好，切换会话');
    await page.locator('button[aria-label="Send message"]').click();
    await page.locator('[data-ferdium-translation-confirm]').waitFor();
    await page.locator('header h1').evaluate(element => {
      element.replaceChildren(document.createTextNode('Another teammate'));
    });
    await page
      .locator('[data-ferdium-translation-confirm] button', {
        hasText: '发送译文',
      })
      .click();

    await expect(composer).toContainText('你好，切换会话');
    await expect(page.locator('div[role="listitem"]')).toHaveCount(2);
  });

  test('确认前修改草稿时不会覆盖或发送新内容', async ({ page }) => {
    await setupGoogleChatSimulation(page);
    const composer = page.locator(
      'div[contenteditable="true"][role="textbox"]',
    );
    await composer.click();
    await page.keyboard.type('你好，原草稿');
    await page.locator('button[aria-label="Send message"]').click();
    await page.locator('[data-ferdium-translation-confirm]').waitFor();
    await composer.evaluate(element => {
      element.replaceChildren(document.createTextNode('用户后来修改的草稿'));
    });
    await page
      .locator('[data-ferdium-translation-confirm] button', {
        hasText: '发送译文',
      })
      .click();

    await expect(composer).toContainText('用户后来修改的草稿');
    await expect(page.locator('div[role="listitem"]')).toHaveCount(2);
  });

  test('写入译文后切换会话时保留可恢复的原文', async ({ page }) => {
    await setupGoogleChatSimulation(page);
    const composer = page.locator(
      'div[contenteditable="true"][role="textbox"]',
    );
    await composer.click();
    await page.keyboard.type('你好，待恢复');
    await page.evaluate(() => {
      const editable = document.querySelector('[contenteditable="true"]');
      const observer = new MutationObserver(() => {
        if (editable?.textContent?.includes('Hello from translation')) {
          document
            .querySelector('header h1')
            ?.replaceChildren(document.createTextNode('Another teammate'));
          observer.disconnect();
        }
      });
      if (editable)
        observer.observe(editable, { childList: true, subtree: true });
    });
    await page.locator('button[aria-label="Send message"]').click();
    await page
      .locator('[data-ferdium-translation-confirm] button', {
        hasText: '发送译文',
      })
      .click();

    await expect(page.locator('[data-ferdium-unsent-draft]')).toBeVisible();
    await expect(
      page.locator('[data-ferdium-unsent-draft] textarea'),
    ).toHaveValue('你好，待恢复');
    await expect(page.locator('div[role="listitem"]')).toHaveCount(2);
  });

  test('取消发送会保留原文草稿', async ({ page }) => {
    await setupGoogleChatSimulation(page);
    const composer = page.locator(
      'div[contenteditable="true"][role="textbox"]',
    );
    await composer.click();
    await page.keyboard.type('你好，保留草稿');
    await page.locator('button[aria-label="Send message"]').click();
    await page
      .locator('[data-ferdium-translation-confirm] button', {
        hasText: '取消',
      })
      .click();

    await expect(composer).toContainText('你好，保留草稿');
    await expect(page.locator('div[role="listitem"]')).toHaveCount(2);
  });

  test('编辑译文后只发送编辑后的内容', async ({ page }) => {
    await setupGoogleChatSimulation(page);
    const composer = page.locator(
      'div[contenteditable="true"][role="textbox"]',
    );
    await composer.click();
    await page.keyboard.type('你好，编辑译文');
    await page.locator('button[aria-label="Send message"]').click();
    await page
      .locator('[data-ferdium-translation-confirm] textarea')
      .fill('Edited English message');
    await page
      .locator('[data-ferdium-translation-confirm] button', {
        hasText: '发送译文',
      })
      .click();

    await expect(page.locator('div[role="listitem"]').last()).toHaveText(
      'Edited English message',
    );
  });

  test('invoke 主链路：中文发送触发翻译并写入历史预览', async ({ page }) => {
    await setupGoogleChatSimulation(page, { forceHostFallback: false });
    await triggerSendAndWait(page, 'Hello from translation', '你好');

    const result = await page.evaluate(() => ({
      invokeCalls: window.__translatorTestBridge?.invokeCalls || [],
      hostMessages: window.__translatorTestBridge?.hostMessages || [],
      logs: window.__translatorTestLogs || [],
    }));

    const translateInvoke = result.invokeCalls.find(
      item => item.channel === 'translate',
    );
    expect(translateInvoke).toBeTruthy();
    expect(String(translateInvoke.payload?.text || '')).toContain('你好');
    expect(String(translateInvoke.payload?.translateToLanguage || '')).toBe(
      'en',
    );
    const hostTranslateCalls = result.hostMessages.filter(
      item => item.channel === 'translator:translate-message',
    );
    expect(hostTranslateCalls.length).toBe(0);
    expect(
      result.logs.some(log =>
        log.includes('[Ferdium Translator] Outgoing history scan start:'),
      ),
    ).toBeTruthy();
  });

  test('sendToHost 回退链路：invoke 失败后仍可翻译发送', async ({ page }) => {
    await setupGoogleChatSimulation(page, { forceHostFallback: true });
    await triggerSendAndWait(page, 'Host translated fallback', '你好');

    const result = await page.evaluate(() => ({
      invokeCalls: window.__translatorTestBridge?.invokeCalls || [],
      hostMessages: window.__translatorTestBridge?.hostMessages || [],
      logs: window.__translatorTestLogs || [],
    }));

    const translateInvokeCount = result.invokeCalls.filter(
      item => item.channel === 'translate',
    ).length;
    expect(translateInvokeCount).toBeGreaterThan(0);
    const hostTranslateCalls = result.hostMessages.filter(
      item => item.channel === 'translator:translate-message',
    );
    expect(hostTranslateCalls.length).toBeGreaterThan(0);
    expect(
      result.logs.some(log =>
        log.includes('invoke translate failed, fallback to host message'),
      ),
    ).toBeTruthy();
  });

  test('form submit 兜底链路：提交事件也能触发翻译', async ({ page }) => {
    await setupGoogleChatSimulation(page, { forceHostFallback: false });
    await triggerSubmitAndWait(page, 'Hello from translation');

    const result = await page.evaluate(() => ({
      invokeCalls: window.__translatorTestBridge?.invokeCalls || [],
      logs: window.__translatorTestLogs || [],
    }));
    const translateInvokeCount = result.invokeCalls.filter(
      item => item.channel === 'translate',
    ).length;
    expect(translateInvokeCount).toBeGreaterThan(0);
    expect(
      result.logs.some(log =>
        log.includes(
          '[Ferdium Translator] Intercepting submit event, starting translation:',
        ),
      ),
    ).toBeTruthy();
  });

  test('发送按钮 TextNode target 场景也能触发翻译（线上常见）', async ({
    page,
  }) => {
    await setupGoogleChatSimulation(page, { forceHostFallback: false });
    await page.locator('div[contenteditable="true"][role="textbox"]').click();
    await page.keyboard.type('你好，测试 text node target');
    await page.evaluate(() => {
      const button = document.querySelector(
        'button[aria-label="Send message"]',
      );
      const textNode = button?.firstChild;
      if (!button || !textNode) return;
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      Object.defineProperty(clickEvent, 'target', {
        value: textNode,
        enumerable: true,
      });
      button.dispatchEvent(clickEvent);
    });

    await page
      .locator('[data-ferdium-translation-confirm] button', {
        hasText: '发送译文',
      })
      .click();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const rows = [...document.querySelectorAll('div[role="listitem"]')];
          return String(rows.at(-1)?.textContent || '').trim();
        }),
      )
      .toContain('Hello from translation');
    await expect(page.locator('div[role="listitem"]').last()).not.toContainText(
      '你好',
    );

    const result = await page.evaluate(() => ({
      logs: window.__translatorTestLogs || [],
    }));
    expect(
      result.logs.some(log =>
        log.includes(
          '[Ferdium Translator] Intercepting send button, starting translation:',
        ),
      ),
    ).toBeTruthy();
  });
});
