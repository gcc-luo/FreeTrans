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
        const interceptorVersion = '2026-02-14-v10';
        if (
          window.__ferdiumTranslatorInterceptorLoaded &&
          window.__ferdiumTranslatorInterceptorVersion === interceptorVersion
        ) {
          return 'already';
        }
        if (
          window.__ferdiumTranslatorInterceptorLoaded &&
          typeof window.__ferdiumTranslatorCleanup === 'function'
        ) {
          try {
            window.__ferdiumTranslatorCleanup('version-change');
          } catch (_error) {}
        }
        const instanceId =
          'inst-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
        window.__ferdiumTranslatorInterceptorLoaded = true;
        window.__ferdiumTranslatorInterceptorVersion = interceptorVersion;
        window.__ferdiumTranslatorInterceptorInstanceId = instanceId;
        window.__ferdiumTranslatorInterceptorInstallCount =
          Number(window.__ferdiumTranslatorInterceptorInstallCount || 0) + 1;

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
          flowSeq: 0,
          setSeq: 0,
          activeTranslateOpId: null,
          lastTrigger: null,
        };
        const isActiveInterceptorInstance = () =>
          window.__ferdiumTranslatorInterceptorInstanceId === instanceId;

        const cleanupTasks = [];
        const registerCleanup = fn => {
          if (typeof fn === 'function') cleanupTasks.push(fn);
        };

        const addDomListener = (target, eventName, handler, options) => {
          if (!target?.addEventListener || !target?.removeEventListener) return;
          target.addEventListener(eventName, handler, options);
          registerCleanup(() => {
            try {
              target.removeEventListener(eventName, handler, options);
            } catch (_error) {}
          });
        };

        const addIpcListener = (channel, handler) => {
          if (!ipcRenderer || typeof ipcRenderer.on !== 'function') return;
          ipcRenderer.on(channel, handler);
          registerCleanup(() => {
            try {
              if (typeof ipcRenderer.removeListener === 'function') {
                ipcRenderer.removeListener(channel, handler);
              } else if (typeof ipcRenderer.off === 'function') {
                ipcRenderer.off(channel, handler);
              }
            } catch (_error) {}
          });
        };

        const disposeInterceptor = reason => {
          for (const req of state.requests.values()) {
            clearTimeout(req.timeout);
            try {
              req.reject(new Error('interceptor-disposed:' + String(reason || 'unknown')));
            } catch (_error) {}
          }
          state.requests.clear();

          while (cleanupTasks.length > 0) {
            const task = cleanupTasks.pop();
            try {
              task && task();
            } catch (_error) {}
          }

          if (window.__ferdiumTranslatorInterceptorInstanceId === instanceId) {
            window.__ferdiumTranslatorInterceptorLoaded = false;
            window.__ferdiumTranslatorInterceptorVersion = null;
            window.__ferdiumTranslatorInterceptorInstanceId = null;
            window.__ferdiumTranslatorCleanup = null;
          }
        };

        window.__ferdiumTranslatorCleanup = disposeInterceptor;

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

        const getEventDebug = event => {
          if (!event) return null;
          const target = event.target instanceof Element ? event.target : null;
          return {
            type: event.type,
            isTrusted: !!event.isTrusted,
            key: event.key,
            code: event.code,
            keyCode: event.keyCode,
            inputType: event.inputType,
            isComposing: !!event.isComposing,
            shiftKey: !!event.shiftKey,
            defaultPrevented: !!event.defaultPrevented,
            timeStamp: Number(event.timeStamp || 0),
            target: target
              ? {
                  tag: target.tagName,
                  role: target.getAttribute('role'),
                  contentEditable: target.getAttribute('contenteditable'),
                  dataTab: target.getAttribute('data-tab'),
                }
              : null,
          };
        };

        const getComposerStructure = el => {
          if (!el || !(el instanceof Element)) return { exists: false };
          const paragraphNodes = Array.from(el.querySelectorAll('p')).slice(0, 5);
          const directChildren = Array.from(el.childNodes).slice(0, 8).map(node => {
            if (node.nodeType === Node.TEXT_NODE) {
              return {
                kind: 'text',
                text: String(node.textContent || '').trim().slice(0, 80),
              };
            }
            if (node instanceof Element) {
              return {
                kind: 'element',
                tag: node.tagName,
                text: String(node.textContent || '').trim().slice(0, 80),
              };
            }
            return { kind: 'node', nodeType: node.nodeType };
          });
          const paragraphs = paragraphNodes.map((p, index) => ({
            index,
            text: String(p.textContent || '').trim().slice(0, 120),
            childCount: p.childNodes.length,
            childTags: Array.from(p.children)
              .slice(0, 6)
              .map(child => child.tagName),
          }));
          return {
            exists: true,
            childNodeCount: el.childNodes.length,
            paragraphCount: el.querySelectorAll('p').length,
            directChildren,
            paragraphs,
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

        const isTextLooselyMatched = (actual, expected) => {
          const comparableActual = toComparableText(actual);
          const comparableExpected = toComparableText(expected);
          if (!comparableActual || !comparableExpected) return false;
          if (!hasCjkChars(expected) && hasCjkChars(actual)) return false;
          if (comparableActual === comparableExpected) return true;
          if (comparableActual.includes(comparableExpected)) return true;
          if (
            comparableExpected.includes(comparableActual) &&
            comparableActual.length >= Math.floor(comparableExpected.length * 0.9)
          ) {
            return true;
          }
          return false;
        };

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

        const setComposerText = (el, text, options = {}) => {
          if (!isActiveInterceptorInstance()) return;
          if (!el) return;
          const normalized = String(text || '');
          const forceDomReplace = !!options.forceDomReplace;
          const operationId = String(options.operationId || 'no-op');
          const reason = String(options.reason || 'unspecified');
          const setId = 'set-' + ++state.setSeq;
          const isLexicalComposer =
            String(el.getAttribute('data-lexical-editor') || '').toLowerCase() === 'true';
          const allowDirectDomMutations =
            !isLexicalComposer || !!options.allowLexicalDomMutation;
          const originalText = String(options.originalText || '');
          const beforeText = getComposerText(el);
          el.focus();
          const isTextInput =
            el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;

          try {
            console.log(
              '[Ferdium Translator] setComposerText begin:',
              JSON.stringify({
                instanceId,
                operationId,
                setId,
                reason,
                forceDomReplace,
                isLexicalComposer,
                allowDirectDomMutations,
                targetText: normalized.substring(0, 120),
                targetComparable: toComparableText(normalized),
                originalComparable: toComparableText(originalText),
                beforeText: beforeText.substring(0, 120),
                beforeComparable: toComparableText(beforeText),
                target: getComposerDebug(el),
                beforeStructure: getComposerStructure(el),
              }),
            );
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
              const afterInputText = String(inputEl.value || '');
              console.log(
                '[Ferdium Translator] setComposerText(input) result:',
                JSON.stringify({
                  instanceId,
                  operationId,
                  setId,
                  reason,
                  forceDomReplace,
                  before: beforeValue.substring(0, 120),
                  after: afterInputText.substring(0, 120),
                  targetComparable: toComparableText(normalized),
                  afterComparable: toComparableText(afterInputText),
                  looselyMatched: isTextLooselyMatched(afterInputText, normalized),
                }),
              );
            } catch (_e) {}
            return;
          }

          const selectAllInElement = target => {
            try {
              target.focus();
              try {
                if (typeof document.execCommand === 'function') {
                  document.execCommand('selectAll', false);
                  const selectedText = String(window.getSelection()?.toString() || '');
                  if (selectedText.trim().length > 0) {
                    return true;
                  }
                }
              } catch (_error) {}
              const selection = window.getSelection();
              if (!selection) return false;

              const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
              const firstTextNode = walker.nextNode();
              let lastTextNode = firstTextNode;
              while (walker.nextNode()) {
                lastTextNode = walker.currentNode;
              }

              const range = document.createRange();
              if (firstTextNode && lastTextNode) {
                range.setStart(firstTextNode, 0);
                range.setEnd(lastTextNode, String(lastTextNode.textContent || '').length);
              } else {
                range.selectNodeContents(target);
              }

              selection.removeAllRanges();
              selection.addRange(range);
              return selection.rangeCount > 0;
            } catch (_error) {
              return false;
            }
          };

          const getSelectionText = () => {
            try {
              return String(window.getSelection()?.toString() || '');
            } catch (_error) {
              return '';
            }
          };

          const getLexicalEditorInstance = () => {
            if (!isLexicalComposer) return null;
            try {
              const direct = el.__lexicalEditor || el._lexicalEditor;
              if (direct && typeof direct === 'object') return direct;
            } catch (_error) {}
            return null;
          };

          const replaceViaLexicalParagraphText = () => {
            // Direct DOM mutation is unstable with Lexical and may be reverted.
            return false;
          };

          const replaceViaLexicalEditorState = () => {
            if (!isLexicalComposer) return false;
            try {
              const editor = getLexicalEditorInstance();
              if (!editor) {
                try {
                  console.log(
                    '[Ferdium Translator] setComposerText strategy:',
                    JSON.stringify({
                      instanceId,
                      operationId,
                      setId,
                      strategy: 'lexical.editorState',
                      ok: false,
                      reason: 'no-editor-instance',
                    }),
                  );
                } catch (_e) {}
                return false;
              }
              if (
                typeof editor.parseEditorState !== 'function' ||
                typeof editor.setEditorState !== 'function'
              ) {
                try {
                  console.log(
                    '[Ferdium Translator] setComposerText strategy:',
                    JSON.stringify({
                      instanceId,
                      operationId,
                      setId,
                      strategy: 'lexical.editorState',
                      ok: false,
                      reason: 'missing-editor-method',
                      hasParseEditorState: typeof editor.parseEditorState === 'function',
                      hasSetEditorState: typeof editor.setEditorState === 'function',
                    }),
                  );
                } catch (_e) {}
                return false;
              }

              const textChildren = normalized
                ? [
                    {
                      detail: 0,
                      format: 0,
                      mode: 'normal',
                      style: '',
                      text: normalized,
                      type: 'text',
                      version: 1,
                    },
                  ]
                : [];
              const nextStatePayload = {
                root: {
                  children: [
                    {
                      children: textChildren,
                      direction: 'ltr',
                      format: '',
                      indent: 0,
                      type: 'paragraph',
                      version: 1,
                    },
                  ],
                  direction: 'ltr',
                  format: '',
                  indent: 0,
                  type: 'root',
                  version: 1,
                },
              };

              let parsedState = null;
              try {
                parsedState = editor.parseEditorState(JSON.stringify(nextStatePayload));
              } catch (_stringParseError) {
                parsedState = editor.parseEditorState(nextStatePayload);
              }
              if (!parsedState) {
                try {
                  console.log(
                    '[Ferdium Translator] setComposerText strategy:',
                    JSON.stringify({
                      instanceId,
                      operationId,
                      setId,
                      strategy: 'lexical.editorState',
                      ok: false,
                      reason: 'parse-editor-state-empty',
                    }),
                  );
                } catch (_e) {}
                return false;
              }

              editor.setEditorState(parsedState);
              try {
                if (typeof editor.focus === 'function') {
                  editor.focus();
                }
              } catch (_focusError) {}

              const after = getComposerText(el);
              const ok = isTextLooselyMatched(after, normalized);
              try {
                console.log(
                  '[Ferdium Translator] setComposerText strategy:',
                  JSON.stringify({
                    instanceId,
                    operationId,
                    setId,
                    strategy: 'lexical.editorState',
                    isLexicalComposer,
                    hasEditor: true,
                    editorKeys: Object.keys(editor).slice(0, 15),
                    after: String(after || '').substring(0, 120),
                    ok,
                  }),
                );
              } catch (_e) {}
              return ok;
            } catch (_error) {
              try {
                console.log(
                  '[Ferdium Translator] setComposerText strategy:',
                  JSON.stringify({
                    instanceId,
                    operationId,
                    setId,
                    strategy: 'lexical.editorState',
                    ok: false,
                    reason: String(_error?.message || _error || 'unknown-error'),
                  }),
                );
              } catch (_e) {}
              return false;
            }
          };

          const replaceViaExecCommand = () => {
            try {
              if (typeof document.execCommand !== 'function') return false;
              el.focus();
              const selected = selectAllInElement(el);
              const selectedText = getSelectionText();
              if (!selected) return false;
              document.execCommand('insertText', false, normalized);
              const after = getComposerText(el);
              const ok = isTextLooselyMatched(after, normalized);
              try {
                console.log(
                  '[Ferdium Translator] setComposerText strategy:',
                  JSON.stringify({
                    instanceId,
                    operationId,
                    setId,
                    strategy: 'execCommand.insertText',
                    isLexicalComposer,
                    selectedText: selectedText.substring(0, 120),
                    after: String(after || '').substring(0, 120),
                    ok,
                  }),
                );
              } catch (_e) {}
              return ok;
            } catch (_error) {
              return false;
            }
          };

          const replaceViaLexicalReplacementBeforeInput = () => {
            if (!isLexicalComposer) return false;
            try {
              el.focus();
              const selected = selectAllInElement(el);
              const selectedText = getSelectionText();
              if (!selected) return false;
              el.dispatchEvent(
                new InputEvent('beforeinput', {
                  bubbles: true,
                  cancelable: true,
                  composed: true,
                  inputType: 'insertReplacementText',
                  data: normalized,
                }),
              );
              el.dispatchEvent(
                new InputEvent('input', {
                  bubbles: true,
                  composed: true,
                  inputType: 'insertReplacementText',
                  data: normalized,
                }),
              );
              const after = getComposerText(el);
              const ok = isTextLooselyMatched(after, normalized);
              try {
                console.log(
                  '[Ferdium Translator] setComposerText strategy:',
                  JSON.stringify({
                    instanceId,
                    operationId,
                    setId,
                    strategy: 'lexical.beforeinput.insertReplacementText',
                    isLexicalComposer,
                    selectedText: selectedText.substring(0, 120),
                    after: String(after || '').substring(0, 120),
                    ok,
                  }),
                );
              } catch (_e) {}
              return ok;
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
              return isTextLooselyMatched(after, normalized);
            } catch (_error) {
              return false;
            }
          };

          const replaceViaPasteEvent = () => {
            try {
              el.focus();
              const selected = selectAllInElement(el);
              const selectedText = getSelectionText();
              if (!selected) return false;

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
                  el.dispatchEvent(pasteEvent);
                  dispatched = true;
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
              const ok = isTextLooselyMatched(after, normalized);
              try {
                console.log(
                  '[Ferdium Translator] setComposerText strategy:',
                  JSON.stringify({
                    instanceId,
                    operationId,
                    setId,
                    strategy: 'pasteEvent',
                    isLexicalComposer,
                    dispatched,
                    selectedText: selectedText.substring(0, 120),
                    after: String(after || '').substring(0, 120),
                    ok,
                  }),
                );
              } catch (_e) {}
              return ok;
            } catch (_error) {
              return false;
            }
          };

          let replacedByDomReplace = false;
          let replacedByLexicalReplace = false;
          let replacedByLexicalEditorState = false;
          let replacedByExecCommand = false;
          let replacedBySyntheticBeforeInput = false;
          let replacedByPasteEvent = false;
          if (!forceDomReplace) {
            if (isLexicalComposer) {
              replacedByLexicalEditorState = replaceViaLexicalEditorState();
              if (!replacedByLexicalEditorState) {
                replacedByExecCommand = replaceViaExecCommand();
              }
              if (!replacedByLexicalEditorState && !replacedByExecCommand) {
                replacedBySyntheticBeforeInput = replaceViaLexicalReplacementBeforeInput();
              }
            } else {
              replacedByExecCommand = replaceViaExecCommand();

              if (
                replacedByExecCommand &&
                !isTextLooselyMatched(getComposerText(el), normalized)
              ) {
                replacedByExecCommand = false;
              }

              if (!replacedByExecCommand) {
                replacedByPasteEvent = replaceViaPasteEvent();
              }

              if (!replacedByExecCommand && !replacedByPasteEvent) {
                replacedBySyntheticBeforeInput = replaceViaSyntheticBeforeInput();
              }
            }
          }

          try {
            if (
              allowDirectDomMutations &&
              (
                forceDomReplace ||
                (
                  !replacedByExecCommand &&
                  !replacedBySyntheticBeforeInput &&
                  !replacedByPasteEvent
                )
              )
            ) {
              if (isLexicalComposer && allowDirectDomMutations) {
                replacedByLexicalReplace = replaceViaLexicalParagraphText();
              }
              if (!replacedByLexicalReplace && allowDirectDomMutations) {
                while (el.firstChild) {
                  el.removeChild(el.firstChild);
                }
                if (normalized) {
                  el.appendChild(document.createTextNode(normalized));
                }
                replacedByDomReplace = isTextLooselyMatched(getComposerText(el), normalized);
              }
              if (replacedByLexicalReplace) {
                replacedByDomReplace = true;
              }
            }
          } catch (_error) {}

          // Fallback using Range API if direct replacement failed.
          if (
            allowDirectDomMutations &&
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
              replacedByDomReplace = isTextLooselyMatched(getComposerText(el), normalized);
            } catch (_error) {}
          }

          // Last fallback.
          if (
            allowDirectDomMutations &&
            !replacedByExecCommand &&
            !replacedBySyntheticBeforeInput &&
            !replacedByPasteEvent &&
            !replacedByDomReplace
          ) {
            el.textContent = normalized;
          }

          if (!isLexicalComposer) {
            dispatchComposerInput(el);
            try {
              el.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (_error) {}
          }

          try {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            selection?.removeAllRanges();
            selection?.addRange(range);
          } catch (_error) {}

          try {
            const afterText = getComposerText(el);
            const comparableAfter = toComparableText(afterText);
            const comparableTarget = toComparableText(normalized);
            const comparableOriginal = toComparableText(originalText);
            console.log(
              '[Ferdium Translator] setComposerText(contenteditable) result:',
              JSON.stringify({
                instanceId,
                operationId,
                setId,
                reason,
                forceDomReplace,
                isLexicalComposer,
                allowDirectDomMutations,
                skippedDirectDomMutation: isLexicalComposer && !allowDirectDomMutations,
                usedLexicalEditorState: replacedByLexicalEditorState,
                usedLexicalReplace: replacedByLexicalReplace,
                usedExecCommand: replacedByExecCommand,
                usedSyntheticBeforeInput: replacedBySyntheticBeforeInput,
                usedPasteEvent: replacedByPasteEvent,
                usedDomReplace: replacedByDomReplace,
                beforeText: beforeText.substring(0, 120),
                afterText: afterText.substring(0, 120),
                targetText: normalized.substring(0, 120),
                beforeComparable: toComparableText(beforeText),
                afterComparable: comparableAfter,
                targetComparable: comparableTarget,
                originalComparable: comparableOriginal,
                looselyMatched: isTextLooselyMatched(afterText, normalized),
                containsOriginal:
                  !!comparableOriginal && !!comparableAfter && comparableAfter.includes(comparableOriginal),
                containsTarget:
                  !!comparableTarget && !!comparableAfter && comparableAfter.includes(comparableTarget),
                structure: getComposerStructure(el),
                afterHtml: String(el.innerHTML || '').substring(0, 180),
              }),
            );
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

        const forceSyncViaFooterTextarea = (text, originalText, operationId = 'no-op') => {
          const footer = document.querySelector('footer');
          const textarea = footer?.querySelector?.('textarea');
          if (!(textarea instanceof HTMLTextAreaElement)) {
            return false;
          }
          try {
            console.log('[Ferdium Translator] Trying textarea fallback sync', {
              operationId,
            });
          } catch (_e) {}
          setComposerText(textarea, text, {
            operationId,
            reason: 'footer-textarea-fallback',
            originalText,
          });
          const after = getComposerText(textarea);
          const ok = isComposerSynced(after, text, originalText);
          try {
            console.log('[Ferdium Translator] Textarea fallback result:', {
              operationId,
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

        const handleTranslationResult = (_event, result = {}) => {
          if (!isActiveInterceptorInstance()) return;
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
        };
        addIpcListener('translator:translation-result', handleTranslationResult);

        const triggerNativeSend = async (
          preferClick,
          desiredText = '',
          originalText = '',
          operationId = 'no-op',
        ) => {
          if (!isActiveInterceptorInstance()) {
            return;
          }
          try {
            console.log('[Ferdium Translator] triggerNativeSend start:', JSON.stringify({
              instanceId,
              operationId,
              preferClick,
              desiredText: String(desiredText || '').substring(0, 120),
              originalText: String(originalText || '').substring(0, 120),
            }));
          } catch (_e) {}

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
              setComposerText(composer, desiredText, {
                operationId,
                reason: 'ensure-before-send',
                originalText,
              });
              await sleep(120);
            }

            const afterEnsure = getComposerText(readComposer());
            if (!isComposerSynced(afterEnsure, desiredText, originalText)) {
              const fallbackOk = forceSyncViaFooterTextarea(desiredText, originalText, operationId);
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

          try {
            console.log('[Ferdium Translator] triggerNativeSend end:', JSON.stringify({
              instanceId,
              operationId,
              beforeSend: String(beforeSend || '').substring(0, 120),
              afterFirstAttempt: String(afterFirstAttempt || '').substring(0, 120),
            }));
          } catch (_e) {}
        };

        const translateAndSend = async (preferClick, triggerSource = 'unknown', triggerEvent = null) => {
          if (!isActiveInterceptorInstance()) {
            return;
          }
          const operationId = 'tx-' + ++state.flowSeq;
          const triggerDebug = getEventDebug(triggerEvent);
          state.lastTrigger = {
            operationId,
            triggerSource,
            triggerDebug,
            at: Date.now(),
          };
          try {
            console.log('[Ferdium Translator] translateAndSend called', {
              instanceId,
              operationId,
              triggerSource,
              triggerDebug,
              sendTranslation: state.settings.sendTranslation,
              translating: state.translating,
              activeTranslateOpId: state.activeTranslateOpId,
              preferClick,
            });
          } catch (_e) {}

          if (!state.settings.sendTranslation) {
            try {
              console.warn('[Ferdium Translator] sendTranslation is false, aborting', {
                operationId,
                triggerSource,
              });
            } catch (_e) {}
            return;
          }
          if (state.translating) {
            try {
              console.warn('[Ferdium Translator] Already translating, skipping', {
                operationId,
                triggerSource,
                activeTranslateOpId: state.activeTranslateOpId,
                lastTrigger: state.lastTrigger,
              });
            } catch (_e) {}
            return;
          }

          const composer = readComposer();
          const original = getComposerText(composer);
          if (!composer || !original) {
            try {
              console.warn('[Ferdium Translator] No composer or empty text', {
                operationId,
                triggerSource,
                hasComposer: !!composer,
                originalLength: original?.length,
              });
            } catch (_e) {}
            return;
          }

          let hideStatusImmediately = true;
          state.translating = true;
          state.activeTranslateOpId = operationId;
          showStatus('Translating...', true, false);

          try {
            // Verbose diagnostics to debug the full translation-send flow.
            console.log('[Ferdium Translator] ===== Starting translation =====', {
              instanceId,
              operationId,
              triggerSource,
            });
            console.log('[Ferdium Translator] Original text:', original);
            console.log(
              '[Ferdium Translator] Settings:',
              JSON.stringify({
                instanceId,
                operationId,
                myLanguage: state.settings.myLanguage,
                targetLanguage: state.settings.targetLanguage,
                translatorEngine: state.settings.translatorEngine,
                sendTranslation: state.settings.sendTranslation,
                composerDebug: getComposerDebug(composer),
                composerStructure: getComposerStructure(composer),
              }),
            );

            const translated = await translate(original);
            const finalText = (translated || original).trim() || original;

            console.log(
              '[Ferdium Translator] Translation result:',
              JSON.stringify({
                instanceId,
                operationId,
                original: original.substring(0, 100),
                translated: finalText.substring(0, 100),
                success: finalText !== original,
                translatedLength: finalText.length,
              }),
            );
            console.log('[Ferdium Translator] Setting composer text to:', finalText.substring(0, 100));
            let activeComposer = composer;
            let isLexicalFlow =
              String(activeComposer?.getAttribute('data-lexical-editor') || '').toLowerCase() === 'true';
            setComposerText(activeComposer, finalText, {
              operationId,
              reason: 'translate-first-set',
              originalText: original,
            });
            await sleep(180);
            let afterSet = getComposerText(activeComposer);
            console.log('[Ferdium Translator] After first set, composer text:', afterSet?.substring(0, 100));

            if (!isComposerSynced(afterSet, finalText, original)) {
              if (isLexicalFlow) {
                console.log(
                  '[Ferdium Translator] Lexical composer not synced after first set, skipping repeat set attempts',
                  { operationId },
                );
              } else {
                console.log('[Ferdium Translator] Not synced, retrying with DOM replace');
                activeComposer = readComposer() || activeComposer;
                isLexicalFlow =
                  String(activeComposer?.getAttribute('data-lexical-editor') || '').toLowerCase() === 'true';
                setComposerText(activeComposer, finalText, {
                  operationId,
                  reason: 'translate-second-set-force-dom',
                  originalText: original,
                  forceDomReplace: !isLexicalFlow,
                });
                await sleep(260);
                afterSet = getComposerText(activeComposer);
                console.log('[Ferdium Translator] After second set, composer text:', afterSet?.substring(0, 100));
              }
            }
            if (!isComposerSynced(afterSet, finalText, original) && !isLexicalFlow) {
              console.log('[Ferdium Translator] Still not synced, third attempt');
              activeComposer = readComposer() || activeComposer;
              setComposerText(activeComposer, finalText, {
                operationId,
                reason: 'translate-third-set',
                originalText: original,
              });
              await sleep(220);
              afterSet = getComposerText(activeComposer);
              console.log('[Ferdium Translator] After third set, composer text:', afterSet?.substring(0, 100));
            }
            if (!isComposerSynced(afterSet, finalText, original)) {
              const fallbackOk = forceSyncViaFooterTextarea(finalText, original, operationId);
              if (fallbackOk) {
                await sleep(180);
                const fallbackComposer = readComposer();
                afterSet = getComposerText(fallbackComposer);
                console.log(
                  '[Ferdium Translator] After textarea fallback, composer text:',
                  afterSet?.substring(0, 100),
                );
              }
            }
            if (!isComposerSynced(afterSet, finalText, original)) {
              throw new Error('composer-update-failed');
            }
            console.log('[Ferdium Translator] Triggering native send', { operationId });
            state.bypassSendUntil = Date.now() + 2400;
            await triggerNativeSend(preferClick, finalText, original, operationId);
            console.log('[Ferdium Translator] ===== Translation and send completed =====', { operationId });
          } catch (error) {
            console.error('[Ferdium Translator] ===== Translation failed =====', error);
            console.error(
              '[Ferdium Translator] Error details:',
              JSON.stringify({
                instanceId,
                operationId,
                triggerSource,
                message: error?.message,
                stack: error?.stack,
                name: error?.name,
                lastTrigger: state.lastTrigger,
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
            if (state.activeTranslateOpId === operationId) {
              state.activeTranslateOpId = null;
            }
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

        const handleComposerKeyDown = event => {
          if (!isActiveInterceptorInstance()) return;
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
            console.log('[Ferdium Translator] Intercepting Enter key, starting translation', {
              event: getEventDebug(event),
            });
          } catch (_e) {}
          event.preventDefault();
          event.stopPropagation();
          translateAndSend(false, 'keydown-enter', event);
        };

        const handleComposerBeforeInput = event => {
          if (!isActiveInterceptorInstance()) return;
          if (!state.settings.sendTranslation) return;
          if (Date.now() < state.bypassSendUntil) return;
          if (event.isComposing) return;
          const inputType = String(event.inputType || '');
          if (inputType !== 'insertLineBreak' && inputType !== 'insertParagraph') {
            return;
          }
          if (!isEditableTarget(event.target)) return;
          try {
            console.log('[Ferdium Translator] Intercepting beforeinput send action', {
              event: getEventDebug(event),
            });
          } catch (_e) {}
          event.preventDefault();
          event.stopPropagation();
          translateAndSend(false, 'beforeinput-linebreak', event);
        };

        addDomListener(document, 'keydown', handleComposerKeyDown, true);
        addDomListener(document, 'beforeinput', handleComposerBeforeInput, true);

        const handleSendButtonEvent = event => {
          if (!isActiveInterceptorInstance()) return;
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
            try {
              console.log('[Ferdium Translator] Send button ignored because translating', {
                activeTranslateOpId: state.activeTranslateOpId,
                event: getEventDebug(event),
              });
            } catch (_e) {}
            return;
          }

          try {
            console.log('[Ferdium Translator] Intercepting send button, starting translation', {
              event: getEventDebug(event),
            });
          } catch (_e) {}
          translateAndSend(true, 'send-button', event);
        };

        addDomListener(document, 'pointerdown', handleSendButtonEvent, true);
        addDomListener(document, 'mousedown', handleSendButtonEvent, true);
        addDomListener(document, 'click', handleSendButtonEvent, true);

        const handleTranslatorConfigure = (_event, settings) => {
          if (!isActiveInterceptorInstance()) return;
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
        };
        addIpcListener('translator:configure', handleTranslatorConfigure);

        // 鍙戦€佸垵濮嬪寲瀹屾垚娑堟伅鍒颁富杩涚▼锛岃繖鏍峰彲浠ュ湪涓绘帶鍒跺彴鐪嬪埌
        ipcRenderer.sendToHost('translator:initialized', {
          serviceId: '${serviceId}',
          settings: state.settings,
          instanceId,
          interceptorVersion,
          installCount: Number(window.__ferdiumTranslatorInterceptorInstallCount || 0),
        });

        // 灏濊瘯澶氱鏂瑰紡杈撳嚭鏃ュ織锛岀‘淇濊兘鐪嬪埌
        try {
          console.log('[Ferdium Translator] Interceptor initialized successfully', {
            serviceId: '${serviceId}',
            instanceId,
            interceptorVersion,
            installCount: Number(window.__ferdiumTranslatorInterceptorInstallCount || 0),
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
              instanceId,
              interceptorVersion,
              installCount: Number(window.__ferdiumTranslatorInterceptorInstallCount || 0),
              settings: state.settings,
              composerFound: !!readComposer(),
            };
          };
          window.__ferdiumTranslatorDebugState = () => ({
            instanceId,
            interceptorVersion,
            installCount: Number(window.__ferdiumTranslatorInterceptorInstallCount || 0),
            isActive: isActiveInterceptorInstance(),
            translating: state.translating,
            activeTranslateOpId: state.activeTranslateOpId,
            bypassSendUntil: state.bypassSendUntil,
          });
          window.__ferdiumTranslatorRunCase = async targetText => {
            if (!isActiveInterceptorInstance()) {
              return { ok: false, reason: 'inactive-interceptor-instance', instanceId };
            }
            const composer = readComposer();
            if (!composer) {
              return { ok: false, reason: 'no-composer', instanceId };
            }
            const target = String(targetText || '').trim();
            if (!target) {
              return { ok: false, reason: 'empty-target', instanceId };
            }
            const original = getComposerText(composer);
            const operationId = 'manual-case-' + Date.now();
            setComposerText(composer, target, {
              operationId,
              reason: 'manual-test-case',
              originalText: original,
            });
            await sleep(320);
            const after = getComposerText(readComposer() || composer);
            return {
              ok: isComposerSynced(after, target, original),
              instanceId,
              operationId,
              original: original.substring(0, 120),
              target: target.substring(0, 120),
              after: String(after || '').substring(0, 120),
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
