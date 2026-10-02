import { inject, observer } from 'mobx-react';
import { Component, type ReactNode } from 'react';
import {
  type WrappedComponentProps,
  defineMessages,
  injectIntl,
} from 'react-intl';
import { NavLink } from 'react-router-dom';
import type { StoresProps } from '../../../@types/ferdium-components.types';
import {
  LIVE_FERDIUM_API,
  LIVE_FRANZ_API,
  LOCAL_SERVER,
} from '../../../config';

const messages = defineMessages({
  availableServices: {
    id: 'settings.navigation.availableServices',
    defaultMessage: 'Available services',
  },
  yourServices: {
    id: 'settings.navigation.yourServices',
    defaultMessage: 'Your services',
  },
  account: {
    id: 'settings.navigation.account',
    defaultMessage: 'Account',
  },
  team: {
    id: 'settings.navigation.team',
    defaultMessage: 'Manage Team',
  },
  releaseNotes: {
    id: 'settings.navigation.releaseNotes',
    defaultMessage: 'Release Notes',
  },
  supportFerdium: {
    id: 'settings.navigation.supportFerdium',
    defaultMessage: 'About FreeTrans',
  },
  logout: {
    id: 'settings.navigation.logout',
    defaultMessage: 'Logout',
  },
  groupServices: {
    id: 'settings.navigation.groupServices',
    defaultMessage: 'Services',
  },
  groupPreferences: {
    id: 'settings.navigation.groupPreferences',
    defaultMessage: 'Preferences',
  },
  groupUpdates: {
    id: 'settings.navigation.groupUpdates',
    defaultMessage: 'Updates',
  },
  updateSettings: {
    id: 'settings.navigation.updateSettings',
    defaultMessage: 'Update settings',
  },
  checkUpdates: {
    id: 'settings.navigation.checkUpdates',
    defaultMessage: 'Check for updates',
  },
  downloadUpdate: {
    id: 'settings.navigation.downloadUpdate',
    defaultMessage: 'Download update',
  },
  groupAccount: {
    id: 'settings.navigation.groupAccount',
    defaultMessage: 'Account and team',
  },
  groupAbout: {
    id: 'settings.navigation.groupAbout',
    defaultMessage: 'Application info',
  },
  preferencesGeneral: {
    id: 'settings.navigation.preferencesGeneral',
    defaultMessage: 'General',
  },
  preferencesServices: {
    id: 'settings.navigation.preferencesServices',
    defaultMessage: 'Services',
  },
  preferencesAppearance: {
    id: 'settings.navigation.preferencesAppearance',
    defaultMessage: 'Appearance',
  },
  preferencesPrivacy: {
    id: 'settings.navigation.preferencesPrivacy',
    defaultMessage: 'Privacy',
  },
  preferencesLanguage: {
    id: 'settings.navigation.preferencesLanguage',
    defaultMessage: 'Language',
  },
  preferencesAdvanced: {
    id: 'settings.navigation.preferencesAdvanced',
    defaultMessage: 'Advanced',
  },
});

const linkClassName = ({ isActive }: { isActive: boolean }) =>
  isActive
    ? 'settings-navigation__link is-active'
    : 'settings-navigation__link';

interface IProps extends Partial<StoresProps>, WrappedComponentProps {
  serviceCount: number;
}

@inject('stores', 'actions')
@observer
class SettingsNavigation extends Component<IProps> {
  handleLogout(): void {
    const isUsingWithoutAccount =
      this.props.stores!.settings.app.server === LOCAL_SERVER;

    // Remove current auth token
    localStorage.removeItem('authToken');

    if (isUsingWithoutAccount) {
      // Reset server back to Ferdium API
      this.props.actions!.settings.update({
        type: 'app',
        data: {
          server: LIVE_FERDIUM_API,
        },
      });
    }
    this.props.stores!.user.isLoggingOut = true;

    this.props.stores!.router.push('/auth/welcome');

    // Reload Ferdium, otherwise many settings won't sync correctly with the server
    // after logging into another account
    window.location.reload();
  }

  render() {
    const { serviceCount, stores, intl } = this.props;
    const isUsingWithoutAccount = stores!.settings.app.server === LOCAL_SERVER;
    const isUsingFranzServer = stores!.settings.app.server === LIVE_FRANZ_API;
    const hasUpdate =
      stores!.settings.app.automaticUpdates &&
      (stores!.ui.showServicesUpdatedInfoBar ||
        stores!.app.updateStatus === stores!.app.updateStatusTypes.AVAILABLE ||
        stores!.app.updateStatus === stores!.app.updateStatusTypes.DOWNLOADED);
    const section = (
      key: string,
      label: ReactNode,
      children: ReactNode,
      className = '',
    ) => (
      <section
        className={`settings-navigation__section ${className}`.trim()}
        key={key}
      >
        <div className="settings-navigation__section-title">
          {label}
          {className === 'settings-navigation__section--updates' &&
            hasUpdate && <span className="settings-navigation__action-badge" />}
        </div>
        {children}
      </section>
    );

    const navLink = (to: string, label: ReactNode, end = false) => (
      <NavLink to={to} className={linkClassName} end={end} key={to}>
        {label}
      </NavLink>
    );

    return (
      <div className="settings-navigation">
        {section(
          'services',
          intl.formatMessage(messages.groupServices),
          <>
            {navLink(
              '/settings/recipes',
              intl.formatMessage(messages.availableServices),
            )}
            <NavLink
              to="/settings/services"
              className={linkClassName}
              key="/settings/services"
            >
              {intl.formatMessage(messages.yourServices)}
              <span className="badge">{serviceCount}</span>
            </NavLink>
          </>,
        )}
        {!isUsingWithoutAccount &&
          section(
            'account',
            intl.formatMessage(messages.groupAccount),
            <>
              {navLink('/settings/user', intl.formatMessage(messages.account))}
              {isUsingFranzServer &&
                navLink('/settings/team', intl.formatMessage(messages.team))}
            </>,
          )}
        {section(
          'preferences',
          intl.formatMessage(messages.groupPreferences),
          <>
            {[
              { path: 'general', label: messages.preferencesGeneral },
              { path: 'services', label: messages.preferencesServices },
              { path: 'appearance', label: messages.preferencesAppearance },
              { path: 'privacy', label: messages.preferencesPrivacy },
              { path: 'language', label: messages.preferencesLanguage },
              { path: 'advanced', label: messages.preferencesAdvanced },
            ].map(({ path, label }) =>
              navLink(`/settings/app/${path}`, intl.formatMessage(label)),
            )}
          </>,
          'settings-navigation__section--preferences',
        )}
        {section(
          'updates',
          intl.formatMessage(messages.groupUpdates),
          <>
            {navLink(
              '/settings/app/update-settings',
              intl.formatMessage(messages.updateSettings),
            )}
            {navLink(
              '/settings/app/check-updates',
              intl.formatMessage(messages.checkUpdates),
            )}
            {navLink(
              '/settings/app/download-update',
              intl.formatMessage(messages.downloadUpdate),
            )}
            {navLink(
              '/settings/releasenotes',
              intl.formatMessage(messages.releaseNotes),
            )}
          </>,
          'settings-navigation__section--updates',
        )}
        {section(
          'about',
          intl.formatMessage(messages.groupAbout),
          navLink(
            '/settings/support',
            intl.formatMessage(messages.supportFerdium),
          ),
          'settings-navigation__section--about',
        )}
        <span className="settings-navigation__expander" />
        {!isUsingWithoutAccount && (
          <button
            type="button"
            // @ts-expect-error  Fix me
            to="/auth/logout" // TODO: [TS DEBT] Need to check if button take this prop
            className="settings-navigation__link"
            onClick={this.handleLogout.bind(this)}
          >
            {intl.formatMessage(messages.logout)}
          </button>
        )}
      </div>
    );
  }
}

export default injectIntl(SettingsNavigation);
