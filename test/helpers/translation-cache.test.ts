import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeSync } from 'fs-extra';
import {
  TRANSLATION_CACHE_RETENTION_MS,
  clearTranslationCacheInstancesForTests,
  getTranslationCache,
} from '../../src/helpers/translation-cache';

const wait = (ms: number) =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

describe('translation-cache', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ferdium-translation-cache-'));
    clearTranslationCacheInstancesForTests();
  });

  afterEach(() => {
    clearTranslationCacheInstancesForTests();
    removeSync(tempDir);
  });

  it('persists cached entries to disk and can reload them', () => {
    const cacheFilePath = join(tempDir, 'translation-cache.json');
    const cache = getTranslationCache(cacheFilePath, 100);

    expect(cache).not.toBeNull();
    cache?.save(
      {
        sourceText: 'hello',
        fromLanguage: 'en',
        toLanguage: 'fr',
        engine: 'Baidu',
      },
      'bonjour',
    );

    clearTranslationCacheInstancesForTests();

    const reloadedCache = getTranslationCache(cacheFilePath, 100);
    const hit = reloadedCache?.lookup({
      sourceText: 'hello',
      fromLanguage: 'en',
      toLanguage: 'fr',
      engine: 'Baidu',
    });

    expect(hit).toBe('bonjour');
  });

  it('clears cached conversation text from memory and disk', () => {
    const cacheFilePath = join(tempDir, 'translation-cache.json');
    const cache = getTranslationCache(cacheFilePath, 100);
    const request = {
      sourceText: 'private conversation',
      fromLanguage: 'en',
      toLanguage: 'zh',
      engine: 'Google',
    };

    cache?.save(request, '私人对话');
    expect(existsSync(cacheFilePath)).toBe(true);
    const privatePermissions = statSync(cacheFilePath).mode % 0o100 === 0;
    expect(process.platform === 'win32' || privatePermissions).toBe(true);

    cache?.clear();
    expect(cache?.lookup(request)).toBeNull();
    expect(existsSync(cacheFilePath)).toBe(false);
  });

  it('includes source/target language and engine in cache key', () => {
    const cacheFilePath = join(tempDir, 'translation-cache.json');
    const cache = getTranslationCache(cacheFilePath, 100);

    cache?.save(
      {
        sourceText: 'ni hao',
        fromLanguage: 'zh-CN',
        toLanguage: 'fr',
        engine: 'Baidu',
      },
      'bonjour',
    );

    expect(
      cache?.lookup({
        sourceText: 'ni hao',
        fromLanguage: 'zh-CN',
        toLanguage: 'fr',
        engine: 'Baidu',
      }),
    ).toBe('bonjour');

    expect(
      cache?.lookup({
        sourceText: 'ni hao',
        fromLanguage: 'zh-CN',
        toLanguage: 'es',
        engine: 'Baidu',
      }),
    ).toBeNull();

    expect(
      cache?.lookup({
        sourceText: 'ni hao',
        fromLanguage: 'zh-CN',
        toLanguage: 'fr',
        engine: 'Google',
      }),
    ).toBeNull();
  });

  it('isolates messages by service and clears only the selected service', () => {
    const cache = getTranslationCache(join(tempDir, 'cache.json'), 100);
    const request = {
      sourceText: 'hello',
      fromLanguage: 'en',
      toLanguage: 'zh',
      engine: 'Google',
    };
    cache?.save({ ...request, serviceId: 'whatsapp' }, '你好', 'Google');
    cache?.save({ ...request, serviceId: 'googlechat' }, '您好', 'MyMemory');

    expect(cache?.lookup({ ...request, serviceId: 'whatsapp' })).toBe('你好');
    expect(cache?.lookup({ ...request, serviceId: 'googlechat' })).toBe('您好');
    expect(cache?.lookup(request)).toBeNull();
    expect(
      cache?.lookupOriginalByTranslatedText({
        serviceId: 'whatsapp',
        translatedText: '您好',
      }),
    ).toBeNull();
    expect(
      cache?.lookupResult({ ...request, serviceId: 'googlechat' }),
    ).toEqual({ text: '您好', usedEngine: 'MyMemory' });

    cache?.save(request, 'legacy translation');
    cache?.clearService('whatsapp');
    expect(cache?.lookup({ ...request, serviceId: 'whatsapp' })).toBeNull();
    expect(cache?.lookup(request)).toBeNull();
    expect(cache?.lookup({ ...request, serviceId: 'googlechat' })).toBe('您好');
  });

  it('expires conversation text after seven days, including after reload', () => {
    const cacheFilePath = join(tempDir, 'cache.json');
    const now = Date.now();
    const nowSpy = jest.spyOn(Date, 'now');
    const request = {
      serviceId: 'whatsapp',
      sourceText: 'private message',
      fromLanguage: 'en',
      toLanguage: 'zh',
      engine: 'Google',
    };
    try {
      nowSpy.mockReturnValue(now);
      getTranslationCache(cacheFilePath)?.save(request, '私人消息');
      nowSpy.mockReturnValue(now + TRANSLATION_CACHE_RETENTION_MS + 1);
      clearTranslationCacheInstancesForTests();
      expect(getTranslationCache(cacheFilePath)?.lookup(request)).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('prunes least-recently-updated entries when max size is reached', async () => {
    const cacheFilePath = join(tempDir, 'translation-cache.json');
    const cache = getTranslationCache(cacheFilePath, 2);

    cache?.save(
      {
        sourceText: 'text-1',
        fromLanguage: 'en',
        toLanguage: 'fr',
        engine: 'Baidu',
      },
      'result-1',
    );
    await wait(2);
    cache?.save(
      {
        sourceText: 'text-2',
        fromLanguage: 'en',
        toLanguage: 'fr',
        engine: 'Baidu',
      },
      'result-2',
    );
    await wait(2);
    cache?.save(
      {
        sourceText: 'text-3',
        fromLanguage: 'en',
        toLanguage: 'fr',
        engine: 'Baidu',
      },
      'result-3',
    );

    expect(
      cache?.lookup({
        sourceText: 'text-1',
        fromLanguage: 'en',
        toLanguage: 'fr',
        engine: 'Baidu',
      }),
    ).toBeNull();
    expect(
      cache?.lookup({
        sourceText: 'text-2',
        fromLanguage: 'en',
        toLanguage: 'fr',
        engine: 'Baidu',
      }),
    ).toBe('result-2');
    expect(
      cache?.lookup({
        sourceText: 'text-3',
        fromLanguage: 'en',
        toLanguage: 'fr',
        engine: 'Baidu',
      }),
    ).toBe('result-3');
  });

  it('can lookup original text by translated text for history preview', () => {
    const cacheFilePath = join(tempDir, 'translation-cache.json');
    const cache = getTranslationCache(cacheFilePath, 100);

    cache?.save(
      {
        sourceText: 'what is your name',
        fromLanguage: 'zh',
        toLanguage: 'en',
        engine: 'Baidu',
      },
      'How are you',
    );

    const original = cache?.lookupOriginalByTranslatedText({
      translatedText: 'How are you',
      toLanguage: 'en',
      engine: 'Baidu',
    });

    expect(original).toBe('what is your name');
  });

  it('returns null when no reverse match is found', () => {
    const cacheFilePath = join(tempDir, 'translation-cache.json');
    const cache = getTranslationCache(cacheFilePath, 100);

    cache?.save(
      {
        sourceText: 'hello',
        fromLanguage: 'zh',
        toLanguage: 'en',
        engine: 'Baidu',
      },
      'hello',
    );

    const original = cache?.lookupOriginalByTranslatedText({
      translatedText: 'hello',
      toLanguage: 'fr',
      engine: 'Baidu',
    });

    expect(original).toBeNull();
  });

  it('can reverse-lookup across target-language switch when toLanguage is omitted', () => {
    const cacheFilePath = join(tempDir, 'translation-cache.json');
    const cache = getTranslationCache(cacheFilePath, 100);

    cache?.save(
      {
        sourceText: 'today is very hot',
        fromLanguage: 'zh',
        toLanguage: 'fr',
        engine: 'Baidu',
      },
      "Il fait tres chaud aujourd'hui",
    );

    const exactMiss = cache?.lookupOriginalByTranslatedText({
      translatedText: "Il fait tres chaud aujourd'hui",
      toLanguage: 'es',
      engine: 'Baidu',
    });
    expect(exactMiss).toBeNull();

    const fallbackHit = cache?.lookupOriginalByTranslatedText({
      translatedText: "Il fait tres chaud aujourd'hui",
      toLanguage: '',
      engine: 'Baidu',
    });
    expect(fallbackHit).toBe('today is very hot');
  });
});
