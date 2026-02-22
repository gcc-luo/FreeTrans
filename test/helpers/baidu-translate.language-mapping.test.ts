import { translateWithBaidu } from '../../src/helpers/baidu-translate';

const originalFetch = global.fetch;

const successPayload = {
  trans_result: [
    {
      src: 'source',
      dst: 'target',
    },
  ],
};

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

describe('baidu-translate language mapping', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('maps ru-RU source and en-US target to Baidu language codes', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(successPayload));

    const result = await translateWithBaidu('Privet', 'ru-RU', 'en-US', {
      appId: 'test-app-id',
      secretKey: 'test-secret',
    });

    expect(result.error).toBe(false);
    const requestInit = fetchMock.mock.calls[0][1] || {};
    const body = decodeURIComponent(String(requestInit.body || ''));
    expect(body).toContain('from=ru');
    expect(body).toContain('to=en');
  });

  it('maps zh-Hant source and zh_CN target variants correctly', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(successPayload));
    fetchMock.mockResolvedValueOnce(jsonResponse(successPayload));

    await translateWithBaidu('ni hao', 'zh-Hant', 'en', {
      appId: 'test-app-id',
      secretKey: 'test-secret',
    });
    await translateWithBaidu('hello', 'en', 'zh_CN', {
      appId: 'test-app-id',
      secretKey: 'test-secret',
    });

    const firstBody = decodeURIComponent(
      String(fetchMock.mock.calls[0]?.[1]?.body || ''),
    );
    const secondBody = decodeURIComponent(
      String(fetchMock.mock.calls[1]?.[1]?.body || ''),
    );

    expect(firstBody).toContain('from=cht');
    expect(firstBody).toContain('to=en');
    expect(secondBody).toContain('from=en');
    expect(secondBody).toContain('to=zh');
  });

  it('falls back unsupported source language to auto for Baidu', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(successPayload));

    const result = await translateWithBaidu('good', 'hr', 'zh', {
      appId: 'test-app-id',
      secretKey: 'test-secret',
    });

    expect(result.error).toBe(false);
    const requestInit = fetchMock.mock.calls[0][1] || {};
    const body = decodeURIComponent(String(requestInit.body || ''));
    expect(body).toContain('from=auto');
    expect(body).toContain('to=zh');
  });

  it('supports all common Baidu language codes (source and target mappings)', async () => {
    const cases: {
      input: string;
      expectedSource: string;
      expectedTarget: string;
    }[] = [
      { input: 'zh', expectedSource: 'zh', expectedTarget: 'zh' },
      { input: 'en', expectedSource: 'en', expectedTarget: 'en' },
      { input: 'yue', expectedSource: 'yue', expectedTarget: 'yue' },
      { input: 'wyw', expectedSource: 'wyw', expectedTarget: 'wyw' },
      { input: 'jp', expectedSource: 'jp', expectedTarget: 'jp' },
      { input: 'ja', expectedSource: 'jp', expectedTarget: 'jp' },
      { input: 'kor', expectedSource: 'kor', expectedTarget: 'kor' },
      { input: 'ko', expectedSource: 'kor', expectedTarget: 'kor' },
      { input: 'fra', expectedSource: 'fra', expectedTarget: 'fra' },
      { input: 'fr', expectedSource: 'fra', expectedTarget: 'fra' },
      { input: 'spa', expectedSource: 'spa', expectedTarget: 'spa' },
      { input: 'es', expectedSource: 'spa', expectedTarget: 'spa' },
      { input: 'th', expectedSource: 'th', expectedTarget: 'th' },
      { input: 'ara', expectedSource: 'ara', expectedTarget: 'ara' },
      { input: 'ar', expectedSource: 'ara', expectedTarget: 'ara' },
      { input: 'ru', expectedSource: 'ru', expectedTarget: 'ru' },
      { input: 'pt', expectedSource: 'pt', expectedTarget: 'pt' },
      { input: 'de', expectedSource: 'de', expectedTarget: 'de' },
      { input: 'it', expectedSource: 'it', expectedTarget: 'it' },
      { input: 'el', expectedSource: 'el', expectedTarget: 'el' },
      { input: 'nl', expectedSource: 'nl', expectedTarget: 'nl' },
      { input: 'pl', expectedSource: 'pl', expectedTarget: 'pl' },
      { input: 'bul', expectedSource: 'bul', expectedTarget: 'bul' },
      { input: 'bg', expectedSource: 'bul', expectedTarget: 'bul' },
      { input: 'est', expectedSource: 'est', expectedTarget: 'est' },
      { input: 'et', expectedSource: 'est', expectedTarget: 'est' },
      { input: 'dan', expectedSource: 'dan', expectedTarget: 'dan' },
      { input: 'da', expectedSource: 'dan', expectedTarget: 'dan' },
      { input: 'fin', expectedSource: 'fin', expectedTarget: 'fin' },
      { input: 'fi', expectedSource: 'fin', expectedTarget: 'fin' },
      { input: 'cs', expectedSource: 'cs', expectedTarget: 'cs' },
      { input: 'rom', expectedSource: 'rom', expectedTarget: 'rom' },
      { input: 'ro', expectedSource: 'rom', expectedTarget: 'rom' },
      { input: 'slo', expectedSource: 'slo', expectedTarget: 'slo' },
      { input: 'sl', expectedSource: 'slo', expectedTarget: 'slo' },
      { input: 'swe', expectedSource: 'swe', expectedTarget: 'swe' },
      { input: 'sv', expectedSource: 'swe', expectedTarget: 'swe' },
      { input: 'hu', expectedSource: 'hu', expectedTarget: 'hu' },
      { input: 'cht', expectedSource: 'cht', expectedTarget: 'cht' },
      { input: 'zh-TW', expectedSource: 'cht', expectedTarget: 'cht' },
      { input: 'vie', expectedSource: 'vie', expectedTarget: 'vie' },
      { input: 'vi', expectedSource: 'vie', expectedTarget: 'vie' },
      { input: 'id', expectedSource: 'id', expectedTarget: 'id' },
      { input: 'hi', expectedSource: 'hi', expectedTarget: 'hi' },
    ];

    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(successPayload)),
    );

    for (const item of cases) {
      // eslint-disable-next-line no-await-in-loop
      const sourceResult = await translateWithBaidu(
        'source-text',
        item.input,
        'en',
        {
          appId: 'test-app-id',
          secretKey: 'test-secret',
        },
      );
      expect(sourceResult.error).toBe(false);

      const sourceBody = decodeURIComponent(
        String(fetchMock.mock.calls.at(-1)?.[1]?.body || ''),
      );
      expect(sourceBody).toContain(`from=${item.expectedSource}`);
      expect(sourceBody).toContain('to=en');

      // eslint-disable-next-line no-await-in-loop
      const targetResult = await translateWithBaidu(
        'target-text',
        'en',
        item.input,
        {
          appId: 'test-app-id',
          secretKey: 'test-secret',
        },
      );
      expect(targetResult.error).toBe(false);

      const targetBody = decodeURIComponent(
        String(fetchMock.mock.calls.at(-1)?.[1]?.body || ''),
      );
      expect(targetBody).toContain('from=en');
      expect(targetBody).toContain(`to=${item.expectedTarget}`);
    }
  });
});
