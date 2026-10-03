/* eslint-disable no-console */
import { ipcRenderer } from 'electron';
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

  constructor() {
    super();
    makeObservable(this);
  }

  @computed get settings() {
    return localStorage.getItem('messageTranslator') || {};
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

    this._mergeGlobalSettings({ panelWidth: 300 });

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

  _resolveTranslatorInterceptorPlatform = (
    service: any,
  ): 'whatsapp' | 'googlechat' | null => {
    if (!service) return null;

    const recipeId = String(service?.recipe?.id || '')
      .trim()
      .toLowerCase();
    if (recipeId === 'whatsapp') {
      return 'whatsapp';
    }
    if (
      recipeId === 'googlechat' ||
      recipeId === 'google-chat' ||
      recipeId === 'google_chat' ||
      recipeId === 'hangoutschat' ||
      recipeId === 'hangouts' ||
      recipeId === 'googlechatservice'
    ) {
      return 'googlechat';
    }

    const serviceUrl = String(service?.url || service?.customUrl || '')
      .trim()
      .toLowerCase();
    if (!serviceUrl) return null;

    if (serviceUrl.includes('web.whatsapp.com')) {
      return 'whatsapp';
    }
    if (
      serviceUrl.includes('chat.google.com') ||
      serviceUrl.includes('mail.google.com/chat')
    ) {
      return 'googlechat';
    }
    if (
      serviceUrl.includes('mail.google.com') &&
      (serviceUrl.includes('#chat') || serviceUrl.includes('/#chat'))
    ) {
      return 'googlechat';
    }

    return null;
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

    const interceptorPlatform =
      this._resolveTranslatorInterceptorPlatform(service);
    if (interceptorPlatform) {
      console.log(
        '[Ferdium Translator Store] Pushing settings to translator-interceptor service:',
        {
          serviceId,
          interceptorPlatform,
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

      debug('Injecting translator interceptor', {
        serviceId,
        interceptorPlatform,
        settings: {
          myLanguage: settings.myLanguage,
          targetLanguage: settings.targetLanguage,
          translatorEngine: settings.translatorEngine,
          sendTranslation: settings.sendTranslation,
          receiveTranslation: settings.receiveTranslation,
          showOriginalText: settings.showOriginalText,
        },
      });

      this._ensureWhatsAppInterceptor(serviceId, interceptorPlatform)
        .then(status => {
          console.log(
            '[Ferdium Translator Store] Translator interceptor injection result:',
            {
              serviceId,
              interceptorPlatform,
              status,
            },
          );
          debug('Translator interceptor injection result', {
            serviceId,
            interceptorPlatform,
            status,
          });
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
              '[Ferdium Translator Store] Translator interceptor ready, sending config',
            );
            return;
          }

          console.warn(
            '[Ferdium Translator Store] Translator interceptor not ready:',
            status,
          );
          debug('Translator interceptor not ready yet', {
            serviceId,
            interceptorPlatform,
            status,
          });
          this._scheduleWhatsAppInjectRetry(serviceId);
        })
        .catch(error => {
          console.error(
            '[Ferdium Translator Store] Failed to inject translator interceptor:',
            error,
          );
          debug('Failed to inject translator interceptor', {
            serviceId,
            interceptorPlatform,
            error,
          });
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

  async _ensureWhatsAppInterceptor(
    serviceId: string,
    platformHint: 'whatsapp' | 'googlechat' | null = null,
  ): Promise<string> {
    console.log(
      '[Ferdium Translator Store] _ensureWhatsAppInterceptor called for',
      serviceId,
    );

    const service = this.stores?.services?.one?.(serviceId);
    const interceptorPlatform =
      platformHint ||
      this._resolveTranslatorInterceptorPlatform(service) ||
      'whatsapp';
    if (
      interceptorPlatform !== 'googlechat' &&
      this._injectedWhatsAppServices.has(serviceId)
    ) {
      console.log(
        '[Ferdium Translator Store] WhatsApp interceptor already injected for',
        serviceId,
      );
      debug('WhatsApp interceptor already injected for', serviceId);
      return 'already';
    }
    if (
      interceptorPlatform === 'googlechat' &&
      this._injectedWhatsAppServices.has(serviceId)
    ) {
      console.log(
        '[Ferdium Translator Store] Google Chat interceptor re-injecting for new frames',
        serviceId,
      );
    }
    console.log('[Ferdium Translator Store] Service check:', {
      serviceId,
      hasService: !!service,
      hasWebview: !!service?.webview,
      hasExecuteJavaScript: !!service?.webview?.executeJavaScript,
      recipeId: service?.recipe?.id,
      interceptorPlatform,
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
      translatorEngine: actualSettings.translatorEngine || 'Google',
      sendTranslation: actualSettings.sendTranslation !== false,
      receiveTranslation: actualSettings.receiveTranslation !== false,
      showOriginalText: actualSettings.showOriginalText === true,
    });
    const interceptorPlatformJson = JSON.stringify(interceptorPlatform);

    const script = `
      (() => {
        try {
        const getIpcRenderer = () => {
          const bridged = window.ferdium?.ipcRenderer || window.Ferdium?.ipcRenderer;
          if (bridged) return bridged;
          try {
            const topBridged =
              window.top?.ferdium?.ipcRenderer || window.top?.Ferdium?.ipcRenderer;
            if (topBridged) return topBridged;
          } catch (_error) {}
          try {
            if (typeof window.require === 'function') {
              const electron = window.require('electron');
              if (electron?.ipcRenderer) return electron.ipcRenderer;
            }
          } catch (_error) {}
          return null;
        };

        const ipcRenderer = getIpcRenderer();
        const hasDirectSendToHost =
          !!ipcRenderer && typeof ipcRenderer.sendToHost === 'function';
        const hasDirectInvoke = !!ipcRenderer && typeof ipcRenderer.invoke === 'function';
        const canUseTopBridge = (() => {
          try {
            return window.top && window.top !== window;
          } catch (_e) {
            return false;
          }
        })();
        if (!hasDirectSendToHost) {
          try {
            console.warn(
              '[Ferdium Translator] no-direct-ipc frame: ' +
                JSON.stringify({
                  href: String(window.location?.href || ''),
                  host: String(window.location?.host || ''),
                  isTop: window.top === window,
                  canUseTopBridge,
                }),
            );
          } catch (_error) {}
        }
        const BRIDGE_TAG = '__ferdiumTranslatorBridge';
        const BRIDGE_ACTION_CONFIG_SYNC = 'configure-sync';
        const bridgePending = new Map();
        let bridgeReqId = 0;
        const bridgeInvoke = (channel, payload) =>
          new Promise((resolve, reject) => {
            if (!canUseTopBridge) {
              reject(new Error('top-bridge-not-available'));
              return;
            }
            let topWindow = null;
            try {
              topWindow = window.top;
            } catch (_e) {}
            if (!topWindow || typeof topWindow.postMessage !== 'function') {
              reject(new Error('top-postmessage-not-available'));
              return;
            }
            const requestId = 'bridge-' + ++bridgeReqId;
            const timeout = setTimeout(() => {
              bridgePending.delete(requestId);
              reject(new Error('top-bridge-timeout'));
            }, 12000);
            bridgePending.set(requestId, { resolve, reject, timeout });
            try {
              topWindow.postMessage(
                {
                  [BRIDGE_TAG]: true,
                  direction: 'request',
                  requestId,
                  action: 'invoke',
                  channel,
                  payload,
                },
                '*',
              );
            } catch (error) {
              clearTimeout(timeout);
              bridgePending.delete(requestId);
              reject(error);
            }
          });
        window.addEventListener('message', event => {
          const data = event?.data;
          if (!data || data[BRIDGE_TAG] !== true || data.direction !== 'response') {
            return;
          }
          const requestId = String(data.requestId || '');
          const pending = bridgePending.get(requestId);
          if (!pending) return;
          clearTimeout(pending.timeout);
          bridgePending.delete(requestId);
          if (data.ok) {
            pending.resolve(data.result);
          } else {
            pending.reject(new Error(String(data.error || 'top-bridge-failed')));
          }
        });
        if (window.top === window && hasDirectInvoke) {
          window.addEventListener('message', async event => {
            const data = event?.data;
            if (!data || data[BRIDGE_TAG] !== true || data.direction !== 'request') {
              return;
            }
            const action = String(data.action || '');
            if (action === 'sendToHost') {
              if (hasDirectSendToHost) {
                try {
                  ipcRenderer.sendToHost(data.channel, data.payload);
                } catch (_e) {}
              }
              return;
            }
            if (action !== 'invoke') return;
            const requestId = String(data.requestId || '');
            if (!requestId) return;
            try {
              const result = await ipcRenderer.invoke(data.channel, data.payload);
              event.source?.postMessage?.(
                {
                  [BRIDGE_TAG]: true,
                  direction: 'response',
                  requestId,
                  ok: true,
                  result,
                },
                '*',
              );
            } catch (error) {
              event.source?.postMessage?.(
                {
                  [BRIDGE_TAG]: true,
                  direction: 'response',
                  requestId,
                  ok: false,
                  error: String(error?.message || error || ''),
                },
                '*',
              );
            }
          });
        }
        const invokeTranslator = async (channel, payload) => {
          if (hasDirectInvoke) {
            return ipcRenderer.invoke(channel, payload);
          }
          return bridgeInvoke(channel, payload);
        };
        const sendToHostSafe = (channel, payload) => {
          if (hasDirectSendToHost) {
            try {
              ipcRenderer.sendToHost(channel, payload);
              return true;
            } catch (_e) {}
          }
          if (canUseTopBridge) {
            try {
              window.top?.postMessage?.(
                {
                  [BRIDGE_TAG]: true,
                  direction: 'request',
                  action: 'sendToHost',
                  channel,
                  payload,
                },
                '*',
              );
              return true;
            } catch (_e) {}
          }
          return false;
        };

        const interceptorVersion = '2026-09-30-v18';
        const interceptorPlatform = ${interceptorPlatformJson};
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
        const normalizedHost = String(window.location?.hostname || '')
          .trim()
          .toLowerCase();
        const looksLikeGoogleChatHost =
          normalizedHost === 'chat.google.com' ||
          normalizedHost.endsWith('.chat.google.com') ||
          normalizedHost === 'mail.google.com';
        const activeProfile =
          interceptorPlatform === 'googlechat' ||
          (interceptorPlatform !== 'whatsapp' && looksLikeGoogleChatHost)
            ? 'googlechat'
            : 'whatsapp';
        const isGoogleChatProfile = () => activeProfile === 'googlechat';
        const isWhatsAppProfile = () => activeProfile === 'whatsapp';
        const GOOGLE_CHAT_OWN_MESSAGE_HINTS = [
          'you said',
          'you sent',
          'you:',
          '你说',
          '你說',
          '你发送',
          '你發送',
          '你傳送',
        ];
        const SEND_BUTTON_HINTS = [
          'send',
          '发送',
          '發送',
          'send message',
          'enviar',
          'envoyer',
          'senden',
        ];
        const GOOGLE_CHAT_TEXT_SELECTORS = [
          'div[dir="auto"]',
          'span[dir="auto"]',
          'div[jsname]',
          'div[role="text"]',
          'span',
        ];

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

        const normalizeIncomingSettingsPatch = settingsPatch => {
          const merged = {
            ...state.settings,
            ...(settingsPatch || {}),
          };
          if (merged.sendTranslation === undefined) {
            merged.sendTranslation = true;
          }
          if (merged.receiveTranslation === undefined) {
            merged.receiveTranslation = true;
          }
          if (merged.showOriginalText === undefined) {
            merged.showOriginalText = false;
          }
          return merged;
        };

        const syncSettingsToChildFrames = nextSettings => {
          if (window.top !== window) return;
          const payload = {
            [BRIDGE_TAG]: true,
            direction: 'broadcast',
            action: BRIDGE_ACTION_CONFIG_SYNC,
            settings: nextSettings,
            sourceInstanceId: instanceId,
          };
          try {
            for (let idx = 0; idx < window.frames.length; idx += 1) {
              window.frames[idx]?.postMessage?.(payload, '*');
            }
          } catch (_error) {}
        };

        addDomListener(window, 'message', event => {
          const data = event?.data;
          if (!data || data[BRIDGE_TAG] !== true) return;
          if (String(data.direction || '') !== 'broadcast') return;
          if (String(data.action || '') !== BRIDGE_ACTION_CONFIG_SYNC) return;
          if (!isActiveInterceptorInstance()) return;
          const incomingSettings = data.settings;
          if (!incomingSettings || typeof incomingSettings !== 'object') return;
          const oldSettings = { ...state.settings };
          state.settings = normalizeIncomingSettingsPatch(incomingSettings);
          try {
            console.log('[Ferdium Translator] Settings synced from top frame:', {
              sourceInstanceId: String(data.sourceInstanceId || ''),
              old: oldSettings,
              new: state.settings,
            });
          } catch (_e) {}
          if (state.settings.receiveTranslation) {
            ensureIncomingObserver();
            scheduleIncomingScan('configure-sync', 220);
          }
          ensureOutgoingHistoryObserver();
          scheduleOutgoingHistoryScan('configure-sync', 260);
          scheduleBootstrapFormattingPass('configure-sync');
          refreshFormattingForActiveChat('configure-sync');
        });

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

        const getComposerCandidateScore = node => {
          if (!(node instanceof Element)) return -1;
          const rect = node.getBoundingClientRect();
          const ariaLabel = String(node.getAttribute('aria-label') || '').toLowerCase();
          let score = 0;
          if (node.closest('footer')) score += 60;
          if (node.getAttribute('role') === 'textbox') score += 28;
          if (ariaLabel.includes('message')) score += 24;
          if (ariaLabel.includes('chat')) score += 16;
          if (ariaLabel.includes('输入') || ariaLabel.includes('輸入')) score += 16;
          if (ariaLabel.includes('消息') || ariaLabel.includes('訊息')) score += 16;
          if (String(node.getAttribute('data-lexical-editor') || '') === 'true') {
            score += 22;
          }
          // Prefer lower composer candidates to avoid picking top search inputs.
          score += Math.max(0, Math.round(rect.top + rect.height));
          return score;
        };

        const pickBestComposer = candidates => {
          let best = null;
          let bestScore = -1;
          for (const candidate of candidates) {
            if (!(candidate instanceof Element)) continue;
            if (!isVisibleComposer(candidate)) continue;
            const score = getComposerCandidateScore(candidate);
            if (score > bestScore) {
              best = candidate;
              bestScore = score;
            }
          }
          return best;
        };

        const querySelectorAllIncludingShadowRoots = (root, selector) => {
          const out = [];
          if (!root) return out;
          try {
            if (root instanceof Element) {
              root.querySelectorAll(selector).forEach(node => {
                if (node instanceof Element) out.push(node);
              });
            }
            const walk = node => {
              if (!(node instanceof Element)) return;
              if (node.shadowRoot) {
                node.shadowRoot.querySelectorAll(selector).forEach(n => {
                  if (n instanceof Element) out.push(n);
                });
                node.shadowRoot.querySelectorAll('*').forEach(walk);
              }
              node.querySelectorAll('*').forEach(walk);
            };
            if (root instanceof Document) {
              root.querySelectorAll(selector).forEach(n => {
                if (n instanceof Element) out.push(n);
              });
              root.body && walk(root.body);
            } else if (root instanceof Element) {
              walk(root);
            }
          } catch (_err) {}
          return out;
        };

        const getDocumentsToSearch = () => {
          const docs = [document];
          if (!isGoogleChatProfile()) return docs;
          try {
            const iframes = document.querySelectorAll('iframe');
            for (let i = 0; i < iframes.length; i++) {
              const doc = iframes[i].contentDocument;
              if (doc && doc !== document && !docs.includes(doc)) {
                docs.push(doc);
              }
            }
          } catch (_err) {}
          return docs;
        };

        const readComposer = () => {
          if (!isGoogleChatProfile()) {
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
            console.warn(
              '[Ferdium Translator] Composer not found: ' +
                JSON.stringify({ profile: activeProfile }),
            );
          } catch (_e) {}
          return null;
          }

          const roots = [
            document.querySelector('div[role="main"]'),
            document.querySelector('c-wiz[role="main"]'),
            document.querySelector('main'),
            document.body,
          ].filter(Boolean);
          const selectors = [
            'div[contenteditable="true"][role="textbox"]',
            'div[role="textbox"][contenteditable="true"]',
            'div[contenteditable="true"][aria-label*="Message"]',
            'div[contenteditable="true"][aria-label*="message"]',
            'div[contenteditable="true"][aria-label*="消息"]',
            'div[contenteditable="true"][aria-label*="訊息"]',
            'div[contenteditable="true"][aria-label*="输入"]',
            'div[contenteditable="true"][aria-label*="輸入"]',
            'textarea[aria-label*="Message"]',
            'textarea[aria-label*="message"]',
            'textarea',
          ];

          const candidates = [];
          for (const root of roots) {
            if (!(root instanceof Element)) continue;
            for (const selector of selectors) {
              root.querySelectorAll(selector).forEach(node => {
                if (node instanceof Element) {
                  candidates.push(node);
                }
              });
            }
          }

          let best = pickBestComposer(candidates);
          if (best) {
            try {
              console.log(
                '[Ferdium Translator] Found composer for Google Chat profile',
                { tag: best.tagName, ariaLabel: best.getAttribute('aria-label') },
              );
            } catch (_e) {}
          }
          if (!best) {
            const bodySelectors = [
              'div[contenteditable="true"][role="textbox"]',
              'div[contenteditable="true"]',
              'textarea',
            ];
            const bodyCandidates = [];
            for (const sel of bodySelectors) {
              try {
                document.querySelectorAll(sel).forEach(node => {
                  if (node instanceof Element && isVisibleComposer(node)) {
                    bodyCandidates.push(node);
                  }
                });
              } catch (_err) {}
            }
            best = pickBestComposer(bodyCandidates);
            if (best) {
              try {
                console.log(
                  '[Ferdium Translator] Found composer for Google Chat (body fallback)',
                  { tag: best.tagName, ariaLabel: best.getAttribute('aria-label') },
                );
              } catch (_e) {}
            }
          }
          if (!best && isGoogleChatProfile()) {
            const shadowSelectors = [
              '[contenteditable="true"][role="textbox"]',
              '[contenteditable="true"]',
              'textarea',
              '[role="textbox"]',
            ];
            const shadowCandidates = [];
            const docsToSearch = getDocumentsToSearch();
            for (const doc of docsToSearch) {
              for (const sel of shadowSelectors) {
                querySelectorAllIncludingShadowRoots(doc, sel).forEach(node => {
                  if (node instanceof Element && isVisibleComposer(node)) {
                    shadowCandidates.push(node);
                  }
                });
              }
            }
            best = pickBestComposer(shadowCandidates);
            if (best) {
              try {
                const inIframe = best.ownerDocument !== document;
                console.log(
                  '[Ferdium Translator] Found composer for Google Chat (shadow/iframe)',
                  {
                    tag: best.tagName,
                    ariaLabel: best.getAttribute('aria-label'),
                    inIframe,
                  },
                );
              } catch (_e) {}
            }
          }
          if (!best) {
            try {
              console.warn(
                '[Ferdium Translator] Composer not found: ' +
                  JSON.stringify({ profile: activeProfile }),
              );
            } catch (_e) {}
          }
          return best;
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
            htmlLength: String(el.innerHTML || '').length,
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
                textLength: String(node.textContent || '').trim().length,
              };
            }
            if (node instanceof Element) {
              return {
                kind: 'element',
                tag: node.tagName,
                textLength: String(node.textContent || '').trim().length,
              };
            }
            return { kind: 'node', nodeType: node.nodeType };
          });
          const paragraphs = paragraphNodes.map((p, index) => ({
            index,
            textLength: String(p.textContent || '').trim().length,
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
              '.ferdium-translator-local-translation{display:block;white-space:pre-wrap;color:inherit !important;}',
              '.ferdium-translator-local-divider{display:block;height:0;margin:6px 0 4px;border-top:1px solid rgba(16,24,40,0.24) !important;}',
              '.ferdium-translator-local-original{display:block;white-space:pre-wrap;color:inherit !important;opacity:0.78;}',
              '.ferdium-translator-incoming-translation{display:block;white-space:pre-wrap;color:inherit;}',
              '.ferdium-translator-incoming-divider{display:block;height:0;margin:6px 0 4px;border-top:1px solid rgba(16,24,40,0.24);}',
              '.ferdium-translator-incoming-original{display:block;white-space:pre-wrap;color:inherit;opacity:0.78;}',
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

        const isGoogleChatOwnMessageRow = row => {
          if (!(row instanceof Element)) return false;
          if (
            row.getAttribute('data-is-own-message') === 'true' ||
            row.querySelector('[data-is-own-message="true"]')
          ) {
            return true;
          }
          const rowAria = String(row.getAttribute('aria-label') || '').toLowerCase();
          if (GOOGLE_CHAT_OWN_MESSAGE_HINTS.some(hint => rowAria.includes(hint))) {
            return true;
          }
          const ownAriaNode = row.querySelector('[aria-label]');
          const ownAriaText = String(
            ownAriaNode?.getAttribute?.('aria-label') || '',
          ).toLowerCase();
          if (
            ownAriaText &&
            GOOGLE_CHAT_OWN_MESSAGE_HINTS.some(hint => ownAriaText.includes(hint))
          ) {
            return true;
          }
          return false;
        };

        const isGoogleChatMessageRow = row => {
          if (!(row instanceof Element)) return false;
          if (!row.matches('div[role="listitem"]')) return false;
          const text = String(row.innerText || row.textContent || '').trim();
          return text.length > 0;
        };

        const isOutgoingMessageRowElement = row => {
          if (!(row instanceof Element)) return false;
          if (!isGoogleChatProfile()) {
            return row.matches('div.message-out') || !!row.closest('div.message-out');
          }
          return isGoogleChatMessageRow(row) && isGoogleChatOwnMessageRow(row);
        };

        const isIncomingMessageRowElement = row => {
          if (!(row instanceof Element)) return false;
          if (!isGoogleChatProfile()) {
            return row.matches('div.message-in') || !!row.closest('div.message-in');
          }
          return isGoogleChatMessageRow(row) && !isGoogleChatOwnMessageRow(row);
        };

        const hasMatchingMessageRowInSubtree = (node, direction = 'incoming') => {
          if (!(node instanceof Element)) return false;
          const predicate =
            direction === 'outgoing'
              ? isOutgoingMessageRowElement
              : isIncomingMessageRowElement;
          if (predicate(node)) return true;
          let current = node.parentElement;
          while (current) {
            if (predicate(current)) return true;
            current = current.parentElement;
          }
          const subtreeSelector =
            direction === 'outgoing'
              ? isGoogleChatProfile()
                ? 'div[role="listitem"]'
                : 'div.message-out'
              : isGoogleChatProfile()
                ? 'div[role="listitem"]'
                : 'div.message-in';
          const subtreeMatches = Array.from(node.querySelectorAll(subtreeSelector));
          for (const row of subtreeMatches) {
            if (predicate(row)) return true;
          }
          return false;
        };

        const getOutgoingMessageRows = () => {
          if (isGoogleChatProfile()) {
            try {
              const rows = Array.from(document.querySelectorAll('div[role="listitem"]'));
              const messageRows = rows.filter(row => {
                return isGoogleChatMessageRow(row);
              });
              const outgoingRows = messageRows.filter(row =>
                isOutgoingMessageRowElement(row),
              );
              return outgoingRows.length > 0 ? outgoingRows : messageRows;
            } catch (_error) {
              return [];
            }
          }
          try {
            return Array.from(document.querySelectorAll('div.message-out'));
          } catch (_error) {
            return [];
          }
        };

        const findBestMessageTextContainer = row => {
          if (!(row instanceof Element)) return null;
          let bestNode = null;
          let bestScore = -1;
          const seen = new Set();
          for (const selector of GOOGLE_CHAT_TEXT_SELECTORS) {
            const nodes = Array.from(row.querySelectorAll(selector));
            for (const node of nodes) {
              if (!(node instanceof Element)) continue;
              if (seen.has(node)) continue;
              seen.add(node);
              if (
                node.matches(
                  'button,[role="button"],[contenteditable="true"],textarea,svg,time',
                )
              ) {
                continue;
              }
              if (node.closest('button,[role="button"],[contenteditable="true"]')) {
                continue;
              }
              const text = String(node.innerText || node.textContent || '').trim();
              if (!text) continue;
              const descendantCount = node.querySelectorAll('div,span,p').length;
              const buttonCount = node.querySelectorAll('button,[role="button"]').length;
              const dirBonus = String(node.getAttribute('dir') || '').toLowerCase() === 'auto'
                ? 22
                : 0;
              const score =
                Math.min(text.length, 260) -
                Math.min(descendantCount, 80) -
                buttonCount * 20 +
                dirBonus;
              if (score > bestScore) {
                bestNode = node;
                bestScore = score;
              }
            }
          }
          return bestNode;
        };

        const findOutgoingMessageTextContainer = row => {
          if (!(row instanceof Element)) return null;
          if (isGoogleChatProfile()) {
            return findBestMessageTextContainer(row);
          }
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
          'id',
          'hi',
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
          if (isGoogleChatProfile()) {
            try {
              const rows = Array.from(document.querySelectorAll('div[role="listitem"]'));
              const messageRows = rows.filter(row => {
                return isGoogleChatMessageRow(row);
              });
              const incomingRows = messageRows.filter(row =>
                isIncomingMessageRowElement(row),
              );
              return incomingRows.length > 0 ? incomingRows : messageRows;
            } catch (_error) {
              return [];
            }
          }
          try {
            return Array.from(document.querySelectorAll('div.message-in'));
          } catch (_error) {
            return [];
          }
        };

        const findIncomingMessageTextContainer = row => {
          if (!(row instanceof Element)) return null;
          if (isGoogleChatProfile()) {
            return findBestMessageTextContainer(row);
          }
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
            '[data-ferdium-incoming-error="1"]',
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

          const cleanupSelectors = [
            'span[' + INCOMING_TRANSLATION_ATTR + '="1"]',
            'span[' + INCOMING_DIVIDER_ATTR + '="1"]',
            'span[' + INCOMING_ORIGINAL_ATTR + '="1"]',
            'span[' + INCOMING_MISMATCH_ATTR + '="1"]',
          ];
          for (const selector of cleanupSelectors) {
            textContainer.querySelectorAll(selector).forEach(node => {
              try {
                node.remove();
              } catch (_error) {}
            });
          }

          if (isGoogleChatProfile()) {
            const insertionAnchor = textContainer.firstChild;
            if (insertionAnchor) {
              textContainer.insertBefore(translationBlock, insertionAnchor);
            } else {
              textContainer.appendChild(translationBlock);
            }
            if (mismatchText) {
              const mismatchBlock = document.createElement('span');
              mismatchBlock.setAttribute(INCOMING_MISMATCH_ATTR, '1');
              mismatchBlock.className = 'ferdium-translator-incoming-mismatch';
              mismatchBlock.textContent = mismatchText;
              if (translationBlock.nextSibling) {
                textContainer.insertBefore(mismatchBlock, translationBlock.nextSibling);
              } else {
                textContainer.appendChild(mismatchBlock);
              }
            }
            if (translationBlock.nextSibling) {
              textContainer.insertBefore(dividerBlock, translationBlock.nextSibling);
            } else {
              textContainer.appendChild(dividerBlock);
            }
            if (dividerBlock.nextSibling) {
              textContainer.insertBefore(originalBlock, dividerBlock.nextSibling);
            } else {
              textContainer.appendChild(originalBlock);
            }
            textContainer.setAttribute(INCOMING_PREVIEW_ATTR, '1');
            textContainer.setAttribute(INCOMING_PREVIEW_TEXT_ATTR, translationComparable);
            return true;
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
          const isLikelyOutgoingMatch = (rowComparable, translatedComparable) => {
            if (!rowComparable || !translatedComparable) return false;
            if (
              rowComparable.includes(translatedComparable) ||
              translatedComparable.includes(rowComparable)
            ) {
              return true;
            }
            const translatedPrefix = translatedComparable.slice(0, 24).trim();
            if (translatedPrefix.length >= 8 && rowComparable.includes(translatedPrefix)) {
              return true;
            }
            const keywords = translatedComparable
              .split(' ')
              .map(item => item.trim())
              .filter(item => item.length >= 3)
              .slice(0, 4);
            if (keywords.length < 2) return false;
            const hitCount = keywords.filter(item => rowComparable.includes(item)).length;
            return hitCount >= Math.min(2, keywords.length);
          };

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
            if (!isLikelyOutgoingMatch(rowComparable, comparableTranslated)) {
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
              console.log(
                '[Ferdium Translator] Local preview decorated ' +
                  JSON.stringify({ operationId }),
              );
            } catch (_e) {}
            return true;
          }

          if (isWhatsAppProfile()) {
            const selectors = [
              '[data-testid="msg-text"]',
              'span.selectable-text.copyable-text',
              'span.copyable-text',
              'div.copyable-text',
              'span',
            ];
            const candidates = [];
            const seen = new Set();
            for (const selector of selectors) {
              for (const candidate of Array.from(document.querySelectorAll(selector))) {
                if (!(candidate instanceof Element) || seen.has(candidate)) continue;
                seen.add(candidate);
                candidates.push({ candidate, selector });
              }
            }

            for (let index = candidates.length - 1; index >= 0; index -= 1) {
              const { candidate, selector } = candidates[index];
              if (selectors.some(textSelector => candidate.querySelector(textSelector))) {
                continue;
              }
              if (candidate.closest('div.message-in')) continue;
              const candidateComparable = toComparableText(
                String(candidate.innerText || candidate.textContent || ''),
              );
              if (!isLikelyOutgoingMatch(candidateComparable, comparableTranslated)) {
                continue;
              }
              const rect = candidate.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) continue;
              const row = candidate.closest('div.message-out');
              if (!row && rect.right < window.innerWidth * 0.55) continue;

              const applied = appendOriginalPreviewBlock(
                candidate,
                translatedText,
                originalText,
                operationId,
              );
              if (!applied) continue;
              candidate.setAttribute(LOCAL_PREVIEW_ATTR, '1');
              candidate.setAttribute(LOCAL_PREVIEW_TEXT_ATTR, comparableTranslated);
              candidate.setAttribute(LOCAL_PREVIEW_OP_ATTR, String(operationId || ''));
              if (row instanceof Element) {
                row.setAttribute(LOCAL_PREVIEW_ATTR, '1');
                row.setAttribute(LOCAL_PREVIEW_TEXT_ATTR, comparableTranslated);
                row.setAttribute(LOCAL_PREVIEW_OP_ATTR, String(operationId || ''));
              }
              try {
                console.log('[Ferdium Translator] Local preview decorated via text fallback', {
                  operationId,
                  selector,
                  hasOutgoingRow: row instanceof Element,
                });
              } catch (_e) {}
              return true;
            }
          }

          // Google Chat can delay row text normalization; fallback to the latest row
          // to keep the outgoing preview format consistent with WhatsApp UX.
          if (isGoogleChatProfile() && outgoingRows.length > startIndex) {
            const fallbackRow = outgoingRows[outgoingRows.length - 1];
            if (fallbackRow instanceof Element) {
              const messageTextContainer = findOutgoingMessageTextContainer(fallbackRow);
              if (messageTextContainer) {
                const applied = appendOriginalPreviewBlock(
                  messageTextContainer,
                  translatedText,
                  originalText,
                  operationId,
                );
                if (applied) {
                  fallbackRow.setAttribute(LOCAL_PREVIEW_ATTR, '1');
                  fallbackRow.setAttribute(LOCAL_PREVIEW_TEXT_ATTR, comparableTranslated);
                  fallbackRow.setAttribute(LOCAL_PREVIEW_OP_ATTR, String(operationId || ''));
                  return true;
                }
              }
            }
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
                console.log(
                  '[Ferdium Translator] Local preview attempt ' +
                    JSON.stringify({ operationId, delayMs, applied }),
                );
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
                    translatorEngine: state.settings.translatorEngine || 'Google',
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
            try {
              console.log(
                '[Ferdium Translator] Outgoing history scan start: ' +
                  JSON.stringify({
                    reason,
                    profile: activeProfile,
                    rowCount: outgoingRows.length,
                  }),
              );
            } catch (_e) {}
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
                if (!originalText) {
                  try {
                    console.log(
                      '[Ferdium Translator] Outgoing history lookup miss: ' +
                        JSON.stringify({
                          reason,
                          translatedLength: translatedText.length,
                          fromLanguage: state.settings.myLanguage || '',
                          toLanguage: state.settings.targetLanguage || '',
                          translatorEngine: state.settings.translatorEngine || 'Google',
                        }),
                    );
                  } catch (_e) {}
                  continue;
                }
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
                try {
                  console.log(
                    '[Ferdium Translator] Outgoing history preview restored: ' +
                      JSON.stringify({
                        reason,
                        translatedLength: translatedText.length,
                        originalLength: originalText.length,
                      }),
                  );
                } catch (_e) {}

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

            if (isWhatsAppProfile()) {
              const selectors = [
                '[data-testid="msg-text"]',
                'span.selectable-text.copyable-text',
                'span.copyable-text',
                'div.copyable-text',
                'span',
              ];
              const candidates = [];
              const seen = new Set();
              for (const selector of selectors) {
                for (const candidate of Array.from(document.querySelectorAll(selector))) {
                  if (!(candidate instanceof Element) || seen.has(candidate)) continue;
                  seen.add(candidate);
                  candidates.push({ candidate, selector });
                }
              }

              for (let index = candidates.length - 1; index >= 0; index -= 1) {
                const { candidate, selector } = candidates[index];
                if (selectors.some(textSelector => candidate.querySelector(textSelector))) {
                  continue;
                }
                if (candidate.closest('[' + LOCAL_PREVIEW_ATTR + '="1"]')) continue;
                if (candidate.getAttribute(LOCAL_PREVIEW_ATTR) === '1') continue;
                if (candidate.closest('div.message-in')) continue;
                const row = candidate.closest('div.message-out');
                const rect = candidate.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;
                if (!row && rect.right < window.innerWidth * 0.55) continue;
                const translatedText = normalizeCompareText(
                  candidate.innerText || candidate.textContent || '',
                );
                if (!translatedText) continue;

                candidate.setAttribute(OUTGOING_HISTORY_LOOKUP_PENDING_ATTR, '1');
                try {
                  // eslint-disable-next-line no-await-in-loop
                  const originalText = await lookupOutgoingOriginalFromCache(
                    translatedText,
                    reason + ':' + selector,
                  );
                  if (
                    !originalText ||
                    toComparableText(originalText) === toComparableText(translatedText)
                  ) {
                    continue;
                  }
                  const applied = appendOriginalPreviewBlock(
                    candidate,
                    translatedText,
                    originalText,
                    'history-' + reason,
                  );
                  if (!applied) continue;
                  candidate.setAttribute(LOCAL_PREVIEW_ATTR, '1');
                  candidate.setAttribute(
                    LOCAL_PREVIEW_TEXT_ATTR,
                    toComparableText(translatedText),
                  );
                  candidate.setAttribute(
                    LOCAL_PREVIEW_OP_ATTR,
                    'history-' + reason,
                  );
                  if (row instanceof Element) {
                    row.setAttribute(LOCAL_PREVIEW_ATTR, '1');
                    row.setAttribute(
                      LOCAL_PREVIEW_TEXT_ATTR,
                      toComparableText(translatedText),
                    );
                    row.setAttribute(LOCAL_PREVIEW_OP_ATTR, 'history-' + reason);
                  }
                  try {
                    console.log(
                      '[Ferdium Translator] Outgoing history preview restored via text fallback ' +
                        JSON.stringify({ reason, selector }),
                    );
                  } catch (_e) {}
                } finally {
                  candidate.removeAttribute(OUTGOING_HISTORY_LOOKUP_PENDING_ATTR);
                }
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
            if (isGoogleChatProfile()) {
              const headerNode =
                document.querySelector('[role="heading"][aria-level="1"]') ||
                document.querySelector('header [aria-label]') ||
                document.querySelector('header h1') ||
                document.querySelector('header h2');
              const headerTitle = String(
                headerNode?.getAttribute?.('aria-label') ||
                  headerNode?.textContent ||
                  '',
              )
                .trim()
                .slice(0, 120);
              const mainPane = document.querySelector('div[role="main"]');
              const mainPaneState = mainPane ? 'main-ready' : 'main-missing';
              return [path, search, hash, headerTitle, mainPaneState, activeProfile].join(
                '|',
              );
            }
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
                targetTextLength: normalized.length,
                targetComparableLength: toComparableText(normalized).length,
                originalComparableLength: toComparableText(originalText).length,
                beforeTextLength: beforeText.length,
                beforeComparableLength: toComparableText(beforeText).length,
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
                  beforeLength: beforeValue.length,
                  afterLength: afterInputText.length,
                  targetComparableLength: toComparableText(normalized).length,
                  afterComparableLength: toComparableText(afterInputText).length,
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
                    afterLength: String(after || '').length,
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
                    selectedTextLength: selectedText.length,
                    afterLength: String(after || '').length,
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
                    selectedTextLength: selectedText.length,
                    afterLength: String(after || '').length,
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
                    selectedTextLength: selectedText.length,
                    afterLength: String(after || '').length,
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
                beforeTextLength: beforeText.length,
                afterTextLength: afterText.length,
                targetTextLength: normalized.length,
                beforeComparableLength: toComparableText(beforeText).length,
                afterComparableLength: comparableAfter.length,
                targetComparableLength: comparableTarget.length,
                originalComparableLength: comparableOriginal.length,
                looselyMatched: isTextLooselyMatched(afterText, normalized),
                containsOriginal:
                  !!comparableOriginal && !!comparableAfter && comparableAfter.includes(comparableOriginal),
                containsTarget:
                  !!comparableTarget && !!comparableAfter && comparableAfter.includes(comparableTarget),
                structure: getComposerStructure(el),
                afterHtmlLength: String(el.innerHTML || '').length,
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
                afterLength: after?.length,
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
                afterLength: after?.length,
              });
            } catch (_e) {}
            return ok;
          }

          if (isGoogleChatProfile()) {
            const composer = readComposer();
            const roots = [
              composer?.closest?.('form'),
              composer?.closest?.('div[role="main"]'),
              document.querySelector('div[role="main"]'),
              document,
            ].filter(Boolean);

            for (const root of roots) {
              if (!(root instanceof Element) && root !== document) continue;
              const textareaNode =
                root.querySelector?.(
                  'textarea[aria-label*="Message"], textarea[aria-label*="message"], textarea',
                ) || null;
              if (textareaNode instanceof HTMLTextAreaElement) {
                setComposerText(textareaNode, text, {
                  operationId,
                  reason: 'composer-textarea-fallback',
                  originalText,
                });
                const after = getComposerText(textareaNode);
                if (isComposerSynced(after, text, originalText)) {
                  return true;
                }
              }

              const editableNode =
                root.querySelector?.(
                  '[contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label*="Message"], [contenteditable="true"]',
                ) || null;
              if (editableNode instanceof Element) {
                setComposerText(editableNode, text, {
                  operationId,
                  reason: 'composer-context-fallback',
                  originalText,
                  allowLexicalDomMutation: true,
                  forceDomReplace: true,
                });
                const after = getComposerText(editableNode);
                if (isComposerSynced(after, text, originalText)) {
                  return true;
                }
              }
            }
          }

          return false;
        };

        const findSendButton = () => {
          if (isGoogleChatProfile()) {
            const composer = readComposer();
            const roots = [
              composer?.closest?.('form'),
              composer?.closest?.('div[role="main"]'),
              document.querySelector('div[role="main"]'),
              document,
            ].filter(Boolean);
            const selectors = [
              'button[aria-label*="Send message"]',
              'button[aria-label*="send message"]',
              'button[aria-label="Send"]',
              'button[aria-label*="Send"]',
              'button[aria-label*="发送"]',
              'button[aria-label*="發送"]',
              'button[data-tooltip*="Send"]',
              'button[data-testid*="send"]',
              '[role="button"][aria-label*="Send"]',
              '[role="button"][aria-label*="发送"]',
              '[role="button"][aria-label*="發送"]',
              '[data-icon="send"]',
            ];
            for (const root of roots) {
              if (!(root instanceof Element) && root !== document) continue;
              for (const selector of selectors) {
                const node = root.querySelector?.(selector) || null;
                if (!node) continue;
                if (node.tagName === 'BUTTON') return node;
                return node.closest('button, [role="button"]') || node;
              }
            }
            const docsToSearch = getDocumentsToSearch();
            for (const doc of docsToSearch) {
              const shadowButtons = querySelectorAllIncludingShadowRoots(
                doc,
                'button, [role="button"]',
              );
              for (const node of shadowButtons) {
                if (!(node instanceof Element)) continue;
                const aria = String(node.getAttribute('aria-label') || '').toLowerCase();
                const testId = String(node.getAttribute('data-testid') || '').toLowerCase();
                const title = String(node.getAttribute('title') || '').toLowerCase();
                const text = String(node.textContent || '').toLowerCase();
                const hasSend =
                  aria.includes('send') ||
                  aria.includes('发送') ||
                  aria.includes('發送') ||
                  testId.includes('send') ||
                  title.includes('send') ||
                  text.includes('send');
                if (!hasSend) continue;
                if (node.tagName === 'BUTTON') return node;
                const btn = node.closest('button, [role="button"]') || node;
                if (btn) return btn;
              }
            }
          }
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
          const title = String(clickable.getAttribute('title') || '');
          const text = String(clickable.textContent || '');
          const hints = (ariaLabel + ' ' + dataTestId + ' ' + title + ' ' + text).toLowerCase();

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

          if (SEND_BUTTON_HINTS.some(hint => hints.includes(hint))) {
            return true;
          }

          return false;
        };

        const resolveEventTargetElement = event => {
          if (!event) return null;
          const path =
            typeof event.composedPath === 'function' ? event.composedPath() : [];
          for (const node of Array.from(path || [])) {
            if (node instanceof Element) {
              return node;
            }
          }
          if (event.target instanceof Element) return event.target;
          if (event.target instanceof Node) return event.target.parentElement;
          return null;
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

        const confirmTranslatedMessage = (original, translated) =>
          new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.setAttribute('data-ferdium-translation-confirm', '1');
            overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center;padding:16px;';
            const card = document.createElement('div');
            card.style.cssText = 'width:min(480px,100%);max-height:90vh;overflow:auto;background:#fff;color:#1f2937;border-radius:12px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);font:14px/1.5 sans-serif;';
            const title = document.createElement('strong');
            title.textContent = original.trim() === translated.trim()
              ? '译文与原文相同，请确认发送'
              : '确认发送译文';
            const sourceLabel = document.createElement('p');
            sourceLabel.textContent = '原文（仅供核对）';
            const source = document.createElement('div');
            source.textContent = original;
            source.style.cssText = 'white-space:pre-wrap;max-height:100px;overflow:auto;padding:8px;background:#f3f4f6;border-radius:6px;';
            const translationLabel = document.createElement('p');
            translationLabel.textContent = '将发送给对方的内容（可编辑）';
            const editor = document.createElement('textarea');
            editor.value = translated;
            editor.setAttribute('aria-label', '将发送给对方的译文');
            editor.style.cssText = 'box-sizing:border-box;width:100%;min-height:100px;padding:8px;resize:vertical;border:1px solid #9ca3af;border-radius:6px;font:inherit;';
            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px;';
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.textContent = '取消';
            const send = document.createElement('button');
            send.type = 'button';
            send.textContent = original.trim() === translated.trim()
              ? '确认发送原文'
              : '发送译文';
            send.style.cssText = 'background:#2563eb;color:#fff;border:0;border-radius:6px;padding:6px 12px;';
            cancel.style.cssText = 'background:#f3f4f6;border:0;border-radius:6px;padding:6px 12px;';
            const finish = value => {
              overlay.remove();
              resolve(value);
            };
            cancel.addEventListener('click', () => finish(null));
            send.addEventListener('click', () => {
              const value = editor.value.trim();
              if (value) finish(value);
              else editor.focus();
            });
            overlay.addEventListener('keydown', event => {
              event.stopPropagation();
              if (event.key === 'Escape') finish(null);
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                send.click();
              }
            });
            actions.append(cancel, send);
            card.append(title, sourceLabel, source, translationLabel, editor, actions);
            overlay.appendChild(card);
            document.body.appendChild(overlay);
            editor.focus();
          });

        const translateByInvoke = async (text, options = {}) => {
          console.log('[Ferdium Translator] translateByInvoke called');
          if (!hasDirectInvoke && !canUseTopBridge) {
            console.warn('[Ferdium Translator] invoke not available (no direct ipc and no top bridge)');
            throw new Error('invoke-not-available');
          }

          const requestParams = {
            text,
            translateToLanguage:
              options.toLang || state.settings.targetLanguage || 'en',
            translatorEngine:
              options.translatorEngine || state.settings.translatorEngine || 'Google',
            fromLanguage: options.fromLang || state.settings.myLanguage || 'auto',
          };
          console.log(
            '[Ferdium Translator] Invoking translate with params:',
            JSON.stringify({
              textLength: String(text || '').length,
              translateToLanguage: requestParams.translateToLanguage,
              fromLanguage: requestParams.fromLanguage,
              translatorEngine: requestParams.translatorEngine,
              reason: options.reason || 'unspecified',
            }),
          );

          const response = await invokeTranslator('translate', requestParams);
          console.log(
            '[Ferdium Translator] translate invoke response:',
            JSON.stringify({
              hasResponse: !!response,
              hasError: response?.error,
              textLength: response?.text?.length,
            }),
          );

          if (!response || response.error) {
            console.error('[Ferdium Translator] translate invoke failed:', { hasResponse: !!response, error: response?.error });
            throw new Error(response?.text || 'translate-failed');
          }

          const translatedText = String(response.text || '').trim();
          if (!translatedText) {
            console.error('[Ferdium Translator] Empty translation result');
            throw new Error('empty-translation');
          }

          console.log('[Ferdium Translator] translateByInvoke success, length:', translatedText.length);
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
              options.translatorEngine || state.settings.translatorEngine || 'Google';
            const translateReason = String(options.reason || 'unspecified');

            try {
              console.log(
                '[Ferdium Translator] Sending translation request: ' +
                  JSON.stringify({
                    requestId,
                    profile: activeProfile,
                    textLength: text.length,
                    textLength: String(text || '').length,
                    fromLang,
                    toLang,
                    translatorEngine,
                    reason: translateReason,
                  }),
              );
            } catch (_debugError) {}

            const sent = sendToHostSafe('translator:translate-message', {
              requestId,
              text,
              fromLang,
              toLang,
              translatorEngine,
              reason: translateReason,
              profile: activeProfile,
            });
            if (!sent) {
              clearTimeout(timeout);
              state.requests.delete(requestId);
              reject(new Error('sendToHost-not-available'));
            }
          });

        const translate = async (text, options = {}) => {
          console.log(
            '[Ferdium Translator] translate() called with text:',
            text.length,
          );
          try {
            console.log('[Ferdium Translator] Trying translateByInvoke');
            const result = await translateByInvoke(text, options);
            console.log('[Ferdium Translator] translateByInvoke succeeded, length:', result.length);
            return result;
          } catch (invokeError) {
            console.warn(
              '[Ferdium Translator] invoke translate failed, fallback to host message',
              invokeError,
            );
            console.log('[Ferdium Translator] Trying translateByHostMessage');
            const result = await translateByHostMessage(text, options);
            console.log('[Ferdium Translator] translateByHostMessage succeeded, length:', result.length);
            return result;
          }
        };

        const detectLanguage = async sample => {
          if (!hasDirectInvoke && !canUseTopBridge) {
            return '';
          }
          const normalizedSample = String(sample || '').trim();
          if (normalizedSample.length < 3) {
            return '';
          }
          try {
            const detected = await invokeTranslator('detect-language', {
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
                textLength: normalizedText.length,
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
          if (!(textContainer instanceof Element)) {
            try {
              console.log(
                '[Ferdium Translator] Incoming row skipped (no text container): ' +
                  JSON.stringify({
                    reason,
                    profile: activeProfile,
                    rowLength: String(row.innerText || row.textContent || '').length,
                  }),
              );
            } catch (_e) {}
            return;
          }

          const showIncomingFailure = () => {
            if (textContainer.querySelector('[data-ferdium-incoming-error="1"]')) return;
            row.setAttribute('data-ferdium-incoming-error-source', originalComparable);
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.setAttribute('data-ferdium-incoming-error', '1');
            retry.textContent = '翻译失败，点击重试';
            retry.style.cssText = 'display:block;margin-top:4px;border:0;background:transparent;color:#b42318;cursor:pointer;font-size:11px;padding:0;';
            retry.addEventListener('click', event => {
              event.preventDefault();
              event.stopPropagation();
              retry.remove();
              row.removeAttribute('data-ferdium-incoming-error-source');
              processIncomingMessageRow(row, 'manual-retry');
            });
            textContainer.appendChild(retry);
          };

          const originalText = extractIncomingOriginalText(textContainer);
          const originalComparable = toComparableText(originalText);
          if (
            reason !== 'manual-retry' &&
            row.getAttribute('data-ferdium-incoming-error-source') === originalComparable
          ) {
            return;
          }
          if (row.getAttribute('data-ferdium-incoming-error-source') !== originalComparable) {
            textContainer.querySelector('[data-ferdium-incoming-error="1"]')?.remove();
            row.removeAttribute('data-ferdium-incoming-error-source');
          }
          if (!originalText || !originalComparable) {
            try {
              console.log(
                '[Ferdium Translator] Incoming row skipped (empty original): ' +
                  JSON.stringify({
                    reason,
                    profile: activeProfile,
                    hasOriginalText: !!originalText,
                    hasOriginalComparable: !!originalComparable,
                  }),
              );
            } catch (_e) {}
            return;
          }

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
                    sampleLength: originalText.length,
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
                    sampleLength: originalText.length,
                    sampleLength: originalText.length,
                  },
                );
              } catch (_e) {}
            }
            const planDetectedLanguage = lowConfidenceIncomingDetection
              ? ''
              : effectiveDetectedLanguage;

            // Detection is scoped to this message. The service target language is
            // the user's outgoing preference and must not change when another
            // contact or group member writes in a different language.
            const translatePlan = buildIncomingTranslatePlan(
              planDetectedLanguage,
              {
                preferAutoSource: lowConfidenceIncomingDetection,
              },
            );
            if (!translatePlan.shouldTranslate) {
              try {
                console.log(
                  '[Ferdium Translator] Incoming row skipped (shouldTranslate=false): ' +
                    JSON.stringify({
                      reason,
                      profile: activeProfile,
                      sourceLanguage: translatePlan.sourceLanguage,
                      myLanguage: translatePlan.myLanguage,
                      configuredPeerLanguage: translatePlan.configuredPeerLanguage,
                      detectedLanguage: translatePlan.detectedLanguage,
                    }),
                );
              } catch (_e) {}
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
              showIncomingFailure();
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
              showIncomingFailure();
              return;
            }

            const applied = applyIncomingPreviewDecoration(
              textContainer,
              translatedText,
              originalText,
              translatePlan,
            );
            if (!applied) {
              showIncomingFailure();
              return;
            }

            textContainer.querySelector('[data-ferdium-incoming-error="1"]')?.remove();
            row.removeAttribute('data-ferdium-incoming-error-source');

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
                originalLength: originalText.length,
                translatedLength: translatedText.length,
              });
            } catch (_e) {}
          } catch (error) {
            showIncomingFailure();
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
            try {
              console.log(
                '[Ferdium Translator] Incoming scan start: ' +
                  JSON.stringify({
                    reason,
                    profile: activeProfile,
                    rowCount: rows.length,
                    receiveTranslation: state.settings.receiveTranslation,
                    myLanguage: state.settings.myLanguage,
                    targetLanguage: state.settings.targetLanguage,
                    translatorEngine: state.settings.translatorEngine,
                  }),
              );
            } catch (_e) {}
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
                  if (hasMatchingMessageRowInSubtree(hostElement, 'incoming')) {
                    shouldScan = true;
                    break;
                  }
                }
                if (mutation.target instanceof Element) {
                  if (hasMatchingMessageRowInSubtree(mutation.target, 'incoming')) {
                    shouldScan = true;
                    break;
                  }
                }
                for (const node of Array.from(mutation.addedNodes || [])) {
                  if (!(node instanceof Element)) continue;
                  if (hasMatchingMessageRowInSubtree(node, 'incoming')) {
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
              ensureWhatsAppComposerKeydownListener();
              let shouldScan = false;

              for (const mutation of mutations) {
                if (mutation.type === 'characterData') {
                  const hostElement = mutation.target?.parentElement;
                  if (hasMatchingMessageRowInSubtree(hostElement, 'outgoing')) {
                    shouldScan = true;
                    break;
                  }
                }
                if (
                  mutation.target instanceof Element &&
                  hasMatchingMessageRowInSubtree(mutation.target, 'outgoing')
                ) {
                  shouldScan = true;
                  break;
                }
                for (const node of Array.from(mutation.addedNodes || [])) {
                  if (!(node instanceof Element)) continue;
                  if (hasMatchingMessageRowInSubtree(node, 'outgoing')) {
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
              desiredTextLength: String(desiredText || '').length,
              originalTextLength: String(originalText || '').length,
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
              beforeSendLength: String(beforeSend || '').length,
              afterFirstAttemptLength: String(afterFirstAttempt || '').length,
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

          const composerFromEvent =
            triggerSource === 'send-button'
              ? resolveComposerFromContextTarget(triggerEvent?.target)
              : null;
          const composer = composerFromEvent || readComposer();
          const original = getComposerText(composer);
          if (!composer || !original) {
            try {
              console.warn('[Ferdium Translator] No composer or empty text', {
                operationId,
                triggerSource,
                hasComposer: !!composer,
                originalLength: original?.length,
                hasComposerFromEvent: !!composerFromEvent,
              });
            } catch (_e) {}
            return;
          }

          let hideStatusImmediately = true;
          let nativeSendAttempted = false;
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
            console.log('[Ferdium Translator] Original text length:', original.length);
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

            if (!outgoingValidation.match) {
              throw new Error('译文语言与目标语言不符，请检查语言设置后重试');
            }

            console.log(
              '[Ferdium Translator] Translation result:',
              JSON.stringify({
                instanceId,
                operationId,
                originalLength: original.length,
                translatedLength: finalText.length,
                success: finalText !== original,
                translatedLength: finalText.length,
                detectedOutgoingSource,
                preferredSourceLanguage,
                outgoingValidation,
              }),
            );
            showStatus('', false, false);
            const confirmedText = await confirmTranslatedMessage(original, finalText);
            if (!confirmedText) {
              return;
            }
            const finalSendText = confirmedText;
            console.log(
              '[Ferdium Translator] Setting composer text to:',
              finalSendText.length,
            );
            let activeComposer = composer;
            let isLexicalFlow =
              String(activeComposer?.getAttribute('data-lexical-editor') || '').toLowerCase() === 'true';
            setComposerText(activeComposer, finalSendText, {
              operationId,
              reason: 'translate-first-set',
              originalText: original,
            });
            await sleep(180);
            let afterSet = getComposerText(activeComposer);
            console.log('[Ferdium Translator] After first set, composer text:', afterSet?.length);

            if (!isComposerSynced(afterSet, finalSendText, original)) {
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
                  if (isComposerSynced(afterSet, finalSendText, original)) {
                    break;
                  }
                }
                if (!isComposerSynced(afterSet, finalSendText, original)) {
                  activeComposer = readComposer() || activeComposer;
                  setComposerText(activeComposer, finalSendText, {
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
                setComposerText(activeComposer, finalSendText, {
                  operationId,
                  reason: 'translate-second-set-force-dom',
                  originalText: original,
                  forceDomReplace: !isLexicalFlow,
                });
                await sleep(260);
                afterSet = getComposerText(activeComposer);
                console.log('[Ferdium Translator] After second set, composer text:', afterSet?.length);
              }
            }
            if (!isComposerSynced(afterSet, finalSendText, original) && !isLexicalFlow) {
              console.log('[Ferdium Translator] Still not synced, third attempt');
              activeComposer = readComposer() || activeComposer;
              setComposerText(activeComposer, finalSendText, {
                operationId,
                reason: 'translate-third-set',
                originalText: original,
              });
              await sleep(220);
              afterSet = getComposerText(activeComposer);
              console.log('[Ferdium Translator] After third set, composer text:', afterSet?.length);
            }
            if (!isComposerSynced(afterSet, finalSendText, original)) {
              const fallbackOk = forceSyncViaFooterTextarea(finalSendText, original, operationId);
              if (fallbackOk) {
                await sleep(180);
                const fallbackComposer = readComposer();
                afterSet = getComposerText(fallbackComposer);
                console.log(
                  '[Ferdium Translator] After textarea fallback, composer text:',
                  afterSet?.length,
                );
              }
            }
            if (!isComposerSynced(afterSet, finalSendText, original)) {
              throw new Error('composer-update-failed');
            }
            console.log('[Ferdium Translator] Triggering native send', { operationId });
            state.bypassSendUntil = Date.now() + 2400;
            const outgoingRowCountBeforeSend = getOutgoingMessageRows().length;
            nativeSendAttempted = true;
            await triggerNativeSend(preferClick, finalSendText, original, operationId);
            if (!isGoogleChatProfile()) {
              queueLocalPreviewDecoration(
                finalSendText,
                original,
                operationId,
                outgoingRowCountBeforeSend,
              );
            }
            console.log('[Ferdium Translator] ===== Translation and send completed =====', { operationId });
          } catch (error) {
            if (!nativeSendAttempted) {
              try {
                setComposerText(readComposer() || composer, original, {
                  operationId,
                  reason: 'restore-draft-after-translation-failure',
                });
              } catch (_restoreError) {}
            }
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
            showStatus('翻译未发送：' + errorMessage, true, true);
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

        const resolveComposerFromContextTarget = target => {
          if (!isGoogleChatProfile()) {
            return readComposer();
          }
          if (!(target instanceof Element)) {
            return readComposer();
          }

          const roots = [
            target.closest('form'),
            target.closest('div[role="main"]'),
            target.closest('[role="main"]'),
            document.querySelector('div[role="main"]'),
            document,
          ].filter(Boolean);
          const selectors = [
            '[contenteditable="true"][role="textbox"]',
            '[contenteditable="true"][aria-label*="Message"]',
            '[contenteditable="true"][aria-label*="message"]',
            '[contenteditable="true"][aria-label*="消息"]',
            '[contenteditable="true"][aria-label*="訊息"]',
            '[contenteditable="true"][aria-label*="输入"]',
            '[contenteditable="true"][aria-label*="輸入"]',
            'textarea[aria-label*="Message"]',
            'textarea[aria-label*="message"]',
            'textarea',
            '[contenteditable="true"]',
          ];

          for (const root of roots) {
            if (!(root instanceof Element) && root !== document) continue;
            const candidates = [];
            for (const selector of selectors) {
              root.querySelectorAll?.(selector).forEach(node => {
                if (!(node instanceof Element)) return;
                if (!isVisibleComposer(node)) return;
                candidates.push(node);
              });
            }
            const candidatesWithText = candidates.filter(
              node => String(getComposerText(node) || '').trim().length > 0,
            );
            const bestCandidate =
              pickBestComposer(candidatesWithText) || pickBestComposer(candidates);
            if (bestCandidate) {
              return bestCandidate;
            }
          }

          return readComposer();
        };

        const handleComposerKeyDown = event => {
          if (!isActiveInterceptorInstance()) return;
          if (event.target?.closest?.('[data-ferdium-translation-confirm]')) return;
          if (event.key !== 'Enter' || event.shiftKey) return;
          if (event.isComposing || event.keyCode === 229) return;
          if (!state.settings.sendTranslation) {
            try {
              console.log('[Ferdium Translator] sendTranslation is disabled');
            } catch (_e) {}
            return;
          }
          const eventPath =
            typeof event.composedPath === 'function' ? event.composedPath() : [];
          const currentTargetComposer =
            event.currentTarget instanceof Element &&
            event.currentTarget.matches('[contenteditable="true"], textarea')
              ? event.currentTarget
              : null;
          const composerFromEventPath = Array.from(eventPath || []).find(
            node =>
              node instanceof Element &&
              node.matches('[contenteditable="true"], textarea') &&
              isVisibleComposer(node),
          );
          const composer =
            currentTargetComposer || composerFromEventPath || readComposer();
          if (!composer) {
            try {
              console.warn('[Ferdium Translator] Composer not found on Enter key');
            } catch (_e) {}
            return;
          }
          const eventBelongsToComposer =
            currentTargetComposer === composer ||
            Array.from(eventPath || []).some(
              node => node === composer || (node instanceof Node && composer.contains(node)),
            ) ||
            (event.target instanceof Node && composer.contains(event.target));
          const active = composer.ownerDocument?.activeElement || document.activeElement;
          const composerFocused =
            active === composer ||
            (active instanceof Element && composer.contains(active));
          const shouldHandleEnter = isWhatsAppProfile()
            ? eventBelongsToComposer || composerFocused
            : isEditableTarget(event.target) || composerFocused;
          if (!shouldHandleEnter) {
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

        const composerKeydownListeners = new WeakSet();
        const ensureWhatsAppComposerKeydownListener = () => {
          if (!isWhatsAppProfile() || !isActiveInterceptorInstance()) return;
          const composer = readComposer();
          if (!composer || composerKeydownListeners.has(composer)) return;
          composerKeydownListeners.add(composer);
          addDomListener(composer, 'keydown', handleComposerKeyDown, true);
          try {
            console.log('[Ferdium Translator] Bound Enter handler to WhatsApp composer', {
              tag: composer.tagName,
              role: composer.getAttribute('role'),
              ariaLabel: composer.getAttribute('aria-label'),
            });
          } catch (_e) {}
        };

        const handleComposerBeforeInput = event => {
          if (!isActiveInterceptorInstance()) return;
          if (event.target?.closest?.('[data-ferdium-translation-confirm]')) return;
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

        const handleSendButtonEvent = event => {
          if (!isActiveInterceptorInstance()) return;
          if (event.target?.closest?.('[data-ferdium-translation-confirm]')) return;
          if (isGoogleChatProfile() && event?.type !== 'click') {
            // Avoid blocking unrelated pointer/mouse interactions in Google Chat.
            return;
          }
          if (!state.settings.sendTranslation) {
            try {
              console.log(
                '[Ferdium Translator] Send button ignored (sendTranslation=false)',
              );
            } catch (_e) {}
            return;
          }
          if (Date.now() < state.bypassSendUntil) {
            try {
              console.log('[Ferdium Translator] Send button ignored (bypass period)');
            } catch (_e) {}
            return;
          }
          const eventTargetElement = resolveEventTargetElement(event);
          if (!eventTargetElement) return;
          if (!isSendButtonTarget(eventTargetElement)) return;
          if (isGoogleChatProfile()) {
            const activeSendButton = findSendButton();
            if (
              activeSendButton &&
              eventTargetElement !== activeSendButton &&
              !activeSendButton.contains(eventTargetElement)
            ) {
              return;
            }
          }
          const composer =
            resolveComposerFromContextTarget(eventTargetElement) || readComposer();
          if (!composer || !getComposerText(composer)) {
            try {
              console.log(
                '[Ferdium Translator] Send button ignored (composer missing/empty): ' +
                  JSON.stringify({
                    hasComposer: !!composer,
                    composerTextLength: String(getComposerText(composer) || '').length,
                    profile: activeProfile,
                    eventType: event.type,
                  }),
              );
            } catch (_e) {}
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
            console.log(
              '[Ferdium Translator] Intercepting send button, starting translation: ' +
                JSON.stringify({
                  event: getEventDebug(event),
                  profile: activeProfile,
                  composerTextLength: String(getComposerText(composer) || '').length,
                }),
            );
          } catch (_e) {}
          translateAndSend(true, 'send-button', event);
        };

        const handleComposerSubmit = event => {
          if (!isActiveInterceptorInstance()) return;
          if (!isGoogleChatProfile()) return;
          if (!state.settings.sendTranslation) return;
          if (Date.now() < state.bypassSendUntil) return;

          const eventTargetElement = resolveEventTargetElement(event);
          const form = eventTargetElement?.closest?.('form');
          if (!form) return;
          const composer = resolveComposerFromContextTarget(form) || readComposer();
          if (!composer || !getComposerText(composer)) return;

          event.preventDefault();
          event.stopPropagation();
          if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
          }
          try {
            console.log(
              '[Ferdium Translator] Intercepting submit event, starting translation: ' +
                JSON.stringify({
                  profile: activeProfile,
                  composerTextLength: String(getComposerText(composer) || '').length,
                }),
            );
          } catch (_e) {}
          translateAndSend(true, 'form-submit', event);
        };

        const attachSendAndSubmitListeners = doc => {
          if (!doc) return;
          ensureWhatsAppComposerKeydownListener();
          if (doc.__ferdiumTranslatorListenersAttached === instanceId) return;
          try {
            doc.__ferdiumTranslatorListenersAttached = instanceId;
            addDomListener(doc, 'pointerdown', handleSendButtonEvent, true);
            addDomListener(doc, 'mousedown', handleSendButtonEvent, true);
            addDomListener(doc, 'click', handleSendButtonEvent, true);
            addDomListener(doc, 'submit', handleComposerSubmit, true);
            addDomListener(doc, 'keydown', handleComposerKeyDown, true);
            addDomListener(doc, 'beforeinput', handleComposerBeforeInput, true);
          } catch (_e) {}
          ensureWhatsAppComposerKeydownListener();
        };
        attachSendAndSubmitListeners(document);
        if (isGoogleChatProfile()) {
          try {
            document.querySelectorAll('iframe').forEach(iframe => {
              const doc = iframe.contentDocument;
              if (doc) attachSendAndSubmitListeners(doc);
            });
          } catch (_e) {}
          const iframeAttachInterval = setInterval(() => {
            if (!isActiveInterceptorInstance()) return;
            try {
              document.querySelectorAll('iframe').forEach(iframe => {
                const doc = iframe.contentDocument;
                if (doc) attachSendAndSubmitListeners(doc);
              });
            } catch (_e) {}
          }, 2500);
          registerCleanup(() => clearInterval(iframeAttachInterval));
        }
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
            state.settings = normalizeIncomingSettingsPatch(settings);
            syncSettingsToChildFrames(state.settings);
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
        sendToHostSafe('translator:initialized', {
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
              originalLength: original.length,
              targetLength: target.length,
              afterLength: String(after || '').length,
            };
          };
          window.__ferdiumTranslatorDiagnose = () => {
            const composer = readComposer();
            const sendBtn = findSendButton();
            const candidatesComposer = [];
            try {
              document.querySelectorAll('div[contenteditable="true"], textarea, [contenteditable="true"]').forEach((el, i) => {
                if (!(el instanceof Element)) return;
                const rect = el.getBoundingClientRect();
                const visible = rect.width > 0 && rect.height > 0;
                candidatesComposer.push({
                  index: i,
                  tag: el.tagName,
                  role: el.getAttribute('role'),
                  ariaLabel: (el.getAttribute('aria-label') || '').slice(0, 80),
                  id: (el.id || '').slice(0, 40),
                  className: String(el.className || '').slice(0, 60),
                  visible,
                });
              });
            } catch (_err) {}
            const candidatesSend = [];
            try {
              document.querySelectorAll('button, [role="button"]').forEach((el, i) => {
                if (!(el instanceof Element)) return;
                const aria = String(el.getAttribute('aria-label') || '');
                const testId = String(el.getAttribute('data-testid') || '');
                const title = String(el.getAttribute('title') || '');
                const text = String(el.textContent || '').trim().slice(0, 40);
                const combined = (aria + ' ' + testId + ' ' + title + ' ' + text).toLowerCase();
                if (!combined.includes('send') && !combined.includes('发送') && !combined.includes('發送')) return;
                candidatesSend.push({
                  index: i,
                  tag: el.tagName,
                  ariaLabel: aria.slice(0, 80),
                  dataTestid: testId.slice(0, 40),
                  title: title.slice(0, 40),
                  textPreview: text.slice(0, 30),
                });
              });
            } catch (_err) {}
            const out = {
              profile: activeProfile,
              composerFound: !!composer,
              sendButtonFound: !!sendBtn,
              candidatesComposer,
              candidatesSend,
            };
            console.log('[Ferdium Translator] Diagnose:', JSON.stringify(out, null, 2));
            return out;
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
      if (interceptorPlatform === 'googlechat') {
        const wcId = (service.webview as any)?.getWebContentsId?.();
        if (typeof wcId === 'number') {
          try {
            status = await ipcRenderer.invoke(
              'translator:inject-in-all-frames',
              {
                webContentsId: wcId,
                script,
              },
            );
          } catch (invokeError) {
            console.warn(
              '[Ferdium Translator Store] All-frames inject failed, fallback to executeJavaScript',
              invokeError,
            );
            status = await service.webview.executeJavaScript(script, true);
          }
        } else {
          status = await service.webview.executeJavaScript(script, true);
        }
      } else {
        status = await service.webview.executeJavaScript(script, true);
      }
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
    debug('_translateMessage requested', {
      textLength: text.length,
      fromLang,
      toLang,
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

    if (
      message.action === 'translator:initialized' &&
      message.data?.serviceId
    ) {
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
