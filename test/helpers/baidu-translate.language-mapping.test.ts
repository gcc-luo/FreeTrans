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
});
