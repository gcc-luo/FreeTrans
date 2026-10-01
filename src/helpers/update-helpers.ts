import { ipcRenderer } from 'electron';
import { type IntlShape, defineMessages } from 'react-intl';

export const getAppVersionTag = (
  currentLocation: string,
  appVersion: string,
): string => {
  const matches = currentLocation.match(/version=([^&]*)/);
  if (matches !== null) {
    return `v${matches[1]}`;
  }
  return `v${appVersion}`;
};

export const updateVersionParse = (updateVersion: string): string => {
  return updateVersion === '' ? '' : `?version=${updateVersion}`;
};

export const onAuthGoToReleaseNotes = (
  currentLocation: string,
  updateVersionParsed: string = '',
): string => {
  return currentLocation.includes('#/auth')
    ? `#/auth/releasenotes${updateVersionParsed}`
    : `#/releasenotes${updateVersionParsed}`;
};

const messages = defineMessages({
  connectionError: {
    id: 'settings.releasenotes.connectionError',
    defaultMessage:
      'An error occurred when connecting to GitHub, please try again later.',
  },
  connectionErrorPageMissing: {
    id: 'settings.releasenotes.connectionErrorPageMissing',
    defaultMessage:
      'An error occurred when connecting to GitHub, the release you are looking for is missing.',
  },
});

export async function getUpdateInfoFromGitHub(
  currentLocation: string,
  appVersion: string,
  intl: IntlShape,
): Promise<string> {
  try {
    const releaseNotes = await ipcRenderer.invoke(
      'get-github-release-notes',
      getAppVersionTag(currentLocation, appVersion),
    );

    return (
      releaseNotes || `### ${intl.formatMessage(messages.connectionError)}`
    );
  } catch {
    return `### ${intl.formatMessage(messages.connectionErrorPageMissing)}`;
  }
}
