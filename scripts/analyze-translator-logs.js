#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('node:fs');

function classify(lines) {
  const has = marker => lines.some(line => line.includes(marker));
  const count = marker => lines.filter(line => line.includes(marker)).length;

  const signals = {
    webviewInit: has(
      '[Ferdium Translator] Interceptor initialized successfully',
    ),
    incomingScan: count('[Ferdium Translator] Incoming scan start:'),
    outgoingScan: count('[Ferdium Translator] Outgoing history scan start:'),
    sendIntercept:
      count(
        '[Ferdium Translator] Intercepting send button, starting translation:',
      ) +
      count(
        '[Ferdium Translator] Intercepting Enter key, starting translation',
      ) +
      count(
        '[Ferdium Translator] Intercepting submit event, starting translation:',
      ),
    sendIgnoredEmptyComposer: count(
      '[Ferdium Translator] Send button ignored (composer missing/empty):',
    ),
    sendIgnoredBypass: count(
      '[Ferdium Translator] Send button ignored (bypass period)',
    ),
    sendIgnoredDisabled: count(
      '[Ferdium Translator] Send button ignored (sendTranslation=false)',
    ),
    webviewTranslateRequest: count(
      '[Ferdium Translator] Sending translation request:',
    ),
    webviewInvokeTry: count('[Ferdium Translator] Trying translateByInvoke'),
    webviewInvokeFallback: count(
      'invoke translate failed, fallback to host message',
    ),
    rendererForward: count('[ServicesStore] Forward translation request'),
    mainRequest: count('[Translator Main] Request'),
    mainResponse: count('[Translator Main] Response'),
    rendererResult: count('[ServicesStore] Receive translation result'),
    incomingApplied: count('[Ferdium Translator] Incoming translation applied'),
    historyRestored: count(
      '[Ferdium Translator] Outgoing history preview restored:',
    ),
    diagnostic: count('[Ferdium Translator] diagnostic:'),
    composerNotFound: count('[Ferdium Translator] Composer not found:'),
  };

  let diagnosis = 'unknown';
  let suggestion = '请继续收集更多日志。';

  if (
    (signals.incomingScan > 0 || signals.outgoingScan > 0) &&
    signals.webviewTranslateRequest === 0 &&
    signals.webviewInvokeTry === 0
  ) {
    diagnosis = 'trigger-not-captured';
    suggestion =
      '拦截器已启动但未进入翻译请求。优先检查发送事件是否被命中（click/submit/enter），以及 composer 文本是否为空。';
    if (signals.diagnostic > 0) {
      suggestion +=
        ' 若日志中有 diagnostic 行，查看 composerFound/sendButtonFound 是否为 false，以确认选择器是否匹配当前页面。';
    }
    if (signals.composerNotFound > 0) {
      suggestion +=
        ' 日志中出现 Composer not found 表示输入框未匹配到，请根据 profile 检查对应平台 DOM 选择器。';
    }
  } else if (
    (signals.webviewTranslateRequest > 0 || signals.webviewInvokeTry > 0) &&
    signals.mainRequest === 0 &&
    signals.rendererForward === 0
  ) {
    diagnosis = 'renderer-forward-missing';
    suggestion =
      'WebView 已请求翻译，但 Renderer 未转发。检查 ServicesStore IPC 监听与桥接。';
  } else if (signals.mainRequest > 0 && signals.mainResponse === 0) {
    diagnosis = 'main-no-response';
    suggestion =
      '主进程收到请求但无响应。检查 translateTo() 调用和外部翻译 API 错误。';
  } else if (signals.mainResponse > 0 && signals.rendererResult === 0) {
    diagnosis = 'result-not-forwarded';
    suggestion =
      '主进程有响应但结果未回传 WebView。检查 translator:translation-result 转发链路。';
  } else if (
    signals.webviewTranslateRequest > 0 ||
    signals.mainResponse > 0 ||
    signals.rendererResult > 0
  ) {
    diagnosis = 'request-chain-observed';
    suggestion =
      '翻译请求链路已出现，继续核查 DOM 写回（composer/set text/preview 装饰）逻辑。';
  }

  return { signals, diagnosis, suggestion };
}

function analyzeContent(content) {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  return classify(lines);
}

function printReport(result) {
  console.log('=== Translator Log Analysis ===');
  console.log(`diagnosis: ${result.diagnosis}`);
  console.log(`suggestion: ${result.suggestion}`);
  console.log('signals:');
  for (const [key, value] of Object.entries(result.signals)) {
    console.log(`  - ${key}: ${value}`);
  }
}

// eslint-disable-next-line eqeqeq -- require.main vs module type differs; sonar/different-types-comparison expects ==
if (require.main == module) {
  const filePath = process.argv[2];
  let content = '';
  content = filePath
    ? fs.readFileSync(filePath, 'utf8')
    : fs.readFileSync(0, 'utf8');
  const result = analyzeContent(content);
  printReport(result);
}

module.exports = {
  analyzeContent,
  classify,
};
