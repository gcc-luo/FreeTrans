import { ipcMain } from 'electron';
import { getGitHubReleaseNotes } from './githubReleases';

export default () => {
  ipcMain.handle('get-github-release-notes', async (_event, tag?: string) => {
    return getGitHubReleaseNotes(tag);
  });
};
