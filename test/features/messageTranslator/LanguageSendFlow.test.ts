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

  it('pushes each supported myLanguage to webview config without mutating language code', () => {
    const sendIPCMessage = jest.fn();
    const store: any = new MessageTranslatorStore();
    store.actions = { service: { sendIPCMessage } };
    store.stores = {
      services: {
        one: (serviceId: string) =>
          serviceId === 'service-1'
            ? { recipe: { id: 'telegram' }, webview: {} }
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
            ? { recipe: { id: 'telegram' }, webview: {} }
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
