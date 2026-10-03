import { chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { safeStorage } from 'electron';
import {
  ensureDirSync,
  pathExistsSync,
  readJsonSync,
  removeSync,
  writeJsonSync,
} from 'fs-extra';
import { userDataPath } from '../environment-remote';

interface EncryptedCredentials {
  version: 1;
  appId: string;
  secretKey: string;
}

export interface BaiduCredentials {
  appId: string;
  secretKey: string;
}

export type ConfigurableTranslationEngine =
  | 'Google'
  | 'Baidu'
  | 'Youdao'
  | 'Aliyun';

const providerFields: Record<ConfigurableTranslationEngine, string[]> = {
  Google: ['apiKey'],
  Baidu: ['appId', 'secretKey'],
  Youdao: ['appKey', 'appSecret'],
  Aliyun: ['accessKeyId', 'accessKeySecret'],
};

const providerEnvironment: Record<
  ConfigurableTranslationEngine,
  Record<string, string>
> = {
  Google: { apiKey: 'GOOGLE_TRANSLATE_API_KEY' },
  Baidu: {},
  Youdao: {
    appKey: 'YOUDAO_TRANSLATE_APP_KEY',
    appSecret: 'YOUDAO_TRANSLATE_APP_SECRET',
  },
  Aliyun: {
    accessKeyId: 'ALIYUN_TRANSLATE_ACCESS_KEY_ID',
    accessKeySecret: 'ALIYUN_TRANSLATE_ACCESS_KEY_SECRET',
  },
};

const defaultFilePath = () =>
  userDataPath('config', 'translation-provider-credentials-v1.json');

export const canStoreTranslationCredentials = () =>
  safeStorage.isEncryptionAvailable() &&
  (process.platform !== 'linux' ||
    safeStorage.getSelectedStorageBackend() !== 'basic_text');

export const getSavedBaiduCredentials = (
  filePath = defaultFilePath(),
): BaiduCredentials | null => {
  if (!canStoreTranslationCredentials() || !pathExistsSync(filePath))
    return null;
  try {
    if (process.platform !== 'win32') chmodSync(filePath, 0o600);
    const payload = readJsonSync(filePath, {
      throws: false,
    }) as EncryptedCredentials | null;
    if (payload?.version !== 1 || !payload.appId || !payload.secretKey) {
      return null;
    }
    const appId = safeStorage.decryptString(
      Buffer.from(payload.appId, 'base64'),
    );
    const secretKey = safeStorage.decryptString(
      Buffer.from(payload.secretKey, 'base64'),
    );
    return appId && secretKey ? { appId, secretKey } : null;
  } catch {
    return null;
  }
};

export const getBaiduCredentials = (
  filePath = defaultFilePath(),
): BaiduCredentials | null => {
  const saved = getSavedBaiduCredentials(filePath);
  if (saved) return saved;
  const appId = String(
    process.env.BAIDU_TRANSLATE_APP_ID || process.env.BAIDU_APP_ID || '',
  ).trim();
  const secretKey = String(
    process.env.BAIDU_TRANSLATE_SECRET_KEY ||
      process.env.BAIDU_SECRET_KEY ||
      '',
  ).trim();
  return appId && secretKey ? { appId, secretKey } : null;
};

export const getBaiduCredentialStatus = (filePath = defaultFilePath()) => ({
  configured: Boolean(getBaiduCredentials(filePath)),
  canSave: canStoreTranslationCredentials(),
  saved: Boolean(getSavedBaiduCredentials(filePath)),
});

export const saveBaiduCredentials = (
  appIdInput: string,
  secretKeyInput: string,
  filePath = defaultFilePath(),
) => {
  const appId = String(appIdInput || '').trim();
  const secretKey = String(secretKeyInput || '').trim();
  if (!appId || !secretKey)
    throw new Error('Both Baidu credentials are required');
  if (!canStoreTranslationCredentials()) {
    throw new Error('Secure credential storage is unavailable');
  }
  const payload: EncryptedCredentials = {
    version: 1,
    appId: safeStorage.encryptString(appId).toString('base64'),
    secretKey: safeStorage.encryptString(secretKey).toString('base64'),
  };
  ensureDirSync(dirname(filePath));
  writeJsonSync(filePath, payload, { spaces: 2, mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(filePath, 0o600);
};

export const clearSavedBaiduCredentials = (filePath = defaultFilePath()) => {
  removeSync(filePath);
};

const providerFilePath = (engine: ConfigurableTranslationEngine) =>
  userDataPath(
    'config',
    `translation-credentials-${engine.toLowerCase()}-v1.json`,
  );

const getSavedProviderCredentials = (
  engine: ConfigurableTranslationEngine,
  filePath: string,
): Record<string, string> | null => {
  if (!canStoreTranslationCredentials() || !pathExistsSync(filePath))
    return null;
  try {
    if (process.platform !== 'win32') chmodSync(filePath, 0o600);
    const payload = readJsonSync(filePath, { throws: false }) as Record<
      string,
      string | number
    > | null;
    if (payload?.version !== 1) return null;
    const result: Record<string, string> = {};
    for (const field of providerFields[engine]) {
      const encrypted = payload[field];
      if (typeof encrypted !== 'string' || !encrypted) return null;
      result[field] = safeStorage.decryptString(
        Buffer.from(encrypted, 'base64'),
      );
      if (!result[field]) return null;
    }
    return result;
  } catch {
    return null;
  }
};

export const getProviderCredentials = (
  engine: ConfigurableTranslationEngine,
  filePath?: string,
): Record<string, string> | null => {
  if (!Object.hasOwn(providerFields, engine)) return null;
  const resolvedPath =
    filePath ||
    (engine === 'Baidu' ? defaultFilePath() : providerFilePath(engine));
  if (engine === 'Baidu') {
    const baidu = getBaiduCredentials(resolvedPath);
    return baidu ? { appId: baidu.appId, secretKey: baidu.secretKey } : null;
  }
  const saved = getSavedProviderCredentials(engine, resolvedPath);
  if (saved) return saved;
  const environment = Object.entries(providerEnvironment[engine]).map(
    ([field, variable]) => [field, String(process.env[variable] || '').trim()],
  );
  return environment.every(([, value]) => value)
    ? Object.fromEntries(environment)
    : null;
};

export const getProviderCredentialStatus = (
  engine: ConfigurableTranslationEngine,
) => {
  if (!Object.hasOwn(providerFields, engine))
    throw new Error('Unknown provider');
  if (engine === 'Baidu') return getBaiduCredentialStatus();
  return {
    configured: Boolean(getProviderCredentials(engine)),
    canSave: canStoreTranslationCredentials(),
    saved: Boolean(
      getSavedProviderCredentials(engine, providerFilePath(engine)),
    ),
  };
};

export const saveProviderCredentials = (
  engine: ConfigurableTranslationEngine,
  values: Record<string, string>,
  filePath?: string,
) => {
  if (!Object.hasOwn(providerFields, engine))
    throw new Error('Unknown provider');
  const resolvedPath =
    filePath ||
    (engine === 'Baidu' ? defaultFilePath() : providerFilePath(engine));
  if (engine === 'Baidu') {
    saveBaiduCredentials(values.appId, values.secretKey, resolvedPath);
    return;
  }
  if (!canStoreTranslationCredentials()) {
    throw new Error('Secure credential storage is unavailable');
  }
  const payload: Record<string, string | number> = { version: 1 };
  for (const field of providerFields[engine]) {
    const value = String(values[field] || '').trim();
    if (!value) throw new Error('All provider credentials are required');
    payload[field] = safeStorage.encryptString(value).toString('base64');
  }
  ensureDirSync(dirname(resolvedPath));
  writeJsonSync(resolvedPath, payload, { spaces: 2, mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(resolvedPath, 0o600);
};

export const clearProviderCredentials = (
  engine: ConfigurableTranslationEngine,
  filePath?: string,
) => {
  if (!Object.hasOwn(providerFields, engine))
    throw new Error('Unknown provider');
  removeSync(
    filePath ||
      (engine === 'Baidu' ? defaultFilePath() : providerFilePath(engine)),
  );
};
