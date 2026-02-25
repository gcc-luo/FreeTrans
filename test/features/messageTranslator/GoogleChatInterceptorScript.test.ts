const getItemMock = jest.fn<Record<string, unknown>, [string]>(() => ({}));
const setItemMock = jest.fn<undefined, [string, any]>();

let MessageTranslatorStore: any;

const captureInjectedScript = async ({
  recipeId = 'googlechat',
  serviceUrl = '',
}: {
  recipeId?: string;
  serviceUrl?: string;
} = {}) => {
  const store: any = new MessageTranslatorStore();
  let injectedScript = '';

  const mockService = {
    recipe: { id: recipeId },
    url: serviceUrl,
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
        serviceId === 'service-gc' ? mockService : null,
    },
  };

  const status = await store._ensureWhatsAppInterceptor('service-gc');
  expect(status).toBe('ok');
  expect(injectedScript.length).toBeGreaterThan(1000);
  return injectedScript;
};

describe('Google Chat interceptor script', () => {
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

  describe('profile detection and initialization', () => {
    it('sets interceptorPlatform to googlechat', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('const interceptorPlatform = "googlechat"');
    });

    it('contains isGoogleChatProfile and isWhatsAppProfile helpers', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        "const isGoogleChatProfile = () => activeProfile === 'googlechat';",
      );
      expect(script).toContain(
        "const isWhatsAppProfile = () => activeProfile === 'whatsapp';",
      );
    });

    it('detects Google Chat host from hostname', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain("normalizedHost === 'chat.google.com'");
      expect(script).toContain("normalizedHost.endsWith('.chat.google.com')");
      expect(script).toContain("normalizedHost === 'mail.google.com'");
    });

    it('activates googlechat profile when interceptorPlatform is googlechat', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain("interceptorPlatform === 'googlechat'");
      expect(script).toContain('looksLikeGoogleChatHost');
    });

    it('can be injected via different Google Chat recipe IDs', async () => {
      for (const recipeId of [
        'googlechat',
        'google-chat',
        'hangoutschat',
        'hangouts',
        'googlechatservice',
      ]) {
        // eslint-disable-next-line no-await-in-loop
        const script = await captureInjectedScript({ recipeId });
        expect(script).toContain('const interceptorPlatform = "googlechat"');
      }
    });

    it('can be injected via Google Chat URL', async () => {
      const script = await captureInjectedScript({
        recipeId: 'custom',
        serviceUrl: 'https://chat.google.com/u/0/',
      });
      expect(script).toContain('const interceptorPlatform = "googlechat"');
    });

    it('can be injected via mail hash chat URL', async () => {
      const script = await captureInjectedScript({
        recipeId: 'custom',
        serviceUrl: 'https://mail.google.com/mail/u/0/#chat/space/AAA',
      });
      expect(script).toContain('const interceptorPlatform = "googlechat"');
    });
  });

  describe('Google Chat own-message detection', () => {
    it('contains own-message hint strings', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('GOOGLE_CHAT_OWN_MESSAGE_HINTS');
      expect(script).toContain("'you said'");
      expect(script).toContain("'you sent'");
      expect(script).toContain("'you:'");
      expect(script).toContain("'你说'");
      expect(script).toContain("'你發送'");
      expect(script).toContain("'你傳送'");
    });

    it('contains isGoogleChatOwnMessageRow function', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('const isGoogleChatOwnMessageRow = row =>');
      expect(script).toContain(
        "row.getAttribute('data-is-own-message') === 'true'",
      );
      expect(script).toContain(
        'GOOGLE_CHAT_OWN_MESSAGE_HINTS.some(hint => rowAria.includes(hint))',
      );
    });

    it('contains isGoogleChatMessageRow function', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('const isGoogleChatMessageRow = row =>');
      expect(script).toContain('row.matches(\'div[role="listitem"]\')');
    });
  });

  describe('Google Chat text selectors', () => {
    it('defines GOOGLE_CHAT_TEXT_SELECTORS array', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('GOOGLE_CHAT_TEXT_SELECTORS');
      expect(script).toContain('\'div[dir="auto"]\'');
      expect(script).toContain('\'span[dir="auto"]\'');
      expect(script).toContain("'div[jsname]'");
      expect(script).toContain('\'div[role="text"]\'');
    });

    it('uses findBestMessageTextContainer for Google Chat text extraction', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('const findBestMessageTextContainer = row =>');
      expect(script).toContain(
        'for (const selector of GOOGLE_CHAT_TEXT_SELECTORS)',
      );
    });
  });

  describe('Google Chat composer detection', () => {
    it('searches for composer in div[role="main"] and c-wiz containers', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('document.querySelector(\'div[role="main"]\')');
      expect(script).toContain(
        'document.querySelector(\'c-wiz[role="main"]\')',
      );
      expect(script).toContain("document.querySelector('main')");
    });

    it('uses Google Chat-specific composer selectors', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        '\'div[contenteditable="true"][role="textbox"]\'',
      );
      expect(script).toContain(
        '\'div[contenteditable="true"][aria-label*="Message"]\'',
      );
      expect(script).toContain(
        '\'div[contenteditable="true"][aria-label*="消息"]\'',
      );
      expect(script).toContain(
        '\'div[contenteditable="true"][aria-label*="訊息"]\'',
      );
      expect(script).toContain(
        '\'div[contenteditable="true"][aria-label*="输入"]\'',
      );
      expect(script).toContain(
        '\'div[contenteditable="true"][aria-label*="輸入"]\'',
      );
    });

    it('uses pickBestComposer for candidate selection', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('const pickBestComposer = candidates =>');
      expect(script).toContain('pickBestComposer(candidates)');
    });

    it('has body fallback for composer when roots find nothing', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        'Found composer for Google Chat (body fallback)',
      );
      expect(script).toContain('bodySelectors');
      expect(script).toContain(
        '\'div[contenteditable="true"][role="textbox"]\'',
      );
      expect(script).toContain('\'div[contenteditable="true"]\'');
      expect(script).toContain('document.querySelectorAll(sel)');
    });

    it('logs Composer not found with profile for diagnostics', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('JSON.stringify({ profile: activeProfile })');
      expect(script).toContain('Composer not found:');
    });
  });

  describe('Google Chat periodic diagnostic', () => {
    it('does not include periodic diagnostic timer logs anymore', async () => {
      const script = await captureInjectedScript();
      expect(script).not.toContain('[Ferdium Translator] diagnostic:');
      expect(script).not.toContain('diagnosticInterval');
      expect(script).not.toContain(
        'registerCleanup(() => clearInterval(diagnosticInterval))',
      );
    });
  });

  describe('Google Chat send button detection', () => {
    it('contains Google Chat send button selectors', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('\'button[aria-label*="Send message"]\'');
      expect(script).toContain('\'button[aria-label="Send"]\'');
      expect(script).toContain('\'button[aria-label*="发送"]\'');
      expect(script).toContain('\'button[aria-label*="發送"]\'');
      expect(script).toContain('\'button[data-tooltip*="Send"]\'');
      expect(script).toContain('\'button[data-testid*="send"]\'');
      expect(script).toContain('\'[role="button"][aria-label*="Send"]\'');
      expect(script).toContain('\'[role="button"][aria-label*="发送"]\'');
      expect(script).toContain('\'[role="button"][aria-label*="發送"]\'');
    });

    it('searches send button within form and main containers', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain("composer?.closest?.('form')");
      expect(script).toContain('composer?.closest?.(\'div[role="main"]\')');
    });

    it('has SEND_BUTTON_HINTS for general send detection', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('SEND_BUTTON_HINTS');
      expect(script).toContain("'send'");
      expect(script).toContain("'发送'");
      expect(script).toContain("'發送'");
      expect(script).toContain("'send message'");
    });
  });

  describe('Google Chat message row handling', () => {
    it('uses div[role="listitem"] for Google Chat message rows', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        'document.querySelectorAll(\'div[role="listitem"]\')',
      );
    });

    it('getIncomingMessageRows uses isGoogleChatProfile branch', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('const getIncomingMessageRows = () => {');
      const fnStart = script.indexOf('const getIncomingMessageRows = () => {');
      const googleCheckInFn = script.indexOf('isGoogleChatProfile()', fnStart);
      expect(googleCheckInFn).toBeGreaterThan(fnStart);
    });

    it('getOutgoingMessageRows uses isGoogleChatProfile branch', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('const getOutgoingMessageRows = () => {');
      const fnStart = script.indexOf('const getOutgoingMessageRows = () => {');
      const googleCheckInFn = script.indexOf('isGoogleChatProfile()', fnStart);
      expect(googleCheckInFn).toBeGreaterThan(fnStart);
    });

    it('isOutgoingMessageRowElement checks isGoogleChatOwnMessageRow for Google Chat', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('const isOutgoingMessageRowElement = row =>');
      expect(script).toContain(
        'isGoogleChatMessageRow(row) && isGoogleChatOwnMessageRow(row)',
      );
    });

    it('isIncomingMessageRowElement inverts own-message check for Google Chat', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('const isIncomingMessageRowElement = row =>');
      expect(script).toContain(
        'isGoogleChatMessageRow(row) && !isGoogleChatOwnMessageRow(row)',
      );
    });

    it('hasMatchingMessageRowInSubtree uses div[role="listitem"] for Google Chat', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('const hasMatchingMessageRowInSubtree =');
      const fnStart = script.indexOf('const hasMatchingMessageRowInSubtree =');
      const gcSelector = script.indexOf('\'div[role="listitem"]\'', fnStart);
      expect(gcSelector).toBeGreaterThan(fnStart);
    });
  });

  describe('Google Chat incoming translation preview decoration', () => {
    it('uses insertBefore pattern for Google Chat profile', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        'const insertionAnchor = textContainer.firstChild',
      );
      expect(script).toContain(
        'textContainer.insertBefore(translationBlock, insertionAnchor)',
      );
    });

    it('places mismatch block after translation block for Google Chat', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        'textContainer.insertBefore(mismatchBlock, translationBlock.nextSibling)',
      );
    });

    it('places divider block after translation block', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        'textContainer.insertBefore(dividerBlock, translationBlock.nextSibling)',
      );
    });

    it('places original block after divider for Google Chat', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        'textContainer.insertBefore(originalBlock, dividerBlock.nextSibling)',
      );
      expect(script).toContain('textContainer.appendChild(originalBlock)');
    });

    it('uses findBestMessageTextContainer for incoming text in Google Chat', async () => {
      const script = await captureInjectedScript();
      const fnStart = script.indexOf(
        'const findIncomingMessageTextContainer = row =>',
      );
      expect(fnStart).toBeGreaterThan(0);
      const gcBranch = script.indexOf(
        'return findBestMessageTextContainer(row)',
        fnStart,
      );
      expect(gcBranch).toBeGreaterThan(fnStart);
    });
  });

  describe('Google Chat send format and language switching', () => {
    it('sends translated text with separator and original text', async () => {
      const script = await captureInjectedScript();
      expect(script).not.toContain('\\u2014\\u2014 Original \\u2014\\u2014');
      expect(script).toContain(
        "isGoogleChatProfile() && String(original || '').trim()",
      );
      expect(script).toContain('----------------');
      expect(script).toContain("String(original || '').trim()");
    });

    it('keeps local preview decoration path gated for non-Google profiles', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('queueLocalPreviewDecoration(');
      expect(script).toContain('if (!isGoogleChatProfile()) {');
      expect(script).not.toContain('LOCAL_PREVIEW_TRANSLATION_ATTR');
      expect(script).toContain(
        'messageTextContainer.appendChild(originalBlock)',
      );
    });

    it('does not auto-overwrite target language from incoming detection', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('!isGoogleChatProfile() &&');
      expect(script).toContain(
        'state.settings.targetLanguage = detectedPeerLanguage;',
      );
    });

    it('syncs translator configure updates into iframe contexts', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        "const BRIDGE_ACTION_CONFIG_SYNC = 'configure-sync';",
      );
      expect(script).toContain('action: BRIDGE_ACTION_CONFIG_SYNC');
      expect(script).toContain('Settings synced from top frame:');
      expect(script).toContain('syncSettingsToChildFrames(state.settings);');
    });

    it('uses tolerant outgoing row matching for Google Chat preview decoration', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        'const isLikelyOutgoingMatch = (rowComparable, translatedComparable) =>',
      );
      expect(script).toContain('translatedPrefix.length >= 8');
      expect(script).toContain('hitCount >= Math.min(2, keywords.length)');
      expect(script).toContain(
        'Google Chat can delay row text normalization; fallback to the latest row',
      );
    });
  });

  describe('Google Chat active chat signature', () => {
    it('uses heading role for Google Chat header detection', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('\'[role="heading"][aria-level="1"]\'');
      expect(script).toContain("'header [aria-label]'");
      expect(script).toContain("'header h1'");
      expect(script).toContain("'header h2'");
    });

    it('includes activeProfile in Google Chat signature', async () => {
      const script = await captureInjectedScript();
      const fnStart = script.indexOf('const getActiveChatSignature = () => {');
      expect(fnStart).toBeGreaterThan(0);
      const activeProfileInSig = script.indexOf('activeProfile', fnStart);
      expect(activeProfileInSig).toBeGreaterThan(fnStart);
    });

    it('checks main pane readiness', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain("mainPane ? 'main-ready' : 'main-missing'");
    });
  });

  describe('Google Chat composer text fallback', () => {
    it('has textarea fallback for Google Chat composer', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain("reason: 'composer-textarea-fallback'");
    });

    it('has context fallback with forceDomReplace for Google Chat', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain("reason: 'composer-context-fallback'");
      expect(script).toContain('forceDomReplace: true');
    });

    it('contains composer resolution from event context', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        'const resolveComposerFromContextTarget = target =>',
      );
      expect(script).toContain('const resolveEventTargetElement = event =>');
      expect(script).toContain("typeof event.composedPath === 'function'");
      expect(script).toContain("target.closest('form')");
      expect(script).toContain('target.closest(\'div[role="main"]\')');
      expect(script).toContain('const candidatesWithText = candidates.filter(');
      expect(script).toContain(
        'pickBestComposer(candidatesWithText) || pickBestComposer(candidates)',
      );
    });

    it('uses context-based composer resolution in send button flow', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        'resolveComposerFromContextTarget(eventTargetElement) || readComposer()',
      );
      expect(script).toContain(
        'const eventTargetElement = resolveEventTargetElement(event)',
      );
    });

    it('uses context-based composer resolution in translateAndSend for send-button', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain("triggerSource === 'send-button'");
      expect(script).toContain(
        'resolveComposerFromContextTarget(triggerEvent?.target)',
      );
      expect(script).toContain(
        'const composer = composerFromEvent || readComposer()',
      );
      expect(script).toContain('hasComposerFromEvent: !!composerFromEvent');
    });
  });

  describe('shared infrastructure remains intact for Google Chat', () => {
    it('contains all shared CSS style classes', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        'ferdium-translator-local-translation{display:block;',
      );
      expect(script).toContain(
        'ferdium-translator-local-divider{display:block;height:0;margin:6px 0 4px;border-top:1px solid rgba(16,24,40,0.24) !important;}',
      );
      expect(script).toContain(
        'ferdium-translator-local-original{display:block;white-space:pre-wrap;color:#0b7f3e !important;opacity:0.96;}',
      );
      expect(script).toContain(
        'ferdium-translator-incoming-translation{display:block;',
      );
      expect(script).toContain(
        'ferdium-translator-incoming-divider{display:block;height:0;margin:6px 0 4px;border-top:1px solid rgba(16,24,40,0.24);}',
      );
      expect(script).toContain(
        'ferdium-translator-incoming-original{display:block;white-space:pre-wrap;color:#0b7f3e;opacity:0.96;}',
      );
      expect(script).toContain(
        'ferdium-translator-incoming-mismatch{display:block;margin:2px 0 4px;color:#b54708;font-size:11px;line-height:1.25;}',
      );
    });

    it('registers keydown, beforeinput, and send button event listeners', async () => {
      const script = await captureInjectedScript();
      expect(
        script.includes("addDomListener(document, 'keydown'") ||
          script.includes("addDomListener(doc, 'keydown'"),
      ).toBe(true);
      expect(
        script.includes("addDomListener(document, 'beforeinput'") ||
          script.includes("addDomListener(doc, 'beforeinput'"),
      ).toBe(true);
      expect(
        script.includes(
          "addDomListener(document, 'pointerdown', handleSendButtonEvent",
        ) ||
          script.includes(
            "addDomListener(doc, 'pointerdown', handleSendButtonEvent",
          ),
      ).toBe(true);
      expect(
        script.includes(
          "addDomListener(document, 'mousedown', handleSendButtonEvent",
        ) ||
          script.includes(
            "addDomListener(doc, 'mousedown', handleSendButtonEvent",
          ),
      ).toBe(true);
      expect(
        script.includes(
          "addDomListener(document, 'click', handleSendButtonEvent",
        ) ||
          script.includes("addDomListener(doc, 'click', handleSendButtonEvent"),
      ).toBe(true);
      expect(
        script.includes(
          "addDomListener(document, 'submit', handleComposerSubmit",
        ) ||
          script.includes("addDomListener(doc, 'submit', handleComposerSubmit"),
      ).toBe(true);
    });

    it('contains IPC communication channels', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        "addIpcListener('translator:translation-result'",
      );
      expect(script).toContain("addIpcListener('translator:configure'");
      expect(
        script.includes(
          "ipcRenderer.sendToHost('translator:translate-message'",
        ) || script.includes("sendToHostSafe('translator:translate-message'"),
      ).toBe(true);
      expect(
        script.includes(
          "ipcRenderer.sendToHost('translator:incoming-language-detected'",
        ) ||
          script.includes(
            "sendToHostSafe('translator:incoming-language-detected'",
          ),
      ).toBe(true);
      expect(
        script.includes("ipcRenderer.sendToHost('translator:initialized'") ||
          script.includes("sendToHostSafe('translator:initialized'"),
      ).toBe(true);
      expect(script).toContain('reason: translateReason');
      expect(script).toContain('profile: activeProfile');
    });

    it('contains incoming translation processing and validation', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        "const processIncomingMessageRow = async (row, reason = 'unknown') => {",
      );
      expect(script).toContain('const buildIncomingTranslatePlan = (');
      expect(script).toContain('const validateTranslatedLanguage = async (');
      expect(script).toContain("reason: 'incoming:' + reason");
      expect(script).toContain("reason: 'incoming-language-retry'");
    });

    it('contains outgoing history observer', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('const ensureOutgoingHistoryObserver = () => {');
      expect(script).toContain("scheduleOutgoingHistoryScan('bootstrap', 420)");
      expect(script).toContain(
        "scheduleOutgoingHistoryScan('outgoing-history-observer', 160)",
      );
    });

    it('contains incoming observer and bootstrap scans', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('const ensureIncomingObserver = () => {');
      expect(script).toContain("scheduleIncomingScan('bootstrap', 380)");
      expect(script).toContain(
        "scheduleIncomingScan('mutation-observer', 120)",
      );
    });

    it('contains active chat watcher and visibility change handler', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('startActiveChatWatcher();');
      expect(script).toContain(
        "refreshFormattingForActiveChat('visibility-change')",
      );
    });

    it('contains cleanup infrastructure', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('window.__ferdiumTranslatorCleanup');
      expect(script).toContain(
        'window.__ferdiumTranslatorInterceptorInstanceId',
      );
      expect(script).toContain(
        "window.__ferdiumTranslatorCleanup('version-change')",
      );
    });

    it('contains translateAndSend with bypass and preview decoration', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        'const outgoingRowCountBeforeSend = getOutgoingMessageRows().length',
      );
      expect(script).toContain('queueLocalPreviewDecoration(');
      expect(
        script.includes(
          'await triggerNativeSend(preferClick, finalText, original, operationId)',
        ) ||
          script.includes(
            'await triggerNativeSend(preferClick, finalSendText, original, operationId)',
          ),
      ).toBe(true);
    });

    it('contains translation unchanged path', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('const translationChanged =');
      expect(script).toContain(
        "'[Ferdium Translator] Translation unchanged, sending original text'",
      );
      expect(script).toContain(
        'await triggerNativeSend(preferClick, original, original, operationId)',
      );
    });

    it('contains language detection and normalization functions', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('const SUPPORTED_SETTING_LANGUAGES = new Set([');
      expect(script).toContain('const toSettingsLanguageCode = value => {');
      expect(script).toContain(
        'const inferLanguageFromCharacterSet = value => {',
      );
      expect(script).toContain(
        'const isAmbiguousShortIncomingSample = value => {',
      );
    });

    it('contains outgoing history lookup via cache', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        'const lookupOutgoingOriginalFromCache = async (',
      );
      expect(script).toContain("'translator:lookup-original'");
      expect(script).toContain(
        "const restoreOutgoingHistoryPreview = async (reason = 'unknown') => {",
      );
      expect(script).toContain(
        '[Ferdium Translator] Outgoing history lookup miss:',
      );
      expect(script).toContain(
        '[Ferdium Translator] Outgoing history preview restored:',
      );
    });

    it('contains bootstrap formatting pass', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('const scheduleBootstrapFormattingPass = (');
      expect(script).toContain("scheduleBootstrapFormattingPass('bootstrap')");
      expect(script).toContain(
        "scheduleBootstrapFormattingPass('configure-update')",
      );
    });

    it('contains runtime diagnostic functions', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain(
        'window.__ferdiumTranslatorRunCase = async targetText =>',
      );
      expect(script).toContain('window.__ferdiumTranslatorTest');
      expect(script).toContain('window.__ferdiumTranslatorDebugState');
    });

    it('contains submit-event fallback interception', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('const handleComposerSubmit = event => {');
      expect(script).toContain("translateAndSend(true, 'form-submit', event)");
      expect(script).toContain(
        '[Ferdium Translator] Intercepting submit event, starting translation:',
      );
    });

    it('contains incoming and request trace logs for debugging', async () => {
      const script = await captureInjectedScript();
      expect(script).toContain('[Ferdium Translator] Incoming scan start:');
      expect(script).toContain(
        '[Ferdium Translator] Sending translation request:',
      );
      expect(script).toContain("textLength: String(text || '').length");
      expect(script).toContain('const translateReason = String(options.reason');
    });
  });

  describe('WhatsApp regression: injecting with whatsapp recipe still works', () => {
    it('sets interceptorPlatform to whatsapp for whatsapp recipe', async () => {
      const store: any = new MessageTranslatorStore();
      let injectedScript = '';

      const mockService = {
        recipe: { id: 'whatsapp' },
        url: '',
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
            serviceId === 'service-wa' ? mockService : null,
        },
      };

      const status = await store._ensureWhatsAppInterceptor('service-wa');
      expect(status).toBe('ok');
      expect(injectedScript).toContain(
        'const interceptorPlatform = "whatsapp"',
      );
      expect(injectedScript).toContain(
        "return Array.from(document.querySelectorAll('div.message-in'));",
      );
      expect(injectedScript).toContain(
        "return Array.from(document.querySelectorAll('div.message-out'));",
      );
    });
  });
});
