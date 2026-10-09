import type { BrowserWindow } from 'electron';
import { protocolClient } from '../environment-remote';

export default function handleDeepLink(
  window: BrowserWindow,
  rawUrl: string,
): void {
  if (!rawUrl) {
    return;
  }

  const protocolPrefix = `${protocolClient}://`;
  const protocolIndex = rawUrl.indexOf(protocolPrefix);
  if (protocolIndex === -1) return;

  const url = rawUrl.slice(protocolIndex + protocolPrefix.length);
  if (!url) return;

  window.webContents.send('navigateFromDeepLink', { url });
}
