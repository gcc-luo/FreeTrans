import { ipcMain } from 'electron';
import { getGitHubReleaseByTag } from './githubReleases';

export default () => {
  ipcMain.handle('get-github-release-notes', async (_event, tag: string) => {
    const release = await getGitHubReleaseByTag(tag);
    return release.body || '';
  });
};
