import { mdiTranslate } from '@mdi/js';
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
    defaultMessage: '翻译工具',
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
});

interface Props extends WrappedComponentProps {
  stores?: RealStores;
}

@inject('stores')
@observer
class MessageTranslatorPanel extends Component<Props> {
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
            <div className="translator-setting-row">
              <span>{intl.formatMessage(messages.translatorTool)}</span>
              <input type="text" value="百度翻译" readOnly />
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
          </div>
        </div>
      </aside>
    );
  }
}

export default injectIntl(MessageTranslatorPanel);
