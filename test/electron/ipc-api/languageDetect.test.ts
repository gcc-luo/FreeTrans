const handleMock = jest.fn();
const detectMock = jest.fn();
const setLanguageTypeMock = jest.fn();

jest.mock('electron', () => ({
  ipcMain: {
    handle: (...args: [string, (...innerArgs: any[]) => any]) =>
      handleMock(...args),
  },
}));

jest.mock('languagedetect', () =>
  jest.fn().mockImplementation(() => ({
    setLanguageType: (...args: [string]) => setLanguageTypeMock(...args),
    detect: (...args: [string, number]) => detectMock(...args),
  })),
);

const setupLanguageDetect =
  require('../../../src/electron/ipc-api/languageDetect').default;

const setupHandler = async () => {
  await setupLanguageDetect();
  expect(handleMock).toHaveBeenCalledTimes(1);
  const [channel, handler] = handleMock.mock.calls[0];
  expect(channel).toBe('detect-language');
  expect(typeof handler).toBe('function');
  return handler as (
    _event: unknown,
    payload: { sample?: string },
  ) => Promise<string>;
};

describe('ipc-api/languageDetect', () => {
  beforeEach(() => {
    handleMock.mockReset();
    detectMock.mockReset();
    setLanguageTypeMock.mockReset();
  });

  it('returns detected language code when detector has result', async () => {
    detectMock.mockReturnValue([['en', 0.99]]);
    const handler = await setupHandler();

    const result = await handler({}, { sample: 'good morning' });

    expect(result).toBe('en');
    expect(setLanguageTypeMock).toHaveBeenCalledWith('iso2');
    expect(detectMock).toHaveBeenCalledWith('good morning', 1);
  });

  it('returns empty string when detector returns empty result', async () => {
    detectMock.mockReturnValue([]);
    const handler = await setupHandler();

    const result = await handler({}, { sample: 'good' });

    expect(result).toBe('');
  });

  it('returns empty string when payload sample is empty', async () => {
    detectMock.mockReturnValue([['en', 0.99]]);
    const handler = await setupHandler();

    const result = await handler({}, {});

    expect(result).toBe('');
    expect(detectMock).not.toHaveBeenCalled();
  });

  it('returns empty string when detector throws', async () => {
    detectMock.mockImplementation(() => {
      throw new Error('detector-failed');
    });
    const handler = await setupHandler();

    const result = await handler({}, { sample: 'hello' });

    expect(result).toBe('');
  });
});
