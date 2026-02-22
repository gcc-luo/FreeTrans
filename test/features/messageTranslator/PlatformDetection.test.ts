const getItemMock = jest.fn<Record<string, unknown>, [string]>(() => ({}));
const setItemMock = jest.fn<undefined, [string, any]>();

let MessageTranslatorStore: any;

describe('_resolveTranslatorInterceptorPlatform', () => {
  let store: any;

  beforeEach(() => {
    jest.resetModules();
    getItemMock.mockClear();
    setItemMock.mockClear();
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
    store = new MessageTranslatorStore();
  });

  describe('returns whatsapp for WhatsApp services', () => {
    it('detects by recipe id "whatsapp"', () => {
      expect(
        store._resolveTranslatorInterceptorPlatform({
          recipe: { id: 'whatsapp' },
          url: '',
        }),
      ).toBe('whatsapp');
    });

    it('detects by URL containing web.whatsapp.com', () => {
      expect(
        store._resolveTranslatorInterceptorPlatform({
          recipe: { id: 'unknown' },
          url: 'https://web.whatsapp.com/',
        }),
      ).toBe('whatsapp');
    });
  });

  describe('returns googlechat for Google Chat services', () => {
    it.each([
      'googlechat',
      'google-chat',
      'google_chat',
      'hangoutschat',
      'hangouts',
      'googlechatservice',
    ])('detects by recipe id "%s"', (recipeId: string) => {
      expect(
        store._resolveTranslatorInterceptorPlatform({
          recipe: { id: recipeId },
          url: '',
        }),
      ).toBe('googlechat');
    });

    it('detects by URL containing chat.google.com', () => {
      expect(
        store._resolveTranslatorInterceptorPlatform({
          recipe: { id: 'custom' },
          url: 'https://chat.google.com/u/0/',
        }),
      ).toBe('googlechat');
    });

    it('detects by URL containing mail.google.com/chat', () => {
      expect(
        store._resolveTranslatorInterceptorPlatform({
          recipe: { id: 'custom' },
          url: 'https://mail.google.com/chat/u/0/',
        }),
      ).toBe('googlechat');
    });

    it('detects by URL containing mail.google.com hash chat route', () => {
      expect(
        store._resolveTranslatorInterceptorPlatform({
          recipe: { id: 'custom' },
          url: 'https://mail.google.com/mail/u/0/#chat/space/AAA',
        }),
      ).toBe('googlechat');
    });

    it('is case-insensitive for recipe id', () => {
      expect(
        store._resolveTranslatorInterceptorPlatform({
          recipe: { id: 'GoogleChat' },
          url: '',
        }),
      ).toBe('googlechat');
    });
  });

  describe('returns null for unsupported services', () => {
    it('returns null for unknown recipe with no URL', () => {
      expect(
        store._resolveTranslatorInterceptorPlatform({
          recipe: { id: 'telegram' },
          url: '',
        }),
      ).toBeNull();
    });

    it('returns null for null service', () => {
      expect(store._resolveTranslatorInterceptorPlatform(null)).toBeNull();
    });

    it('returns null for undefined service', () => {
      expect(store._resolveTranslatorInterceptorPlatform()).toBeNull();
    });

    it('returns null for service with no recipe and non-matching URL', () => {
      expect(
        store._resolveTranslatorInterceptorPlatform({
          recipe: { id: '' },
          url: 'https://example.com',
        }),
      ).toBeNull();
    });
  });

  describe('recipe id takes precedence over URL', () => {
    it('whatsapp recipe id wins over google chat URL', () => {
      expect(
        store._resolveTranslatorInterceptorPlatform({
          recipe: { id: 'whatsapp' },
          url: 'https://chat.google.com/',
        }),
      ).toBe('whatsapp');
    });

    it('googlechat recipe id wins over whatsapp URL', () => {
      expect(
        store._resolveTranslatorInterceptorPlatform({
          recipe: { id: 'googlechat' },
          url: 'https://web.whatsapp.com/',
        }),
      ).toBe('googlechat');
    });
  });

  describe('handles edge cases in URL matching', () => {
    it('handles customUrl field when url is missing', () => {
      expect(
        store._resolveTranslatorInterceptorPlatform({
          recipe: { id: '' },
          customUrl: 'https://chat.google.com/u/1/',
        }),
      ).toBe('googlechat');
    });

    it('handles whitespace in recipe id', () => {
      expect(
        store._resolveTranslatorInterceptorPlatform({
          recipe: { id: '  googlechat  ' },
          url: '',
        }),
      ).toBe('googlechat');
    });
  });
});
