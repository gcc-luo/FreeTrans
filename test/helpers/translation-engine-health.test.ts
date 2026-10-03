import {
  checkTranslationEngine,
  getTranslationDirections,
} from '../../src/helpers/translation-engine-health';
import type { translateTo } from '../../src/helpers/translation-helpers';

describe('translation engine health', () => {
  it('checks both enabled chat directions using the selected languages', async () => {
    const translate = jest.fn().mockResolvedValue({
      text: 'translated',
      error: false,
    });
    const directions = getTranslationDirections({
      myLanguage: 'zh',
      targetLanguage: 'en',
      sendTranslation: true,
      receiveTranslation: true,
    });

    const result = await checkTranslationEngine(
      'Baidu',
      directions,
      { appId: 'id', secretKey: 'secret' },
      translate as typeof translateTo,
    );

    expect(result).toEqual({ engine: 'Baidu', available: true });
    expect(translate).toHaveBeenNthCalledWith(
      1,
      '你好',
      'en',
      'Baidu',
      expect.objectContaining({ fromLanguage: 'zh', allowFallback: false }),
    );
    expect(translate).toHaveBeenNthCalledWith(
      2,
      'Hello',
      'zh',
      'Baidu',
      expect.objectContaining({ fromLanguage: 'en', allowFallback: false }),
    );
  });

  it('does not advertise an unconfigured domestic engine', async () => {
    const translate = jest.fn();
    const status = await checkTranslationEngine(
      'Youdao',
      [{ fromLanguage: 'zh', toLanguage: 'en' }],
      null,
      translate as typeof translateTo,
    );
    expect(status).toEqual({
      engine: 'Youdao',
      available: false,
      reason: 'missing-credentials',
    });
    expect(translate).not.toHaveBeenCalled();
  });

  it('uses a different source language when outgoing source is automatic', () => {
    expect(
      getTranslationDirections({
        myLanguage: 'auto',
        targetLanguage: 'en',
        sendTranslation: true,
        receiveTranslation: false,
      }),
    ).toEqual([{ fromLanguage: 'zh', toLanguage: 'en' }]);
  });

  it('marks a failed direction unavailable even if the other direction works', async () => {
    const translate = jest
      .fn()
      .mockResolvedValueOnce({ text: 'Hello', error: false })
      .mockResolvedValueOnce({ text: '', error: true });
    const status = await checkTranslationEngine(
      'Google',
      [
        { fromLanguage: 'zh', toLanguage: 'en' },
        { fromLanguage: 'en', toLanguage: 'zh' },
      ],
      null,
      translate as typeof translateTo,
    );
    expect(status).toEqual({
      engine: 'Google',
      available: false,
      reason: 'translation-failed',
    });
  });
});
