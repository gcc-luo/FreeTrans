import { ipcRenderer } from 'electron';
import { type IntlShape, defineMessages } from 'react-intl';

export const getFerdiumVersion = (
  currentLocation: string,
  ferdiumVersion: string,
): string => {
  const matches = currentLocation.match(/version=([^&]*)/);
  if (matches !== null) {
    return `v${matches[1]}`;
  }
  return `v${ferdiumVersion}`;
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
      'An error occurred when connecting to Gitee, please try again later.',
  },
  connectionErrorPageMissing: {
    id: 'settings.releasenotes.connectionErrorPageMissing',
    defaultMessage:
      'An error occurred when connecting to Gitee, the page you are looking for is missing.',
  },
});

export async function getUpdateInfoFromGitee(
  currentLocation: string,
  ferdiumVersion: string,
  intl: IntlShape,
): Promise<string> {
  try {
    const releaseNotes = await ipcRenderer.invoke(
      'get-gitee-release-notes',
      getFerdiumVersion(currentLocation, ferdiumVersion),
    );

    return (
      releaseNotes || `### ${intl.formatMessage(messages.connectionError)}`
    );
  } catch {
    return `### ${intl.formatMessage(messages.connectionErrorPageMissing)}`;
  }
}
