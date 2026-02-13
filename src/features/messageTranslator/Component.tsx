import { mdiTranslate } from '@mdi/js';
import { inject, observer } from 'mobx-react';
import { Component } from 'react';
import { defineMessages, injectIntl, type WrappedComponentProps } from 'react-intl';
import type { RealStores } from '../../stores';
import Icon from '../../components/ui/icon';
import { translatorActions } from './actions';

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
});

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
  { value: 'de', label: '德语' },
  { value: 'fr', label: '法语' },
  { value: 'es', label: '西班牙语' },
  { value: 'ru', label: '俄语' },
];

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

    const isOpen = Boolean(messageTranslator.isPanelVisible);
    const serviceSettings = messageTranslator.getServiceSettings(activeService.id);

    return (
      <aside
        className={`translator-panel ${isOpen ? 'is-open' : ''}`}
        style={
          isOpen
            ? {
                width: `${messageTranslator.panelWidth}px`,
                flexBasis: `${messageTranslator.panelWidth}px`,
              }
            : undefined
        }
      >
        <div className="translator-panel__header translator-panel__header--compact">
          <div className="translator-panel__title">
            <Icon icon={mdiTranslate} size={0.9} />
            <span>{intl.formatMessage(messages.title)}</span>
          </div>
        </div>

        <div className="translator-panel__body">
          <div className="translator-card">
            <div className="translator-setting-row">
              <label>{intl.formatMessage(messages.translatorTool)}</label>
              <input type="text" value="百度翻译" readOnly />
            </div>

            <div className="translator-setting-row">
              <label>{intl.formatMessage(messages.myLanguage)}</label>
              <select
                value={serviceSettings.myLanguage}
                onChange={e =>
                  this.updateSettings(activeService.id, {
                    myLanguage: e.target.value,
                  })
                }
              >
                {LANGUAGE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="translator-setting-row">
              <label>{intl.formatMessage(messages.targetLanguage)}</label>
              <select
                value={serviceSettings.targetLanguage}
                onChange={e =>
                  this.updateSettings(activeService.id, {
                    targetLanguage: e.target.value,
                  })
                }
              >
                {LANGUAGE_OPTIONS.filter(opt => opt.value !== 'auto').map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
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
