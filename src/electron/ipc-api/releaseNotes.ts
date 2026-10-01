import { ipcMain } from 'electron';
import { getGiteeReleaseByTag } from './giteeReleases';

export default () => {
  ipcMain.handle('get-gitee-release-notes', async (_event, tag: string) => {
    const release = await getGiteeReleaseByTag(tag);
    return release.body || '';
  });
};
