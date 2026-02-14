import { translateTo } from '../../src/helpers/translation-helpers';

const originalFetch = global.fetch;

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

describe('translation-helpers language normalization', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('normalizes regional russian source language for Google requests', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([[['Hello']]]));

    const result = await translateTo('Privet', 'en', 'Google', {
      fromLanguage: 'ru-RU',
    });

    expect(result.error).toBe(false);
    expect(result.text).toBe('Hello');
    const requestUrl = String(fetchMock.mock.calls[0][0] || '');
    expect(requestUrl).toContain('sl=ru');
    expect(requestUrl).toContain('tl=en');
  });

  it('normalizes language name aliases for Google requests', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([[['Hello']]]));

    const result = await translateTo('Privet', 'en', 'Google', {
      fromLanguage: 'russian',
    });

    expect(result.error).toBe(false);
    expect(result.text).toBe('Hello');
    const requestUrl = String(fetchMock.mock.calls[0][0] || '');
    expect(requestUrl).toContain('sl=ru');
  });

  it('keeps MyMemory source language as auto when fromLanguage=auto', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        responseData: {
          translatedText: 'hello',
        },
      }),
    );

    const result = await translateTo('bonjour', 'en', 'Google', {
      fromLanguage: 'auto',
    });

    expect(result.error).toBe(false);
    expect(result.text).toBe('hello');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const myMemoryUrl = String(fetchMock.mock.calls[2][0] || '');
    expect(decodeURIComponent(myMemoryUrl)).toContain('langpair=auto|en-US');
  });
});
