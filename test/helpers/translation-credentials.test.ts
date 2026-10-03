/* eslint-disable global-require */
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeSync } from 'fs-extra';

jest.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: jest.fn(() => true),
    getSelectedStorageBackend: jest.fn(() => 'keychain'),
    encryptString: jest.fn((value: string) =>
      Buffer.from(`encrypted:${value}`),
    ),
    decryptString: jest.fn((value: Buffer) =>
      value.toString().replace(/^encrypted:/, ''),
    ),
  },
}));

jest.mock('../../src/environment-remote', () => ({
  userDataPath: jest.fn(),
}));

const { safeStorage } = require('electron') as typeof import('electron');

const isEncryptionAvailable = jest.mocked(safeStorage.isEncryptionAvailable);

let credentials: typeof import('../../src/helpers/translation-credentials');

describe('translation credentials', () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(() => {
    credentials =
      require('../../src/helpers/translation-credentials') as typeof import('../../src/helpers/translation-credentials');
    tempDir = mkdtempSync(join(tmpdir(), 'freetrans-credentials-'));
    filePath = join(tempDir, 'config', 'credentials.json');
    isEncryptionAvailable.mockReturnValue(true);
  });

  afterEach(() => removeSync(tempDir));

  it('encrypts both Baidu fields and reads them back', () => {
    credentials.saveBaiduCredentials('test-app-id', 'test-secret', filePath);

    const persisted = readFileSync(filePath, 'utf8');
    expect(persisted).not.toContain('test-app-id');
    expect(persisted).not.toContain('test-secret');
    expect(credentials.getSavedBaiduCredentials(filePath)).toEqual({
      appId: 'test-app-id',
      secretKey: 'test-secret',
    });
    expect(credentials.getBaiduCredentialStatus(filePath)).toEqual({
      configured: true,
      canSave: true,
      saved: true,
    });
    expect(
      process.platform === 'win32' ||
        statSync(filePath).mode % 0o1000 === 0o600,
    ).toBe(true);
  });

  it('removes saved credentials', () => {
    credentials.saveBaiduCredentials('app', 'secret', filePath);
    credentials.clearSavedBaiduCredentials(filePath);
    expect(existsSync(filePath)).toBe(false);
    expect(credentials.getSavedBaiduCredentials(filePath)).toBeNull();
  });

  it('refuses to save when system encryption is unavailable', () => {
    isEncryptionAvailable.mockReturnValue(false);
    expect(() =>
      credentials.saveBaiduCredentials('app', 'secret', filePath),
    ).toThrow('Secure credential storage is unavailable');
    expect(existsSync(filePath)).toBe(false);
  });

  it.each([
    ['Google', { apiKey: 'google-key' }],
    ['Youdao', { appKey: 'youdao-id', appSecret: 'youdao-secret' }],
    ['Aliyun', { accessKeyId: 'ali-id', accessKeySecret: 'ali-secret' }],
  ] as const)('stores %s credentials encrypted', (engine, values) => {
    credentials.saveProviderCredentials(engine, values, filePath);
    const persisted = readFileSync(filePath, 'utf8');
    for (const value of Object.values(values)) {
      expect(persisted).not.toContain(value);
    }
    expect(credentials.getProviderCredentials(engine, filePath)).toEqual(
      values,
    );
    credentials.clearProviderCredentials(engine, filePath);
    expect(existsSync(filePath)).toBe(false);
  });
});
