(() => {
  try {
    const getIpcRenderer = () => {
      const bridged =
        window.ferdium?.ipcRenderer || window.Ferdium?.ipcRenderer;
      if (bridged) return bridged;
      try {
        if (typeof window.require === 'function') {
          const electron = window.require('electron');
          if (electron?.ipcRenderer) return electron.ipcRenderer;
        }
      } catch {}
      return null;
    };

    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer || typeof ipcRenderer.sendToHost !== 'function') {
      return 'no-ipc';
    }
    const interceptorVersion = '2026-02-14-v4';
    if (
      window.__ferdiumTranslatorInterceptorLoaded &&
      window.__ferdiumTranslatorInterceptorVersion === interceptorVersion
    ) {
      return 'already';
    }
    window.__ferdiumTranslatorInterceptorLoaded = true;
    window.__ferdiumTranslatorInterceptorVersion = interceptorVersion;

    // Initialize state from host-side settings.
    const initialSettings = {};
    const state = {
      settings: {
        myLanguage: initialSettings.myLanguage,
        targetLanguage: initialSettings.targetLanguage,
        translatorEngine: initialSettings.translatorEngine,
        sendTranslation: initialSettings.sendTranslation,
        receiveTranslation: initialSettings.receiveTranslation,
      },
      translating: false,
      bypassSendUntil: 0,
      requestId: 0,
      requests: new Map(),
    };

    const isVisibleComposer = node => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const readComposer = () => {
      const footer = document.querySelector('footer');
      const footerSelectors = [
        '[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"][data-tab]',
        '[contenteditable="true"]',
        'textarea',
      ];

      if (footer) {
        for (const selector of footerSelectors) {
          const found = footer.querySelector(selector);
          if (!found) continue;
          if (!isVisibleComposer(found)) continue;
          try {
            console.log(
              '[Ferdium Translator] Found composer in footer:',
              selector,
            );
          } catch {}
          return found;
        }
      }

      const globalSelectors = [
        'footer [contenteditable="true"][data-tab]',
        '[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        'footer textarea',
      ];
      for (const selector of globalSelectors) {
        const found = document.querySelector(selector);
        if (!found) continue;
        if (!isVisibleComposer(found)) continue;
        try {
          console.log(
            '[Ferdium Translator] Found composer globally:',
            selector,
          );
        } catch {}
        return found;
      }
      try {
        console.warn('[Ferdium Translator] Composer not found');
      } catch {}
      return null;
    };

    const getComposerText = el => {
      if (!el) return '';
      if ('value' in el) return (el.value || '').trim();
      return (el.innerText || '').trim();
    };

    const getComposerDebug = el => {
      if (!el || !(el instanceof Element)) return { exists: false };
      return {
        exists: true,
        tag: el.tagName,
        role: el.getAttribute('role'),
        contentEditable: el.getAttribute('contenteditable'),
        dataTab: el.dataset.tab,
        dataLexical: el.dataset.lexicalEditor,
        inFooter: !!el.closest('footer'),
        className: String(el.className || '').slice(0, 120),
        htmlPreview: String(el.innerHTML || '').slice(0, 120),
      };
    };

    const normalizeCompareText = value =>
      String(value || '')
        .trim()
        .replaceAll(/\\s+/g, ' ')
        .replaceAll(/[0-289\\u]/g, "'")
        .replaceAll(/[0-2\\cdu]/g, '"');

    const toComparableText = value =>
      normalizeCompareText(value)
        .toLowerCase()
        .replaceAll(/[^\d0-\\a-z]/gi, '')
        .replaceAll(/\\s+/g, ' ')
        .trim();

    const hasCjkChars = value => /[0-\\fu]/.test(String(value || ''));

    const dispatchComposerInput = el => {
      try {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } catch {}
    };

    const setNativeValue = (el, value) => {
      try {
        const prototype = Object.getPrototypeOf(el);
        const descriptor =
          prototype && Object.getOwnPropertyDescriptor(prototype, 'value');
        if (descriptor && typeof descriptor.set === 'function') {
          descriptor.set.call(el, value);
          return;
        }
      } catch {}
      el.value = value;
    };

    const setComposerText = (el, text) => {
      if (!el) return;
      const normalized = String(text || '');
      el.focus();
      const isTextInput =
        el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
      const isLexicalEditor =
        el instanceof Element && el.dataset.lexicalEditor === 'true';

      try {
        console.log(
          '[Ferdium Translator] setComposerText target:',
          JSON.stringify(getComposerDebug(el)),
        );
      } catch {}

      if (isTextInput) {
        const inputEl = el;
        const beforeValue = String(inputEl.value || '');
        try {
          if (typeof inputEl.setSelectionRange === 'function') {
            inputEl.setSelectionRange(0, beforeValue.length);
          }
        } catch {}
        try {
          inputEl.dispatchEvent(
            new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertReplacementText',
              data: normalized,
            }),
          );
        } catch {}
        setNativeValue(inputEl, normalized);
        try {
          inputEl.dispatchEvent(
            new InputEvent('input', {
              bubbles: true,
              data: normalized,
              inputType: 'insertText',
            }),
          );
        } catch {
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        try {
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        } catch {}
        try {
          console.log(
            '[Ferdium Translator] setComposerText(input) before/after:',
            JSON.stringify({
              before: beforeValue.slice(0, 120),
              after: String(inputEl.value || '').slice(0, 120),
            }),
          );
        } catch {}
        return;
      }

      const selectAllInElement = target => {
        try {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(target);
          selection?.removeAllRanges();
          selection?.addRange(range);
          return true;
        } catch {
          return false;
        }
      };

      const replaceViaLexicalParagraph = () => {
        try {
          if (!isLexicalEditor) return false;

          let paragraph = el.querySelector('p');
          if (!paragraph) {
            paragraph = document.createElement('p');
            while (el.firstChild) {
              el.firstChild.remove();
            }
            el.append(paragraph);
          }

          while (paragraph.firstChild) {
            paragraph.firstChild.remove();
          }
          if (normalized) {
            paragraph.append(document.createTextNode(normalized));
          } else {
            paragraph.append(document.createElement('br'));
          }

          try {
            el.dispatchEvent(
              new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: normalized,
              }),
            );
          } catch {}

          dispatchComposerInput(el);
          try {
            el.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: normalized,
              }),
            );
          } catch {}

          const after = getComposerText(el);
          const comparableAfter = toComparableText(after);
          const comparableTarget = toComparableText(normalized);
          return (
            !!comparableAfter &&
            !!comparableTarget &&
            (comparableAfter === comparableTarget ||
              comparableAfter.includes(comparableTarget) ||
              comparableTarget.includes(comparableAfter))
          );
        } catch {
          return false;
        }
      };

      const replaceViaExecCommand = () => {
        try {
          if (typeof document.execCommand !== 'function') return false;
          el.focus();
          selectAllInElement(el);
          document.execCommand('delete', false);
          selectAllInElement(el);
          const inserted = document.execCommand(
            'insertText',
            false,
            normalized,
          );
          return inserted || getComposerText(el).trim() === normalized.trim();
        } catch {
          return false;
        }
      };

      const replaceViaSyntheticBeforeInput = () => {
        try {
          el.focus();
          selectAllInElement(el);
          el.dispatchEvent(
            new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'deleteContentBackward',
            }),
          );
          el.dispatchEvent(
            new InputEvent('input', {
              bubbles: true,
              inputType: 'deleteContentBackward',
            }),
          );

          selectAllInElement(el);
          el.dispatchEvent(
            new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: normalized,
            }),
          );
          el.dispatchEvent(
            new InputEvent('input', {
              bubbles: true,
              inputType: 'insertText',
              data: normalized,
            }),
          );

          const after = getComposerText(el);
          const comparableAfter = toComparableText(after);
          const comparableTarget = toComparableText(normalized);
          return (
            !!comparableAfter &&
            !!comparableTarget &&
            (comparableAfter === comparableTarget ||
              comparableAfter.includes(comparableTarget) ||
              comparableTarget.includes(comparableAfter))
          );
        } catch {
          return false;
        }
      };

      const replaceViaPasteEvent = () => {
        try {
          el.focus();
          selectAllInElement(el);

          let dataTransfer = null;
          try {
            if (typeof DataTransfer !== 'undefined') {
              dataTransfer = new DataTransfer();
              dataTransfer.setData('text/plain', normalized);
            }
          } catch {
            dataTransfer = null;
          }

          let dispatched = false;
          if (typeof ClipboardEvent !== 'undefined') {
            try {
              const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dataTransfer || undefined,
              });
              dispatched = el.dispatchEvent(pasteEvent);
            } catch {
              dispatched = false;
            }
          }

          if (!dispatched) {
            try {
              if (typeof document.execCommand === 'function') {
                document.execCommand('insertText', false, normalized);
              }
            } catch {}
          }

          const after = getComposerText(el);
          const comparableAfter = toComparableText(after);
          const comparableTarget = toComparableText(normalized);
          return (
            !!comparableAfter &&
            !!comparableTarget &&
            (comparableAfter === comparableTarget ||
              comparableAfter.includes(comparableTarget) ||
              comparableTarget.includes(comparableAfter))
          );
        } catch {
          return false;
        }
      };

      let replacedByDomReplace = false;
      let replacedByLexicalParagraph = false;
      let replacedByExecCommand = false;
      let replacedBySyntheticBeforeInput = false;
      let replacedByPasteEvent = false;
      replacedByLexicalParagraph = replaceViaLexicalParagraph();

      if (!replacedByLexicalParagraph) {
        replacedByExecCommand = replaceViaExecCommand();
      }

      if (
        replacedByExecCommand &&
        getComposerText(el).trim() !== normalized.trim()
      ) {
        replacedByExecCommand = false;
      }

      if (!replacedByLexicalParagraph && !replacedByExecCommand) {
        replacedBySyntheticBeforeInput = replaceViaSyntheticBeforeInput();
      }

      if (
        !replacedByLexicalParagraph &&
        !replacedByExecCommand &&
        !replacedBySyntheticBeforeInput
      ) {
        replacedByPasteEvent = replaceViaPasteEvent();
      }

      try {
        if (
          !replacedByLexicalParagraph &&
          !replacedByExecCommand &&
          !replacedBySyntheticBeforeInput &&
          !replacedByPasteEvent
        ) {
          while (el.firstChild) {
            el.firstChild.remove();
          }
          if (normalized) {
            el.append(document.createTextNode(normalized));
          }
          replacedByDomReplace = true;
        }
      } catch {}

      // Fallback using Range API if direct replacement failed.
      if (
        !replacedByLexicalParagraph &&
        !replacedByExecCommand &&
        !replacedBySyntheticBeforeInput &&
        !replacedByPasteEvent &&
        !replacedByDomReplace
      ) {
        try {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.deleteContents();
          range.insertNode(document.createTextNode(normalized));
          range.selectNodeContents(el);
          range.collapse(false);
          selection?.removeAllRanges();
          selection?.addRange(range);
          replacedByDomReplace = true;
        } catch {}
      }

      // Last fallback.
      if (
        !replacedByLexicalParagraph &&
        !replacedByExecCommand &&
        !replacedBySyntheticBeforeInput &&
        !replacedByPasteEvent &&
        !replacedByDomReplace
      ) {
        el.textContent = normalized;
      }

      dispatchComposerInput(el);
      try {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } catch {}

      try {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      } catch {}

      try {
        console.log(
          '[Ferdium Translator] setComposerText(contenteditable) result:',
          JSON.stringify({
            usedExecCommand: replacedByExecCommand,
            usedLexicalParagraph: replacedByLexicalParagraph,
            usedSyntheticBeforeInput: replacedBySyntheticBeforeInput,
            usedPasteEvent: replacedByPasteEvent,
            usedDomReplace: replacedByDomReplace,
            afterText: getComposerText(el).slice(0, 120),
            afterHtml: String(el.innerHTML || '').slice(0, 120),
          }),
        );
      } catch {}
    };

    const isComposerSynced = (afterValue, finalValue, originalValue) => {
      const comparableAfter = toComparableText(afterValue);
      const comparableFinal = toComparableText(finalValue);
      const comparableOriginal = toComparableText(originalValue);

      if (!comparableAfter) return false;
      if (comparableAfter === comparableOriginal) return false;
      if (!hasCjkChars(finalValue) && hasCjkChars(afterValue)) return false;
      if (comparableAfter === comparableFinal) return true;
      if (comparableFinal && comparableAfter.includes(comparableFinal))
        return true;
      if (
        comparableFinal?.includes(comparableAfter) &&
        comparableAfter.length >= Math.floor(comparableFinal.length * 0.9)
      ) {
        return true;
      }
      return false;
    };

    const forceSyncViaFooterTextarea = (text, originalText) => {
      const footer = document.querySelector('footer');
      const textarea = footer?.querySelector?.('textarea');
      if (!(textarea instanceof HTMLTextAreaElement)) {
        return false;
      }
      try {
        console.log('[Ferdium Translator] Trying textarea fallback sync');
      } catch {}
      setComposerText(textarea, text);
      const after = getComposerText(textarea);
      const ok = isComposerSynced(after, text, originalText);
      try {
        console.log('[Ferdium Translator] Textarea fallback result:', {
          ok,
          after: after?.slice(0, 120),
        });
      } catch {}
      return ok;
    };

    const findSendButton = () => {
      const root = document.querySelector('footer') || document;
      const selectors = [
        'button[aria-label="Send"]',
        'button[aria-label*="Send"]',
        'button[data-testid="compose-btn-send"]',
        'button[data-testid*="send"]',
        'span[data-icon="send"]',
        'span[data-testid="send"]',
      ];
      for (const selector of selectors) {
        const node = root.querySelector(selector);
        if (!node) continue;
        if (node.tagName === 'BUTTON') return node;
        return node.closest('button') || node;
      }
      return null;
    };

    const isSendButtonTarget = target => {
      if (!(target instanceof Element)) return false;

      const clickable = target.closest('button, [role="button"]');
      if (!clickable) return false;

      const ariaLabel = String(clickable.getAttribute('aria-label') || '');
      const dataTestId = String(clickable.dataset.testid || '');
      const hints = `${ariaLabel} ${dataTestId}`.toLowerCase();

      if (hints.includes('send')) {
        return true;
      }

      if (clickable.querySelector('[data-icon="send"], [data-testid="send"]')) {
        return true;
      }

      return false;
    };

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    const showStatus = (text, on, isError = false) => {
      let node = document.querySelector('#ferdium-translating-pill');
      if (!node) {
        node = document.createElement('div');
        node.id = 'ferdium-translating-pill';
        node.style.cssText =
          'position:fixed;right:16px;bottom:88px;z-index:9999;display:none;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.95);border:1px solid rgba(0,0,0,.12);font-size:12px;color:#1f2937;';
        document.body.append(node);
      }
      node.textContent = text || 'Translating...';
      node.style.color = isError ? '#b42318' : '#1f2937';
      node.style.borderColor = isError
        ? 'rgba(180,35,24,.32)'
        : 'rgba(0,0,0,.12)';
      node.style.display = on ? 'block' : 'none';
    };

    const translateByInvoke = async text => {
      console.log('[Ferdium Translator] translateByInvoke called');
      if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
        console.warn('[Ferdium Translator] ipcRenderer.invoke not available');
        throw new Error('invoke-not-available');
      }

      const requestParams = {
        text,
        translateToLanguage: state.settings.targetLanguage || 'en',
        translatorEngine: state.settings.translatorEngine || 'Baidu',
        fromLanguage: state.settings.myLanguage || 'auto',
      };
      console.log(
        '[Ferdium Translator] Invoking translate with params:',
        JSON.stringify(requestParams),
      );

      const response = await ipcRenderer.invoke('translate', requestParams);
      console.log(
        '[Ferdium Translator] translate invoke response:',
        JSON.stringify({
          hasResponse: !!response,
          hasError: response?.error,
          textLength: response?.text?.length,
          textPreview: response?.text?.slice(0, 50),
        }),
      );

      if (!response || response.error) {
        console.error(
          '[Ferdium Translator] translate invoke failed:',
          response,
        );
        throw new Error(response?.text || 'translate-failed');
      }

      const translatedText = String(response.text || '').trim();
      if (!translatedText) {
        console.error('[Ferdium Translator] Empty translation result');
        throw new Error('empty-translation');
      }

      console.log(
        '[Ferdium Translator] translateByInvoke success:',
        translatedText.slice(0, 50),
      );
      return translatedText;
    };

    const translateByHostMessage = text =>
      new Promise((resolve, reject) => {
        const requestId = ++state.requestId;
        const timeout = setTimeout(() => {
          state.requests.delete(requestId);
          reject(new Error('timeout'));
        }, 12_000);
        state.requests.set(requestId, { resolve, reject, timeout });
        try {
          console.debug('[Ferdium Translator] Sending translation request', {
            requestId,
            text: text.slice(0, 50),
            fromLang: state.settings.myLanguage || 'auto',
            toLang: state.settings.targetLanguage || 'en',
            translatorEngine: state.settings.translatorEngine || 'Baidu',
          });
        } catch {}

        ipcRenderer.sendToHost('translator:translate-message', {
          requestId,
          text,
          fromLang: state.settings.myLanguage || 'auto',
          toLang: state.settings.targetLanguage || 'en',
          translatorEngine: state.settings.translatorEngine || 'Baidu',
        });
      });

    const translate = async text => {
      console.log(
        '[Ferdium Translator] translate() called with text:',
        text.slice(0, 50),
      );
      try {
        console.log('[Ferdium Translator] Trying translateByInvoke');
        const result = await translateByInvoke(text);
        console.log(
          '[Ferdium Translator] translateByInvoke succeeded:',
          result.slice(0, 50),
        );
        return result;
      } catch (invokeError) {
        console.warn(
          '[Ferdium Translator] invoke translate failed, fallback to host message',
          invokeError,
        );
        console.log('[Ferdium Translator] Trying translateByHostMessage');
        const result = await translateByHostMessage(text);
        console.log(
          '[Ferdium Translator] translateByHostMessage succeeded:',
          result.slice(0, 50),
        );
        return result;
      }
    };

    const buildOutgoingText = (originalText, translatedText) => {
      const original = String(originalText || '').trim();
      const translated = String(translatedText || '').trim();
      if (!translated) {
        return original;
      }

      const includeOriginal =
        state.settings.showOriginalText !== false &&
        !state.settings.forbidSendingOriginal;

      if (!includeOriginal || !original || original === translated) {
        return translated;
      }

      return `${original}\n--------SOURCE / TRANSLATED--------\n${translated}`;
    };

    ipcRenderer.on('translator:translation-result', (_event, result = {}) => {
      const req = state.requests.get(result.requestId);
      if (!req) {
        try {
          console.warn(
            '[Ferdium Translator] Received result for unknown request',
            {
              requestId: result.requestId,
            },
          );
        } catch {}
        return;
      }
      clearTimeout(req.timeout);
      state.requests.delete(result.requestId);
      try {
        console.debug('[Ferdium Translator] Received translation result', {
          requestId: result.requestId,
          success: result.success,
          textLength: result.text?.length,
          error: result.error,
        });
      } catch {}

      if (result.success) {
        req.resolve(result.text || '');
      } else {
        const errorMsg = result.text || 'Translation failed';
        try {
          console.error('[Ferdium Translator] Translation failed', {
            requestId: result.requestId,
            error: errorMsg,
          });
        } catch {}
        req.reject(new Error(errorMsg));
      }
    });

    const triggerNativeSend = async (
      preferClick,
      desiredText = '',
      originalText = '',
    ) => {
      const trySendViaClick = () => {
        const sendButton = findSendButton();
        if (!sendButton) return false;
        try {
          sendButton.dispatchEvent(
            new MouseEvent('pointerdown', {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window,
            }),
          );
        } catch {}
        try {
          sendButton.dispatchEvent(
            new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window,
            }),
          );
        } catch {}
        try {
          sendButton.dispatchEvent(
            new MouseEvent('mouseup', {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window,
            }),
          );
        } catch {}
        sendButton.click();
        return true;
      };

      const trySendViaEnter = () => {
        const composer = readComposer();
        if (!composer) return false;
        composer.focus();
        composer.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          }),
        );
        composer.dispatchEvent(
          new KeyboardEvent('keyup', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          }),
        );
        return true;
      };

      const composer = readComposer();
      if (composer && desiredText) {
        const currentText = getComposerText(composer);
        if (!isComposerSynced(currentText, desiredText, originalText)) {
          setComposerText(composer, desiredText);
          await sleep(120);
        }

        const afterEnsure = getComposerText(readComposer());
        if (!isComposerSynced(afterEnsure, desiredText, originalText)) {
          const fallbackOk = forceSyncViaFooterTextarea(
            desiredText,
            originalText,
          );
          if (!fallbackOk) {
            throw new Error('composer-update-before-send-failed');
          }
        }
      }

      const beforeSend = getComposerText(composer);
      if (preferClick) {
        if (!trySendViaClick()) trySendViaEnter();
      } else if (!trySendViaEnter()) {
        trySendViaClick();
      }

      await sleep(140);
      const afterFirstAttempt = getComposerText(readComposer());
      if (
        beforeSend &&
        afterFirstAttempt &&
        afterFirstAttempt.trim() === beforeSend.trim()
      ) {
        trySendViaClick();
        await sleep(140);
        const afterSecondAttempt = getComposerText(readComposer());
        if (
          afterSecondAttempt &&
          afterSecondAttempt.trim() === beforeSend.trim()
        ) {
          trySendViaEnter();
        }
      }
    };

    const translateAndSend = async preferClick => {
      try {
        console.log('[Ferdium Translator] translateAndSend called', {
          sendTranslation: state.settings.sendTranslation,
          translating: state.translating,
          preferClick,
        });
      } catch {}

      if (!state.settings.sendTranslation) {
        try {
          console.warn(
            '[Ferdium Translator] sendTranslation is false, aborting',
          );
        } catch {}
        return;
      }
      if (state.translating) {
        try {
          console.warn('[Ferdium Translator] Already translating, skipping');
        } catch {}
        return;
      }

      const composer = readComposer();
      const original = getComposerText(composer);
      if (!composer || !original) {
        try {
          console.warn('[Ferdium Translator] No composer or empty text', {
            hasComposer: !!composer,
            originalLength: original?.length,
          });
        } catch {}
        return;
      }

      let hideStatusImmediately = true;
      state.translating = true;
      showStatus('Translating...', true, false);

      try {
        // Verbose diagnostics to debug the full translation-send flow.
        console.log('[Ferdium Translator] ===== Starting translation =====');
        console.log('[Ferdium Translator] Original text:', original);
        console.log(
          '[Ferdium Translator] Settings:',
          JSON.stringify({
            myLanguage: state.settings.myLanguage,
            targetLanguage: state.settings.targetLanguage,
            translatorEngine: state.settings.translatorEngine,
            sendTranslation: state.settings.sendTranslation,
          }),
        );

        const translated = await translate(original);
        const translatedOnly = (translated || original).trim() || original;
        const finalText = buildOutgoingText(original, translatedOnly);

        console.log(
          '[Ferdium Translator] Translation result:',
          JSON.stringify({
            original: original.slice(0, 100),
            translatedOnly: translatedOnly.slice(0, 100),
            translated: finalText.slice(0, 100),
            success: translatedOnly !== original,
            translatedLength: finalText.length,
          }),
        );
        console.log(
          '[Ferdium Translator] Setting composer text to:',
          finalText.slice(0, 100),
        );
        setComposerText(composer, finalText);
        await sleep(180);
        let afterSet = getComposerText(composer);
        console.log(
          '[Ferdium Translator] After first set, composer text:',
          afterSet?.slice(0, 100),
        );

        if ((afterSet || '').trim() !== finalText) {
          console.log('[Ferdium Translator] Text mismatch, retrying set');
          setComposerText(composer, finalText);
          await sleep(260);
          afterSet = getComposerText(composer);
          console.log(
            '[Ferdium Translator] After second set, composer text:',
            afterSet?.slice(0, 100),
          );
        }
        if (!isComposerSynced(afterSet, finalText, original)) {
          console.log('[Ferdium Translator] Still not synced, third attempt');
          setComposerText(composer, finalText);
          await sleep(220);
          afterSet = getComposerText(composer);
          console.log(
            '[Ferdium Translator] After third set, composer text:',
            afterSet?.slice(0, 100),
          );
        }
        if (!isComposerSynced(afterSet, finalText, original)) {
          const fallbackOk = forceSyncViaFooterTextarea(finalText, original);
          if (fallbackOk) {
            await sleep(180);
            const fallbackComposer = readComposer();
            afterSet = getComposerText(fallbackComposer);
            console.log(
              '[Ferdium Translator] After textarea fallback, composer text:',
              afterSet?.slice(0, 100),
            );
          }
        }
        if (!isComposerSynced(afterSet, finalText, original)) {
          throw new Error('composer-update-failed');
        }
        console.log('[Ferdium Translator] Triggering native send');
        state.bypassSendUntil = Date.now() + 2400;
        await triggerNativeSend(preferClick, finalText, original);
        console.log(
          '[Ferdium Translator] ===== Translation and send completed =====',
        );
      } catch (error) {
        console.error(
          '[Ferdium Translator] ===== Translation failed =====',
          error,
        );
        console.error(
          '[Ferdium Translator] Error details:',
          JSON.stringify({
            message: error?.message,
            stack: error?.stack,
            name: error?.name,
          }),
        );
        const errorMessage =
          error?.message ? String(error.message) : 'unknown-error';
        hideStatusImmediately = false;
        showStatus(`Translation failed: ${errorMessage}`, true, true);
        setTimeout(() => {
          showStatus('', false, false);
        }, 1800);
        return;
      } finally {
        if (hideStatusImmediately) {
          showStatus('', false, false);
        }
        state.translating = false;
        setTimeout(() => {
          state.bypassSendUntil = 0;
        }, 2600);
      }
    };

    const isEditableTarget = target => {
      if (target instanceof Element) {
        if (target.matches('[contenteditable="true"], textarea')) return true;
        if (target.closest('[contenteditable="true"]')) return true;
      }
      const active = document.activeElement;
      if (active instanceof Element) {
        if (active.matches('[contenteditable="true"], textarea')) return true;
        if (active.closest('[contenteditable="true"]')) return true;
      }
      return false;
    };

    document.addEventListener(
      'keydown',
      event => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        if (event.isComposing || event.keyCode === 229) return;
        if (!state.settings.sendTranslation) {
          try {
            console.log('[Ferdium Translator] sendTranslation is disabled');
          } catch {}
          return;
        }
        const composer = readComposer();
        if (!composer) {
          try {
            console.warn(
              '[Ferdium Translator] Composer not found on Enter key',
            );
          } catch {}
          return;
        }
        const active = document.activeElement;
        const composerFocused =
          active === composer ||
          (active instanceof Element && composer.contains(active));
        if (!isEditableTarget(event.target) && !composerFocused) {
          try {
            console.log(
              '[Ferdium Translator] Not focused on composer, skipping',
            );
          } catch {}
          return;
        }
        if (Date.now() < state.bypassSendUntil) {
          try {
            console.log('[Ferdium Translator] Bypass period active, skipping');
          } catch {}
          return;
        }
        try {
          console.log(
            '[Ferdium Translator] Intercepting Enter key, starting translation',
          );
        } catch {}
        event.preventDefault();
        event.stopPropagation();
        translateAndSend(false);
      },
      true,
    );

    document.addEventListener(
      'beforeinput',
      event => {
        if (!state.settings.sendTranslation) return;
        if (Date.now() < state.bypassSendUntil) return;
        const inputType = String(event.inputType || '');
        if (
          inputType !== 'insertLineBreak' &&
          inputType !== 'insertParagraph'
        ) {
          return;
        }
        if (!isEditableTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        translateAndSend(false);
      },
      true,
    );

    const handleSendButtonEvent = event => {
      if (!state.settings.sendTranslation) {
        return;
      }
      if (Date.now() < state.bypassSendUntil) {
        return;
      }
      if (!(event.target instanceof Node)) return;
      if (!isSendButtonTarget(event.target)) return;
      const composer = readComposer();
      if (!composer || !getComposerText(composer)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }

      if (state.translating) {
        return;
      }

      translateAndSend(true);
    };

    document.addEventListener('pointerdown', handleSendButtonEvent, true);
    document.addEventListener('mousedown', handleSendButtonEvent, true);
    document.addEventListener('click', handleSendButtonEvent, true);

    ipcRenderer.on('translator:configure', (_event, settings) => {
      console.log(
        '[Ferdium Translator] Received configuration update:',
        settings,
      );
      if (settings) {
        const oldSettings = { ...state.settings };
        state.settings = {
          ...state.settings,
          ...settings,
        };
        // Keep sendTranslation enabled by default when setting is missing.
        if (state.settings.sendTranslation === undefined) {
          state.settings.sendTranslation = true;
        }
        console.log('[Ferdium Translator] Settings updated:', {
          old: oldSettings,
          new: state.settings,
        });
      }
    });

    ipcRenderer.sendToHost('translator:initialized', {
      serviceId: '${serviceId}',
      settings: state.settings,
    });

    try {
      console.log('[Ferdium Translator] Interceptor initialized successfully', {
        serviceId: '${serviceId}',
        settings: state.settings,
      });
      // Also log with warn level because some environments hide console.log.
      console.warn(
        '[Ferdium Translator] INITIALIZED - Service:',
        '${serviceId}',
        'Settings:',
        JSON.stringify(state.settings),
      );
    } catch {}

    // Expose a quick test function for runtime diagnostics.
    try {
      window.__ferdiumTranslatorTest = () => {
        console.log('[Ferdium Translator] Test function called');
        console.log('[Ferdium Translator] Current settings:', state.settings);
        console.log('[Ferdium Translator] Composer found:', !!readComposer());
        return {
          initialized: true,
          settings: state.settings,
          composerFound: !!readComposer(),
        };
      };
    } catch {}

    return 'ok';
  } catch (error) {
    return `error:${error?.message ? error.message : String(error)}`;
  }
})();
