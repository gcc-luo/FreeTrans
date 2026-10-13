// The injected function uses hoisted helpers and scans messages serially.
/* eslint-disable no-use-before-define, @typescript-eslint/no-use-before-define, no-continue, no-await-in-loop, sonar/deprecation */

export interface TelegramTranslatorSettings {
  myLanguage: string;
  targetLanguage: string;
  translatorEngine: string;
  sendTranslation: boolean;
  receiveTranslation: boolean;
}

// Keep the injected function self-contained: its source is executed in the service webview.
function installTelegramInterceptor(
  serviceId: string,
  initialSettings: TelegramTranslatorSettings,
): string {
  const host = String(window.location.hostname || '').toLowerCase();
  if (
    host !== 'web.telegram.org' &&
    host !== 'webk.telegram.org' &&
    host !== 'webz.telegram.org'
  ) {
    return 'unsupported-host';
  }

  const bridge = window as any;
  const version = '2026-10-13-v1';
  const previous = bridge.__freetransTelegramInterceptor;
  if (previous?.version === version) {
    previous.configure(initialSettings);
    return 'already';
  }
  previous?.cleanup?.();

  let ipc = bridge.ferdium?.ipcRenderer || bridge.Ferdium?.ipcRenderer;
  if (!ipc && typeof bridge.require === 'function') {
    try {
      ipc = bridge.require('electron')?.ipcRenderer;
    } catch {
      ipc = null;
    }
  }
  if (!ipc?.sendToHost) return 'no-ipc';

  const listeners: (() => void)[] = [];
  const state = {
    settings: { ...initialSettings },
    translating: false,
    bypassUntil: 0,
    requestId: 0,
    pending: new Map<number, any>(),
    incomingBusy: false,
    scanTimer: 0 as ReturnType<typeof setTimeout> | 0,
    outgoing: null as any,
  };
  const instance = { version, configure, cleanup };
  bridge.__freetransTelegramInterceptor = instance;

  function on(target: any, name: string, handler: any, options?: any) {
    target.addEventListener(name, handler, options);
    listeners.push(() => target.removeEventListener(name, handler, options));
  }

  function onIpc(name: string, handler: any) {
    ipc.on?.(name, handler);
    listeners.push(() => {
      if (ipc.removeListener) ipc.removeListener(name, handler);
      else ipc.off?.(name, handler);
    });
  }

  function cleanup() {
    for (const remove of listeners) remove();
    observer.disconnect();
    if (state.scanTimer) clearTimeout(state.scanTimer);
    for (const request of state.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error('interceptor-replaced'));
    }
    state.pending.clear();
    if (bridge.__freetransTelegramInterceptor === instance) {
      delete bridge.__freetransTelegramInterceptor;
    }
  }

  function configure(settings: TelegramTranslatorSettings) {
    state.settings = { ...state.settings, ...settings };
    scheduleScan();
  }

  function isWebK() {
    return (
      window.location.pathname.startsWith('/k') ||
      !!document.querySelector('.input-message-input')
    );
  }

  function getComposer(): HTMLElement | null {
    const selector = isWebK()
      ? '.chat-input .input-message-input[contenteditable="true"], .input-message-input[contenteditable="true"]'
      : '#editable-message-text[contenteditable="true"]';
    return document.querySelector(selector);
  }

  function getSendButton(): HTMLElement | null {
    const selector = isWebK()
      ? '.chat-input .btn-send, .btn-send-container .btn-send'
      : 'button.main-button.send';
    return document.querySelector(selector);
  }

  function readText(element: HTMLElement | null): string {
    // innerText preserves visible line breaks in Telegram's contenteditable editor.
    // eslint-disable-next-line unicorn/prefer-dom-node-text-content
    return String(element?.innerText || element?.textContent || '')
      .replaceAll('\r\n', '\n')
      .trim();
  }

  function chatKey(): string {
    const title =
      document.querySelector(
        isWebK()
          ? '.chat-info .peer-title, .top .peer-title'
          : '.middle-column .chat-info .title',
      )?.textContent || '';
    return `${window.location.pathname}${window.location.hash}|${title.trim()}`;
  }

  function messageRows(): HTMLElement[] {
    const selector = isWebK()
      ? '.bubbles .bubble:not(.service):not(.is-date)'
      : '.middle-column .Message.message-list-item';
    return [...document.querySelectorAll<HTMLElement>(selector)];
  }

  function isOutgoing(row: HTMLElement): boolean {
    return row.classList.contains(isWebK() ? 'is-out' : 'own');
  }

  function messageBody(row: HTMLElement): HTMLElement | null {
    return row.querySelector(
      isWebK() ? '.bubble-content .message' : '.message-content .text-content',
    );
  }

  function originalText(body: HTMLElement): string {
    const copy = body.cloneNode(true) as HTMLElement;
    copy
      .querySelectorAll(
        '[data-freetrans-telegram-preview], .time, .message-meta, .reactions, .reply, .message-subheader',
      )
      .forEach(node => node.remove());
    return readText(copy);
  }

  function showStatus(message: string, isError = false) {
    let pill = document.querySelector<HTMLElement>(
      '#freetrans-telegram-status',
    );
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'freetrans-telegram-status';
      pill.style.cssText =
        'position:fixed;right:16px;bottom:88px;z-index:2147483646;padding:7px 11px;border-radius:8px;background:#fff;color:#1f2937;box-shadow:0 2px 12px #0003;font:12px sans-serif';
      document.body.append(pill);
    }
    pill.textContent = message;
    pill.style.color = isError ? '#b42318' : '#1f2937';
    pill.style.display = message ? 'block' : 'none';
  }

  function decorate(
    body: HTMLElement,
    label: string,
    text: string,
    kind: string,
  ) {
    body.querySelector(`[data-freetrans-telegram-preview="${kind}"]`)?.remove();
    const preview = document.createElement('div');
    preview.dataset.freetransTelegramPreview = kind;
    preview.style.cssText =
      'display:block;white-space:pre-wrap;margin-top:6px;padding-top:5px;border-top:1px solid currentColor;opacity:.78';
    const heading = document.createElement('small');
    heading.textContent = label;
    heading.style.cssText = 'display:block;opacity:.8';
    const content = document.createElement('span');
    content.textContent = text;
    preview.append(heading, content);
    body.append(preview);
  }

  function scheduleScan() {
    if (state.scanTimer) clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(() => {
      state.scanTimer = 0;
      scanMessages().catch(error =>
        console.error('[FreeTrans Telegram] Message scan failed', error),
      );
    }, 160);
  }

  async function translate(
    text: string,
    fromLang: string,
    toLang: string,
    reason: string,
  ): Promise<string> {
    const payload = {
      serviceId,
      text,
      fromLang,
      toLang,
      translatorEngine: state.settings.translatorEngine || 'Google',
      reason,
      profile: 'telegram',
    };
    if (typeof ipc.invoke === 'function') {
      let response: any;
      try {
        response = await ipc.invoke('translate', {
          serviceId,
          text,
          fromLanguage: fromLang,
          translateToLanguage: toLang,
          translatorEngine: payload.translatorEngine,
        });
      } catch {
        response = null;
      }
      if (response?.error) {
        throw new Error(String(response.text || 'translation-failed'));
      }
      if (String(response?.text || '').trim()) {
        return String(response.text).trim();
      }
    }
    return new Promise((resolve, reject) => {
      state.requestId += 1;
      const { requestId } = state;
      const timeout = setTimeout(() => {
        state.pending.delete(requestId);
        reject(new Error('translation-timeout'));
      }, 15_000);
      state.pending.set(requestId, { resolve, reject, timeout });
      try {
        ipc.sendToHost('translator:translate-message', {
          ...payload,
          requestId,
        });
      } catch (error) {
        clearTimeout(timeout);
        state.pending.delete(requestId);
        reject(error);
      }
    });
  }

  async function scanMessages() {
    if (state.outgoing) {
      const { outgoing } = state;
      if (Date.now() > outgoing.until || chatKey() !== outgoing.chat) {
        state.outgoing = null;
      } else {
        for (const row of messageRows().slice(-30)) {
          if (!isOutgoing(row) || outgoing.before.has(row)) continue;
          const body = messageBody(row);
          if (body && originalText(body).startsWith(outgoing.translated)) {
            decorate(body, '原文', outgoing.original, 'outgoing');
            state.outgoing = null;
            break;
          }
        }
      }
    }

    if (!state.settings.receiveTranslation || state.incomingBusy) return;
    state.incomingBusy = true;
    let processed = 0;
    try {
      const targetLanguage = state.settings.myLanguage || 'zh';
      for (const row of messageRows().slice(-30).reverse()) {
        if (processed >= 3) break;
        if (isOutgoing(row)) continue;
        const body = messageBody(row);
        if (!body) continue;
        const source = originalText(body);
        if (!source || source.length > 2000) continue;
        const marker = `${targetLanguage}|${source}`;
        if (
          row.dataset.freetransTelegramSource === marker &&
          (body.querySelector('[data-freetrans-telegram-preview="incoming"]') ||
            row.dataset.freetransTelegramSame === marker)
        )
          continue;
        if (row.dataset.freetransTelegramPending === marker) continue;
        if (
          row.dataset.freetransTelegramError === marker &&
          Date.now() - Number(row.dataset.freetransTelegramErrorAt || 0) <
            30_000
        )
          continue;

        const currentChat = chatKey();
        processed += 1;
        row.dataset.freetransTelegramPending = marker;
        try {
          const translated = await translate(
            source,
            'auto',
            targetLanguage,
            'telegram-incoming',
          );
          if (
            chatKey() !== currentChat ||
            !row.isConnected ||
            originalText(body) !== source ||
            state.settings.myLanguage !== targetLanguage
          )
            continue;
          if (translated && translated !== source) {
            decorate(body, '译文', translated, 'incoming');
            delete row.dataset.freetransTelegramSame;
          } else {
            row.dataset.freetransTelegramSame = marker;
          }
          row.dataset.freetransTelegramSource = marker;
          delete row.dataset.freetransTelegramError;
        } catch (error) {
          row.dataset.freetransTelegramError = marker;
          row.dataset.freetransTelegramErrorAt = String(Date.now());
          console.warn(
            '[FreeTrans Telegram] Incoming translation failed',
            error,
          );
        } finally {
          delete row.dataset.freetransTelegramPending;
        }
      }
    } finally {
      state.incomingBusy = false;
      if (processed > 0) scheduleScan();
    }
  }

  function confirmTranslation(
    original: string,
    translated: string,
  ): Promise<string | null> {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.dataset.freetransTelegramConfirm = '1';
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;background:#0008;display:flex;align-items:center;justify-content:center;padding:16px';
      const card = document.createElement('div');
      card.style.cssText =
        'width:min(480px,100%);padding:16px;border-radius:12px;background:#fff;color:#1f2937;font:14px/1.5 sans-serif';
      const title = document.createElement('strong');
      title.textContent = '确认发送译文';
      const source = document.createElement('p');
      source.textContent = `原文：${original}`;
      const editor = document.createElement('textarea');
      editor.value = translated;
      editor.setAttribute('aria-label', '将发送给对方的译文');
      editor.style.cssText =
        'box-sizing:border-box;width:100%;min-height:90px;padding:8px';
      const cancel = document.createElement('button');
      cancel.textContent = '取消';
      const send = document.createElement('button');
      send.textContent = '发送译文';
      send.style.marginLeft = '12px';
      const finish = (value: string | null) => {
        overlay.remove();
        resolve(value);
      };
      cancel.addEventListener('click', () => finish(null));
      send.addEventListener('click', () => {
        if (editor.value.trim()) finish(editor.value.trim());
      });
      card.append(title, source, editor, cancel, send);
      overlay.append(card);
      document.body.append(overlay);
      editor.focus();
    });
  }

  function writeComposer(composer: HTMLElement, value: string): boolean {
    composer.focus();
    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, value);
    return readText(composer) === value.trim();
  }

  async function translateAndSend() {
    const composer = getComposer();
    if (!composer || state.translating) return;
    const original = readText(composer);
    if (!original) return;
    const currentChat = chatKey();
    state.translating = true;
    let writtenTranslation = false;
    let nativeSendAttempted = false;
    showStatus('正在翻译…');
    try {
      const translated = await translate(
        original,
        state.settings.myLanguage || 'auto',
        state.settings.targetLanguage || 'en',
        'telegram-outgoing',
      );
      if (chatKey() !== currentChat || readText(composer) !== original) {
        throw new Error('会话或草稿已变化，译文未发送');
      }
      showStatus('');
      const finalText = await confirmTranslation(original, translated);
      if (!finalText) return;
      if (chatKey() !== currentChat || readText(composer) !== original) {
        throw new Error('会话或草稿已变化，译文未发送');
      }
      const sendButton = getSendButton();
      if (!sendButton || !writeComposer(composer, finalText)) {
        throw new Error('无法写入 Telegram 输入框，译文未发送');
      }
      writtenTranslation = true;
      state.outgoing = {
        original,
        translated: finalText,
        chat: currentChat,
        before: new Set(messageRows()),
        until: Date.now() + 8000,
      };
      state.bypassUntil = Date.now() + 2500;
      nativeSendAttempted = true;
      sendButton.click();
      scheduleScan();
      setTimeout(scheduleScan, 500);
      setTimeout(scheduleScan, 1600);
    } catch (error) {
      if (
        writtenTranslation &&
        !nativeSendAttempted &&
        chatKey() === currentChat
      ) {
        writeComposer(composer, original);
      }
      showStatus(
        `翻译未发送：${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      state.translating = false;
    }
  }

  function intercept(event: Event) {
    if (!state.settings.sendTranslation || Date.now() < state.bypassUntil)
      return;
    if (
      (event.target as Element)?.closest?.('[data-freetrans-telegram-confirm]')
    )
      return;
    const composer = getComposer();
    if (!composer || !readText(composer)) return;
    if (event.type === 'keydown') {
      const keyEvent = event as KeyboardEvent;
      if (
        keyEvent.key !== 'Enter' ||
        keyEvent.shiftKey ||
        keyEvent.isComposing ||
        keyEvent.keyCode === 229
      )
        return;
      if (
        !(event.target === composer || composer.contains(event.target as Node))
      )
        return;
    } else {
      const button = getSendButton();
      if (
        !button ||
        !(event.target === button || button.contains(event.target as Node))
      )
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    translateAndSend().catch(error =>
      console.error('[FreeTrans Telegram] Outgoing translation failed', error),
    );
  }

  onIpc('translator:translation-result', (_event: any, result: any) => {
    const request = state.pending.get(result?.requestId);
    if (!request) return;
    clearTimeout(request.timeout);
    state.pending.delete(result.requestId);
    if (result.success && String(result.text || '').trim())
      request.resolve(String(result.text).trim());
    else request.reject(new Error(String(result.text || 'translation-failed')));
  });
  onIpc(
    'translator:configure',
    (_event: any, settings: TelegramTranslatorSettings) => configure(settings),
  );
  on(window, 'keydown', intercept, true);
  on(window, 'click', intercept, true);
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  scheduleScan();
  ipc.sendToHost('translator:initialized', {
    serviceId,
    settings: state.settings,
  });
  return 'ok';
}

export function buildTelegramInterceptorScript(
  serviceId: string,
  settings: TelegramTranslatorSettings,
): string {
  return `(${installTelegramInterceptor.toString()})(${JSON.stringify(serviceId)}, ${JSON.stringify(settings)})`;
}
