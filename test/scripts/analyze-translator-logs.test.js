const { analyzeContent } = require('../../scripts/analyze-translator-logs');

describe('analyze-translator-logs', () => {
  it('识别“只有扫描日志但没有翻译请求”场景', () => {
    const content = `
[WebView Console] [Ferdium Translator] Interceptor initialized successfully {"serviceId":"abc"}
[WebView Console] [Ferdium Translator] Incoming scan start: {"reason":"configure-update","profile":"googlechat","rowCount":0}
[WebView Console] [Ferdium Translator] Outgoing history scan start: {"reason":"bootstrap:outgoing:260","profile":"googlechat","rowCount":0}
[WebView Console] [Ferdium Translator] Outgoing history scan start: {"reason":"configure-update:outgoing:260","profile":"googlechat","rowCount":0}
`;
    const result = analyzeContent(content);
    expect(result.diagnosis).toBe('trigger-not-captured');
    expect(result.signals.webviewInit).toBe(true);
    expect(result.signals.webviewTranslateRequest).toBe(0);
    expect(result.signals.webviewInvokeTry).toBe(0);
    expect(result.signals.outgoingScan).toBeGreaterThan(0);
  });

  it('识别完整翻译链路已出现', () => {
    const content = `
[WebView Console] [Ferdium Translator] Sending translation request: {"requestId":1}
[ServicesStore] Forward translation request {"requestId":1}
[Translator Main] Request {"requestId":1}
[Translator Main] Response {"requestId":1,"success":true}
[ServicesStore] Receive translation result {"requestId":1}
`;
    const result = analyzeContent(content);
    expect(result.diagnosis).toBe('request-chain-observed');
    expect(result.signals.webviewTranslateRequest).toBeGreaterThan(0);
    expect(result.signals.mainRequest).toBeGreaterThan(0);
    expect(result.signals.mainResponse).toBeGreaterThan(0);
  });

  it('trigger-not-captured 时包含 diagnostic 与 Composer not found 的提示', () => {
    const content = `
[Ferdium Translator] Incoming scan start:
[Ferdium Translator] Outgoing history scan start:
[Ferdium Translator] diagnostic: {"profile":"googlechat","composerFound":false,"sendButtonFound":false}
[Ferdium Translator] Composer not found: {"profile":"googlechat"}
`;
    const result = analyzeContent(content);
    expect(result.diagnosis).toBe('trigger-not-captured');
    expect(result.signals.diagnostic).toBeGreaterThan(0);
    expect(result.signals.composerNotFound).toBeGreaterThan(0);
    expect(result.suggestion).toContain('composerFound/sendButtonFound');
    expect(result.suggestion).toContain('Composer not found');
  });
});
