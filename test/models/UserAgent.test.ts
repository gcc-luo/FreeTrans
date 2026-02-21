import UserAgent from '../../src/models/UserAgent';

const createMockWebview = () =>
  ({
    userAgent: '',
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }) as any;

describe('UserAgent model', () => {
  beforeEach(() => {
    (global as any).window = {
      ferdium: {
        stores: {
          settings: {
            all: {
              app: {
                userAgentPref:
                  'Mozilla/5.0 Chrome/123.0.6312.122 Safari/537.36',
              },
            },
          },
        },
      },
    };
  });

  it('keeps full Chrome-version UA for Google accounts pages', () => {
    const model = new UserAgent();
    const webview = createMockWebview();
    model.setWebviewReference(webview);

    model._handleNavigate(
      'https://accounts.google.com/v3/signin/challenge/pwd',
    );

    expect(webview.userAgent).toBe(
      'Mozilla/5.0 Chrome/123.0.6312.122 Safari/537.36',
    );
    expect(webview.userAgent).toContain('Chrome/123.0.6312.122');
  });

  it('keeps full Chrome-version UA for non-Google pages', () => {
    const model = new UserAgent();
    const webview = createMockWebview();
    model.setWebviewReference(webview);

    model._handleNavigate('https://chat.google.com/');

    expect(webview.userAgent).toBe(
      'Mozilla/5.0 Chrome/123.0.6312.122 Safari/537.36',
    );
  });

  it('uses service-level UA preference when provided', () => {
    const model = new UserAgent();
    const webview = createMockWebview();
    model.setWebviewReference(webview);
    model.userAgentPref = 'Custom-UA/1.0';

    model._handleNavigate('https://accounts.google.com/');

    expect(webview.userAgent).toBe('Custom-UA/1.0');
  });
});
