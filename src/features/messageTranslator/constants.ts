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

export const TRANSLATION_RECIPE_PLATFORMS = {
  whatsapp: 'whatsapp',
  telegram: 'telegram',
  googlechat: 'googlechat',
  'google-chat': 'googlechat',
  google_chat: 'googlechat',
  hangoutschat: 'googlechat',
  hangouts: 'googlechat',
  googlechatservice: 'googlechat',
} as const;

export type TranslationPlatform =
  (typeof TRANSLATION_RECIPE_PLATFORMS)[keyof typeof TRANSLATION_RECIPE_PLATFORMS];

export const resolveTranslationPlatformForRecipeId = (
  recipeId: string,
): TranslationPlatform | null =>
  TRANSLATION_RECIPE_PLATFORMS[
    recipeId.trim().toLowerCase() as keyof typeof TRANSLATION_RECIPE_PLATFORMS
  ] || null;
