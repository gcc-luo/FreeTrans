import { ipcRenderer } from 'electron';
import { type FormEvent, useEffect, useState } from 'react';
import {
  type WrappedComponentProps,
  defineMessages,
  injectIntl,
} from 'react-intl';

const messages = defineMessages({
  title: {
    id: 'settings.translator.providers.title',
    defaultMessage: '翻译引擎',
  },
  description: {
    id: 'settings.translator.providers.description',
    defaultMessage:
      '按需配置翻译服务。凭据加密保存在本机；可用性检测会发送短文本，可能产生服务商费用。',
  },
  google: {
    id: 'settings.translator.providers.google',
    defaultMessage: '谷歌翻译',
  },
  baidu: {
    id: 'settings.translator.providers.baidu',
    defaultMessage: '百度翻译',
  },
  youdao: {
    id: 'settings.translator.providers.youdao',
    defaultMessage: '网易有道翻译',
  },
  aliyun: {
    id: 'settings.translator.providers.aliyun',
    defaultMessage: '阿里云机器翻译',
  },
  googleHint: {
    id: 'settings.translator.providers.googleHint',
    defaultMessage:
      '无需配置即可使用现有连接；填写 Cloud Translation API Key 后使用官方接口。',
  },
  baiduHint: {
    id: 'settings.translator.providers.baiduHint',
    defaultMessage: '填写百度翻译开放平台的 APP ID 和密钥。',
  },
  youdaoHint: {
    id: 'settings.translator.providers.youdaoHint',
    defaultMessage: '填写有道智云文本翻译服务的应用 ID 和应用密钥。',
  },
  aliyunHint: {
    id: 'settings.translator.providers.aliyunHint',
    defaultMessage: '填写已开通机器翻译服务的阿里云 AccessKey。',
  },
  apiKey: {
    id: 'settings.translator.providers.apiKey',
    defaultMessage: 'API Key',
  },
  appId: {
    id: 'settings.translator.providers.appId',
    defaultMessage: 'APP ID',
  },
  secretKey: {
    id: 'settings.translator.providers.secretKey',
    defaultMessage: '密钥',
  },
  appKey: {
    id: 'settings.translator.providers.appKey',
    defaultMessage: '应用 ID',
  },
  appSecret: {
    id: 'settings.translator.providers.appSecret',
    defaultMessage: '应用密钥',
  },
  accessKeyId: {
    id: 'settings.translator.providers.accessKeyId',
    defaultMessage: 'AccessKey ID',
  },
  accessKeySecret: {
    id: 'settings.translator.providers.accessKeySecret',
    defaultMessage: 'AccessKey Secret',
  },
  ready: {
    id: 'settings.translator.providers.ready',
    defaultMessage: '已保存',
  },
  environment: {
    id: 'settings.translator.providers.environment',
    defaultMessage: '环境变量',
  },
  unconfigured: {
    id: 'settings.translator.providers.unconfigured',
    defaultMessage: '待配置',
  },
  optional: {
    id: 'settings.translator.providers.optional',
    defaultMessage: '无需配置',
  },
  save: {
    id: 'settings.translator.providers.save',
    defaultMessage: '保存并检测',
  },
  clear: {
    id: 'settings.translator.providers.clear',
    defaultMessage: '移除凭据',
  },
  verified: {
    id: 'settings.translator.providers.verified',
    defaultMessage: '检测通过，可以使用。',
  },
  failed: {
    id: 'settings.translator.providers.failed',
    defaultMessage: '已保存，但检测未通过。请检查凭据、额度和网络。',
  },
  saveFailed: {
    id: 'settings.translator.providers.saveFailed',
    defaultMessage: '保存失败，请重试。',
  },
  clearFailed: {
    id: 'settings.translator.providers.clearFailed',
    defaultMessage: '移除失败，请重试。',
  },
  storageUnavailable: {
    id: 'settings.translator.providers.storageUnavailable',
    defaultMessage: '系统安全存储不可用，可通过环境变量配置。',
  },
  replaceHint: {
    id: 'settings.translator.providers.replaceHint',
    defaultMessage: '如需更换，填写新凭据后再次保存。',
  },
});

type Engine = 'Google' | 'Baidu' | 'Youdao' | 'Aliyun';
type Message = (typeof messages)[keyof typeof messages];

const providers: {
  engine: Engine;
  name: Message;
  hint: Message;
  fields: { key: string; label: Message }[];
}[] = [
  {
    engine: 'Google',
    name: messages.google,
    hint: messages.googleHint,
    fields: [{ key: 'apiKey', label: messages.apiKey }],
  },
  {
    engine: 'Baidu',
    name: messages.baidu,
    hint: messages.baiduHint,
    fields: [
      { key: 'appId', label: messages.appId },
      { key: 'secretKey', label: messages.secretKey },
    ],
  },
  {
    engine: 'Youdao',
    name: messages.youdao,
    hint: messages.youdaoHint,
    fields: [
      { key: 'appKey', label: messages.appKey },
      { key: 'appSecret', label: messages.appSecret },
    ],
  },
  {
    engine: 'Aliyun',
    name: messages.aliyun,
    hint: messages.aliyunHint,
    fields: [
      { key: 'accessKeyId', label: messages.accessKeyId },
      { key: 'accessKeySecret', label: messages.accessKeySecret },
    ],
  },
];

interface CredentialStatus {
  configured: boolean;
  canSave: boolean;
  saved: boolean;
}

interface ProviderCardProps extends WrappedComponentProps {
  provider: (typeof providers)[number];
}

const ProviderCard = ({ provider, intl }: ProviderCardProps) => {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<Message | null>(null);

  useEffect(() => {
    let mounted = true;
    ipcRenderer
      .invoke('translator:get-provider-credential-status', provider.engine)
      .then((next: CredentialStatus) => {
        if (mounted) setStatus(next);
      })
      .catch(() => {
        if (mounted) setError(messages.saveFailed);
      });
    return () => {
      mounted = false;
    };
  }, [provider.engine]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || provider.fields.some(field => !values[field.key]?.trim()))
      return;
    setBusy(true);
    setError(null);
    setAvailable(null);
    try {
      const next = (await ipcRenderer.invoke(
        'translator:save-provider-credentials',
        provider.engine,
        values,
      )) as CredentialStatus;
      setStatus(next);
      setValues({});
      try {
        const engines = (await ipcRenderer.invoke(
          'translator:get-engine-status',
          true,
        )) as { engine: string; available: boolean }[];
        setAvailable(
          Boolean(
            engines.find(item => item.engine === provider.engine)?.available,
          ),
        );
      } catch {
        setAvailable(false);
      }
    } catch {
      setError(messages.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = (await ipcRenderer.invoke(
        'translator:clear-provider-credentials',
        provider.engine,
      )) as CredentialStatus;
      setStatus(next);
      setValues({});
      setAvailable(null);
    } catch {
      setError(messages.clearFailed);
    } finally {
      setBusy(false);
    }
  };

  const statusMessage = status?.saved
    ? messages.ready
    : status?.configured
      ? messages.environment
      : provider.engine === 'Google'
        ? messages.optional
        : messages.unconfigured;

  return (
    <details className="translation-provider">
      <summary>
        <span>{intl.formatMessage(provider.name)}</span>
        {status && (
          <span
            className={`translation-provider__status ${status.configured ? 'is-configured' : ''}`}
          >
            {intl.formatMessage(statusMessage)}
          </span>
        )}
      </summary>
      <div className="translation-provider__content">
        <p className="translation-provider__hint">
          {intl.formatMessage(provider.hint)}
        </p>
        {status?.saved && (
          <p className="translation-provider__hint">
            {intl.formatMessage(messages.replaceHint)}
          </p>
        )}
        <form onSubmit={save}>
          {provider.fields.map(field => (
            <div className="translator-credentials__field" key={field.key}>
              <label htmlFor={`translator-${provider.engine}-${field.key}`}>
                {intl.formatMessage(field.label)}
              </label>
              <input
                id={`translator-${provider.engine}-${field.key}`}
                type={/secret|key$/i.test(field.key) ? 'password' : 'text'}
                autoComplete="off"
                value={values[field.key] || ''}
                onChange={event =>
                  setValues(current => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
                disabled={!status?.canSave || busy}
              />
            </div>
          ))}
          <div className="translator-credentials__actions">
            <button
              type="submit"
              disabled={
                !status?.canSave ||
                busy ||
                provider.fields.some(field => !values[field.key]?.trim())
              }
            >
              {intl.formatMessage(messages.save)}
            </button>
            {status?.saved && (
              <button
                className="translator-credentials__remove"
                type="button"
                onClick={clear}
                disabled={busy}
              >
                {intl.formatMessage(messages.clear)}
              </button>
            )}
          </div>
        </form>
        {status && !status.canSave && (
          <p
            className="translator-credentials__feedback is-warning"
            role="alert"
          >
            {intl.formatMessage(messages.storageUnavailable)}
          </p>
        )}
        {available !== null && (
          <p
            className={`translator-credentials__feedback ${available ? 'is-success' : 'is-warning'}`}
            role="status"
          >
            {intl.formatMessage(
              available ? messages.verified : messages.failed,
            )}
          </p>
        )}
        {error && (
          <p
            className="translator-credentials__feedback is-warning"
            role="alert"
          >
            {intl.formatMessage(error)}
          </p>
        )}
      </div>
    </details>
  );
};

const TranslationProviderSettings = ({ intl }: WrappedComponentProps) => (
  <section className="translator-credentials">
    <h3>{intl.formatMessage(messages.title)}</h3>
    <p className="translator-credentials__description">
      {intl.formatMessage(messages.description)}
    </p>
    <div className="translation-provider-list">
      {providers.map(provider => (
        <ProviderCard provider={provider} intl={intl} key={provider.engine} />
      ))}
    </div>
  </section>
);

export default injectIntl(TranslationProviderSettings);
