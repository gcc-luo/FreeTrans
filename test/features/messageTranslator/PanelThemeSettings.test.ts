let MessageTranslatorStore: any;

let storage: Record<string, any> = {};
const getItemMock = jest.fn((key: string) => storage[key]);
const setItemMock = jest.fn((key: string, value: any) => {
  storage[key] = value;
});

const createStore = () => {
  const store: any = new MessageTranslatorStore();
  store.stores = {
    services: {
      one: () => null,
    },
  };
  return store;
};

describe('MessageTranslator panel theme settings', () => {
  beforeEach(() => {
    jest.resetModules();
    getItemMock.mockClear();
    setItemMock.mockClear();
    storage = {
      messageTranslator: {
        services: {},
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

  it('uses light theme by default', () => {
    const store = createStore();
    const settings = store.getServiceSettings('service-1');

    expect(settings.panelTheme).toBe('light');
  });

  it('keeps persisted dark theme', () => {
    storage.messageTranslator.services['service-1'] = {
      panelTheme: 'dark',
    };
    const store = createStore();
    const settings = store.getServiceSettings('service-1');

    expect(settings.panelTheme).toBe('dark');
  });

  it('updates and persists panel theme', () => {
    const store = createStore();

    store._updateServiceSettings({
      serviceId: 'service-1',
      settings: { panelTheme: 'dark' },
    });

    expect(setItemMock).toHaveBeenCalled();
    expect(storage.messageTranslator.services['service-1'].panelTheme).toBe(
      'dark',
    );
    expect(store.getServiceSettings('service-1').panelTheme).toBe('dark');
  });
});
