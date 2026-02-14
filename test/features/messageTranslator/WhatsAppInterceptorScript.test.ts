const getItemMock = jest.fn(() => ({}));
const setItemMock = jest.fn();

let MessageTranslatorStore: any;

describe('WhatsApp interceptor script regression', () => {
  beforeEach(() => {
    jest.resetModules();
    getItemMock.mockClear();
    setItemMock.mockClear();
    jest.doMock('mobx-localstorage', () => ({
      __esModule: true,
      default: {
        getItem: (...args: any[]) => getItemMock(...args),
        setItem: (...args: any[]) => setItemMock(...args),
      },
    }));
    // eslint-disable-next-line global-require
    const storeModule = require('../../../src/features/messageTranslator/store');
    MessageTranslatorStore = storeModule.default;
  });

  it('contains lexical editor-state strategy and guarded retry flow', async () => {
    const store: any = new MessageTranslatorStore();
    let injectedScript = '';

    const mockService = {
      recipe: { id: 'whatsapp' },
      webview: {
        executeJavaScript: jest.fn(async (script: string) => {
          injectedScript = script;
          return 'ok';
        }),
      },
    };

    store.stores = {
      services: {
        one: (serviceId: string) =>
          serviceId === 'service-1' ? mockService : null,
      },
    };

    const status = await store._ensureWhatsAppInterceptor('service-1');
    expect(status).toBe('ok');
    expect(injectedScript.length).toBeGreaterThan(1000);

    expect(injectedScript).toContain(
      'const replaceViaLexicalEditorState = () => {',
    );
    expect(injectedScript).toContain("strategy: 'lexical.editorState'");
    expect(injectedScript).toContain('usedLexicalEditorState');
    expect(injectedScript).toContain(
      'Lexical composer not synced after first set, skipping repeat set attempts',
    );
    expect(injectedScript).toContain(
      'window.__ferdiumTranslatorRunCase = async targetText =>',
    );
    expect(injectedScript).toContain('window.__ferdiumTranslatorCleanup');
    expect(injectedScript).toContain(
      'window.__ferdiumTranslatorInterceptorInstanceId',
    );
    expect(injectedScript).toContain(
      "window.__ferdiumTranslatorCleanup('version-change')",
    );
    expect(injectedScript).toContain("addDomListener(document, 'keydown'");
    expect(injectedScript).toContain(
      "addIpcListener('translator:translation-result'",
    );

    expect(injectedScript).toContain('if (isLexicalComposer) {');
    expect(injectedScript).toContain(
      'replacedByLexicalEditorState = replaceViaLexicalEditorState();',
    );
    expect(injectedScript).toContain(
      'replacedByExecCommand = replaceViaExecCommand();',
    );
    expect(injectedScript).toContain(
      'replacedBySyntheticBeforeInput = replaceViaLexicalReplacementBeforeInput();',
    );
  });
});
