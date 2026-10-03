import {
  createAliyunSignature,
  translateWithAliyun,
  translateWithGoogleCloud,
  translateWithYoudao,
} from '../../src/helpers/translation-provider-apis';

describe('configured translation providers', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('matches the Aliyun signing example from the official documentation', () => {
    expect(
      createAliyunSignature(
        {
          AccessKeyId: 'testid',
          Action: 'DescribeDedicatedHosts',
          Format: 'JSON',
          RegionId: 'cn-beijing',
          SignatureMethod: 'HMAC-SHA1',
          SignatureNonce: 'edb2b34af0af9a6d14deaf7c1a5315eb',
          SignatureVersion: '1.0',
          Timestamp: '2023-03-13T08:34:30Z',
          Version: '2014-05-26',
        },
        'testsecret',
        'GET',
      ),
    ).toBe('9NaGiOspFP5UPcwX8Iwt2YJXXuk=');
  });

  it('sends Google Cloud API key in a header', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { translations: [{ translatedText: '你好' }] },
      }),
    });
    global.fetch = fetchMock;

    await expect(
      translateWithGoogleCloud('Hello', 'en', 'zh', 'google-secret'),
    ).resolves.toBe('你好');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://translation.googleapis.com/language/translate/v2',
    );
    expect(fetchMock.mock.calls[0][1].headers['x-goog-api-key']).toBe(
      'google-secret',
    );
    expect(fetchMock.mock.calls[0][1].body).not.toContain('google-secret');
  });

  it('signs a Youdao text request and maps Chinese language codes', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ errorCode: '0', translation: ['早上好'] }),
    });
    global.fetch = fetchMock;

    await expect(
      translateWithYoudao('Good morning', 'en', 'zh', {
        appKey: 'youdao-id',
        appSecret: 'youdao-secret',
      }),
    ).resolves.toBe('早上好');
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toBe('https://openapi.youdao.com/api');
    expect(body.get('to')).toBe('zh-CHS');
    expect(body.get('signType')).toBe('v3');
    expect(body.get('sign')).toMatch(/^[\da-f]{64}$/);
    expect(fetchMock.mock.calls[0][1].body).not.toContain('youdao-secret');
  });

  it('sends a signed Aliyun TranslateGeneral request', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Code: 200, Data: { Translated: '你好' } }),
    });
    global.fetch = fetchMock;

    await expect(
      translateWithAliyun('Hello', 'en', 'zh', {
        accessKeyId: 'ali-id',
        accessKeySecret: 'ali-secret',
      }),
    ).resolves.toBe('你好');
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://mt.cn-hangzhou.aliyuncs.com/',
    );
    expect(body.get('Action')).toBe('TranslateGeneral');
    expect(body.get('Version')).toBe('2018-10-12');
    expect(body.get('TargetLanguage')).toBe('zh');
    expect(body.get('Signature')).toBeTruthy();
    expect(fetchMock.mock.calls[0][1].body).not.toContain('ali-secret');
  });
});
