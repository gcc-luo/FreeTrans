let DynamicMessageTranslatorStore: any;

let storage: Record<string, any> = {};
const dynamicGetItemMock = jest.fn((key: string) => storage[key]);
const dynamicSetItemMock = jest.fn((key: string, value: any) => {
  storage[key] = value;
});

const createStore = () => {
  const store: any = new DynamicMessageTranslatorStore();
  store.stores = {
    services: {
      one: () => null,
    },
  };
  return store;
};

const emitIncomingLanguage = (
  store: any,
  detectedLanguage: string,
  sample: string,
  reason = 'test-case',
) => {
  store._handleClientMessage({
    channel: 'translator:client',
    message: {
      action: 'translator:incoming-language-detected',
      data: {
        serviceId: 'service-1',
        detectedLanguage,
        sample,
        sampleLength: sample.length,
        reason,
      },
    },
  });
};

describe('MessageTranslator dynamic peer language sync', () => {
  beforeEach(() => {
    jest.resetModules();
    dynamicGetItemMock.mockClear();
    dynamicSetItemMock.mockClear();
    storage = {
      messageTranslator: {
        services: {
          'service-1': {
            myLanguage: 'zh',
            targetLanguage: 'es',
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
        getItem: (...args: [string]) => dynamicGetItemMock(...args),
        setItem: (...args: [string, any]) => dynamicSetItemMock(...args),
      },
    }));

    // eslint-disable-next-line global-require
    const storeModule = require('../../../src/features/messageTranslator/store');
    DynamicMessageTranslatorStore = storeModule.default;
  });

  it('simulates multi-turn dialogue and dynamically updates targetLanguage', () => {
    const store = createStore();

    emitIncomingLanguage(store, 'zh', 'jin tian tian qi re', 'turn-1-zh');
    expect(store.getServiceSettings('service-1').targetLanguage).toBe('es');

    emitIncomingLanguage(
      store,
      'en',
      'The weather is very hot today',
      'turn-2-en',
    );
    expect(store.getServiceSettings('service-1').targetLanguage).toBe('en');

    emitIncomingLanguage(store, 'ru', 'Segodnya ochen zharko', 'turn-3-ru');
    expect(store.getServiceSettings('service-1').targetLanguage).toBe('ru');

    emitIncomingLanguage(store, 'en', 'How are you doing now', 'turn-4-en');
    expect(store.getServiceSettings('service-1').targetLanguage).toBe('en');
  });

  it('ignores unsupported/low-quality updates and keeps current peer language', () => {
    const store = createStore();

    emitIncomingLanguage(store, 'en', 'ok', 'too-short');
    expect(store.getServiceSettings('service-1').targetLanguage).toBe('es');

    emitIncomingLanguage(
      store,
      'pl',
      'Dzisiaj jest bardzo goraco',
      'unsupported-language',
    );
    expect(store.getServiceSettings('service-1').targetLanguage).toBe('es');

    emitIncomingLanguage(
      store,
      'en',
      '\u4ECA\u5929\u5929\u6C14\u5F88\u70ED',
      'cjk-heuristic-overrides-detected',
    );
    expect(store.getServiceSettings('service-1').targetLanguage).toBe('es');

    emitIncomingLanguage(store, 'zh', 'wo zai zheli', 'same-as-my-language');
    expect(store.getServiceSettings('service-1').targetLanguage).toBe('es');
  });

  it('does not auto-sync peer language when receiveTranslation is disabled', () => {
    storage.messageTranslator.services['service-1'].receiveTranslation = false;
    const store = createStore();

    emitIncomingLanguage(
      store,
      'en',
      'The weather is very hot today',
      'receive-disabled',
    );
    expect(store.getServiceSettings('service-1').targetLanguage).toBe('es');
  });
});
