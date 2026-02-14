/* eslint-disable no-console */
import { createHash } from 'node:crypto';

interface BaiduTranslateConfig {
  appId: string;
  secretKey: string;
}

interface BaiduTranslateResponse {
  from?: string;
  to?: string;
  trans_result?: {
    src: string;
    dst: string;
  }[];
  error_code?: string;
  error_msg?: string;
}

const BAIDU_TRANSLATE_API =
  'https://fanyi-api.baidu.com/api/trans/vip/translate';

const LANGUAGE_CODE_MAP: Record<string, string> = {
  auto: 'auto',
  zh: 'zh',
  'zh-cn': 'zh',
  'zh-hans': 'zh',
  'zh-tw': 'cht',
  'zh-hant': 'cht',
  en: 'en',
  ja: 'jp',
  ko: 'kor',
  fr: 'fra',
  es: 'spa',
  de: 'de',
  ru: 'ru',
  pt: 'pt',
  it: 'it',
  ar: 'ara',
  th: 'th',
  vi: 'vie',
  id: 'id',
  hi: 'hi',
};

function mapLanguageCode(lang: string, isTarget = false): string {
  const normalized = String(lang || '')
    .trim()
    .replaceAll('_', '-')
    .toLowerCase();
  if (!normalized || normalized === 'auto') {
    return isTarget ? 'en' : 'auto';
  }

  const mapped = LANGUAGE_CODE_MAP[normalized];
  if (mapped) return mapped;

  if (normalized.startsWith('zh-')) {
    if (
      normalized.includes('tw') ||
      normalized.includes('hant') ||
      normalized.includes('hk') ||
      normalized.includes('mo')
    ) {
      return 'cht';
    }
    return 'zh';
  }

  const baseCode = normalized.split('-')[0];
  const baseMapped = LANGUAGE_CODE_MAP[baseCode];
  if (baseMapped) return baseMapped;

  // Keep source as auto when detector returns unsupported/low-confidence codes
  // (e.g. short Latin text misdetected as "hr"), avoiding Baidu param errors.
  return isTarget ? 'en' : 'auto';
}

function buildSign(
  appId: string,
  query: string,
  salt: string,
  secretKey: string,
): string {
  return createHash('md5')
    .update(`${appId}${query}${salt}${secretKey}`, 'utf8')
    .digest('hex');
}

export async function translateWithBaidu(
  text: string,
  fromLang: string,
  toLang: string,
  config: BaiduTranslateConfig,
): Promise<{ text: string; error: boolean }> {
  console.log('[Baidu Translate] translateWithBaidu called:', {
    textLength: text?.length,
    textPreview: text?.slice(0, 50),
    fromLang,
    toLang,
    hasAppId: !!config?.appId,
    hasSecretKey: !!config?.secretKey,
  });

  const errorText =
    'FERDIUM ERROR: An error occurred. Please check your Baidu Translate API configuration or try again later.';

  if (!config?.appId || !config?.secretKey) {
    console.error('[Baidu Translate] Missing credentials:', {
      hasAppId: !!config?.appId,
      hasSecretKey: !!config?.secretKey,
    });
    return {
      text: `${errorText} Missing appId or secretKey.`,
      error: true,
    };
  }

  const query = String(text || '').trim();
  if (!query) {
    console.error('[Baidu Translate] Empty source text');
    return {
      text: `${errorText} Empty source text.`,
      error: true,
    };
  }

  const from = mapLanguageCode(fromLang, false);
  const to = mapLanguageCode(toLang, true);
  console.log('[Baidu Translate] Mapped language codes:', { from, to });

  const salt = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
  const sign = buildSign(config.appId, query, salt, config.secretKey);
  console.log('[Baidu Translate] Request prepared:', {
    from,
    to,
    salt,
    signLength: sign.length,
  });

  try {
    const body = new URLSearchParams();
    body.set('q', query);
    body.set('from', from);
    body.set('to', to);
    body.set('appid', config.appId);
    body.set('salt', salt);
    body.set('sign', sign);

    console.log('[Baidu Translate] Sending request to:', BAIDU_TRANSLATE_API);
    const response = await fetch(BAIDU_TRANSLATE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    console.log(
      '[Baidu Translate] Response status:',
      response.status,
      response.statusText,
    );
    const data = (await response.json()) as BaiduTranslateResponse;
    console.log('[Baidu Translate] Response data:', {
      hasErrorCode: !!data.error_code,
      errorCode: data.error_code,
      errorMsg: data.error_msg,
      hasTransResult: !!data.trans_result,
      transResultLength: data.trans_result?.length,
    });

    if (!response.ok) {
      console.error('[Baidu Translate] HTTP error:', response.status);
      return {
        text: `${errorText} HTTP ${response.status}`,
        error: true,
      };
    }

    if (data.error_code) {
      console.error('[Baidu Translate] API error:', {
        errorCode: data.error_code,
        errorMsg: data.error_msg,
      });
      return {
        text: `Baidu Translate Error: ${data.error_msg || data.error_code}`,
        error: true,
      };
    }

    const translatedText = (data.trans_result || [])
      .map(item => item.dst)
      .join('\n')
      .trim();

    console.log('[Baidu Translate] Translation result:', {
      translatedTextLength: translatedText.length,
      translatedTextPreview: translatedText.slice(0, 50),
    });

    if (!translatedText) {
      console.error('[Baidu Translate] Empty translation result');
      return { text: `${errorText} Empty translation result.`, error: true };
    }

    console.log('[Baidu Translate] Translation successful');
    return { text: translatedText, error: false };
  } catch (error) {
    console.error('[Baidu Translate] Exception:', error);
    return {
      text: `${errorText} ${error instanceof Error ? error.message : String(error)}`,
      error: true,
    };
  }
}
