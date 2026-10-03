import { mdiTranslate } from '@mdi/js';
import { ipcRenderer } from 'electron';
import { inject, observer } from 'mobx-react';
import { Component } from 'react';
import {
  type WrappedComponentProps,
  defineMessages,
  injectIntl,
} from 'react-intl';
import Icon from '../../components/ui/icon';
import type { RealStores } from '../../stores';
import { translatorActions } from './actions';
import {
  getMyLanguageOptions,
  getTargetLanguageOptions,
  normalizeVisibleLanguageValue,
} from './language-options';

const messages = defineMessages({
  title: {
    id: 'translator.panel.title',
    defaultMessage: '聊天工具',
  },
  translatorTool: {
    id: 'translator.panel.translatorTool',
    defaultMessage: '首选翻译引擎',
  },
  myLanguage: {
    id: 'translator.panel.myLanguage',
    defaultMessage: '我的语言',
  },
  targetLanguage: {
    id: 'translator.panel.targetLanguage',
    defaultMessage: '对方语言',
  },
  sendTranslation: {
    id: 'translator.panel.sendTranslation',
    defaultMessage: '发送翻译',
  },
  receiveTranslation: {
    id: 'translator.panel.receiveTranslation',
    defaultMessage: '接收翻译',
  },
  panelTheme: {
    id: 'translator.panel.theme',
    defaultMessage: '界面主题',
  },
  themeLight: {
    id: 'translator.panel.theme.light',
    defaultMessage: '默认白色',
  },
  themeDark: {
    id: 'translator.panel.theme.dark',
    defaultMessage: '暗黑色',
  },
  privacyNotice: {
    id: 'translator.panel.privacyNotice',
    defaultMessage:
      '翻译内容会发送至第三方服务，失败时可能切换服务，并缓存在本机。',
  },
  privacyTitle: {
    id: 'translator.panel.privacyTitle',
    defaultMessage: '隐私与缓存',
  },
  clearCache: {
    id: 'translator.panel.clearCache',
    defaultMessage: '清除本机翻译缓存',
  },
  cacheCleared: {
    id: 'translator.panel.cacheCleared',
    defaultMessage: '已清除本机翻译缓存',
  },
  cacheClearFailed: {
    id: 'translator.panel.cacheClearFailed',
    defaultMessage: '清除失败，请重试',
  },
  checkingEngines: {
    id: 'translator.panel.checkingEngines',
    defaultMessage: '正在检测可用引擎…',
  },
  noEngines: {
    id: 'translator.panel.noEngines',
    defaultMessage: '暂无可用翻译引擎',
  },
  chooseEngine: {
    id: 'translator.panel.chooseEngine',
    defaultMessage: '请选择可用引擎',
  },
  engineUnavailable: {
    id: 'translator.panel.engineUnavailable',
    defaultMessage: '当前引擎不可用，请选择上方的可用引擎。',
  },
  baiduUnavailable: {
    id: 'translator.panel.baiduUnavailable',
    defaultMessage: '百度翻译不可用，请在“设置 → 语言”中检查凭据。',
  },
  noEnginesHelp: {
    id: 'translator.panel.noEnginesHelp',
    defaultMessage: '请检查网络，或在“设置 → 语言”中配置翻译引擎。',
  },
  checkAgain: {
    id: 'translator.panel.checkAgain',
    defaultMessage: '重新检测',
  },
});

interface EngineStatus {
  engine: string;
  available: boolean;
}

interface PanelState {
  cacheStatus: string;
  engineStatuses: EngineStatus[] | null;
}

interface Props extends WrappedComponentProps {
  stores?: RealStores;
}

@inject('stores')
@observer
class MessageTranslatorPanel extends Component<Props, PanelState> {
  private mounted = false;

  private engineCheckSequence = 0;

  constructor(props: Props) {
    super(props);
    this.state = { cacheStatus: '', engineStatuses: null };
  }

  componentDidMount() {
    this.mounted = true;
    this.checkEngines();
    ipcRenderer.on('translator:engines-changed', this.handleEnginesChanged);
    window.addEventListener('focus', this.handleWindowFocus);
  }

  componentWillUnmount() {
    this.mounted = false;
    ipcRenderer.removeListener(
      'translator:engines-changed',
      this.handleEnginesChanged,
    );
    window.removeEventListener('focus', this.handleWindowFocus);
  }

  handleEnginesChanged = () => this.checkEngines(true);

  handleWindowFocus = () => this.checkEngines();

  checkEngines = async (force = false) => {
    this.engineCheckSequence += 1;
    const sequence = this.engineCheckSequence;
    this.setState({ engineStatuses: null });
    try {
      const engineStatuses = (await ipcRenderer.invoke(
        'translator:get-engine-status',
        force,
      )) as EngineStatus[];
      if (this.mounted && sequence === this.engineCheckSequence)
        this.setState({ engineStatuses });
    } catch {
      if (this.mounted && sequence === this.engineCheckSequence)
        this.setState({ engineStatuses: [] });
    }
  };

  clearTranslationCache = async () => {
    try {
      await ipcRenderer.invoke('translator:clear-cache');
      this.setState({
        cacheStatus: this.props.intl.formatMessage(messages.cacheCleared),
      });
    } catch {
      this.setState({
        cacheStatus: this.props.intl.formatMessage(messages.cacheClearFailed),
      });
    }
  };

  updateSettings(serviceId: string, patch: Record<string, unknown>) {
    translatorActions.updateSettings({
      serviceId,
      settings: patch,
    });
  }

  renderSwitch({
    checked,
    onChange,
  }: {
    checked: boolean;
    onChange: (nextValue: boolean) => void;
  }) {
    return (
      <button
        type="button"
        className={`translator-switch ${checked ? 'is-on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="translator-switch__thumb" />
      </button>
    );
  }

  render() {
    const { stores, intl } = this.props;
    if (!stores) return null;

    const { services, messageTranslator } = stores;
    const activeService = services.active;
    if (!activeService) return null;

    const serviceSettings = messageTranslator.getServiceSettings(
      activeService.id,
    );
    const panelTheme = serviceSettings.panelTheme === 'dark' ? 'dark' : 'light';
    const availableEngines = (this.state.engineStatuses || [])
      .filter(status => status.available)
      .map(status => status.engine);
    const selectedEngineAvailable = availableEngines.includes(
      serviceSettings.translatorEngine,
    );
    const allMyLanguageOptions = getMyLanguageOptions('');
    const allTargetLanguageOptions = getTargetLanguageOptions('');
    const myLanguageOptions = allMyLanguageOptions;
    const targetLanguageOptions = allTargetLanguageOptions;
    const myLanguageValue = normalizeVisibleLanguageValue(
      serviceSettings.myLanguage,
      allMyLanguageOptions,
      'auto',
    );
    const targetLanguageValue = normalizeVisibleLanguageValue(
      serviceSettings.targetLanguage,
      allTargetLanguageOptions,
      'en',
    );

    return (
      <aside
        className={`translator-panel translator-panel--theme-${panelTheme} is-open`}
        style={{
          width: `${messageTranslator.panelWidth}px`,
          flexBasis: `${messageTranslator.panelWidth}px`,
        }}
      >
        <div className="translator-panel__header translator-panel__header--compact">
          <div className="translator-panel__title">
            <img
              src="./assets/images/logo-beard-only.svg"
              alt="Translator logo"
              className="translator-panel__logo"
            />
            <Icon icon={mdiTranslate} size={0.9} />
            <span>{intl.formatMessage(messages.title)}</span>
          </div>
        </div>

        <div className="translator-panel__body">
          <div className="translator-card">
            <div className="translator-engine-section">
              <div className="translator-engine-section__heading">
                <label htmlFor="translator-engine-select">
                  {intl.formatMessage(messages.translatorTool)}
                </label>
                <button type="button" onClick={() => this.checkEngines(true)}>
                  {intl.formatMessage(messages.checkAgain)}
                </button>
              </div>
              <select
                id="translator-engine-select"
                value={
                  selectedEngineAvailable
                    ? serviceSettings.translatorEngine
                    : ''
                }
                onChange={e =>
                  this.updateSettings(activeService.id, {
                    translatorEngine: e.target.value,
                  })
                }
                aria-label={intl.formatMessage(messages.translatorTool)}
                disabled={
                  !this.state.engineStatuses || availableEngines.length === 0
                }
              >
                <option value="" disabled>
                  {this.state.engineStatuses
                    ? availableEngines.length > 0
                      ? intl.formatMessage(messages.chooseEngine)
                      : intl.formatMessage(messages.noEngines)
                    : intl.formatMessage(messages.checkingEngines)}
                </option>
                {availableEngines.map(engine => (
                  <option value={engine} key={engine}>
                    {{
                      Baidu: '百度翻译',
                      Youdao: '网易有道',
                      Aliyun: '阿里云翻译',
                    }[engine] || engine}
                  </option>
                ))}
              </select>
              {this.state.engineStatuses && !selectedEngineAvailable && (
                <p className="translator-engine-section__notice" role="status">
                  {intl.formatMessage(
                    availableEngines.length === 0
                      ? messages.noEnginesHelp
                      : serviceSettings.translatorEngine === 'Baidu'
                        ? messages.baiduUnavailable
                        : messages.engineUnavailable,
                  )}
                </p>
              )}
            </div>
            <div className="translator-setting-row translator-setting-row--language">
              <span>{intl.formatMessage(messages.myLanguage)}</span>
              <div className="translator-language-field">
                <select
                  value={myLanguageValue}
                  onChange={e =>
                    this.updateSettings(activeService.id, {
                      myLanguage: e.target.value,
                    })
                  }
                >
                  {myLanguageOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="translator-setting-row translator-setting-row--language">
              <span>{intl.formatMessage(messages.targetLanguage)}</span>
              <div className="translator-language-field">
                <select
                  value={targetLanguageValue}
                  onChange={e =>
                    this.updateSettings(activeService.id, {
                      targetLanguage: e.target.value,
                    })
                  }
                >
                  {targetLanguageOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="translator-setting-row">
              <span>{intl.formatMessage(messages.panelTheme)}</span>
              <select
                value={panelTheme}
                onChange={e =>
                  this.updateSettings(activeService.id, {
                    panelTheme: e.target.value,
                  })
                }
              >
                <option value="light">
                  {intl.formatMessage(messages.themeLight)}
                </option>
                <option value="dark">
                  {intl.formatMessage(messages.themeDark)}
                </option>
              </select>
            </div>

            <div className="translator-toggle-row">
              <span>{intl.formatMessage(messages.sendTranslation)}</span>
              {this.renderSwitch({
                checked: Boolean(serviceSettings.sendTranslation),
                onChange: nextValue =>
                  this.updateSettings(activeService.id, {
                    sendTranslation: nextValue,
                  }),
              })}
            </div>

            <div className="translator-toggle-row">
              <span>{intl.formatMessage(messages.receiveTranslation)}</span>
              {this.renderSwitch({
                checked: Boolean(serviceSettings.receiveTranslation),
                onChange: nextValue =>
                  this.updateSettings(activeService.id, {
                    receiveTranslation: nextValue,
                  }),
              })}
            </div>
            <details className="translator-privacy">
              <summary>{intl.formatMessage(messages.privacyTitle)}</summary>
              <p>{intl.formatMessage(messages.privacyNotice)}</p>
              <button type="button" onClick={this.clearTranslationCache}>
                {intl.formatMessage(messages.clearCache)}
              </button>
              {this.state.cacheStatus && (
                <p role="status">{this.state.cacheStatus}</p>
              )}
            </details>
          </div>
        </div>
      </aside>
    );
  }
}

export default injectIntl(MessageTranslatorPanel);
