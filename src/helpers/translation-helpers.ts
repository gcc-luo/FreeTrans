import {
  LIVE_API_FERDIUM_LIBRETRANSLATE,
  TRANSLATOR_ENGINE_GOOGLE,
  TRANSLATOR_ENGINE_LIBRETRANSLATE,
} from '../config';
import { translateWithBaidu } from './baidu-translate';

const debug = require('../preload-safe-debug')('Ferdium:Translation');

const MYMEMORY_TRANSLATE_API = 'https://api.mymemory.translated.net/get';
const GOOGLE_TRANSLATE_API =
  'https://translate.googleapis.com/translate_a/single';
const TRANSLATOR_ENGINE_BAIDU = 'Baidu';
const BUILTIN_BAIDU_APP_ID = '20240726002108918';
const BUILTIN_BAIDU_SECRET_KEY = 'vowgbu1GNKLkUSzX3Cbq';

interface BaiduConfig {
  appId: string;
  secretKey: string;
}

export interface TranslateOptions {
  fromLanguage?: string;
  baiduAppId?: string;
  baiduSecretKey?: string;
}

const normalizeLanguageCode = (lang: string, fallback: string) => {
  if (!lang) return fallback;
  const normalized = String(lang).trim();
  return normalized || fallback;
};

const hasCjk = (value: string) => /[\u3400-\u9FFF]/.test(value);

const isLikelyGarbageTranslation = (
  sourceText: string,
  translatedText: string,
) => {
  const cleaned = String(translatedText || '').trim();
  if (!cleaned) return true;
  if (hasCjk(sourceText) && /^[A-Z]{2,5}$/.test(cleaned)) {
    return true;
  }
  return false;
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs = 10_000,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const parseTranslatedText = (value: unknown): string =>
  String(value || '')
    .trim()
    .replaceAll(/^["']+|["']+$/g, '');

const resolveBaiduConfig = (options?: TranslateOptions): BaiduConfig | null => {
  const appId = String(
    options?.baiduAppId ||
      process.env.BAIDU_TRANSLATE_APP_ID ||
      process.env.BAIDU_APP_ID ||
      BUILTIN_BAIDU_APP_ID ||
      '',
  ).trim();
  const secretKey = String(
    options?.baiduSecretKey ||
      process.env.BAIDU_TRANSLATE_SECRET_KEY ||
      process.env.BAIDU_SECRET_KEY ||
      BUILTIN_BAIDU_SECRET_KEY ||
      '',
  ).trim();

  if (!appId || !secretKey) return null;
  return { appId, secretKey };
};

const mapGoogleLanguage = (lang: string, isSource: boolean): string => {
  const normalized = (lang || '').toLowerCase();
  if (!normalized || normalized === 'auto') {
    return isSource ? 'auto' : 'en';
  }

  const mapping: Record<string, string> = {
    zh: 'zh-CN',
    'zh-cn': 'zh-CN',
    'zh-hans': 'zh-CN',
    'zh-tw': 'zh-TW',
    'zh-hant': 'zh-TW',
    en: 'en',
    ja: 'ja',
    ko: 'ko',
    fr: 'fr',
    de: 'de',
    es: 'es',
    ru: 'ru',
    pt: 'pt',
    it: 'it',
  };

  return mapping[normalized] || normalized;
};

const mapMyMemoryLanguage = (lang: string, isTarget = false) => {
  if (!lang || lang === 'auto') {
    return isTarget ? 'en-US' : 'zh-CN';
  }
  const normalized = lang.toLowerCase();
  const mappings: Record<string, string> = {
    zh: 'zh-CN',
    en: 'en-US',
    ja: 'ja-JP',
    ko: 'ko-KR',
    fr: 'fr-FR',
    de: 'de-DE',
    es: 'es-ES',
    ru: 'ru-RU',
    pt: 'pt-PT',
    it: 'it-IT',
  };
  return mappings[normalized] || lang;
};

async function translateViaLibre(
  text: string,
  fromLang: string,
  toLang: string,
): Promise<string> {
  const res = await fetchWithTimeout(
    LIVE_API_FERDIUM_LIBRETRANSLATE,
    {
      method: 'POST',
      body: JSON.stringify({
        q: text,
        source: fromLang === 'auto' ? 'auto' : fromLang,
        target: toLang,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    },
    8000,
  );

  if (!res.ok) {
    throw new Error(`LibreTranslate HTTP ${res.status}`);
  }

  const response = await res.json();
  if (response.error) {
    throw new Error(String(response.error));
  }

  const translatedText = parseTranslatedText(response.translatedText);
  if (!translatedText) {
    throw new Error('LibreTranslate empty result');
  }

  return translatedText;
}

async function translateViaGoogle(
  text: string,
  fromLang: string,
  toLang: string,
): Promise<string> {
  const query = `${GOOGLE_TRANSLATE_API}?client=gtx&sl=${encodeURIComponent(
    mapGoogleLanguage(fromLang, true),
  )}&tl=${encodeURIComponent(
    mapGoogleLanguage(toLang, false),
  )}&dt=t&q=${encodeURIComponent(text)}`;

  const res = await fetchWithTimeout(
    query,
    {
      method: 'GET',
    },
    8000,
  );

  if (!res.ok) {
    throw new Error(`Google HTTP ${res.status}`);
  }

  const response = await res.json();
  const translatedText = parseTranslatedText(
    Array.isArray(response?.[0])
      ? response[0].map(item => item?.[0] || '').join('')
      : '',
  );
  if (!translatedText) {
    throw new Error('Google empty result');
  }
  return translatedText;
}

async function translateViaBaidu(
  text: string,
  fromLang: string,
  toLang: string,
  options?: TranslateOptions,
): Promise<string> {
  const config = resolveBaiduConfig(options);
  if (!config) {
    throw new Error(
      'Baidu config missing. Please set BAIDU_TRANSLATE_APP_ID and BAIDU_TRANSLATE_SECRET_KEY.',
    );
  }

  const response = await translateWithBaidu(text, fromLang, toLang, config);
  if (response.error) {
    throw new Error(response.text || 'Baidu translation failed');
  }
  const translatedText = parseTranslatedText(response.text);
  if (!translatedText) {
    throw new Error('Baidu empty result');
  }
  return translatedText;
}

async function translateViaMyMemory(
  text: string,
  fromLang: string,
  toLang: string,
): Promise<string> {
  const sourceLang = mapMyMemoryLanguage(fromLang, false);
  const targetLang = mapMyMemoryLanguage(toLang || 'en', true);
  const langPair = `${sourceLang}|${targetLang}`;
  const query = `${MYMEMORY_TRANSLATE_API}?q=${encodeURIComponent(
    text,
  )}&langpair=${encodeURIComponent(langPair)}`;

  const res = await fetchWithTimeout(
    query,
    {
      method: 'GET',
    },
    8000,
  );

  if (!res.ok) {
    throw new Error(`MyMemory HTTP ${res.status}`);
  }

  const response = await res.json();
  const translatedText = parseTranslatedText(
    response?.responseData?.translatedText,
  );
  if (!translatedText) {
    throw new Error('MyMemory empty result');
  }
  if (isLikelyGarbageTranslation(text, translatedText)) {
    throw new Error('MyMemory suspicious translation');
  }
  return translatedText;
}

export async function translateTo(
  text: string,
  translateToLanguage: string,
  translatorEngine: string,
  options?: TranslateOptions,
): Promise<{ text: string; error: boolean }> {
  debug('translateTo called:', {
    textLength: text?.length,
    textPreview: text?.slice(0, 50),
    translateToLanguage,
    translatorEngine,
    fromLanguage: options?.fromLanguage,
    hasBaiduAppId: !!options?.baiduAppId,
    hasBaiduSecretKey: !!options?.baiduSecretKey,
  });

  const errorText =
    'FERDIUM ERROR: An error occurred. Please select less text to translate or try again later.';

  const fromLang = normalizeLanguageCode(
    options?.fromLanguage || 'auto',
    'auto',
  );
  const toLang = normalizeLanguageCode(translateToLanguage || 'en', 'en');
  // 引擎名称不需要标准化，直接使用原始值（Baidu, Google, LibreTranslate）
  const engine = String(
    translatorEngine || TRANSLATOR_ENGINE_LIBRETRANSLATE,
  ).trim();

  debug('translateTo normalized:', {
    fromLang,
    toLang,
    engine,
  });

  const attempts: { name: string; fn: () => Promise<string> }[] = [];

  if (engine === TRANSLATOR_ENGINE_BAIDU) {
    debug('Using Baidu translator engine');
    const baiduConfig = resolveBaiduConfig(options);
    debug('Baidu config resolved:', {
      hasConfig: !!baiduConfig,
      hasAppId: !!baiduConfig?.appId,
      hasSecretKey: !!baiduConfig?.secretKey,
    });

    if (!baiduConfig) {
      debug('Baidu config missing, returning error');
      return {
        text: `${errorText} Missing Baidu credentials. Please set BAIDU_TRANSLATE_APP_ID and BAIDU_TRANSLATE_SECRET_KEY.`,
        error: true,
      };
    }

    attempts.push({
      name: 'Baidu',
      fn: () => {
        debug('Calling translateViaBaidu');
        return translateViaBaidu(text, fromLang, toLang, {
          ...options,
          baiduAppId: baiduConfig.appId,
          baiduSecretKey: baiduConfig.secretKey,
        });
      },
    });
  } else if (engine === TRANSLATOR_ENGINE_GOOGLE) {
    attempts.push(
      {
        name: 'Google',
        fn: () => translateViaGoogle(text, fromLang, toLang),
      },
      {
        name: 'LibreTranslate',
        fn: () => translateViaLibre(text, fromLang, toLang),
      },
      {
        name: 'MyMemory',
        fn: () => translateViaMyMemory(text, fromLang, toLang),
      },
    );
  } else {
    attempts.push({
      name: 'LibreTranslate',
      fn: () => translateViaLibre(text, fromLang, toLang),
    });

    if (resolveBaiduConfig(options)) {
      attempts.push({
        name: 'Baidu',
        fn: () => translateViaBaidu(text, fromLang, toLang, options),
      });
    }

    attempts.push({
      name: 'MyMemory',
      fn: () => translateViaMyMemory(text, fromLang, toLang),
    });
  }

  let lastError: string | null = null;
  for (const attempt of attempts) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const translatedText = await attempt.fn();
      return { text: translatedText, error: false };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      debug(`${attempt.name} translation failed:`, error);
    }
  }

  return {
    text: `${errorText} ${lastError || 'Unable to reach translation providers.'}`,
    error: true,
  };
}
