import { inject, observer } from 'mobx-react';
import { Component, type ReactElement } from 'react';
import { ThemeProvider } from 'react-jss';
import { Outlet } from 'react-router-dom';

import {
  ThemeProvider as MUIThemeProvider,
  createTheme,
} from '@mui/material/styles';
import tinycolor from 'tinycolor2';
import type { StoresProps } from '../../@types/ferdium-components.types';
import AppLayout from '../../components/layout/AppLayout';
import Sidebar from '../../components/layout/Sidebar';
import Services from '../../components/services/content/Services';
import AppLoader from '../../components/ui/AppLoader';
import { DEFAULT_ACCENT_COLOR } from '../../config';

interface IProps extends StoresProps {}

@inject('stores', 'actions')
@observer
class AppLayoutContainer extends Component<IProps> {
  render(): ReactElement {
    const { app, features, services, ui, settings, requests, user } =
      this.props.stores;

    const {
      setActive,
      // handleIPCMessage,
      setWebviewReference,
      detachService,
      // openWindow,
      reorder,
      reload,
      toggleNotifications,
      toggleAudio,
      toggleDarkMode,
      deleteService,
      updateService,
      clearCache,
      hibernate,
      awake,
    } = this.props.actions.service;

    // This is a workaround to fix theming on MUI components when the settings are poorly set
    let { accentColor } = settings.app;
    accentColor = tinycolor(accentColor).isValid()
      ? accentColor
      : DEFAULT_ACCENT_COLOR;
    // ---

    // This is a workaround to fix theming on MUI components
    const themeMUIDark = createTheme({
      palette: {
        mode: 'dark',
        primary: {
          main: accentColor,
        },
      },
    });

    const themeMUILight = createTheme({
      palette: {
        mode: 'light',
        primary: {
          main: accentColor,
        },
      },
    });
    // ---

    const { retryRequiredRequests } = this.props.actions.requests;

    const { openSettings } = this.props.actions.ui;

    const isLoadingFeatures =
      features.featuresRequest.isExecuting &&
      !features.featuresRequest.wasExecuted;

    const isLoadingServices =
      services.allServicesRequest.isExecuting &&
      services.allServicesRequest.isExecutingFirstTime;

    const isLoadingSettings = !settings.loaded;

    if (isLoadingSettings || isLoadingFeatures || isLoadingServices) {
      return (
        <ThemeProvider theme={ui.theme}>
          <AppLoader theme={ui.theme} />
        </ThemeProvider>
      );
    }

    const sidebar = (
      <Sidebar
        services={services.allDisplayed}
        setActive={setActive}
        openSettings={openSettings}
        reorder={reorder}
        reload={reload}
        toggleNotifications={toggleNotifications}
        toggleAudio={toggleAudio}
        toggleDarkMode={toggleDarkMode}
        deleteService={deleteService}
        updateService={updateService}
        clearCache={clearCache}
        hibernateService={hibernate}
        wakeUpService={awake}
        showMessageBadgeWhenMutedSetting={
          settings.all.app.showMessageBadgeWhenMuted
        }
        showServiceNameSetting={settings.all.app.showServiceName}
        showMessageBadgesEvenWhenMuted={ui.showMessageBadgesEvenWhenMuted}
      />
    );

    const servicesContainer = (
      <Services
        services={services.allDisplayedUnordered}
        // handleIPCMessage={handleIPCMessage} // TODO: [TECH DEBT] check it later
        setWebviewReference={setWebviewReference}
        detachService={detachService}
        // openWindow={openWindow} // TODO: [TECH DEBT] check it later
        reload={reload}
        openSettings={openSettings}
        update={updateService}
        userHasCompletedSignup={user.hasCompletedSignup}
        isSpellcheckerEnabled={settings.app.enableSpellchecking}
      />
    );

    return (
      // TODO: Using 2 ThemeProviders is not ideal, but it's a workaround for now
      <MUIThemeProvider
        theme={settings.app.darkMode ? themeMUIDark : themeMUILight}
      >
        <ThemeProvider theme={ui.theme}>
          <AppLayout
            settings={settings}
            isFullScreen={app.isFullScreen}
            showServicesUpdatedInfoBar={ui.showServicesUpdatedInfoBar}
            authRequestFailed={app.authRequestFailed}
            sidebar={sidebar}
            services={servicesContainer}
            showRequiredRequestsError={requests.showRequiredRequestsError}
            areRequiredRequestsSuccessful={
              requests.areRequiredRequestsSuccessful
            }
            retryRequiredRequests={retryRequiredRequests}
            areRequiredRequestsLoading={requests.areRequiredRequestsLoading}
          >
            <Outlet />
          </AppLayout>
        </ThemeProvider>
      </MUIThemeProvider>
    );
  }
}

export default AppLayoutContainer;
