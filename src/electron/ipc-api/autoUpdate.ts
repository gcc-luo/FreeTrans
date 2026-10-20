import { app, type BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import electronDl from 'electron-dl';
import {
  getInstallerDownloadUrl,
  getLatestGitHubRelease,
  type GitHubRelease,
} from './githubReleases';

const debug = require('../../preload-safe-debug')('FreeTrans:ipcApi:updates');

const DOWNLOAD_DIR_NAME = 'updates';

export default (params: { mainWindow: BrowserWindow; settings: any }) => {
  let pendingRelease: GitHubRelease | null = null;
  let isDownloading = false;

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
        if (isDownloading) {
          debug('install already in progress, ignoring');
          return;
        }

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
        debug('downloading installer', url);

        const downloadDirectory = join(app.getPath('userData'), DOWNLOAD_DIR_NAME);
        const filename = url.split('/').pop() || 'freetrans-installer';

        isDownloading = true;
        event.sender.send('autoUpdate', { downloading: true });

        let downloadedItem: { path: string } | null = null;
        try {
          const item = await electronDl.download(params.mainWindow, url, {
            directory: downloadDirectory,
            filename,
            overwrite: true,
            showBadge: false,
            showProgressBar: false,
            openFolderWhenDone: false,
            onProgress: progress => {
              event.sender.send('autoUpdate', {
                progress: {
                  percent: Math.round(progress.percent),
                  transferredBytes: progress.transferredBytes,
                  totalBytes: progress.totalBytes,
                },
              });
            },
          });
          downloadedItem = item as unknown as { path: string };
        } catch (downloadError) {
          isDownloading = false;
          throw downloadError;
        }

        isDownloading = false;
        const installerPath = (downloadedItem as { path: string }).path;
        debug('installer downloaded to', installerPath);

        event.sender.send('autoUpdate', { downloaded: true });

        if (process.platform === 'win32') {
          debug('launching silent installer and quitting');
          const child = spawn(installerPath, ['/S', '--updated'], {
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
          app.quit();
        } else if (process.platform === 'darwin') {
          debug('opening dmg for manual install');
          await shell.openPath(installerPath);
        }
      }
    } catch (error) {
      isDownloading = false;
      const err = error as Error;
      debug('autoUpdate error:', err.message);
      let userMessage = err.message;
      if (err.message.includes('GitHub Releases request failed')) {
        userMessage = '无法连接 GitHub，请检查网络连接后重试';
      } else if (err.message.includes('No') && err.message.includes('installer found')) {
        userMessage = '未找到适用于当前系统的安装包，请联系开发者';
      } else if (err.message.toLowerCase().includes('network') || err.message.toLowerCase().includes('download')) {
        userMessage = '下载更新失败，请检查网络连接后重试';
      }
      event.sender.send('autoUpdate', { error: { message: userMessage } });
    }
  });
};