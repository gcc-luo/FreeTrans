/* eslint-disable no-await-in-loop -- Record a deliberate sequence of UI states. */
/* eslint-disable no-param-reassign -- Playwright callbacks update only the local demo DOM. */
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { chromium, expect } = require('@playwright/test');

const root = path.resolve(__dirname, '../../..');
const output = path.resolve(__dirname, '..');
const temporary = path.join(root, '.tmp/readme-demo');
fs.mkdirSync(temporary, { recursive: true });

const settings = {
  myLanguage: 'zh',
  targetLanguage: 'en',
  translatorEngine: 'Google',
  sendTranslation: true,
  receiveTranslation: true,
  showOriginalText: true,
  conversationLanguages: {},
  targetLanguageOptions: [
    { value: 'zh', label: '中文' },
    { value: 'en', label: '英语' },
    { value: 'fr', label: '法语' },
  ],
};
const pairs = [
  [
    'Hi! Are we still on for the project review tomorrow?',
    '嗨！明天的项目评审还照常进行吗？',
  ],
  ['Yes, 2 pm works for me.', '可以，下午两点我有空。'],
  [
    'Perfect. Could you send the agenda before the meeting?',
    '好的。你能在会前把议程发给我吗？',
  ],
  [
    "Of course. I'll send you the agenda before the meeting.",
    '没问题，我会在会前把议程发给你。',
  ],
  ['We should keep the first version simple.', '第一版我们应该保持简单。'],
  ["Let's focus on the translation workflow first.", '我们先专注于翻译流程。'],
  ['The latest build is ready for review.', '最新的构建版本已经可以评审了。'],
  [
    'I will share the meeting notes with the team.',
    '我会把会议记录分享给团队。',
  ],
  [
    'Could we try the new history translation feature?',
    '我们可以试试新的历史翻译功能吗？',
  ],
  [
    'Thanks! See you at the project review tomorrow.',
    '谢谢！明天项目评审时见。',
  ],
];

function translatorScript() {
  const source = fs.readFileSync(
    path.join(root, 'src/features/messageTranslator/store.ts'),
    'utf8',
  );
  const token = 'const script = `';
  const start = source.indexOf(token) + token.length;
  const end = source.indexOf('\n    `;', start);
  if (start < token.length || end < start)
    throw new Error('Translator source boundary changed');
  /* eslint-disable no-template-curly-in-string -- Replace literal placeholders in the local injected source. */
  return source
    .slice(start, end)
    .replaceAll('\\\\', '\\')
    .replace('${initialSettingsJson}', JSON.stringify(settings))
    .replace('${interceptorPlatformJson}', JSON.stringify('whatsapp'))
    .replaceAll('${serviceId}', 'demo');
  /* eslint-enable no-template-curly-in-string */
}

async function installFixture(frame) {
  await frame.evaluate(
    ({ dictionary, initial }) => {
      const handlers = new Map();
      const originals = new Map([
        ['Yes, 2 pm works for me.', '可以，下午两点我有空。'],
      ]);
      window.__demoDelay = 250;
      const translate = async payload => {
        await new Promise(resolve => {
          setTimeout(resolve, window.__demoDelay);
        });
        const source = String(payload.text).trim();
        // eslint-disable-next-line unicorn/consistent-function-scoping -- Serialized into an isolated browser frame.
        const normalize = text => text.replaceAll(/[‘’]/g, "'");
        const pair = dictionary.find(item =>
          item.some(text => normalize(text) === normalize(source)),
        );
        if (!pair) throw new Error(`No offline example translation: ${source}`);
        return {
          text: payload.translateToLanguage.startsWith('zh')
            ? pair[1]
            : pair[0],
          error: false,
        };
      };
      const ipc = {
        on(channel, handler) {
          handlers.set(channel, [...(handlers.get(channel) || []), handler]);
        },
        removeListener(channel, handler) {
          handlers.set(
            channel,
            (handlers.get(channel) || []).filter(item => item !== handler),
          );
        },
        sendToHost(channel, payload) {
          window.parent.demoBridge.host(channel, payload);
        },
        async invoke(channel, payload) {
          if (channel === 'translate') return translate(payload);
          if (channel === 'detect-language')
            return /[\u4E00-\u9FFF]/.test(payload.sample) ? 'zh' : 'en';
          if (channel === 'translator:lookup-original') {
            const text = originals.get(payload.translatedText) || '';
            return { text, found: !!text };
          }
          if (channel === 'translator:save-outgoing-original') {
            originals.set(payload.translatedText, payload.originalText);
            return { saved: true };
          }
          throw new Error(
            `Unsupported offline conversation request: ${channel}`,
          );
        },
      };
      window.ferdium = { ipcRenderer: ipc };
      window.__demoConfigure = patch => {
        for (const handler of handlers.get('translator:configure') || [])
          handler({}, patch);
      };
      window.__demoSettings = initial;
      document.querySelector('button.send').addEventListener('click', () => {
        const composer = document.querySelector('[contenteditable]');
        const text = composer.textContent.trim();
        if (!text) return;
        const row = document.createElement('div');
        row.className = 'message-out';
        const content = document.createElement('span');
        content.className = 'selectable-text copyable-text';
        content.dataset.testid = 'msg-text';
        content.textContent = text;
        const time = document.createElement('span');
        time.className = 'time';
        time.textContent = '10:27 ✓';
        row.append(content, time);
        document.querySelector('.messages').append(row);
        composer.textContent = '';
        const messages = document.querySelector('.messages');
        messages.scrollTop = messages.scrollHeight;
      });
    },
    { dictionary: pairs, initial: settings },
  );
  await frame.addScriptTag({ content: translatorScript() });
  await frame.waitForFunction(
    () => typeof window.__ferdiumTranslatorTranslateHistory === 'function',
  );
}

async function main() {
  const bundle = path.join(temporary, 'client.js');
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'client.jsx')],
    outfile: bundle,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    alias: { electron: path.join(__dirname, 'panel-ipc.js') },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
  });
  const layout = fs.readFileSync(
    path.join(root, 'src/styles/layout.scss'),
    'utf8',
  );
  const panelCss = layout.slice(
    layout.indexOf('.translator-panel {'),
    layout.indexOf('.electron-app-title-bar {'),
  );
  if (!panelCss.includes('.translator-switch'))
    throw new Error('Panel stylesheet boundary changed');
  const html = fs
    .readFileSync(path.join(__dirname, 'index.html'), 'utf8')
    .replace('</style>', `${panelCss}</style>`);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1380, height: 1030 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'freetrans-demo.local') return route.abort();
      if (url.pathname === '/')
        return route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: html,
        });
      if (url.pathname === '/conversation.html')
        return route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: fs.readFileSync(
            path.join(__dirname, 'conversation.html'),
            'utf8',
          ),
        });
      if (url.pathname.endsWith('.png'))
        return route.fulfill({
          contentType: 'image/png',
          body: fs.readFileSync(
            path.join(root, 'src/assets/images/icons/256x256.png'),
          ),
        });
      if (url.pathname === '/telegram.svg')
        return route.fulfill({
          contentType: 'image/svg+xml',
          body: fs.readFileSync(
            path.join(root, 'src/assets/images/telegram.svg'),
          ),
        });
      return route.abort();
    });
    await page.goto('http://freetrans-demo.local/');
    await page.addScriptTag({ content: fs.readFileSync(bundle, 'utf8') });
    await page.waitForFunction(
      () =>
        window.demoPanelReady &&
        document.querySelector('iframe').contentDocument.querySelector('#main'),
    );
    const frame = page
      .frames()
      .find(item => item.url().endsWith('/conversation.html'));
    await installFixture(frame);
    await expect(
      frame.locator('.message-in[data-ferdium-incoming-preview="1"]'),
    ).toHaveCount(2);
    const frames = { send: [], history: [] };
    let capture = null;
    const stopCapture = async () => {
      if (!capture) return;
      const current = capture;
      current.running = false;
      await current.task;
      const last = frames[current.group].at(-1);
      if (last) last.duration = Math.max(20, Date.now() - last.timestamp);
      capture = null;
    };
    const startCapture = group => {
      const current = { group, running: true, task: null };
      current.task = (async () => {
        while (current.running) {
          const timestamp = Date.now();
          const file = path.join(
            temporary,
            `${group}-live-${String(frames[group].length).padStart(4, '0')}.png`,
          );
          await page.locator('#showcase').screenshot({ path: file });
          const previous = frames[group].at(-1);
          if (previous) previous.duration = timestamp - previous.timestamp;
          frames[group].push({ path: file, duration: 125, timestamp });
          await new Promise(resolve => {
            setTimeout(resolve, Math.max(0, 125 - (Date.now() - timestamp)));
          });
        }
      })();
      capture = current;
    };
    const shot = async (group, duration, caption) => {
      await page.locator('#scene').evaluate((element, text) => {
        element.textContent = text;
      }, caption);
      if (!capture || capture.group !== group) {
        await stopCapture();
        startCapture(group);
      }
      await new Promise(resolve => {
        setTimeout(resolve, duration);
      });
    };
    const pointer = async locator => {
      const box = await locator.boundingBox();
      await page.locator('#cursor').evaluate((element, point) => {
        element.style.display = 'block';
        element.style.left = `${point.x + point.width * 0.5}px`;
        element.style.top = `${point.y + point.height * 0.5}px`;
      }, box);
    };
    const composer = frame.getByRole('textbox', { name: '输入消息' });
    await page.locator('#headline').evaluate(element => {
      element.textContent = '用中文写，核对英文后再发送。';
    });
    await shot('send', 1000, '01 / 收到外语消息，直接查看中文译文');
    await composer.click();
    await pointer(composer);
    const draft = '没问题，我会在会前把议程发给你。';
    await page.locator('#scene').evaluate(element => {
      element.textContent = '02 / 用你熟悉的语言写下回复';
    });
    await composer.pressSequentially(draft, { delay: 80 });
    const send = frame.getByRole('button', { name: '发送消息', exact: true });
    await pointer(send);
    await shot('send', 500, '02 / 点击发送，先生成译文');
    await send.click();
    const confirm = frame.locator('[data-ferdium-translation-confirm]');
    await expect(confirm).toBeVisible();
    await page.locator('#cursor').evaluate(element => {
      element.style.display = 'none';
    });
    await shot('send', 1900, '03 / 预览将发给对方的内容，可编辑、改语言或取消');
    await confirm
      .getByRole('textbox', { name: '将发送给对方的译文' })
      .fill("I'll send you the agenda before the meeting.");
    await shot('send', 1100, '03 / 可以微调译文，只发送最终确认的内容');
    const confirmSend = confirm.getByRole('button', {
      name: '发送译文',
      exact: true,
    });
    await pointer(confirmSend);
    await shot('send', 650, '04 / 确认发送译文');
    await confirmSend.click();
    await expect(frame.locator('.message-out')).toHaveCount(2);
    await expect(frame.locator('.message-out').last()).toContainText(draft);
    await page.locator('#cursor').evaluate(element => {
      element.style.display = 'none';
    });
    await shot('send', 2300, '05 / 发送英文，本地原文仅供自己回看');
    await stopCapture();
    await page.locator('#headline').evaluate(element => {
      element.textContent = '跨语言聊天，就在你熟悉的窗口里。';
    });
    await page.locator('#scene').evaluate(element => {
      element.textContent = '接收译文 · 核对后发送 · 本地原文回看';
    });
    await page
      .locator('#showcase')
      .screenshot({ path: path.join(output, 'product-preview.png') });
    await frame.evaluate(() => {
      const received = document
        .querySelector('.message-in')
        .getBoundingClientRect();
      const sent = [...document.querySelectorAll('.message-out')]
        .at(-1)
        .getBoundingClientRect();
      for (const point of [
        {
          x: received.right + 16,
          y: received.top + 12,
          text: '← 接收译文',
          hint: '上方译文，下方原文',
        },
        {
          x: 28,
          y: sent.top + 12,
          text: '发送内容与本地原文 →',
          hint: '原文仅供自己回看',
        },
      ]) {
        const label = document.createElement('div');
        label.dataset.readmeAnnotation = 'true';
        label.style.cssText = `position:fixed;left:${point.x}px;top:${point.y}px;padding:10px 12px;background:#ffffffed;border:1px solid #ddd8f2;border-radius:6px;color:#5b50b7;font:600 12px/1.7 sans-serif;pointer-events:none;`;
        const title = document.createElement('div');
        title.textContent = point.text;
        const hint = document.createElement('div');
        hint.textContent = point.hint;
        hint.style.cssText = 'font-weight:400;color:#8b86a0;font-size:11px';
        label.append(title, hint);
        document.body.append(label);
      }
    });
    await frame
      .locator('#main')
      .screenshot({ path: path.join(output, 'translation-detail.png') });
    await frame
      .locator('[data-readme-annotation]')
      .evaluateAll(labels => labels.forEach(label => label.remove()));

    await page.getByRole('switch', { name: '接收翻译', exact: true }).click();
    await frame.evaluate(history => {
      const messages = document.querySelector('.messages');
      messages.replaceChildren();
      const date = document.createElement('div');
      date.className = 'date';
      date.textContent = '昨天 · 已加载的历史消息';
      messages.append(date);
      for (const [index, pair] of history.entries()) {
        const row = document.createElement('div');
        row.className = 'message-in';
        const content = document.createElement('span');
        content.className = 'selectable-text copyable-text';
        content.dataset.testid = 'msg-text';
        const [source] = pair;
        content.textContent = source;
        const time = document.createElement('span');
        time.className = 'time';
        time.textContent = `16:${10 + index}`;
        row.append(content, time);
        messages.append(row);
      }
      window.__demoDelay = 1000;
    }, pairs.slice(4));
    await page.locator('#headline').evaluate(element => {
      element.textContent = '第一次打开，旧消息也能接着读。';
    });
    await page.locator('#intro').evaluate(element => {
      element.textContent = '向上滚动加载旧记录，再补译当前聊天的已加载消息。';
    });
    await shot('history', 1700, '01 / 已加载一批旧消息，当前还没有译文');
    await page.getByRole('switch', { name: '接收翻译', exact: true }).click();
    const historyButton = page.getByRole('button', {
      name: '翻译已加载历史消息',
      exact: true,
    });
    await pointer(historyButton);
    await historyButton.click();
    await shot('history', 600, '02 / 点击历史翻译，开始补译本批消息');
    await page.locator('#cursor').evaluate(element => {
      element.style.display = 'none';
    });
    await expect(
      frame.locator('.message-in[data-ferdium-incoming-preview="1"]'),
    ).toHaveCount(3);
    await shot('history', 900, '03 / 最多三个并发任务，面板显示处理进度');
    try {
      await expect(
        frame.locator('.message-in[data-ferdium-incoming-preview="1"]'),
      ).toHaveCount(6);
    } catch (error) {
      process.stderr.write(
        `${JSON.stringify(
          await frame
            .locator('.message-in')
            .evaluateAll(rows => rows.map(row => row.textContent)),
          null,
          2,
        )}\n`,
      );
      throw error;
    }
    await expect(
      page.getByText('本批历史翻译已完成。', { exact: true }),
    ).toBeVisible();
    await shot(
      'history',
      2200,
      '04 / 本批补译完成；继续加载旧记录后可再次补译',
    );
    const historyAgain = page.getByRole('button', {
      name: '翻译已加载历史消息',
      exact: true,
    });
    await pointer(historyAgain);
    await historyAgain.click();
    await expect(page.getByText(/翻译 0 条，跳过 6 条/)).toBeVisible();
    await page.locator('#cursor').evaluate(element => {
      element.style.display = 'none';
    });
    await shot('history', 2000, '05 / 再次执行时，已完成的消息自动跳过');
    await stopCapture();
    fs.writeFileSync(
      path.join(temporary, 'frames.json'),
      JSON.stringify(frames, null, 2),
    );
    if (errors.length > 0)
      throw new Error(
        errors.join('\n') || 'Offline demo reported a page error',
      );
    process.stdout.write(
      `Screenshots and GIF frames are ready in ${temporary}\n`,
    );
  } finally {
    await browser.close();
  }
}
main().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
