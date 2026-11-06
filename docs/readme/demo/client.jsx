import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { observable, runInAction } from 'mobx';
import { mdiWhatsapp } from '@mdi/js';
import Panel from '../../../src/features/messageTranslator/Component';
import { translatorActions } from '../../../src/features/messageTranslator/actions';
import messages from '../../../src/i18n/locales/zh-HANS.json';

const frame = () => document.querySelector('iframe').contentWindow;
const settings = observable({
  myLanguage: 'zh',
  targetLanguage: 'en',
  translatorEngine: 'Google',
  sendTranslation: true,
  receiveTranslation: true,
  panelTheme: 'light',
  showOriginalText: true,
  conversationLanguages: {},
});
const history = observable({});
const translator = {
  panelWidth: 312,
  historyTranslationStates: history,
  getServiceSettings: () => settings,
  _resolveTranslatorInterceptorPlatform: () => 'whatsapp',
  async translateLoadedHistory() {
    const requestId = 'demo-history';
    runInAction(() => {
      history.demo = {
        requestId,
        status: 'queued',
        completed: 0,
        total: 0,
        translated: 0,
        skipped: 0,
        failed: 0,
      };
    });
    const result = await frame().__ferdiumTranslatorTranslateHistory(requestId);
    runInAction(() => {
      history.demo = result;
    });
  },
  async cancelHistoryTranslation() {
    frame().__ferdiumTranslatorCancelHistory();
  },
};
window.demoBridge = {
  settings,
  host(channel, payload) {
    if (channel === 'translator:history-progress')
      runInAction(() => {
        history.demo = payload;
      });
    if (channel === 'translator:settings-changed') {
      runInAction(() => Object.assign(settings, payload.settings));
      frame().__demoConfigure({ ...settings });
    }
  },
};
translatorActions.updateSettings.listen(({ settings: patch }) => {
  runInAction(() => Object.assign(settings, patch));
  frame().__demoConfigure({ ...settings });
});
const stores = {
  services: { active: { id: 'demo', name: 'WhatsApp' } },
  messageTranslator: translator,
};
createRoot(document.querySelector('#panel')).render(
  <IntlProvider locale="zh-CN" messages={messages}>
    <Panel stores={stores} />
  </IntlProvider>,
);
document.querySelector('#nav-whatsapp').innerHTML =
  `<svg viewBox="0 0 24 24" fill="#23b273"><path d="${
    mdiWhatsapp
  }"></path></svg>WhatsApp`;
document.querySelector('#nav-telegram').innerHTML =
  '<img src="/telegram.svg" width="24" height="24" alt="">Telegram';
document.querySelector('#nav-googlechat').innerHTML =
  '<svg viewBox="0 0 24 24"><path fill="#3f9d79" d="M3 3h18v14H9l-6 4z"/><path fill="white" d="M7 7h10v2H7zm0 4h7v2H7z"/></svg>Google Chat';
window.demoPanelReady = true;
