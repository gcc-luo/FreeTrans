import { app, type BrowserWindow, ipcMain, shell } from 'electron';
import {
  getInstallerDownloadUrl,
  getLatestGitHubRelease,
  type GitHubRelease,
} from './githubReleases';

const debug = require('../../preload-safe-debug')('FreeTrans:ipcApi:updates');

export default (params: { mainWindow: BrowserWindow; settings: any }) => {
  let pendingRelease: GitHubRelease | null = null;

  const MAX_RETRIES = 2;

  async function fetchLatestRelease(allowPrerelease: boolean): Promise<GitHubRelease | null> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        return await getLatestGitHubRelease(app.getVersion(), allowPrerelease);
      } catch (error) {
        lastError = error as Error;
        if (attempt < MAX_RETRIES) {
          debug(`check attempt ${attempt + 1} failed, retrying...`, lastError.message);
          // eslint-disable-next-line no-await-in-loop -- retry with backoff
          await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
        }
      }
    }
    throw lastError!;
  }

  ipcMain.on('autoUpdate', async (event, args) => {
    try {
      if (args.action === 'check') {
        debug('checking GitHub Releases for an update');
        const allowPrerelease = Boolean(params.settings.app.get('beta'));
        const release = await fetchLatestRelease(allowPrerelease);
        pendingRelease = release;
        event.sender.send(
          'autoUpdate',
          release
            ? { available: true, version: release.tag_name.slice(1) }
            : { available: false },
        );
      } else if (args.action === 'install') {
        // If no pending release, auto-check first
        if (!pendingRelease) {
          debug('no pending release for install, auto-checking first');
          const allowPrerelease = Boolean(params.settings.app.get('beta'));
          const release = await fetchLatestRelease(allowPrerelease);
          pendingRelease = release;
          if (!release) {
            event.sender.send('autoUpdate', { available: false });
            return;
          }
        }
        const url = getInstallerDownloadUrl(
          pendingRelease!,
          process.platform,
          process.arch,
        );
        debug('opening installer download', url);
        await shell.openExternal(url);
      }
    } catch (error) {
      const err = error as Error;
      debug('autoUpdate error:', err.message);
      // Send a structured error with a user-friendly message
      let userMessage = err.message;
      if (err.message.includes('GitHub Releases request failed')) {
        userMessage = '无法连接 GitHub，请检查网络连接后重试';
      } else if (err.message.includes('No') && err.message.includes('installer found')) {
        userMessage = '未找到适用于当前系统的安装包，请联系开发者';
      }
      event.sender.send('autoUpdate', { error: { message: userMessage } });
    }
  });
};
