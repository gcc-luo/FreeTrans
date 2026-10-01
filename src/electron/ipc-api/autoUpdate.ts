import { app, type BrowserWindow, ipcMain, shell } from 'electron';
import {
  getInstallerDownloadUrl,
  getLatestGitHubRelease,
  type GitHubRelease,
} from './githubReleases';

const debug = require('../../preload-safe-debug')('FreeTrans:ipcApi:updates');

export default (params: { mainWindow: BrowserWindow; settings: any }) => {
  let pendingRelease: GitHubRelease | null = null;

  ipcMain.on('autoUpdate', async (event, args) => {
    try {
      if (args.action === 'check') {
        debug('checking GitHub Releases for an update');
        const allowPrerelease = Boolean(params.settings.app.get('beta'));
        const release = await getLatestGitHubRelease(
          app.getVersion(),
          allowPrerelease,
        );
        pendingRelease = release;
        event.sender.send(
          'autoUpdate',
          release
            ? { available: true, version: release.tag_name.slice(1) }
            : { available: false },
        );
      } else if (args.action === 'install' && pendingRelease) {
        const url = getInstallerDownloadUrl(
          pendingRelease,
          process.platform,
          process.arch,
        );
        debug('opening installer download', url);
        await shell.openExternal(url);
      }
    } catch (error) {
      event.sender.send('autoUpdate', { error });
    }
  });
};
