let MessageTranslatorStore: any;

let storage: Record<string, any> = {};
const getItemMock = jest.fn((key: string) => storage[key]);
const setItemMock = jest.fn((key: string, value: any) => {
  storage[key] = value;
});

const OFFICIAL_TRANSLATOR_LANGUAGES = [
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
  'zh-TW',
  'vi',
];

describe('MessageTranslator language send flow', () => {
  beforeEach(() => {
    jest.resetModules();
    getItemMock.mockClear();
    setItemMock.mockClear();
    storage = {
      messageTranslator: {
        services: {
          'service-1': {
            myLanguage: 'zh',
            targetLanguage: 'en',
            receiveTranslation: true,
            sendTranslation: true,
            translatorEngine: 'Baidu',
          },
        },
      },
    };

    jest.doMock('mobx-localstorage', () => ({
      __esModule: true,
      default: {
        getItem: (...args: [string]) => getItemMock(...args),
        setItem: (...args: [string, any]) => setItemMock(...args),
      },
    }));

    // eslint-disable-next-line global-require
    const storeModule = require('../../../src/features/messageTranslator/store');
    MessageTranslatorStore = storeModule.default;
  });

  it('persists conversation language overrides without replacing the service default', () => {
    const store: any = new MessageTranslatorStore();
    store._handleClientMessage({
      channel: 'translator:client',
      message: {
        action: 'translator:settings-changed',
        data: {
          serviceId: 'service-1',
          settings: { conversationLanguages: { teammate: 'fr' } },
        },
      },
    });
    const restored: any = new MessageTranslatorStore();
    expect(
      restored.getServiceSettings('service-1').conversationLanguages,
    ).toEqual({
      teammate: 'fr',
    });
    expect(restored.getServiceSettings('service-1').targetLanguage).toBe('en');
    expect(
      restored.getServiceSettings('another-service').conversationLanguages,
    ).toBeUndefined();
  });

  it('tracks history progress only for the active request and returns its result', async () => {
    const store: any = new MessageTranslatorStore();
    let finish: ((result: any) => void) | undefined;
    const executeJavaScript = jest.fn(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    store.stores = {
      services: {
        one: () => ({
          recipe: { id: 'whatsapp' },
          webview: { executeJavaScript },
        }),
      },
    };
    store._ensureWhatsAppInterceptor = jest.fn().mockResolvedValue('already');
    const running = store.translateLoadedHistory('service-1');
    await Promise.resolve();
    const { requestId } = store.historyTranslationStates['service-1'];
    const progress = {
      requestId,
      status: 'running',
      completed: 1,
      total: 2,
      translated: 1,
      failed: 0,
      skipped: 0,
    };
    store._handleClientMessage({
      channel: 'translator:client',
      message: {
        action: 'translator:history-progress',
        data: { ...progress, serviceId: 'service-1' },
      },
    });
    expect(store.historyTranslationStates['service-1'].completed).toBe(1);
    store._handleClientMessage({
      channel: 'translator:client',
      message: {
        action: 'translator:history-progress',
        data: {
          ...progress,
          serviceId: 'service-1',
          requestId: 'obsolete',
          completed: 999,
        },
      },
    });
    expect(store.historyTranslationStates['service-1'].completed).toBe(1);
    finish?.({ ...progress, status: 'completed', completed: 2, translated: 2 });
    await running;
    expect(store.historyTranslationStates['service-1'].status).toBe(
      'completed',
    );
    expect(store.historyTranslationStates['service-1'].translated).toBe(2);
  });

  it('honors stopping history while the interceptor is still being prepared', async () => {
    const store: any = new MessageTranslatorStore();
    const executeJavaScript = jest.fn().mockResolvedValue(null);
    store.stores = {
      services: {
        one: () => ({
          recipe: { id: 'whatsapp' },
          webview: { executeJavaScript },
        }),
      },
    };
    let ready: ((status: string) => void) | undefined;
    store._ensureWhatsAppInterceptor = () =>
      new Promise(resolve => {
        ready = resolve;
      });
    const running = store.translateLoadedHistory('service-1');
    await store.cancelHistoryTranslation('service-1');
    expect(store.historyTranslationStates['service-1'].status).toBe('stopping');
    ready?.('already');
    await running;
    expect(store.historyTranslationStates['service-1'].status).toBe(
      'cancelled',
    );
    expect(executeJavaScript).toHaveBeenCalledTimes(1);
    expect(executeJavaScript.mock.calls[0][0]).toContain('CancelHistory');
  });

  it('pushes each supported myLanguage to webview config without mutating language code', () => {
    const sendIPCMessage = jest.fn();
    const store: any = new MessageTranslatorStore();
    store.actions = { service: { sendIPCMessage } };
    store.stores = {
      services: {
        one: (serviceId: string) =>
          serviceId === 'service-1'
            ? { recipe: { id: 'custom' }, webview: {} }
            : null,
      },
    };

    for (const language of OFFICIAL_TRANSLATOR_LANGUAGES) {
      storage.messageTranslator.services['service-1'].myLanguage = language;
      store._pushSettingsToService('service-1');

      const payload = sendIPCMessage.mock.calls.at(-1)?.[0];
      expect(payload?.serviceId).toBe('service-1');
      expect(payload?.channel).toBe('translator:configure');
      expect(payload?.args?.myLanguage).toBe(language);
    }
  });

  it('pushes each supported targetLanguage to webview config without mutating language code', () => {
    const sendIPCMessage = jest.fn();
    const store: any = new MessageTranslatorStore();
    store.actions = { service: { sendIPCMessage } };
    store.stores = {
      services: {
        one: (serviceId: string) =>
          serviceId === 'service-1'
            ? { recipe: { id: 'custom' }, webview: {} }
            : null,
      },
    };

    for (const language of OFFICIAL_TRANSLATOR_LANGUAGES) {
      storage.messageTranslator.services['service-1'].targetLanguage = language;
      store._pushSettingsToService('service-1');

      const payload = sendIPCMessage.mock.calls.at(-1)?.[0];
      expect(payload?.serviceId).toBe('service-1');
      expect(payload?.channel).toBe('translator:configure');
      expect(payload?.args?.targetLanguage).toBe(language);
    }
  });
});
