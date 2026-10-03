import { translateTo } from './translation-helpers';

export interface TranslationDirection {
  fromLanguage: string;
  toLanguage: string;
}

export interface EngineHealth {
  engine: string;
  available: boolean;
  reason?:
    | 'missing-credentials'
    | 'timeout'
    | 'translation-failed'
    | 'invalid-target-language';
}

const sampleByLanguage: Record<string, string> = {
  zh: '你好',
  en: 'Hello',
  ja: 'こんにちは',
  ko: '안녕하세요',
  fr: 'Bonjour',
  es: 'Hola',
  de: 'Guten Tag',
  ru: 'Привет',
  pt: 'Olá',
  it: 'Ciao',
};

const probeInput = (direction: TranslationDirection) => {
  const base = direction.fromLanguage.split('-')[0].toLowerCase();
  if (sampleByLanguage[base]) {
    return {
      text: sampleByLanguage[base],
      fromLanguage: direction.fromLanguage,
    };
  }
  return direction.toLanguage.split('-')[0].toLowerCase() === 'en'
    ? { text: '你好', fromLanguage: 'zh' }
    : { text: 'Hello', fromLanguage: 'en' };
};

export const checkTranslationEngine = async (
  engine: string,
  directions: TranslationDirection[],
  credentials: Record<string, string> | null,
  translate: typeof translateTo = translateTo,
): Promise<EngineHealth> => {
  if (['Baidu', 'Youdao', 'Aliyun'].includes(engine) && !credentials) {
    return { engine, available: false, reason: 'missing-credentials' };
  }

  for (const direction of directions) {
    const input = probeInput(direction);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Keep checks independent from fallback providers and the local cache.
      // eslint-disable-next-line no-await-in-loop
      const result = await Promise.race([
        translate(input.text, direction.toLanguage, engine, {
          fromLanguage: input.fromLanguage,
          baiduAppId: credentials?.appId,
          baiduSecretKey: credentials?.secretKey,
          providerCredentials: credentials,
          allowFallback: false,
        }),
        new Promise<null>(resolve => {
          timer = setTimeout(() => resolve(null), 12_000);
        }),
      ]);
      if (!result) return { engine, available: false, reason: 'timeout' };
      if (
        result.error ||
        !result.text.trim() ||
        result.text.trim() === input.text
      ) {
        return { engine, available: false, reason: 'translation-failed' };
      }
    } catch {
      return { engine, available: false, reason: 'translation-failed' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return { engine, available: true };
};

export const getTranslationDirections = ({
  myLanguage,
  targetLanguage,
  sendTranslation,
  receiveTranslation,
}: {
  myLanguage: string;
  targetLanguage: string;
  sendTranslation: boolean;
  receiveTranslation: boolean;
}): TranslationDirection[] => {
  const mine = String(myLanguage || '').trim();
  const target = String(targetLanguage || '').trim() || 'en';
  const directions: TranslationDirection[] = [];
  if (sendTranslation) {
    directions.push({
      fromLanguage:
        mine === 'auto'
          ? target.split('-')[0].toLowerCase() === 'en'
            ? 'zh'
            : 'en'
          : mine || 'zh',
      toLanguage: target,
    });
  }
  if (receiveTranslation && mine && mine !== 'auto') {
    directions.push({ fromLanguage: target, toLanguage: mine });
  }
  if (directions.length === 0) {
    directions.push({ fromLanguage: 'en', toLanguage: 'zh' });
  }
  const distinct = directions.filter(
    direction => direction.fromLanguage !== direction.toLanguage,
  );
  return distinct.length > 0
    ? distinct
    : [{ fromLanguage: 'en', toLanguage: 'zh' }];
};
