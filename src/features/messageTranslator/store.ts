/* eslint-disable no-console */
import {
  action,
  computed,
  makeObservable,
  observable,
  runInAction,
} from 'mobx';
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

  _dynamicPeerLanguageLastApplied = new Map<
    string,
    { language: string; at: number }
  >();

  constructor() {
    super();
    makeObservable(this);
  }

  @computed get settings() {
    return localStorage.getItem('messageTranslator') || {};
  }

  readonly isPanelVisible = true;

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
      translatorEngine:
        serviceSettings.translatorEngine ||
        DEFAULT_TRANSLATOR_SETTINGS.translatorEngine,
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
    this._dynamicPeerLanguageLastApplied.clear();
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
      console.log(
        '[Ferdium Translator Store] Pushing settings to WhatsApp service:',
        {
          serviceId,
          settings: {
            myLanguage: settings.myLanguage,
            targetLanguage: settings.targetLanguage,
            translatorEngine: settings.translatorEngine,
            sendTranslation: settings.sendTranslation,
            receiveTranslation: settings.receiveTranslation,
            showOriginalText: settings.showOriginalText,
          },
        },
      );

      debug('Injecting WhatsApp translator interceptor', {
        serviceId,
        settings: {
          myLanguage: settings.myLanguage,
          targetLanguage: settings.targetLanguage,
          translatorEngine: settings.translatorEngine,
          sendTranslation: settings.sendTranslation,
          receiveTranslation: settings.receiveTranslation,
          showOriginalText: settings.showOriginalText,
        },
      });

      this._ensureWhatsAppInterceptor(serviceId)
        .then(status => {
          console.log(
            '[Ferdium Translator Store] WhatsApp interceptor injection result:',
            {
              serviceId,
              status,
            },
          );
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
            console.log(
              '[Ferdium Translator Store] WhatsApp interceptor ready, sending config',
            );
            return;
          }

          console.warn(
            '[Ferdium Translator Store] WhatsApp interceptor not ready:',
            status,
          );
          debug('WhatsApp translator interceptor not ready yet', {
            serviceId,
            status,
          });
          this._scheduleWhatsAppInjectRetry(serviceId);
        })
        .catch(error => {
          console.error(
            '[Ferdium Translator Store] Failed to inject WhatsApp interceptor:',
            error,
          );
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
      console.log(
        '[Ferdium Translator Store] Retry already scheduled for',
        serviceId,
      );
      return;
    }

    console.log(
      '[Ferdium Translator Store] Scheduling retry injection in',
      delayMs,
      'ms for',
      serviceId,
    );
    const timer = setTimeout(() => {
      console.log(
        '[Ferdium Translator Store] Retrying injection for',
        serviceId,
      );
      this._whatsAppRetryTimers.delete(serviceId);
      this._pushSettingsToService(serviceId);
    }, delayMs);

    this._whatsAppRetryTimers.set(serviceId, timer);
  };

  async _ensureWhatsAppInterceptor(serviceId: string): Promise<string> {
    console.log(
      '[Ferdium Translator Store] _ensureWhatsAppInterceptor called for',
      serviceId,
    );

    if (this._injectedWhatsAppServices.has(serviceId)) {
      console.log(
        '[Ferdium Translator Store] WhatsApp interceptor already injected for',
        serviceId,
      );
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
      console.warn(
        '[Ferdium Translator Store] No webview available for',
        serviceId,
      );
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
      receiveTranslation: actualSettings.receiveTranslation,
      showOriginalText: actualSettings.showOriginalText,
    });

    const initialSettingsJson = JSON.stringify({
      myLanguage: actualSettings.myLanguage || 'zh',
      targetLanguage: actualSettings.targetLanguage || 'en',
      translatorEngine: actualSettings.translatorEngine || 'Baidu',
      sendTranslation: actualSettings.sendTranslation !== false,
      receiveTranslation: actualSettings.receiveTranslation !== false,
      showOriginalText: actualSettings.showOriginalText === true,
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
        const interceptorVersion = '2026-02-20-v16';
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
            showOriginalText: initialSettings.showOriginalText,
          },
          translating: false,
          bypassSendUntil: 0,
          requestId: 0,
          requests: new Map(),
          flowSeq: 0,
          setSeq: 0,
          activeTranslateOpId: null,
          lastTrigger: null,
          incomingScanTimer: 0,
          incomingScanning: false,
          outgoingHistoryScanTimer: 0,
          outgoingHistoryScanning: false,
          outgoingHistoryLookupCache: new Map(),
          outgoingHistoryLookupPending: new Map(),
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
          if (state.incomingScanTimer) {
            clearTimeout(state.incomingScanTimer);
            state.incomingScanTimer = 0;
          }
          if (state.outgoingHistoryScanTimer) {
            clearTimeout(state.outgoingHistoryScanTimer);
            state.outgoingHistoryScanTimer = 0;
          }

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

        const LOCAL_PREVIEW_STYLE_ID = 'ferdium-translator-local-preview-style';
        const LOCAL_PREVIEW_ATTR = 'data-ferdium-local-preview';
        const LOCAL_PREVIEW_TEXT_ATTR = 'data-ferdium-local-preview-text';
        const LOCAL_PREVIEW_OP_ATTR = 'data-ferdium-local-preview-op';
        const LOCAL_PREVIEW_ORIGINAL_ATTR = 'data-ferdium-local-preview-original';
        const OUTGOING_HISTORY_LOOKUP_PENDING_ATTR =
          'data-ferdium-local-history-lookup-pending';
        const INCOMING_PREVIEW_ATTR = 'data-ferdium-incoming-preview';
        const INCOMING_PREVIEW_TEXT_ATTR = 'data-ferdium-incoming-preview-text';
        const INCOMING_PREVIEW_SOURCE_ATTR = 'data-ferdium-incoming-source';
        const INCOMING_PREVIEW_TARGET_LANG_ATTR = 'data-ferdium-incoming-target-lang';
        const INCOMING_PREVIEW_PENDING_ATTR = 'data-ferdium-incoming-pending';
        const INCOMING_TRANSLATION_ATTR = 'data-ferdium-incoming-preview-translation';
        const INCOMING_ORIGINAL_ATTR = 'data-ferdium-incoming-preview-original';
        const INCOMING_DIVIDER_ATTR = 'data-ferdium-incoming-preview-divider';
        const INCOMING_MISMATCH_ATTR = 'data-ferdium-incoming-preview-mismatch';

        const ensureLocalPreviewStyles = () => {
          if (document.getElementById(LOCAL_PREVIEW_STYLE_ID)) return;
          try {
            const style = document.createElement('style');
            style.id = LOCAL_PREVIEW_STYLE_ID;
            style.textContent = [
              '.ferdium-translator-local-translation{display:block;white-space:pre-wrap;color:#111827;}',
              '.ferdium-translator-local-divider{display:block;height:0;margin:6px 0 4px;border-top:1px solid rgba(16,24,40,0.24);}',
              '.ferdium-translator-local-original{display:block;white-space:pre-wrap;color:#0b7f3e;opacity:0.96;}',
              '.ferdium-translator-incoming-translation{display:block;white-space:pre-wrap;color:#111827;}',
              '.ferdium-translator-incoming-divider{display:block;height:0;margin:6px 0 4px;border-top:1px solid rgba(16,24,40,0.24);}',
              '.ferdium-translator-incoming-original{display:block;white-space:pre-wrap;color:#0b7f3e;opacity:0.96;}',
              '.ferdium-translator-incoming-mismatch{display:block;margin:2px 0 4px;color:#b54708;font-size:11px;line-height:1.25;}',
            ].join('');
            (document.head || document.documentElement || document.body)?.appendChild(
              style,
            );
            registerCleanup(() => {
              try {
                style.remove();
              } catch (_error) {}
            });
          } catch (_error) {}
        };

        const getOutgoingMessageRows = () => {
          try {
            return Array.from(document.querySelectorAll('div.message-out'));
          } catch (_error) {
            return [];
          }
        };

        const findOutgoingMessageTextContainer = row => {
          if (!(row instanceof Element)) return null;
          const selectors = [
            '[data-testid="msg-text"]',
            'span.selectable-text.copyable-text',
            'span.copyable-text',
            'div.copyable-text',
          ];
          for (const selector of selectors) {
            const candidates = Array.from(row.querySelectorAll(selector));
            for (const candidate of candidates) {
              if (!(candidate instanceof Element)) continue;
              const text = String(candidate.innerText || '').trim();
              if (!text) continue;
              return candidate;
            }
          }
          return null;
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
            .replace(/[^\\p{L}\\p{N}\\s]/gu, '')
            .replace(/\\s+/g, ' ')
            .trim();

        const hasCjkChars = value => /[\\u3400-\\u9fff]/.test(String(value || ''));

        const normalizeLanguageTag = value => {
          const normalized = String(value || '')
            .trim()
            .replace(/_/g, '-')
            .toLowerCase();
          if (!normalized) return '';
          if (normalized === 'auto') return 'auto';
          if (normalized.startsWith('zh')) {
            if (
              normalized.includes('tw') ||
              normalized.includes('hant') ||
              normalized.includes('hk') ||
              normalized.includes('mo')
            ) {
              return 'zh-tw';
            }
            return 'zh-cn';
          }
          return normalized.split('-')[0] || normalized;
        };

        const languageTagMatches = (actualLanguage, expectedLanguage) => {
          const normalizedActual = normalizeLanguageTag(actualLanguage);
          const normalizedExpected = normalizeLanguageTag(expectedLanguage);
          if (!normalizedExpected || normalizedExpected === 'auto') return true;
          if (!normalizedActual || normalizedActual === 'auto') return true;
          return normalizedActual === normalizedExpected;
        };

        const SUPPORTED_SETTING_LANGUAGES = new Set([
          'zh',
          'en',
          'yue',
          'wyw',
          'ja',
          'ko',
          'fr',
          'es',
          'th',
          'ar',
          'ru',
          'pt',
          'de',
          'it',
          'el',
          'nl',
          'pl',
          'bg',
          'et',
          'da',
          'fi',
          'cs',
          'ro',
          'sl',
          'sv',
          'hu',
          'vi',
        ]);

        const toSettingsLanguageCode = value => {
          const normalized = normalizeLanguageTag(value);
          if (!normalized || normalized === 'auto') return '';
          if (normalized.startsWith('zh')) return 'zh';
          const base = normalized.split('-')[0] || normalized;
          return SUPPORTED_SETTING_LANGUAGES.has(base) ? base : '';
        };

        const inferLanguageFromCharacterSet = value => {
          const text = String(value || '');
          if (/[\\u3040-\\u30FF]/.test(text)) return 'ja';
          if (/[\\uAC00-\\uD7AF]/.test(text)) return 'ko';
          if (/[\\u0400-\\u04FF]/.test(text)) return 'ru';
          if (/[\\u3400-\\u9FFF]/.test(text)) return 'zh';
          return '';
        };

        const isAmbiguousShortIncomingSample = value => {
          const sample = normalizeCompareText(value);
          if (!sample) return false;
          if (sample.length > 20) return false;
          const wordCount = sample.split(/\\s+/).filter(Boolean).length;
          if (wordCount > 4) return false;
          if (!/^[\\p{L}\\p{N}\\s'".,!?-]+$/u.test(sample)) return false;
          // Short Latin snippets (e.g. "good", "ok") are often misdetected.
          return /^[\\p{Script=Latin}\\p{N}\\s'".,!?-]+$/u.test(sample);
        };

        const getIncomingMessageRows = () => {
          try {
            return Array.from(document.querySelectorAll('div.message-in'));
          } catch (_error) {
            return [];
          }
        };

        const findIncomingMessageTextContainer = row => {
          if (!(row instanceof Element)) return null;
          const selectors = [
            '[data-testid="msg-text"]',
            'span.selectable-text.copyable-text',
            'span.copyable-text',
            'div.copyable-text',
          ];
          for (const selector of selectors) {
            const candidates = Array.from(row.querySelectorAll(selector));
            for (const candidate of candidates) {
              if (!(candidate instanceof Element)) continue;
              const text = String(candidate.innerText || '').trim();
              if (!text) continue;
              return candidate;
            }
          }
          return null;
        };

        const extractIncomingOriginalText = container => {
          if (!(container instanceof Element)) return '';
          const decoratedOriginal = container.querySelector(
            'span[' + INCOMING_ORIGINAL_ATTR + '="1"]',
          );
          if (decoratedOriginal instanceof Element) {
            return normalizeCompareText(
              decoratedOriginal.innerText || decoratedOriginal.textContent || '',
            );
          }

          const clone = container.cloneNode(true);
          if (!(clone instanceof Element)) {
            return normalizeCompareText(container.innerText || '');
          }
          const cleanupSelectors = [
            'span[' + INCOMING_TRANSLATION_ATTR + '="1"]',
            'span[' + INCOMING_DIVIDER_ATTR + '="1"]',
            'span[' + INCOMING_MISMATCH_ATTR + '="1"]',
          ];
          for (const selector of cleanupSelectors) {
            clone.querySelectorAll(selector).forEach(node => {
              try {
                node.remove();
              } catch (_error) {}
            });
          }
          return normalizeCompareText(clone.innerText || clone.textContent || '');
        };

        const buildIncomingTranslatePlan = (
          detectedLanguage,
          options = {},
        ) => {
          const normalizedMyLanguage = normalizeLanguageTag(
            state.settings.myLanguage || 'zh',
          );
          const normalizedConfiguredPeerLanguage = normalizeLanguageTag(
            state.settings.targetLanguage || 'auto',
          );
          const normalizedDetectedLanguage = normalizeLanguageTag(
            detectedLanguage || '',
          );
          const preferAutoSource = !!options.preferAutoSource;
          const sourceLanguage =
            normalizedDetectedLanguage && normalizedDetectedLanguage !== 'auto'
              ? normalizedDetectedLanguage
              : preferAutoSource
                ? 'auto'
              : normalizedConfiguredPeerLanguage &&
                  normalizedConfiguredPeerLanguage !== 'auto'
                ? normalizedConfiguredPeerLanguage
                : 'auto';
          const languageMismatch =
            !!normalizedDetectedLanguage &&
            normalizedDetectedLanguage !== 'auto' &&
            !!normalizedConfiguredPeerLanguage &&
            normalizedConfiguredPeerLanguage !== 'auto' &&
            normalizedDetectedLanguage !== normalizedConfiguredPeerLanguage;

          return {
            myLanguage: normalizedMyLanguage || 'zh',
            configuredPeerLanguage: normalizedConfiguredPeerLanguage || 'auto',
            detectedLanguage: normalizedDetectedLanguage || '',
            sourceLanguage,
            languageMismatch,
            shouldTranslate:
              !!(normalizedMyLanguage || 'zh') &&
              sourceLanguage !== (normalizedMyLanguage || 'zh'),
          };
        };

        const applyIncomingPreviewDecoration = (
          textContainer,
          translatedText,
          originalText,
          mismatchDetails = null,
        ) => {
          if (!(textContainer instanceof Element)) return false;
          const normalizedTranslated = String(translatedText || '').trim();
          const normalizedOriginal = String(originalText || '').trim();
          if (!normalizedTranslated || !normalizedOriginal) return false;

          ensureLocalPreviewStyles();
          const translationComparable = toComparableText(normalizedTranslated);
          const originalComparable = toComparableText(normalizedOriginal);
          if (
            !translationComparable ||
            !originalComparable ||
            translationComparable === originalComparable
          ) {
            return false;
          }

          const translationBlock = document.createElement('span');
          translationBlock.setAttribute(INCOMING_TRANSLATION_ATTR, '1');
          translationBlock.className = 'ferdium-translator-incoming-translation';
          translationBlock.textContent = normalizedTranslated;

          const dividerBlock = document.createElement('span');
          dividerBlock.setAttribute(INCOMING_DIVIDER_ATTR, '1');
          dividerBlock.className = 'ferdium-translator-incoming-divider';

          const originalBlock = document.createElement('span');
          originalBlock.setAttribute(INCOMING_ORIGINAL_ATTR, '1');
          originalBlock.className = 'ferdium-translator-incoming-original';
          originalBlock.textContent = normalizedOriginal;

          let mismatchText = '';
          if (
            mismatchDetails &&
            mismatchDetails.languageMismatch &&
            mismatchDetails.detectedLanguage &&
            mismatchDetails.configuredPeerLanguage &&
            mismatchDetails.configuredPeerLanguage !== 'auto'
          ) {
            mismatchText =
              'Detected ' +
              String(mismatchDetails.detectedLanguage).toUpperCase() +
              ', expected ' +
              String(mismatchDetails.configuredPeerLanguage).toUpperCase() +
              '. Used detected source.';
          }

          while (textContainer.firstChild) {
            textContainer.removeChild(textContainer.firstChild);
          }

          textContainer.appendChild(translationBlock);
          if (mismatchText) {
            const mismatchBlock = document.createElement('span');
            mismatchBlock.setAttribute(INCOMING_MISMATCH_ATTR, '1');
            mismatchBlock.className = 'ferdium-translator-incoming-mismatch';
            mismatchBlock.textContent = mismatchText;
            textContainer.appendChild(mismatchBlock);
          }
          textContainer.appendChild(dividerBlock);
          textContainer.appendChild(originalBlock);
          textContainer.setAttribute(INCOMING_PREVIEW_ATTR, '1');
          textContainer.setAttribute(INCOMING_PREVIEW_TEXT_ATTR, translationComparable);

          return true;
        };

        const appendOriginalPreviewBlock = (
          messageTextContainer,
          translatedText,
          originalText,
          operationId,
        ) => {
          if (!(messageTextContainer instanceof Element)) return false;
          const normalizedTranslated = String(translatedText || '').trim();
          const normalizedOriginal = String(originalText || '').trim();
          if (!normalizedTranslated || !normalizedOriginal) return false;

          ensureLocalPreviewStyles();
          messageTextContainer.classList.add('ferdium-translator-local-translation');
          messageTextContainer.setAttribute(LOCAL_PREVIEW_ATTR, '1');
          messageTextContainer.setAttribute(
            LOCAL_PREVIEW_TEXT_ATTR,
            toComparableText(normalizedTranslated),
          );
          messageTextContainer.setAttribute(LOCAL_PREVIEW_OP_ATTR, String(operationId || ''));

          let divider = messageTextContainer.querySelector(
            '[data-ferdium-local-preview-divider="1"]',
          );
          if (!(divider instanceof Element)) {
            divider = document.createElement('span');
            divider.setAttribute('data-ferdium-local-preview-divider', '1');
            divider.className = 'ferdium-translator-local-divider';
          }

          let originalBlock = messageTextContainer.querySelector(
            'span[' + LOCAL_PREVIEW_ORIGINAL_ATTR + '="1"]',
          );
          if (!(originalBlock instanceof Element)) {
            originalBlock = document.createElement('span');
            originalBlock.setAttribute(LOCAL_PREVIEW_ORIGINAL_ATTR, '1');
            originalBlock.className = 'ferdium-translator-local-original';
          }
          originalBlock.textContent = normalizedOriginal;

          if (!divider.isConnected) {
            messageTextContainer.appendChild(divider);
          }
          if (!originalBlock.isConnected) {
            messageTextContainer.appendChild(originalBlock);
          }
          return true;
        };

        const decorateLatestOutgoingMessage = (
          translatedText,
          originalText,
          operationId,
          minimumRowIndex = 0,
        ) => {
          const comparableTranslated = toComparableText(translatedText);
          const comparableOriginal = toComparableText(originalText);
          if (!comparableTranslated || !comparableOriginal) {
            return false;
          }
          ensureLocalPreviewStyles();
          const outgoingRows = getOutgoingMessageRows();
          const startIndex = Math.max(0, Number(minimumRowIndex) || 0);
          for (let index = outgoingRows.length - 1; index >= startIndex; index -= 1) {
            const row = outgoingRows[index];
            if (!(row instanceof Element)) continue;
            const rowComparable = toComparableText(String(row.innerText || ''));
            if (!rowComparable || !rowComparable.includes(comparableTranslated)) {
              continue;
            }
            const messageTextContainer = findOutgoingMessageTextContainer(row);
            if (!messageTextContainer) {
              continue;
            }
            const applied = appendOriginalPreviewBlock(
              messageTextContainer,
              translatedText,
              originalText,
              operationId,
            );
            if (!applied) {
              continue;
            }
            row.setAttribute(LOCAL_PREVIEW_ATTR, '1');
            row.setAttribute(LOCAL_PREVIEW_TEXT_ATTR, comparableTranslated);
            row.setAttribute(LOCAL_PREVIEW_OP_ATTR, String(operationId || ''));
            try {
              console.log('[Ferdium Translator] Local preview decorated', {
                operationId,
                translatedPreview: String(translatedText || '').substring(0, 80),
                originalPreview: String(originalText || '').substring(0, 80),
              });
            } catch (_e) {}
            return true;
          }
          return false;
        };

        const queueLocalPreviewDecoration = (
          translatedText,
          originalText,
          operationId,
          minimumRowIndex = 0,
        ) => {
          const normalizedTranslated = String(translatedText || '').trim();
          const normalizedOriginal = String(originalText || '').trim();
          if (!normalizedTranslated || !normalizedOriginal) return;
          if (toComparableText(normalizedTranslated) === toComparableText(normalizedOriginal)) {
            return;
          }
          const attemptDelays = [80, 220, 460, 900, 1500];
          for (const delayMs of attemptDelays) {
            const timer = setTimeout(() => {
              if (!isActiveInterceptorInstance()) return;
              const applied = decorateLatestOutgoingMessage(
                normalizedTranslated,
                normalizedOriginal,
                operationId,
                minimumRowIndex,
              );
              try {
                console.log('[Ferdium Translator] Local preview attempt', {
                  operationId,
                  delayMs,
                  applied,
                });
              } catch (_e) {}
            }, delayMs);
            registerCleanup(() => {
              clearTimeout(timer);
            });
          }
        };

        const lookupOutgoingOriginalFromCache = async (
          translatedText,
          reason = 'unknown',
        ) => {
          const normalizedTranslated = String(translatedText || '').trim();
          if (!normalizedTranslated) return '';

          const cacheKey = [
            toComparableText(normalizedTranslated),
            normalizeLanguageTag(state.settings.targetLanguage || ''),
            normalizeLanguageTag(state.settings.myLanguage || ''),
            String(state.settings.translatorEngine || '').trim().toLowerCase(),
          ].join('|');
          if (state.outgoingHistoryLookupCache.has(cacheKey)) {
            return String(state.outgoingHistoryLookupCache.get(cacheKey) || '');
          }
          const pending = state.outgoingHistoryLookupPending.get(cacheKey);
          if (pending) {
            return pending;
          }

          const promise = (async () => {
            let originalText = '';
            if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
              try {
                const response = await ipcRenderer.invoke(
                  'translator:lookup-original',
                  {
                    translatedText: normalizedTranslated,
                    fromLanguage: state.settings.myLanguage || '',
                    toLanguage: state.settings.targetLanguage || '',
                    translatorEngine: state.settings.translatorEngine || 'Baidu',
                    reason,
                  },
                );
                if (response?.found && response?.text) {
                  originalText = String(response.text || '').trim();
                }
              } catch (error) {
                try {
                  console.warn(
                    '[Ferdium Translator] lookup-original invoke failed',
                    {
                      reason,
                      error: String(error?.message || error || ''),
                    },
                  );
                } catch (_e) {}
              }
            }

            state.outgoingHistoryLookupCache.set(cacheKey, originalText || '');
            state.outgoingHistoryLookupPending.delete(cacheKey);
            return originalText;
          })();

          state.outgoingHistoryLookupPending.set(cacheKey, promise);
          return promise;
        };

        const restoreOutgoingHistoryPreview = async (reason = 'unknown') => {
          if (!isActiveInterceptorInstance()) return;
          if (state.outgoingHistoryScanning) return;

          state.outgoingHistoryScanning = true;
          try {
            const outgoingRows = getOutgoingMessageRows();
            const startIndex = Math.max(0, outgoingRows.length - 160);
            for (
              let index = startIndex;
              index < outgoingRows.length;
              index += 1
            ) {
              const row = outgoingRows[index];
              if (!(row instanceof Element)) continue;
              if (row.getAttribute(LOCAL_PREVIEW_ATTR) === '1') continue;
              if (
                row.getAttribute(OUTGOING_HISTORY_LOOKUP_PENDING_ATTR) === '1'
              ) {
                continue;
              }

              const messageTextContainer = findOutgoingMessageTextContainer(row);
              if (!messageTextContainer) continue;
              const translatedText = normalizeCompareText(
                messageTextContainer.innerText ||
                  messageTextContainer.textContent ||
                  '',
              );
              if (!translatedText) continue;

              row.setAttribute(OUTGOING_HISTORY_LOOKUP_PENDING_ATTR, '1');
              try {
                // eslint-disable-next-line no-await-in-loop
                const originalText = await lookupOutgoingOriginalFromCache(
                  translatedText,
                  reason,
                );
                if (!originalText) continue;
                if (
                  toComparableText(originalText) === toComparableText(translatedText)
                ) {
                  continue;
                }

                const applied = appendOriginalPreviewBlock(
                  messageTextContainer,
                  translatedText,
                  originalText,
                  'history-' + reason,
                );
                if (!applied) continue;

                row.setAttribute(LOCAL_PREVIEW_ATTR, '1');
                row.setAttribute(
                  LOCAL_PREVIEW_TEXT_ATTR,
                  toComparableText(translatedText),
                );
                row.setAttribute(LOCAL_PREVIEW_OP_ATTR, 'history-' + reason);
              } finally {
                row.removeAttribute(OUTGOING_HISTORY_LOOKUP_PENDING_ATTR);
              }
            }
          } finally {
            state.outgoingHistoryScanning = false;
          }
        };

        const scheduleOutgoingHistoryScan = (
          reason = 'unknown',
          delayMs = 160,
        ) => {
          if (!isActiveInterceptorInstance()) return;
          if (state.outgoingHistoryScanTimer) {
            clearTimeout(state.outgoingHistoryScanTimer);
          }
          state.outgoingHistoryScanTimer = setTimeout(() => {
            state.outgoingHistoryScanTimer = 0;
            restoreOutgoingHistoryPreview(reason);
          }, Math.max(0, Number(delayMs) || 0));
        };

        const scheduleBootstrapFormattingPass = (
          reason = 'bootstrap',
          delays = [0, 260, 720, 1400, 2400, 3800],
        ) => {
          for (const delay of delays) {
            const delayMs = Math.max(0, Number(delay) || 0);
            const timer = setTimeout(() => {
              if (!isActiveInterceptorInstance()) return;
              scheduleOutgoingHistoryScan(reason + ':outgoing:' + delayMs, 0);
            }, delayMs);
            registerCleanup(() => {
              clearTimeout(timer);
            });
          }
        };

        const getActiveChatSignature = () => {
          try {
            const path = String(window.location?.pathname || '');
            const search = String(window.location?.search || '');
            const hash = String(window.location?.hash || '');
            const headerTitleNode = document.querySelector(
              '#main header [title]',
            );
            const headerTitle = String(
              headerTitleNode?.getAttribute?.('title') ||
                headerTitleNode?.textContent ||
                '',
            )
              .trim()
              .slice(0, 120);
            const mainPane = document.querySelector('#main');
            const mainPaneState = mainPane ? 'main-ready' : 'main-missing';
            return [path, search, hash, headerTitle, mainPaneState].join('|');
          } catch (_error) {
            return '';
          }
        };

        let activeChatSignature = '';
        const refreshFormattingForActiveChat = (reason = 'active-chat') => {
          if (!isActiveInterceptorInstance()) return;
          const nextSignature = getActiveChatSignature();
          if (!nextSignature) return;
          if (nextSignature === activeChatSignature) return;
          activeChatSignature = nextSignature;
          scheduleOutgoingHistoryScan(reason + ':outgoing', 80);
        };

        const startActiveChatWatcher = () => {
          refreshFormattingForActiveChat('active-chat-bootstrap');
          const interval = setInterval(() => {
            refreshFormattingForActiveChat('active-chat-change');
          }, 900);
          registerCleanup(() => {
            clearInterval(interval);
          });
        };

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
          if (
            comparableAfter === comparableOriginal &&
            comparableFinal === comparableOriginal
          ) {
            return true;
          }
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
          if (textarea instanceof HTMLTextAreaElement) {
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
            if (ok) return true;
          }

          const footerComposer = footer?.querySelector?.(
            '[contenteditable="true"][role="textbox"], [contenteditable="true"][data-tab], [contenteditable="true"]',
          );
          if (footerComposer instanceof Element) {
            try {
              console.log('[Ferdium Translator] Trying footer composer fallback sync', {
                operationId,
              });
            } catch (_e) {}
            setComposerText(footerComposer, text, {
              operationId,
              reason: 'footer-composer-fallback',
              originalText,
              allowLexicalDomMutation: true,
              forceDomReplace: true,
            });
            const after = getComposerText(footerComposer);
            const ok = isComposerSynced(after, text, originalText);
            try {
              console.log('[Ferdium Translator] Footer composer fallback result:', {
                operationId,
                ok,
                after: after?.substring(0, 120),
              });
            } catch (_e) {}
            return ok;
          }

          return false;
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

        const translateByInvoke = async (text, options = {}) => {
          console.log('[Ferdium Translator] translateByInvoke called');
          if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
            console.warn('[Ferdium Translator] ipcRenderer.invoke not available');
            throw new Error('invoke-not-available');
          }

          const requestParams = {
            text,
            translateToLanguage:
              options.toLang || state.settings.targetLanguage || 'en',
            translatorEngine:
              options.translatorEngine || state.settings.translatorEngine || 'Baidu',
            fromLanguage: options.fromLang || state.settings.myLanguage || 'auto',
          };
          console.log(
            '[Ferdium Translator] Invoking translate with params:',
            JSON.stringify({
              ...requestParams,
              reason: options.reason || 'unspecified',
            }),
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

        const translateByHostMessage = (text, options = {}) =>
          new Promise((resolve, reject) => {
            const requestId = ++state.requestId;
            const timeout = setTimeout(() => {
              state.requests.delete(requestId);
              reject(new Error('timeout'));
            }, 12000);
            state.requests.set(requestId, { resolve, reject, timeout });

            const fromLang = options.fromLang || state.settings.myLanguage || 'auto';
            const toLang = options.toLang || state.settings.targetLanguage || 'en';
            const translatorEngine =
              options.translatorEngine || state.settings.translatorEngine || 'Baidu';
            
            // 娣诲姞璋冭瘯鏃ュ織
            try {
              console.debug('[Ferdium Translator] Sending translation request', {
                requestId,
                text: text.substring(0, 50),
                fromLang,
                toLang,
                translatorEngine,
                reason: options.reason || 'unspecified',
              });
            } catch (_debugError) {}
            
            ipcRenderer.sendToHost('translator:translate-message', {
              requestId,
              text,
              fromLang,
              toLang,
              translatorEngine,
            });
          });

        const translate = async (text, options = {}) => {
          console.log(
            '[Ferdium Translator] translate() called with text:',
            text.substring(0, 50),
          );
          try {
            console.log('[Ferdium Translator] Trying translateByInvoke');
            const result = await translateByInvoke(text, options);
            console.log('[Ferdium Translator] translateByInvoke succeeded:', result.substring(0, 50));
            return result;
          } catch (invokeError) {
            console.warn(
              '[Ferdium Translator] invoke translate failed, fallback to host message',
              invokeError,
            );
            console.log('[Ferdium Translator] Trying translateByHostMessage');
            const result = await translateByHostMessage(text, options);
            console.log('[Ferdium Translator] translateByHostMessage succeeded:', result.substring(0, 50));
            return result;
          }
        };

        const detectLanguage = async sample => {
          if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
            return '';
          }
          const normalizedSample = String(sample || '').trim();
          if (normalizedSample.length < 3) {
            return '';
          }
          try {
            const detected = await ipcRenderer.invoke('detect-language', {
              sample: normalizedSample.slice(0, 1200),
            });
            return normalizeLanguageTag(detected || '');
          } catch (error) {
            try {
              console.warn('[Ferdium Translator] detect-language failed', {
                error: String(error?.message || error || ''),
              });
            } catch (_e) {}
            return '';
          }
        };

        const validateTranslatedLanguage = async (
          translatedText,
          expectedLanguage,
          validationContext = 'unknown',
        ) => {
          const normalizedExpected = normalizeLanguageTag(expectedLanguage || '');
          const normalizedText = String(translatedText || '').trim();
          if (!normalizedExpected || normalizedExpected === 'auto') {
            return { match: true, detectedLanguage: '' };
          }
          if (normalizedText.length < 8) {
            return { match: true, detectedLanguage: '' };
          }
          const detectedLanguage = await detectLanguage(normalizedText);
          const match = languageTagMatches(detectedLanguage, normalizedExpected);
          try {
            console.log(
              '[Ferdium Translator] Translation language validation:',
              JSON.stringify({
                context: validationContext,
                expectedLanguage: normalizedExpected,
                detectedLanguage,
                match,
                textPreview: normalizedText.substring(0, 60),
              }),
            );
          } catch (_e) {}
          return { match, detectedLanguage };
        };

        const processIncomingMessageRow = async (row, reason = 'unknown') => {
          if (!isActiveInterceptorInstance()) return;
          if (!state.settings.receiveTranslation) return;
          if (!(row instanceof Element)) return;
          const textContainer = findIncomingMessageTextContainer(row);
          if (!(textContainer instanceof Element)) return;

          const originalText = extractIncomingOriginalText(textContainer);
          const originalComparable = toComparableText(originalText);
          if (!originalText || !originalComparable) return;

          const targetLanguage = normalizeLanguageTag(
            state.settings.myLanguage || 'zh',
          );
          const previousSourceComparable =
            row.getAttribute(INCOMING_PREVIEW_SOURCE_ATTR) || '';
          const previousTargetLanguage = normalizeLanguageTag(
            row.getAttribute(INCOMING_PREVIEW_TARGET_LANG_ATTR) || '',
          );

          if (
            previousSourceComparable === originalComparable &&
            previousTargetLanguage === targetLanguage
          ) {
            return;
          }
          if (row.getAttribute(INCOMING_PREVIEW_PENDING_ATTR) === '1') {
            return;
          }

          row.setAttribute(INCOMING_PREVIEW_PENDING_ATTR, '1');
          try {
            const detectedLanguage = await detectLanguage(originalText);
            const inferredLanguage = inferLanguageFromCharacterSet(originalText);
            const effectiveDetectedLanguage = inferredLanguage || detectedLanguage;
            const lowConfidenceIncomingDetection =
              !inferredLanguage &&
              isAmbiguousShortIncomingSample(originalText);
            if (
              inferredLanguage &&
              detectedLanguage &&
              normalizeLanguageTag(inferredLanguage) !==
                normalizeLanguageTag(detectedLanguage)
            ) {
              try {
                console.log(
                  '[Ferdium Translator] Incoming language adjusted by character-set heuristic',
                  {
                    detectedLanguage,
                    inferredLanguage,
                    effectiveDetectedLanguage,
                    samplePreview: originalText.substring(0, 80),
                  },
                );
              } catch (_e) {}
            }
            if (
              lowConfidenceIncomingDetection &&
              effectiveDetectedLanguage &&
              normalizeLanguageTag(effectiveDetectedLanguage) !== 'auto'
            ) {
              try {
                console.log(
                  '[Ferdium Translator] Incoming language detection marked low confidence, fallback to auto source',
                  {
                    detectedLanguage,
                    inferredLanguage,
                    effectiveDetectedLanguage,
                    samplePreview: originalText.substring(0, 80),
                    sampleLength: originalText.length,
                  },
                );
              } catch (_e) {}
            }
            const planDetectedLanguage = lowConfidenceIncomingDetection
              ? ''
              : effectiveDetectedLanguage;

            const detectedPeerLanguage = toSettingsLanguageCode(
              planDetectedLanguage,
            );
            const configuredPeerLanguage = toSettingsLanguageCode(
              state.settings.targetLanguage || '',
            );
            const myLanguage = toSettingsLanguageCode(
              state.settings.myLanguage || 'zh',
            );
            if (
              !lowConfidenceIncomingDetection &&
              detectedPeerLanguage &&
              detectedPeerLanguage !== configuredPeerLanguage &&
              detectedPeerLanguage !== myLanguage
            ) {
              state.settings.targetLanguage = detectedPeerLanguage;
              ipcRenderer.sendToHost('translator:incoming-language-detected', {
                detectedLanguage: detectedPeerLanguage,
                rawDetectedLanguage: detectedLanguage || '',
                inferredLanguage: inferredLanguage || '',
                sample: originalText.slice(0, 160),
                sampleLength: originalText.length,
                reason,
              });
              try {
                console.log(
                  '[Ferdium Translator] Reported incoming detected language',
                  {
                    reason,
                    detectedLanguage: detectedPeerLanguage,
                    rawDetectedLanguage: detectedLanguage,
                    inferredLanguage,
                    previousConfiguredPeerLanguage: configuredPeerLanguage,
                  },
                );
              } catch (_e) {}
            }
            const translatePlan = buildIncomingTranslatePlan(
              planDetectedLanguage,
              {
                preferAutoSource: lowConfidenceIncomingDetection,
              },
            );
            if (!translatePlan.shouldTranslate) {
              row.setAttribute(INCOMING_PREVIEW_SOURCE_ATTR, originalComparable);
              row.setAttribute(
                INCOMING_PREVIEW_TARGET_LANG_ATTR,
                translatePlan.myLanguage,
              );
              return;
            }

            let translatedText = await translate(originalText, {
              fromLang: translatePlan.sourceLanguage,
              toLang: translatePlan.myLanguage,
              reason: 'incoming:' + reason,
            });

            translatedText = String(translatedText || '').trim();
            if (
              !translatedText ||
              toComparableText(translatedText) === originalComparable
            ) {
              return;
            }

            let validation = await validateTranslatedLanguage(
              translatedText,
              translatePlan.myLanguage,
              'incoming-first',
            );

            if (!validation.match) {
              const fallbackSource =
                translatePlan.configuredPeerLanguage &&
                translatePlan.configuredPeerLanguage !== 'auto'
                  ? translatePlan.configuredPeerLanguage
                  : 'auto';
              if (fallbackSource !== translatePlan.sourceLanguage) {
                const retryTranslatedText = String(
                  await translate(originalText, {
                    fromLang: fallbackSource,
                    toLang: translatePlan.myLanguage,
                    reason: 'incoming-language-retry',
                  }),
                ).trim();
                if (
                  retryTranslatedText &&
                  toComparableText(retryTranslatedText) !== originalComparable
                ) {
                  const retryValidation = await validateTranslatedLanguage(
                    retryTranslatedText,
                    translatePlan.myLanguage,
                    'incoming-retry',
                  );
                  if (retryValidation.match) {
                    translatedText = retryTranslatedText;
                    validation = retryValidation;
                  }
                }
              }
            }

            if (!validation.match) {
              try {
                console.warn(
                  '[Ferdium Translator] Incoming translation rejected by language validation',
                  {
                    reason,
                    sourceLanguage: translatePlan.sourceLanguage,
                    configuredPeerLanguage: translatePlan.configuredPeerLanguage,
                    targetLanguage: translatePlan.myLanguage,
                    detectedSourceLanguage: translatePlan.detectedLanguage,
                    detectedTranslatedLanguage: validation.detectedLanguage,
                  },
                );
              } catch (_e) {}
              return;
            }

            const applied = applyIncomingPreviewDecoration(
              textContainer,
              translatedText,
              originalText,
              translatePlan,
            );
            if (!applied) {
              return;
            }

            row.setAttribute(INCOMING_PREVIEW_ATTR, '1');
            row.setAttribute(
              INCOMING_PREVIEW_TEXT_ATTR,
              toComparableText(translatedText),
            );
            row.setAttribute(INCOMING_PREVIEW_SOURCE_ATTR, originalComparable);
            row.setAttribute(
              INCOMING_PREVIEW_TARGET_LANG_ATTR,
              translatePlan.myLanguage,
            );

            try {
              console.log('[Ferdium Translator] Incoming translation applied', {
                reason,
                sourceLanguage: translatePlan.sourceLanguage,
                configuredPeerLanguage: translatePlan.configuredPeerLanguage,
                detectedSourceLanguage: translatePlan.detectedLanguage,
                languageMismatch: translatePlan.languageMismatch,
                originalPreview: originalText.substring(0, 80),
                translatedPreview: translatedText.substring(0, 80),
              });
            } catch (_e) {}
          } catch (error) {
            try {
              console.warn('[Ferdium Translator] Incoming translation failed', {
                reason,
                message: String(error?.message || error || ''),
              });
            } catch (_e) {}
          } finally {
            row.removeAttribute(INCOMING_PREVIEW_PENDING_ATTR);
          }
        };

        const scanIncomingMessages = async (reason = 'unknown') => {
          if (!isActiveInterceptorInstance()) return;
          if (!state.settings.receiveTranslation) return;
          if (state.incomingScanning) return;

          state.incomingScanning = true;
          try {
            const rows = getIncomingMessageRows();
            const startIndex = Math.max(0, rows.length - 20);
            for (let index = startIndex; index < rows.length; index += 1) {
              // eslint-disable-next-line no-await-in-loop
              await processIncomingMessageRow(rows[index], reason);
            }
          } finally {
            state.incomingScanning = false;
          }
        };

        const scheduleIncomingScan = (reason = 'unknown', delayMs = 120) => {
          if (!isActiveInterceptorInstance()) return;
          if (!state.settings.receiveTranslation) return;
          if (state.incomingScanTimer) {
            clearTimeout(state.incomingScanTimer);
          }
          state.incomingScanTimer = setTimeout(() => {
            state.incomingScanTimer = 0;
            scanIncomingMessages(reason);
          }, Math.max(0, Number(delayMs) || 0));
        };

        let incomingObserver = null;
        const ensureIncomingObserver = () => {
          if (!isActiveInterceptorInstance()) return;
          if (incomingObserver) return;
          if (typeof MutationObserver === 'undefined') return;

          const attachObserver = () => {
            if (!isActiveInterceptorInstance()) return false;
            const rootNode = document.body || document.documentElement;
            if (!(rootNode instanceof Element)) return false;

            incomingObserver = new MutationObserver(mutations => {
              if (!isActiveInterceptorInstance()) return;
              if (!state.settings.receiveTranslation) return;

              let shouldScan = false;
              for (const mutation of mutations) {
                if (mutation.type === 'characterData') {
                  const hostElement = mutation.target?.parentElement;
                  if (hostElement?.closest?.('div.message-in')) {
                    shouldScan = true;
                    break;
                  }
                }
                if (mutation.target instanceof Element) {
                  if (mutation.target.closest('div.message-in')) {
                    shouldScan = true;
                    break;
                  }
                }
                for (const node of Array.from(mutation.addedNodes || [])) {
                  if (!(node instanceof Element)) continue;
                  if (
                    node.matches('div.message-in') ||
                    node.closest('div.message-in') ||
                    node.querySelector('div.message-in')
                  ) {
                    shouldScan = true;
                    break;
                  }
                }
                if (shouldScan) break;
              }

              if (shouldScan) {
                scheduleIncomingScan('mutation-observer', 120);
              }
            });
            incomingObserver.observe(rootNode, {
              childList: true,
              subtree: true,
              characterData: true,
            });
            registerCleanup(() => {
              try {
                incomingObserver?.disconnect();
              } catch (_error) {}
              incomingObserver = null;
            });
            return true;
          };

          if (attachObserver()) {
            scheduleIncomingScan('incoming-observer-ready', 260);
            return;
          }

          const retryTimer = setTimeout(() => {
            if (!isActiveInterceptorInstance()) return;
            if (attachObserver()) {
              scheduleIncomingScan('incoming-observer-retry', 300);
            }
          }, 650);
          registerCleanup(() => {
            clearTimeout(retryTimer);
          });
        };

        let outgoingHistoryObserver = null;
        const ensureOutgoingHistoryObserver = () => {
          if (!isActiveInterceptorInstance()) return;
          if (outgoingHistoryObserver) return;
          if (typeof MutationObserver === 'undefined') return;

          const attachObserver = () => {
            if (!isActiveInterceptorInstance()) return false;
            const rootNode = document.body || document.documentElement;
            if (!(rootNode instanceof Element)) return false;

            outgoingHistoryObserver = new MutationObserver(mutations => {
              if (!isActiveInterceptorInstance()) return;
              let shouldScan = false;

              for (const mutation of mutations) {
                if (mutation.type === 'characterData') {
                  const hostElement = mutation.target?.parentElement;
                  if (hostElement?.closest?.('div.message-out')) {
                    shouldScan = true;
                    break;
                  }
                }
                if (
                  mutation.target instanceof Element &&
                  mutation.target.closest('div.message-out')
                ) {
                  shouldScan = true;
                  break;
                }
                for (const node of Array.from(mutation.addedNodes || [])) {
                  if (!(node instanceof Element)) continue;
                  if (
                    node.matches('div.message-out') ||
                    node.closest('div.message-out') ||
                    node.querySelector('div.message-out')
                  ) {
                    shouldScan = true;
                    break;
                  }
                }
                if (shouldScan) break;
              }

              if (shouldScan) {
                scheduleOutgoingHistoryScan('outgoing-history-observer', 160);
              }
            });
            outgoingHistoryObserver.observe(rootNode, {
              childList: true,
              subtree: true,
              characterData: true,
            });
            registerCleanup(() => {
              try {
                outgoingHistoryObserver?.disconnect();
              } catch (_error) {}
              outgoingHistoryObserver = null;
            });
            return true;
          };

          if (attachObserver()) {
            scheduleOutgoingHistoryScan('outgoing-history-observer-ready', 260);
            return;
          }

          const retryTimer = setTimeout(() => {
            if (!isActiveInterceptorInstance()) return;
            if (attachObserver()) {
              scheduleOutgoingHistoryScan('outgoing-history-observer-retry', 300);
            }
          }, 650);
          registerCleanup(() => {
            clearTimeout(retryTimer);
          });
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

            const detectedOutgoingSource = await detectLanguage(original);
            const configuredSourceLanguage = normalizeLanguageTag(
              state.settings.myLanguage || 'auto',
            );
            const preferredSourceLanguage =
              detectedOutgoingSource &&
              detectedOutgoingSource !== 'auto' &&
              detectedOutgoingSource !== configuredSourceLanguage
                ? detectedOutgoingSource
                : state.settings.myLanguage || 'auto';

            let translated = await translate(original, {
              fromLang: preferredSourceLanguage,
              toLang: state.settings.targetLanguage || 'en',
              reason: 'outgoing-first',
            });
            let finalText = (translated || original).trim() || original;

            let outgoingValidation = await validateTranslatedLanguage(
              finalText,
              state.settings.targetLanguage || 'en',
              'outgoing-first',
            );
            if (!outgoingValidation.match) {
              const retrySourceLanguage =
                preferredSourceLanguage === 'auto'
                  ? state.settings.myLanguage || 'auto'
                  : 'auto';
              translated = await translate(original, {
                fromLang: retrySourceLanguage,
                toLang: state.settings.targetLanguage || 'en',
                reason: 'outgoing-language-retry',
              });
              finalText = (translated || original).trim() || original;
              outgoingValidation = await validateTranslatedLanguage(
                finalText,
                state.settings.targetLanguage || 'en',
                'outgoing-retry',
              );
            }

            console.log(
              '[Ferdium Translator] Translation result:',
              JSON.stringify({
                instanceId,
                operationId,
                original: original.substring(0, 100),
                translated: finalText.substring(0, 100),
                success: finalText !== original,
                translatedLength: finalText.length,
                detectedOutgoingSource,
                preferredSourceLanguage,
                outgoingValidation,
              }),
            );
            const translationChanged =
              toComparableText(finalText) !== toComparableText(original);
            if (!translationChanged) {
              console.log(
                '[Ferdium Translator] Translation unchanged, sending original text',
                {
                  operationId,
                },
              );
              state.bypassSendUntil = Date.now() + 2400;
              await triggerNativeSend(preferClick, original, original, operationId);
              console.log(
                '[Ferdium Translator] ===== Translation and send completed (unchanged) =====',
                { operationId },
              );
              return;
            }
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
                  '[Ferdium Translator] Lexical composer not synced after first set, waiting settle checks',
                  { operationId },
                );
                const lexicalSettleDelays = [180, 320, 520];
                for (const settleDelay of lexicalSettleDelays) {
                  await sleep(settleDelay);
                  activeComposer = readComposer() || activeComposer;
                  afterSet = getComposerText(activeComposer);
                  if (isComposerSynced(afterSet, finalText, original)) {
                    break;
                  }
                }
                if (!isComposerSynced(afterSet, finalText, original)) {
                  activeComposer = readComposer() || activeComposer;
                  setComposerText(activeComposer, finalText, {
                    operationId,
                    reason: 'translate-lexical-dom-fallback',
                    originalText: original,
                    allowLexicalDomMutation: true,
                    forceDomReplace: true,
                  });
                  await sleep(260);
                  afterSet = getComposerText(activeComposer);
                }
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
            const outgoingRowCountBeforeSend = getOutgoingMessageRows().length;
            await triggerNativeSend(preferClick, finalText, original, operationId);
            queueLocalPreviewDecoration(
              finalText,
              original,
              operationId,
              outgoingRowCountBeforeSend,
            );
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
        ensureIncomingObserver();
        ensureOutgoingHistoryObserver();
        scheduleIncomingScan('bootstrap', 380);
        scheduleOutgoingHistoryScan('bootstrap', 420);
        scheduleBootstrapFormattingPass('bootstrap');
        startActiveChatWatcher();
        addDomListener(
          document,
          'visibilitychange',
          () => {
            if (document.visibilityState === 'visible') {
              scheduleIncomingScan('visibility-change', 160);
              scheduleOutgoingHistoryScan('visibility-change', 220);
              refreshFormattingForActiveChat('visibility-change');
            }
          },
          true,
        );

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
            if (state.settings.receiveTranslation === undefined) {
              state.settings.receiveTranslation = true;
            }
            if (state.settings.showOriginalText === undefined) {
              state.settings.showOriginalText = false;
            }
            console.log('[Ferdium Translator] Settings updated:', {
              old: oldSettings,
              new: state.settings,
            });
            if (state.settings.receiveTranslation) {
              ensureIncomingObserver();
              scheduleIncomingScan('configure-update', 200);
            }
            ensureOutgoingHistoryObserver();
            scheduleOutgoingHistoryScan('configure-update', 260);
            scheduleBootstrapFormattingPass('configure-update');
            refreshFormattingForActiveChat('configure-update');
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
            incomingScanning: state.incomingScanning,
            incomingScanTimer: state.incomingScanTimer,
            receiveTranslation: state.settings.receiveTranslation,
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

    console.log(
      '[Ferdium Translator Store] Executing WhatsApp interceptor script for',
      serviceId,
    );
    debug('Executing WhatsApp interceptor script for', serviceId);

    let status: string;
    try {
      status = await service.webview.executeJavaScript(script, true);
      console.log('[Ferdium Translator Store] Script execution result:', {
        serviceId,
        status,
      });
    } catch (error) {
      console.error(
        '[Ferdium Translator Store] Script execution failed:',
        error,
      );
      status = 'error';
    }

    debug('WhatsApp interceptor injection result:', { serviceId, status });

    if (status === 'ok' || status === 'already') {
      this._injectedWhatsAppServices.add(serviceId);
      debug('WhatsApp interceptor successfully injected for', serviceId);
    } else {
      this._injectedWhatsAppServices.delete(serviceId);
      debug(
        'WhatsApp interceptor injection failed for',
        serviceId,
        'status:',
        status,
      );
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

  _normalizeDynamicLanguageCode = (value: unknown): string => {
    const normalized = String(value || '')
      .trim()
      .replaceAll('_', '-')
      .toLowerCase();
    if (!normalized) return '';
    if (normalized === 'auto') return 'auto';
    if (normalized.startsWith('zh')) return 'zh';
    return normalized.split('-')[0] || normalized;
  };

  _toSupportedPeerLanguage = (value: unknown): string => {
    const normalized = this._normalizeDynamicLanguageCode(value);
    if (!normalized || normalized === 'auto') return '';
    const supported = new Set([
      'zh',
      'en',
      'yue',
      'wyw',
      'ja',
      'ko',
      'fr',
      'es',
      'th',
      'ar',
      'ru',
      'pt',
      'de',
      'it',
      'el',
      'nl',
      'pl',
      'bg',
      'et',
      'da',
      'fi',
      'cs',
      'ro',
      'sl',
      'sv',
      'hu',
      'vi',
    ]);
    return supported.has(normalized) ? normalized : '';
  };

  _inferLanguageFromSampleText = (sample: string): string => {
    const text = String(sample || '');
    if (/[\u3040-\u30FF]/.test(text)) return 'ja';
    if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
    if (/[\u0400-\u04FF]/.test(text)) return 'ru';
    if (/[\u3400-\u9FFF]/.test(text)) return 'zh';
    return '';
  };

  @action _handleIncomingLanguageDetected = ({
    serviceId,
    detectedLanguage,
    sample,
    sampleLength,
    reason,
  }: {
    serviceId: string;
    detectedLanguage: string;
    sample?: string;
    sampleLength?: number;
    reason?: string;
  }) => {
    if (!String(serviceId || '').trim()) return;
    const sampleText = String(sample || '').trim();
    const sampleSize = Number(sampleLength ?? sampleText.length);
    if (sampleSize < 4) return;

    const serviceSettings = this.getServiceSettings(serviceId);
    if (serviceSettings.receiveTranslation === false) return;

    const inferredLanguage = this._inferLanguageFromSampleText(sampleText);
    const detectedPeerLanguage =
      this._toSupportedPeerLanguage(detectedLanguage);
    let shouldPreferInferredLanguage = false;
    if (
      inferredLanguage &&
      detectedPeerLanguage &&
      inferredLanguage !== detectedPeerLanguage &&
      sampleSize <= 24
    ) {
      shouldPreferInferredLanguage = true;
    }
    if (
      shouldPreferInferredLanguage &&
      inferredLanguage === 'zh' &&
      (detectedPeerLanguage === 'yue' || detectedPeerLanguage === 'wyw')
    ) {
      shouldPreferInferredLanguage = false;
    }
    let nextPeerLanguage = detectedPeerLanguage || inferredLanguage;
    if (shouldPreferInferredLanguage) {
      nextPeerLanguage = inferredLanguage;
    }
    if (!nextPeerLanguage) return;

    const myLanguage = this._toSupportedPeerLanguage(
      serviceSettings.myLanguage,
    );
    if (myLanguage && nextPeerLanguage === myLanguage) return;

    const currentPeerLanguage = this._toSupportedPeerLanguage(
      serviceSettings.targetLanguage,
    );
    if (currentPeerLanguage === nextPeerLanguage) return;

    const previousApplied = this._dynamicPeerLanguageLastApplied.get(serviceId);
    if (
      previousApplied &&
      previousApplied.language === nextPeerLanguage &&
      Date.now() - previousApplied.at < 500
    ) {
      return;
    }

    debug('Applying dynamic peer language from incoming message', {
      serviceId,
      reason,
      samplePreview: sampleText.slice(0, 60),
      detectedLanguage,
      nextPeerLanguage,
      previousPeerLanguage: serviceSettings.targetLanguage,
      myLanguage: serviceSettings.myLanguage,
    });

    this._dynamicPeerLanguageLastApplied.set(serviceId, {
      language: nextPeerLanguage,
      at: Date.now(),
    });
    this._updateServiceSettings({
      serviceId,
      settings: {
        targetLanguage: nextPeerLanguage,
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

    if (
      message.action === 'translator:initialized' &&
      message.data?.serviceId
    ) {
      this._pushSettingsToService(message.data.serviceId);
    }

    if (
      message.action === 'translator:incoming-language-detected' &&
      message.data?.serviceId &&
      message.data?.detectedLanguage
    ) {
      this._handleIncomingLanguageDetected({
        serviceId: message.data.serviceId,
        detectedLanguage: message.data.detectedLanguage,
        sample: message.data.sample,
        sampleLength: message.data.sampleLength,
        reason: message.data.reason,
      });
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
