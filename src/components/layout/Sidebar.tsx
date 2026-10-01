import { mdiCog, mdiPlusBox, mdiTranslate } from '@mdi/js';
import { inject, observer } from 'mobx-react';
import { Component } from 'react';
import {
  type WrappedComponentProps,
  defineMessages,
  injectIntl,
} from 'react-intl';
import { translatorActions } from '../../features/messageTranslator/actions';
import globalMessages from '../../i18n/globalMessages';
import type Service from '../../models/Service';
import type { RealStores } from '../../stores';
import Tabbar from '../services/tabs/Tabbar';
import Icon from '../ui/icon';

const messages = defineMessages({
  addNewService: {
    id: 'sidebar.addNewService',
    defaultMessage: 'Add new service',
  },
  servicesSection: {
    id: 'sidebar.servicesSection',
    defaultMessage: 'Messaging services',
  },
  translationPanel: {
    id: 'sidebar.translationPanel',
    defaultMessage: 'Translation panel',
  },
});

interface IProps extends WrappedComponentProps {
  services: Service[];
  showMessageBadgeWhenMutedSetting: boolean;
  showServiceNameSetting: boolean;
  showMessageBadgesEvenWhenMuted: boolean;
  stores?: RealStores;
  openSettings: (args: { path: string }) => void;
  setActive: (args: { serviceId: string }) => void;
  reorder: (args: { oldIndex: number; newIndex: number }) => void;
  reload: (args: { serviceId: string }) => void;
  toggleNotifications: (args: { serviceId: string }) => void;
  toggleAudio: (args: { serviceId: string }) => void;
  toggleDarkMode: (args: { serviceId: string }) => void;
  deleteService: (args: { serviceId: string }) => void;
  clearCache: (args: { serviceId: string }) => void;
  hibernateService: (args: { serviceId: string }) => void;
  wakeUpService: (args: { serviceId: string }) => void;
  updateService: (args: {
    serviceId: string;
    serviceData: { isEnabled: boolean; isMediaPlaying: boolean };
    redirect: boolean;
  }) => void;
}

@inject('stores')
@observer
class Sidebar extends Component<IProps> {
  render() {
    const { openSettings, services, stores, intl } = this.props;
    const activeService = services.find(service => service.isActive);

    return (
      <aside className="sidebar sidebar--freetrans">
        <div className="sidebar__top">
          <div className="sidebar__brand">
            <span className="sidebar__brand-mark">F</span>
            <span className="sidebar__brand-name">FreeTrans</span>
          </div>

          <div className="sidebar__section-heading">
            <span className="sidebar__section-label">
              {intl.formatMessage(messages.servicesSection)}
            </span>
            <span className="sidebar__count">{services.length}</span>
            <button
              type="button"
              className="sidebar__add-service"
              onClick={() => openSettings({ path: 'recipes' })}
              aria-label={intl.formatMessage(messages.addNewService)}
              title={intl.formatMessage(messages.addNewService)}
            >
              <Icon icon={mdiPlusBox} size={1.2} />
            </button>
          </div>
          <div className="sidebar__service-list">
            <Tabbar
              useHorizontalStyle={false}
              showMessageBadgeWhenMutedSetting={
                this.props.showMessageBadgeWhenMutedSetting
              }
              showServiceNameSetting={this.props.showServiceNameSetting}
              showMessageBadgesEvenWhenMuted={
                this.props.showMessageBadgesEvenWhenMuted
              }
              services={services}
              setActive={this.props.setActive}
              openSettings={openSettings}
              enableToolTip={() => null}
              disableToolTip={() => null}
              reorder={this.props.reorder}
              reload={this.props.reload}
              toggleNotifications={this.props.toggleNotifications}
              toggleAudio={this.props.toggleAudio}
              toggleDarkMode={this.props.toggleDarkMode}
              deleteService={this.props.deleteService}
              updateService={this.props.updateService}
              clearCache={this.props.clearCache}
              hibernateService={this.props.hibernateService}
              wakeUpService={this.props.wakeUpService}
            />
          </div>
        </div>

        <div className="sidebar__footer-actions">
          <button
            type="button"
            className={`sidebar__footer-link ${
              stores?.messageTranslator?.isPanelVisible ? 'is-active' : ''
            }`}
            onClick={() => {
              if (activeService) {
                translatorActions.togglePanel({ serviceId: activeService.id });
              }
            }}
            disabled={!activeService}
          >
            <Icon icon={mdiTranslate} size={1.35} />
            <span>{intl.formatMessage(messages.translationPanel)}</span>
          </button>
          <button
            type="button"
            className="sidebar__footer-link"
            onClick={() => openSettings({ path: 'app' })}
          >
            <Icon icon={mdiCog} size={1.35} />
            <span>{intl.formatMessage(globalMessages.settings)}</span>
          </button>
        </div>
      </aside>
    );
  }
}

export default injectIntl(Sidebar);
