import { createHash, createHmac, randomUUID } from 'node:crypto';

const fetchJson = async (url: string, init: RequestInit) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`Translation HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const languageCode = (language: string, engine: 'Youdao' | 'Aliyun') => {
  const code = String(language || 'auto').toLowerCase();
  if (code.startsWith('zh-tw') || code.startsWith('zh-hant')) {
    return engine === 'Youdao' ? 'zh-CHT' : 'zh-tw';
  }
  if (code.startsWith('zh')) {
    return engine === 'Youdao' ? 'zh-CHS' : 'zh';
  }
  return code.split('-')[0];
};

export const translateWithGoogleCloud = async (
  text: string,
  fromLanguage: string,
  toLanguage: string,
  apiKey: string,
): Promise<string> => {
  const body: Record<string, string> = {
    q: text,
    target: toLanguage,
    format: 'text',
  };
  if (fromLanguage !== 'auto') body.source = fromLanguage;
  const response = await fetchJson(
    'https://translation.googleapis.com/language/translate/v2',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    },
  );
  const translated = String(
    response?.data?.translations?.[0]?.translatedText || '',
  ).trim();
  if (!translated) throw new Error('Google Cloud returned no translation');
  return translated;
};

export const translateWithYoudao = async (
  text: string,
  fromLanguage: string,
  toLanguage: string,
  credentials: { appKey: string; appSecret: string },
): Promise<string> => {
  const salt = randomUUID();
  const curtime = String(Math.floor(Date.now() / 1000));
  const input =
    text.length <= 20
      ? text
      : `${text.slice(0, 10)}${text.length}${text.slice(-10)}`;
  const sign = createHash('sha256')
    .update(
      `${credentials.appKey}${input}${salt}${curtime}${credentials.appSecret}`,
    )
    .digest('hex');
  const body = new URLSearchParams({
    q: text,
    from: languageCode(fromLanguage, 'Youdao'),
    to: languageCode(toLanguage, 'Youdao'),
    appKey: credentials.appKey,
    salt,
    sign,
    signType: 'v3',
    curtime,
  });
  const response = await fetchJson('https://openapi.youdao.com/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (String(response?.errorCode) !== '0') {
    throw new Error(
      `Youdao translation failed (${String(response?.errorCode || 'unknown')})`,
    );
  }
  const translated = Array.isArray(response.translation)
    ? response.translation.join('\n').trim()
    : '';
  if (!translated) throw new Error('Youdao returned no translation');
  return translated;
};

const percentEncode = (value: string) =>
  encodeURIComponent(value).replaceAll(
    /[!'()*]/g,
    character => `%${character.codePointAt(0)?.toString(16).toUpperCase()}`,
  );

export const createAliyunSignature = (
  parameters: Record<string, string>,
  accessKeySecret: string,
  method = 'POST',
) => {
  const canonicalQuery = Object.keys(parameters)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map(key => `${percentEncode(key)}=${percentEncode(parameters[key])}`)
    .join('&');
  const stringToSign = `${method}&%2F&${percentEncode(canonicalQuery)}`;
  return createHmac('sha1', `${accessKeySecret}&`)
    .update(stringToSign)
    .digest('base64');
};

export const translateWithAliyun = async (
  text: string,
  fromLanguage: string,
  toLanguage: string,
  credentials: { accessKeyId: string; accessKeySecret: string },
): Promise<string> => {
  const parameters: Record<string, string> = {
    Action: 'TranslateGeneral',
    Version: '2018-10-12',
    Format: 'JSON',
    AccessKeyId: credentials.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: randomUUID(),
    Timestamp: new Date().toISOString().replaceAll(/\.\d{3}Z$/g, 'Z'),
    FormatType: 'text',
    Scene: 'general',
    SourceLanguage: languageCode(fromLanguage, 'Aliyun'),
    TargetLanguage: languageCode(toLanguage, 'Aliyun'),
    SourceText: text,
  };
  const signature = createAliyunSignature(
    parameters,
    credentials.accessKeySecret,
  );
  const body = new URLSearchParams({ ...parameters, Signature: signature });
  const response = await fetchJson('https://mt.cn-hangzhou.aliyuncs.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (String(response?.Code) !== '200') {
    throw new Error(
      `Aliyun translation failed (${String(response?.Code || 'unknown')})`,
    );
  }
  const translated = String(response?.Data?.Translated || '').trim();
  if (!translated) throw new Error('Aliyun returned no translation');
  return translated;
};
