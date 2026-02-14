import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeSync } from 'fs-extra';
import { clearTranslationCacheInstancesForTests } from '../../src/helpers/translation-cache';

jest.mock('../../src/helpers/baidu-translate', () => ({
  translateWithBaidu: jest.fn(),
}));

// eslint-disable-next-line global-require
const { translateWithBaidu } = require('../../src/helpers/baidu-translate') as {
  translateWithBaidu: jest.Mock;
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
