import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeSync } from 'fs-extra';
import { clearTranslationCacheInstancesForTests } from '../../src/helpers/translation-cache';

jest.mock('../../src/helpers/baidu-translate', () => ({
  translateWithBaidu: jest.fn(),
}));
jest.mock('../../src/helpers/translation-provider-apis', () => ({
  translateWithGoogleCloud: jest.fn(),
  translateWithYoudao: jest.fn(),
  translateWithAliyun: jest.fn(),
}));

// eslint-disable-next-line global-require
const { translateWithBaidu } = require('../../src/helpers/baidu-translate') as {
  translateWithBaidu: jest.Mock;
};
// eslint-disable-next-line global-require
const providerApis = require('../../src/helpers/translation-provider-apis') as {
  translateWithGoogleCloud: jest.Mock;
  translateWithYoudao: jest.Mock;
  translateWithAliyun: jest.Mock;
};
// eslint-disable-next-line global-require
const { translateTo } = require('../../src/helpers/translation-helpers') as {
  translateTo: typeof import('../../src/helpers/translation-helpers').translateTo;
};

describe('translation-helpers cache behavior', () => {
  let tempDir: string;
  let cacheFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ferdium-translate-to-cache-'));
    cacheFilePath = join(tempDir, 'translation-cache.json');
    clearTranslationCacheInstancesForTests();
    translateWithBaidu.mockReset();
    providerApis.translateWithYoudao.mockReset();
    providerApis.translateWithAliyun.mockReset();
    providerApis.translateWithGoogleCloud.mockReset();
  });

  afterEach(() => {
    clearTranslationCacheInstancesForTests();
    removeSync(tempDir);
  });

  it('avoids duplicate Baidu calls for identical translation requests', async () => {
    translateWithBaidu.mockResolvedValue({
      text: 'bonjour',
      error: false,
    });

    const options = {
      fromLanguage: 'zh-CN',
      baiduAppId: 'test-app-id',
      baiduSecretKey: 'test-secret-key',
      cacheFilePath,
    };

    const first = await translateTo('你好', 'fr', 'Baidu', options);
    const second = await translateTo('你好', 'fr', 'Baidu', options);

    expect(first.error).toBe(false);
    expect(second.error).toBe(false);
    expect(first.text).toBe('bonjour');
    expect(second.text).toBe('bonjour');
    expect(translateWithBaidu).toHaveBeenCalledTimes(1);
  });

  it('requires explicit Baidu credentials', async () => {
    const keys = [
      'BAIDU_TRANSLATE_APP_ID',
      'BAIDU_APP_ID',
      'BAIDU_TRANSLATE_SECRET_KEY',
      'BAIDU_SECRET_KEY',
    ];
    const previous = keys.map(key => process.env[key]);
    try {
      keys.forEach(key => {
        Reflect.deleteProperty(process.env, key);
      });
      const result = await translateTo('你好', 'en', 'Baidu');
      expect(result.error).toBe(true);
      expect(translateWithBaidu).not.toHaveBeenCalled();
    } finally {
      keys.forEach((key, index) => {
        if (previous[index] === undefined)
          Reflect.deleteProperty(process.env, key);
        else process.env[key] = previous[index];
      });
    }
  });

  it('checks only the selected engine when fallback is disabled', async () => {
    const previousFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    global.fetch = fetchMock;
    try {
      const result = await translateTo('Good morning', 'zh', 'Google', {
        fromLanguage: 'en',
        allowFallback: false,
      });
      expect(result.error).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain(
        'translate.googleapis.com',
      );
    } finally {
      global.fetch = previousFetch;
    }
  });

  it('uses MyMemory directly when selected for an availability check', async () => {
    const previousFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ responseData: { translatedText: '早上好' } }),
    });
    global.fetch = fetchMock;
    try {
      const result = await translateTo('Good morning', 'zh', 'MyMemory', {
        fromLanguage: 'en',
        allowFallback: false,
      });
      expect(result).toEqual({ text: '早上好', error: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain(
        'mymemory.translated.net',
      );
    } finally {
      global.fetch = previousFetch;
    }
  });

  it('dispatches configured domestic engines without falling back', async () => {
    providerApis.translateWithYoudao.mockResolvedValue('你好');
    providerApis.translateWithAliyun.mockResolvedValue('早上好');
    const youdao = await translateTo('Hello', 'zh', 'Youdao', {
      fromLanguage: 'en',
      providerCredentials: { appKey: 'id', appSecret: 'secret' },
      allowFallback: false,
    });
    const aliyun = await translateTo('Good morning', 'zh', 'Aliyun', {
      fromLanguage: 'en',
      providerCredentials: { accessKeyId: 'id', accessKeySecret: 'secret' },
      allowFallback: false,
    });
    expect(youdao).toEqual({ text: '你好', error: false });
    expect(aliyun).toEqual({ text: '早上好', error: false });
    expect(providerApis.translateWithYoudao).toHaveBeenCalledTimes(1);
    expect(providerApis.translateWithAliyun).toHaveBeenCalledTimes(1);
  });

  it('uses the configured Google Cloud API when an API key is saved', async () => {
    providerApis.translateWithGoogleCloud.mockResolvedValue('你好');
    const result = await translateTo('Hello', 'zh', 'Google', {
      fromLanguage: 'en',
      providerCredentials: { apiKey: 'google-key' },
      allowFallback: false,
    });
    expect(result).toEqual({ text: '你好', error: false });
    expect(providerApis.translateWithGoogleCloud).toHaveBeenCalledWith(
      'Hello',
      'en',
      'zh',
      'google-key',
    );
  });

  it('re-translates when target language changes', async () => {
    translateWithBaidu
      .mockResolvedValueOnce({
        text: 'bonjour',
        error: false,
      })
      .mockResolvedValueOnce({
        text: 'hola',
        error: false,
      });

    const options = {
      fromLanguage: 'zh-CN',
      baiduAppId: 'test-app-id',
      baiduSecretKey: 'test-secret-key',
      cacheFilePath,
    };

    const french = await translateTo('你好', 'fr', 'Baidu', options);
    const spanish = await translateTo('你好', 'es', 'Baidu', options);

    expect(french.error).toBe(false);
    expect(spanish.error).toBe(false);
    expect(french.text).toBe('bonjour');
    expect(spanish.text).toBe('hola');
    expect(translateWithBaidu).toHaveBeenCalledTimes(2);
  });

  it('can read cached result from disk after cache instance reset', async () => {
    translateWithBaidu.mockResolvedValueOnce({
      text: 'bonjour',
      error: false,
    });

    const options = {
      fromLanguage: 'zh-CN',
      baiduAppId: 'test-app-id',
      baiduSecretKey: 'test-secret-key',
      cacheFilePath,
    };

    const first = await translateTo('你好', 'fr', 'Baidu', options);
    expect(first.error).toBe(false);
    expect(translateWithBaidu).toHaveBeenCalledTimes(1);

    clearTranslationCacheInstancesForTests();
    translateWithBaidu.mockClear();

    const second = await translateTo('你好', 'fr', 'Baidu', options);
    expect(second.error).toBe(false);
    expect(second.text).toBe('bonjour');
    expect(translateWithBaidu).toHaveBeenCalledTimes(0);
  });
});
