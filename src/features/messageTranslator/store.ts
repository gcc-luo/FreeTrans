import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import localStorage from 'mobx-localstorage';
import { ifUndefined } from '../../jsUtils';
import type Reaction from '../../stores/lib/Reaction';
import { createReactions } from '../../stores/lib/Reaction';
import { createActionBindings } from '../utils/ActionBinding';
import FeatureStore from '../utils/FeatureStore';
import { translatorActions } from './actions';
import {
  DEFAULT_TRANSLATOR_SETTINGS,
  TRANSLATOR_DEFAULT_WIDTH,
  TRANSLATOR_MIN_WIDTH,
} from './constants';

const debug = require('../../preload-safe-debug')(
  'Ferdium:feature:messageTranslator:store',
);

export default class MessageTranslatorStore extends FeatureStore {
  @observable stores: any = null;

  @observable isFeatureActive = false;

  @observable activeServiceId: string | null = null;

  actions: any = undefined;

  _allReactions: Reaction[] | undefined;

  _injectedWhatsAppServices = new Set<string>();

  _whatsAppRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    super();
    makeObservable(this);
  }

  @computed get settings() {
    return localStorage.getItem('messageTranslator') || {};
  }

  @computed get isPanelVisible() {
    return true;
  }

  @computed get panelWidth() {
    const width = ifUndefined<number>(
      this.settings.panelWidth,
      TRANSLATOR_DEFAULT_WIDTH,
    );
    return width < TRANSLATOR_MIN_WIDTH ? TRANSLATOR_MIN_WIDTH : width;
  }

  getServiceSettings(serviceId: string) {
    const serviceSettings = this.settings.services?.[serviceId] || {};
    return {
      ...DEFAULT_TRANSLATOR_SETTINGS,
      ...serviceSettings,
      // 淇濈暀鐢ㄦ埛閫夋嫨鐨?translatorEngine锛屽鏋滄病鏈夎缃垯浣跨敤榛樿鍊?'Baidu'
      translatorEngine: serviceSettings.translatorEngine || DEFAULT_TRANSLATOR_SETTINGS.translatorEngine,
      // 纭繚 sendTranslation 榛樿鍚敤
      sendTranslation: serviceSettings.sendTranslation !== false,
    };
  }

  @computed get activeServiceSettings() {
    if (!this.activeServiceId) {
      return DEFAULT_TRANSLATOR_SETTINGS;
    }
    return this.getServiceSettings(this.activeServiceId);
  }

  @action start(stores, actions) {
    debug('MessageTranslatorStore::start');
    this.stores = stores;
    this.actions = actions;

    this._registerActions(
      createActionBindings([
        [translatorActions.updateSettings, this._updateServiceSettings],
        [translatorActions.translateMessage, this._translateMessage],
        [translatorActions.togglePanel, this._togglePanel],
        [translatorActions.setServiceLanguage, this._setServiceLanguage],
        [translatorActions.handleHostMessage, this._handleHostMessage],
        [translatorActions.handleClientMessage, this._handleClientMessage],
      ]),
    );

    this._allReactions = createReactions([
      this._updateActiveService,
      this._syncActiveServiceSettings,
    ]);
    this._registerReactions(this._allReactions);

    this._mergeGlobalSettings({
      isPanelVisible: true,
      panelWidth: 300,
    });

    this.isFeatureActive = true;
  }

  @action stop() {
    super.stop();
    debug('MessageTranslatorStore::stop');
    for (const timer of this._whatsAppRetryTimers.values()) {
      clearTimeout(timer);
    }
    this._whatsAppRetryTimers.clear();
    this._injectedWhatsAppServices.clear();
    this.isFeatureActive = false;
  }

  @action _mergeGlobalSettings = (changes: any) => {
    localStorage.setItem('messageTranslator', {
      ...this.settings,
      ...changes,
    });
  };

  _pushSettingsToService = (serviceId: string) => {
    if (!serviceId) return;
    const service = this.stores?.services?.one?.(serviceId);
    if (!service?.webview) return;

    const settings = this.getServiceSettings(serviceId);

    const sendConfig = () => {
      console.log('[Ferdium Translator Store] Sending config to webview:', {
        serviceId,
        channel: 'translator:configure',
        settings,
      });
      this.actions?.service?.sendIPCMessage({
        serviceId,
        channel: 'translator:configure',
        args: settings,
      });
    };

    if (service?.recipe?.id === 'whatsapp') {
      console.log('[Ferdium Translator Store] Pushing settings to WhatsApp service:', {
        serviceId,
        settings: {
          myLanguage: settings.myLanguage,
          targetLanguage: settings.targetLanguage,
          translatorEngine: settings.translatorEngine,
          sendTranslation: settings.sendTranslation,
        },
      });
      
      debug('Injecting WhatsApp translator interceptor', {
        serviceId,
        settings: {
          myLanguage: settings.myLanguage,
          targetLanguage: settings.targetLanguage,
          translatorEngine: settings.translatorEngine,
          sendTranslation: settings.sendTranslation,
        },
      });
      
      this._ensureWhatsAppInterceptor(serviceId)
        .then(status => {
          console.log('[Ferdium Translator Store] WhatsApp interceptor injection result:', {
            serviceId,
            status,
          });
          debug('WhatsApp interceptor injection result', { serviceId, status });
          if (status === 'ok' || status === 'already') {
            const timer = this._whatsAppRetryTimers.get(serviceId);
            if (timer) {
              clearTimeout(timer);
              this._whatsAppRetryTimers.delete(serviceId);
            }
            // 鏍囪涓哄凡娉ㄥ叆
            if (status === 'ok') {
              this._injectedWhatsAppServices.add(serviceId);
            }
            console.log('[Ferdium Translator Store] WhatsApp interceptor ready, sending config');
            return;
          }

          console.warn('[Ferdium Translator Store] WhatsApp interceptor not ready:', status);
          debug('WhatsApp translator interceptor not ready yet', {
            serviceId,
            status,
          });
          this._scheduleWhatsAppInjectRetry(serviceId);
        })
        .catch(error => {
          console.error('[Ferdium Translator Store] Failed to inject WhatsApp interceptor:', error);
          debug('Failed to inject WhatsApp interceptor', { serviceId, error });
          this._scheduleWhatsAppInjectRetry(serviceId);
        })
        .finally(() => {
          sendConfig();
        });
      return;
    }

    sendConfig();
  };

  _scheduleWhatsAppInjectRetry = (serviceId: string, delayMs = 1000) => {
    if (!serviceId || this._whatsAppRetryTimers.has(serviceId)) {
      console.log('[Ferdium Translator Store] Retry already scheduled for', serviceId);
      return;
    }

    console.log('[Ferdium Translator Store] Scheduling retry injection in', delayMs, 'ms for', serviceId);
    const timer = setTimeout(() => {
      console.log('[Ferdium Translator Store] Retrying injection for', serviceId);
      this._whatsAppRetryTimers.delete(serviceId);
      this._pushSettingsToService(serviceId);
    }, delayMs);

    this._whatsAppRetryTimers.set(serviceId, timer);
  };

  async _ensureWhatsAppInterceptor(serviceId: string): Promise<string> {
    console.log('[Ferdium Translator Store] _ensureWhatsAppInterceptor called for', serviceId);
    
    if (this._injectedWhatsAppServices.has(serviceId)) {
      console.log('[Ferdium Translator Store] WhatsApp interceptor already injected for', serviceId);
      debug('WhatsApp interceptor already injected for', serviceId);
      return 'already';
    }
    
    const service = this.stores?.services?.one?.(serviceId);
    console.log('[Ferdium Translator Store] Service check:', {
      serviceId,
      hasService: !!service,
      hasWebview: !!service?.webview,
      hasExecuteJavaScript: !!service?.webview?.executeJavaScript,
      recipeId: service?.recipe?.id,
    });
    
    if (!service?.webview?.executeJavaScript) {
      console.warn('[Ferdium Translator Store] No webview available for', serviceId);
      debug('No webview available for', serviceId);
      return 'no-webview';
    }

    // Use current service settings to initialize the WhatsApp interceptor state.
    const actualSettings = this.getServiceSettings(serviceId);
    debug('Injecting WhatsApp interceptor with settings:', {
      serviceId,
      myLanguage: actualSettings.myLanguage,
      targetLanguage: actualSettings.targetLanguage,
      translatorEngine: actualSettings.translatorEngine,
      sendTranslation: actualSettings.sendTranslation,
    });
    
    const initialSettingsJson = JSON.stringify({
      myLanguage: actualSettings.myLanguage || 'zh',
      targetLanguage: actualSettings.targetLanguage || 'en',
      translatorEngine: actualSettings.translatorEngine || 'Baidu',
      sendTranslation: actualSettings.sendTranslation !== false,
      receiveTranslation: actualSettings.receiveTranslation !== false,
    });

    const script = `
      (() => {
        try {
        const getIpcRenderer = () => {
          const bridged = window.ferdium?.ipcRenderer || window.Ferdium?.ipcRenderer;
          if (bridged) return bridged;
          try {
            if (typeof window.require === 'function') {
              const electron = window.require('electron');
              if (electron?.ipcRenderer) return electron.ipcRenderer;
            }
          } catch (_error) {}
          return null;
        };

        const ipcRenderer = getIpcRenderer();
        if (!ipcRenderer || typeof ipcRenderer.sendToHost !== 'function') {
          return 'no-ipc';
        }
        const interceptorVersion = '2026-02-13-v3';
        if (
          window.__ferdiumTranslatorInterceptorLoaded &&
          window.__ferdiumTranslatorInterceptorVersion === interceptorVersion
        ) {
          return 'already';
        }
        window.__ferdiumTranslatorInterceptorLoaded = true;
        window.__ferdiumTranslatorInterceptorVersion = interceptorVersion;

        // Initialize state from host-side settings.
        const initialSettings = ${initialSettingsJson};
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
                console.log('[Ferdium Translator] Found composer in footer:', selector);
              } catch (_e) {}
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
              console.log('[Ferdium Translator] Found composer globally:', selector);
            } catch (_e) {}
            return found;
          }
          try {
            console.warn('[Ferdium Translator] Composer not found');
          } catch (_e) {}
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
            dataTab: el.getAttribute('data-tab'),
            dataLexical: el.getAttribute('data-lexical-editor'),
            inFooter: !!el.closest('footer'),
            className: String(el.className || '').slice(0, 120),
            htmlPreview: String(el.innerHTML || '').slice(0, 120),
          };
        };

        const normalizeCompareText = value =>
          String(value || '')
            .trim()
            .replace(/\\s+/g, ' ')
            .replace(/[\\u2019\\u2018]/g, "'")
            .replace(/[\\u201c\\u201d]/g, '"');

        const toComparableText = value =>
          normalizeCompareText(value)
            .toLowerCase()
            .replace(/[^a-z0-9\\u3400-\\u9fff\\s]/gi, '')
            .replace(/\\s+/g, ' ')
            .trim();

        const hasCjkChars = value => /[\\u3400-\\u9fff]/.test(String(value || ''));

        const dispatchComposerInput = el => {
          try {
            el.dispatchEvent(new Event('input', { bubbles: true }));
          } catch (_error) {}
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
          } catch (_error) {}
          el.value = value;
        };

        const setComposerText = (el, text) => {
          if (!el) return;
          const normalized = String(text || '');
          el.focus();
          const isTextInput =
            el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;

          try {
            console.log('[Ferdium Translator] setComposerText target:', JSON.stringify(getComposerDebug(el)));
          } catch (_e) {}

          if (isTextInput) {
            const inputEl = el;
            const beforeValue = String(inputEl.value || '');
            try {
              if (typeof inputEl.setSelectionRange === 'function') {
                inputEl.setSelectionRange(0, beforeValue.length);
              }
            } catch (_error) {}
            try {
              inputEl.dispatchEvent(
                new InputEvent('beforeinput', {
                  bubbles: true,
                  cancelable: true,
                  inputType: 'insertReplacementText',
                  data: normalized,
                }),
              );
            } catch (_error) {}
            setNativeValue(inputEl, normalized);
            try {
              inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: normalized, inputType: 'insertText' }));
            } catch (_error) {
              inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
            try {
              inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (_error) {}
            try {
              console.log('[Ferdium Translator] setComposerText(input) before/after:', JSON.stringify({
                before: beforeValue.substring(0, 120),
                after: String(inputEl.value || '').substring(0, 120),
              }));
            } catch (_e) {}
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
            } catch (_error) {
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
              const inserted = document.execCommand('insertText', false, normalized);
              return inserted || getComposerText(el).trim() === normalized.trim();
            } catch (_error) {
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
            } catch (_error) {
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
              } catch (_error) {
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
                } catch (_error) {
                  dispatched = false;
                }
              }

              if (!dispatched) {
                try {
                  if (typeof document.execCommand === 'function') {
                    document.execCommand('insertText', false, normalized);
                  }
                } catch (_error) {}
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
            } catch (_error) {
              return false;
            }
          };

          let replacedByDomReplace = false;
          let replacedByExecCommand = false;
          let replacedBySyntheticBeforeInput = false;
          let replacedByPasteEvent = false;
          replacedByExecCommand = replaceViaExecCommand();

          if (replacedByExecCommand && getComposerText(el).trim() !== normalized.trim()) {
            replacedByExecCommand = false;
          }

          if (!replacedByExecCommand) {
            replacedBySyntheticBeforeInput = replaceViaSyntheticBeforeInput();
          }

          if (!replacedByExecCommand && !replacedBySyntheticBeforeInput) {
            replacedByPasteEvent = replaceViaPasteEvent();
          }

          try {
            if (
              !replacedByExecCommand &&
              !replacedBySyntheticBeforeInput &&
              !replacedByPasteEvent
            ) {
              while (el.firstChild) {
                el.removeChild(el.firstChild);
              }
              if (normalized) {
                el.appendChild(document.createTextNode(normalized));
              }
              replacedByDomReplace = true;
            }
          } catch (_error) {}

          // Fallback using Range API if direct replacement failed.
          if (
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
            } catch (_error) {}
          }

          // Last fallback.
          if (
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
          } catch (_error) {}

          try {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            selection?.removeAllRanges();
            selection?.addRange(range);
          } catch (_error) {}

          try {
            console.log('[Ferdium Translator] setComposerText(contenteditable) result:', JSON.stringify({
              usedExecCommand: replacedByExecCommand,
              usedSyntheticBeforeInput: replacedBySyntheticBeforeInput,
              usedPasteEvent: replacedByPasteEvent,
              usedDomReplace: replacedByDomReplace,
              afterText: getComposerText(el).substring(0, 120),
              afterHtml: String(el.innerHTML || '').substring(0, 120),
            }));
          } catch (_e) {}
        };

        const isComposerSynced = (afterValue, finalValue, originalValue) => {
          const comparableAfter = toComparableText(afterValue);
          const comparableFinal = toComparableText(finalValue);
          const comparableOriginal = toComparableText(originalValue);

          if (!comparableAfter) return false;
          if (comparableAfter === comparableOriginal) return false;
          if (!hasCjkChars(finalValue) && hasCjkChars(afterValue)) return false;
          if (comparableAfter === comparableFinal) return true;
          if (comparableFinal && comparableAfter.includes(comparableFinal)) return true;
          if (
            comparableFinal &&
            comparableFinal.includes(comparableAfter) &&
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
          } catch (_e) {}
          setComposerText(textarea, text);
          const after = getComposerText(textarea);
          const ok = isComposerSynced(after, text, originalText);
          try {
            console.log('[Ferdium Translator] Textarea fallback result:', {
              ok,
              after: after?.substring(0, 120),
            });
          } catch (_e) {}
          return ok;
        };

        const findSendButton = () => {
          const root = document.querySelector('footer') || document;
          const selectors = [
            'button[aria-label="Send"]',
            'button[aria-label*="Send"]',
            'button[aria-label="发送"]',
            'button[aria-label*="发送"]',
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
          const dataTestId = String(clickable.getAttribute('data-testid') || '');
          const hints = (ariaLabel + ' ' + dataTestId).toLowerCase();

          if (
            hints.includes('send') ||
            hints.includes('发送') ||
            hints.includes('發送')
          ) {
            return true;
          }

          if (
            clickable.querySelector('[data-icon="send"], [data-testid="send"]')
          ) {
            return true;
          }

          return false;
        };

        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

        const showStatus = (text, on, isError = false) => {
          let node = document.getElementById('ferdium-translating-pill');
          if (!node) {
            node = document.createElement('div');
            node.id = 'ferdium-translating-pill';
            node.style.cssText = 'position:fixed;right:16px;bottom:88px;z-index:9999;display:none;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.95);border:1px solid rgba(0,0,0,.12);font-size:12px;color:#1f2937;';
            document.body.appendChild(node);
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
              textPreview: response?.text?.substring(0, 50),
            }),
          );

          if (!response || response.error) {
            console.error('[Ferdium Translator] translate invoke failed:', response);
            throw new Error(response?.text || 'translate-failed');
          }

          const translatedText = String(response.text || '').trim();
          if (!translatedText) {
            console.error('[Ferdium Translator] Empty translation result');
            throw new Error('empty-translation');
          }

          console.log('[Ferdium Translator] translateByInvoke success:', translatedText.substring(0, 50));
          return translatedText;
        };

        const translateByHostMessage = text =>
          new Promise((resolve, reject) => {
            const requestId = ++state.requestId;
            const timeout = setTimeout(() => {
              state.requests.delete(requestId);
              reject(new Error('timeout'));
            }, 12000);
            state.requests.set(requestId, { resolve, reject, timeout });
            
            // 娣诲姞璋冭瘯鏃ュ織
            try {
              console.debug('[Ferdium Translator] Sending translation request', {
                requestId,
                text: text.substring(0, 50),
                fromLang: state.settings.myLanguage || 'auto',
                toLang: state.settings.targetLanguage || 'en',
                translatorEngine: state.settings.translatorEngine || 'Baidu',
              });
            } catch (_debugError) {}
            
            ipcRenderer.sendToHost('translator:translate-message', {
              requestId,
              text,
              fromLang: state.settings.myLanguage || 'auto',
              toLang: state.settings.targetLanguage || 'en',
              translatorEngine: state.settings.translatorEngine || 'Baidu',
            });
          });

        const translate = async text => {
          console.log('[Ferdium Translator] translate() called with text:', text.substring(0, 50));
          try {
            console.log('[Ferdium Translator] Trying translateByInvoke');
            const result = await translateByInvoke(text);
            console.log('[Ferdium Translator] translateByInvoke succeeded:', result.substring(0, 50));
            return result;
          } catch (invokeError) {
            console.warn(
              '[Ferdium Translator] invoke translate failed, fallback to host message',
              invokeError,
            );
            console.log('[Ferdium Translator] Trying translateByHostMessage');
            const result = await translateByHostMessage(text);
            console.log('[Ferdium Translator] translateByHostMessage succeeded:', result.substring(0, 50));
            return result;
          }
        };

        ipcRenderer.on('translator:translation-result', (_event, result = {}) => {
          const req = state.requests.get(result.requestId);
          if (!req) {
            try {
              console.warn('[Ferdium Translator] Received result for unknown request', {
                requestId: result.requestId,
              });
            } catch (_warnError) {}
            return;
          }
          clearTimeout(req.timeout);
          state.requests.delete(result.requestId);
          
          // 娣诲姞璋冭瘯鏃ュ織
          try {
            console.debug('[Ferdium Translator] Received translation result', {
              requestId: result.requestId,
              success: result.success,
              textLength: result.text?.length,
              error: result.error,
            });
          } catch (_debugError) {}
          
          if (result.success) {
            req.resolve(result.text || '');
          } else {
            const errorMsg = result.text || 'Translation failed';
            try {
              console.error('[Ferdium Translator] Translation failed', {
                requestId: result.requestId,
                error: errorMsg,
              });
            } catch (_errorLog) {}
            req.reject(new Error(errorMsg));
          }
        });

        const triggerNativeSend = async (preferClick, desiredText = '', originalText = '') => {
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
            } catch (_error) {}
            try {
              sendButton.dispatchEvent(
                new MouseEvent('mousedown', {
                  bubbles: true,
                  cancelable: true,
                  composed: true,
                  view: window,
                }),
              );
            } catch (_error) {}
            try {
              sendButton.dispatchEvent(
                new MouseEvent('mouseup', {
                  bubbles: true,
                  cancelable: true,
                  composed: true,
                  view: window,
                }),
              );
            } catch (_error) {}
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
              const fallbackOk = forceSyncViaFooterTextarea(desiredText, originalText);
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
          } catch (_e) {}
          
          if (!state.settings.sendTranslation) {
            try {
              console.warn('[Ferdium Translator] sendTranslation is false, aborting');
            } catch (_e) {}
            return;
          }
          if (state.translating) {
            try {
              console.warn('[Ferdium Translator] Already translating, skipping');
            } catch (_e) {}
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
            } catch (_e) {}
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
            const finalText = (translated || original).trim() || original;
            
            console.log(
              '[Ferdium Translator] Translation result:',
              JSON.stringify({
                original: original.substring(0, 100),
                translated: finalText.substring(0, 100),
                success: finalText !== original,
                translatedLength: finalText.length,
              }),
            );
            console.log('[Ferdium Translator] Setting composer text to:', finalText.substring(0, 100));
            setComposerText(composer, finalText);
            await sleep(180);
            let afterSet = getComposerText(composer);
            console.log('[Ferdium Translator] After first set, composer text:', afterSet?.substring(0, 100));
            
            if ((afterSet || '').trim() !== finalText) {
              console.log('[Ferdium Translator] Text mismatch, retrying set');
              setComposerText(composer, finalText);
              await sleep(260);
              afterSet = getComposerText(composer);
              console.log('[Ferdium Translator] After second set, composer text:', afterSet?.substring(0, 100));
            }
            if (!isComposerSynced(afterSet, finalText, original)) {
              console.log('[Ferdium Translator] Still not synced, third attempt');
              setComposerText(composer, finalText);
              await sleep(220);
              afterSet = getComposerText(composer);
              console.log('[Ferdium Translator] After third set, composer text:', afterSet?.substring(0, 100));
            }
            if (!isComposerSynced(afterSet, finalText, original)) {
              const fallbackOk = forceSyncViaFooterTextarea(finalText, original);
              if (fallbackOk) {
                await sleep(180);
                const fallbackComposer = readComposer();
                afterSet = getComposerText(fallbackComposer);
                console.log('[Ferdium Translator] After textarea fallback, composer text:', afterSet?.substring(0, 100));
              }
            }
            if (!isComposerSynced(afterSet, finalText, original)) {
              throw new Error('composer-update-failed');
            }
            console.log('[Ferdium Translator] Triggering native send');
            state.bypassSendUntil = Date.now() + 2400;
            await triggerNativeSend(preferClick, finalText, original);
            console.log('[Ferdium Translator] ===== Translation and send completed =====');
          } catch (error) {
            console.error('[Ferdium Translator] ===== Translation failed =====', error);
            console.error(
              '[Ferdium Translator] Error details:',
              JSON.stringify({
                message: error?.message,
                stack: error?.stack,
                name: error?.name,
              }),
            );
            const errorMessage =
              error && error.message ? String(error.message) : 'unknown-error';
            hideStatusImmediately = false;
            showStatus('Translation failed: ' + errorMessage, true, true);
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

        document.addEventListener('keydown', event => {
          if (event.key !== 'Enter' || event.shiftKey) return;
          if (event.isComposing || event.keyCode === 229) return;
          if (!state.settings.sendTranslation) {
            try {
              console.log('[Ferdium Translator] sendTranslation is disabled');
            } catch (_e) {}
            return;
          }
          const composer = readComposer();
          if (!composer) {
            try {
              console.warn('[Ferdium Translator] Composer not found on Enter key');
            } catch (_e) {}
            return;
          }
          const active = document.activeElement;
          const composerFocused =
            active === composer ||
            (active instanceof Element && composer.contains(active));
          if (!isEditableTarget(event.target) && !composerFocused) {
            try {
              console.log('[Ferdium Translator] Not focused on composer, skipping');
            } catch (_e) {}
            return;
          }
          if (Date.now() < state.bypassSendUntil) {
            try {
              console.log('[Ferdium Translator] Bypass period active, skipping');
            } catch (_e) {}
            return;
          }
          try {
            console.log('[Ferdium Translator] Intercepting Enter key, starting translation');
          } catch (_e) {}
          event.preventDefault();
          event.stopPropagation();
          translateAndSend(false);
        }, true);

        document.addEventListener('beforeinput', event => {
          if (!state.settings.sendTranslation) return;
          if (Date.now() < state.bypassSendUntil) return;
          const inputType = String(event.inputType || '');
          if (inputType !== 'insertLineBreak' && inputType !== 'insertParagraph') {
            return;
          }
          if (!isEditableTarget(event.target)) return;
          event.preventDefault();
          event.stopPropagation();
          translateAndSend(false);
        }, true);

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
          console.log('[Ferdium Translator] Received configuration update:', settings);
          if (settings) {
            // 淇濈暀鐢ㄦ埛閫夋嫨鐨勬墍鏈夎缃紝鍖呮嫭 translatorEngine 鍜岃瑷€璁剧疆
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

        // 鍙戦€佸垵濮嬪寲瀹屾垚娑堟伅鍒颁富杩涚▼锛岃繖鏍峰彲浠ュ湪涓绘帶鍒跺彴鐪嬪埌
        ipcRenderer.sendToHost('translator:initialized', {
          serviceId: '${serviceId}',
          settings: state.settings,
        });

        // 灏濊瘯澶氱鏂瑰紡杈撳嚭鏃ュ織锛岀‘淇濊兘鐪嬪埌
        try {
          console.log('[Ferdium Translator] Interceptor initialized successfully', {
            serviceId: '${serviceId}',
            settings: state.settings,
          });
          // Also log with warn level because some environments hide console.log.
          console.warn('[Ferdium Translator] INITIALIZED - Service:', '${serviceId}', 'Settings:', JSON.stringify(state.settings));
        } catch (_e) {}

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
        } catch (_e) {}

        return 'ok';
        } catch (error) {
          return 'error:' + (error && error.message ? error.message : String(error));
        }
      })();
    `;

    console.log('[Ferdium Translator Store] Executing WhatsApp interceptor script for', serviceId);
    debug('Executing WhatsApp interceptor script for', serviceId);
    
    let status: string;
    try {
      status = await service.webview.executeJavaScript(script, true);
      console.log('[Ferdium Translator Store] Script execution result:', { serviceId, status });
    } catch (error) {
      console.error('[Ferdium Translator Store] Script execution failed:', error);
      status = 'error';
    }
    
    debug('WhatsApp interceptor injection result:', { serviceId, status });
    
    if (status === 'ok' || status === 'already') {
      this._injectedWhatsAppServices.add(serviceId);
      debug('WhatsApp interceptor successfully injected for', serviceId);
    } else {
      this._injectedWhatsAppServices.delete(serviceId);
      debug('WhatsApp interceptor injection failed for', serviceId, 'status:', status);
    }

    return status;
  }

  @action _updateServiceSettings = ({
    serviceId,
    settings,
  }: {
    serviceId: string;
    settings: any;
  }) => {
    const currentServices = this.settings.services || {};
    this._mergeGlobalSettings({
      services: {
        ...currentServices,
        [serviceId]: {
          ...currentServices[serviceId],
          ...settings,
        },
      },
    });
    this._pushSettingsToService(serviceId);
  };

  @action _translateMessage = async ({
    text,
    fromLang,
    toLang,
  }: {
    text: string;
    fromLang: string;
    toLang: string;
  }) => {
    debug('_translateMessage requested', { text, fromLang, toLang });
  };

  @action _togglePanel = () => {
    this._mergeGlobalSettings({
      isPanelVisible: true,
    });
  };

  @action _setServiceLanguage = ({
    serviceId,
    myLanguage,
    targetLanguage,
  }: {
    serviceId: string;
    myLanguage: string;
    targetLanguage: string;
  }) => {
    this._updateServiceSettings({
      serviceId,
      settings: {
        myLanguage,
        targetLanguage,
      },
    });
  };

  @action _handleHostMessage = (message: { action: string; data: any }) => {
    debug('_handleHostMessage', message);
  };

  @action _handleClientMessage = ({
    channel,
    message = { action: '', data: {} },
  }: {
    channel: string;
    message: { action: string; data: any };
  }) => {
    debug('_handleClientMessage', channel, message);

    if (
      message.action === 'translator:settings-changed' &&
      message.data?.serviceId &&
      message.data?.settings
    ) {
      this._updateServiceSettings({
        serviceId: message.data.serviceId,
        settings: message.data.settings,
      });
    }

    if (message.action === 'translator:initialized' && message.data?.serviceId) {
      this._pushSettingsToService(message.data.serviceId);
    }
  };

  _updateActiveService = () => {
    const activeService = this.stores?.services?.active;
    runInAction(() => {
      this.activeServiceId = activeService ? activeService.id : null;
    });
  };

  _syncActiveServiceSettings = () => {
    if (!this.activeServiceId) return;

    const activeService = this.stores?.services?.one?.(this.activeServiceId);
    if (!activeService?.isAttached || !activeService?.webview) return;

    this._pushSettingsToService(this.activeServiceId);
  };
}


