const getItemMock = jest.fn<Record<string, unknown>, [string]>(() => ({}));
const setItemMock = jest.fn<undefined, [string, any]>();

let MessageTranslatorStore: any;

const captureInjectedScript = async () => {
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
  return injectedScript;
};

describe('WhatsApp interceptor script regression', () => {
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
  });

  it('contains lexical editor-state strategy and guarded retry flow', async () => {
    const injectedScript = await captureInjectedScript();

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

  it('decorates local outgoing bubble with translated-over-original preview without changing send payload', async () => {
    const injectedScript = await captureInjectedScript();
    const sendCall =
      'await triggerNativeSend(preferClick, finalText, original, operationId);';
    const previewCall = 'queueLocalPreviewDecoration(';

    expect(injectedScript).toContain(
      "const LOCAL_PREVIEW_ATTR = 'data-ferdium-local-preview';",
    );
    expect(injectedScript).toContain(
      "const LOCAL_PREVIEW_ORIGINAL_ATTR = 'data-ferdium-local-preview-original';",
    );
    expect(injectedScript).toContain('const queueLocalPreviewDecoration = (');
    expect(injectedScript).toContain(
      "return Array.from(document.querySelectorAll('div.message-out'));",
    );
    expect(injectedScript).toContain(
      'ferdium-translator-local-divider{display:block;height:0;margin:6px 0 4px;border-top:1px solid rgba(16,24,40,0.24);}',
    );
    expect(injectedScript).toContain(
      'ferdium-translator-local-original{display:block;white-space:pre-wrap;color:#0b7f3e;opacity:0.96;}',
    );
    expect(injectedScript).toContain(sendCall);
    expect(injectedScript).toContain(previewCall);
    expect(injectedScript).toContain(
      'const outgoingRowCountBeforeSend = getOutgoingMessageRows().length;',
    );
    expect(injectedScript).toContain('minimumRowIndex = 0');
    expect(injectedScript).toContain('index >= startIndex');
    expect(injectedScript).toContain('outgoingRowCountBeforeSend');

    expect(
      injectedScript.indexOf('queueLocalPreviewDecoration('),
    ).toBeGreaterThan(injectedScript.indexOf(sendCall));

    expect(injectedScript).not.toContain('finalText + original');
    expect(injectedScript).not.toContain('original + finalText');
    expect(injectedScript).not.toContain('finalText + "\\n" + original');
    expect(injectedScript).not.toContain('original + "\\n" + finalText');
  });
});
