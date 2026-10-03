export const IPC = {
  TRANSLATOR_HOST_CHANNEL: 'TRANSLATOR_HOST_CHANNEL',
  TRANSLATOR_CLIENT_CHANNEL: 'TRANSLATOR_CLIENT_CHANNEL',
};

export const DEFAULT_TRANSLATOR_SETTINGS = {
  myLanguage: 'zh',
  targetLanguage: 'en',
  translatorEngine: 'Google',
  panelTheme: 'light',
  sendTranslation: true,
  receiveTranslation: true,
  showOriginalText: false,
  forbidSendingOriginal: false,
  panelVisible: true,
};

export const TRANSLATOR_MIN_WIDTH = 300;
export const TRANSLATOR_DEFAULT_WIDTH = 350;
