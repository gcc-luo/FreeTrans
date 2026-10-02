jest.mock('@electron/remote', () => ({ webContents: {} }));
jest.mock('electron', () => ({ ipcRenderer: {} }));
jest.mock('../../src/api/apiBase', () => ({ needsToken: jest.fn() }));
jest.mock('../../src/config', () => ({
  DEFAULT_SERVICE_ORDER: 0,
  DEFAULT_SERVICE_SETTINGS: {},
}));
jest.mock('../../src/environment', () => ({ isMac: false }));
jest.mock('../../src/features/todos', () => ({ todosStore: {} }));
jest.mock('../../src/helpers/favicon-helpers', () => ({
  getFaviconUrl: jest.fn(),
}));
jest.mock('../../src/helpers/url-helpers', () => ({
  isValidExternalURL: jest.fn(),
  normalizedUrl: jest.fn(),
}));
jest.mock('../../src/jsUtils', () => ({ ifUndefined: jest.fn() }));
jest.mock('../../src/models/UserAgent', () => jest.fn());

const Service = require('../../src/models/Service').default;

describe('Service load state', () => {
  it('marks the service as errored when its main frame fails to load', () => {
    const service = Object.create(Service.prototype) as Service;
    service.isError = false;
    service.errorMessage = '';
    service.isLoading = true;
    service.isLoadingPage = true;

    service._didFailLoad({ errorDescription: 'ERR_CONNECTION_FAILED' });

    expect(service.isError).toBe(true);
    expect(service.errorMessage).toBe('ERR_CONNECTION_FAILED');
    expect(service.isLoading).toBe(false);
    expect(service.isLoadingPage).toBe(false);
  });
});
