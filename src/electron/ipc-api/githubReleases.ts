import semver from 'semver';

const releaseApiBase =
  'https://api.github.com/repos/gcc-luo/FreeTrans/releases';

export interface GitHubRelease {
  tag_name: string;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name: string; browser_download_url: string }[];
}

export async function getLatestGitHubRelease(
  currentVersion: string,
  allowPrerelease: boolean,
): Promise<GitHubRelease | null> {
  const response = await fetch(`${releaseApiBase}?per_page=30`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'FreeTrans',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub Releases request failed (${response.status}).`);
  }

  const releases = (await response.json()) as GitHubRelease[];
  return (
    releases
      .filter(
        release =>
          !release.draft &&
          (allowPrerelease || !release.prerelease) &&
          semver.valid(release.tag_name) &&
          semver.gt(release.tag_name, currentVersion),
      )
      .sort((left, right) =>
        semver.rcompare(left.tag_name, right.tag_name),
      )[0] || null
  );
}

export function getInstallerDownloadUrl(
  release: GitHubRelease,
  platform: NodeJS.Platform,
  arch: string,
): string {
  if (platform !== 'darwin' && platform !== 'win32') {
    return `https://github.com/gcc-luo/FreeTrans/releases/tag/${encodeURIComponent(release.tag_name)}`;
  }
  const extension = platform === 'darwin' ? '.dmg' : '.exe';
  const expectedArch = platform === 'win32' && arch === 'arm64' ? 'x64' : arch;
  const asset = release.assets?.find(
    candidate =>
      candidate.name.startsWith('FreeTrans-') &&
      candidate.name.includes(release.tag_name.slice(1)) &&
      candidate.name.includes(`-${expectedArch}.`) &&
      candidate.name.endsWith(extension) &&
      (platform === 'darwin' || candidate.name.includes('Installer')),
  );
  if (!asset) {
    throw new Error(`No ${platform}/${arch} installer in ${release.tag_name}.`);
  }
  const url = new URL(asset.browser_download_url);
  if (
    url.origin !== 'https://github.com' ||
    !url.pathname.startsWith('/gcc-luo/FreeTrans/releases/download/')
  ) {
    throw new Error('GitHub returned an unexpected installer URL.');
  }
  return url.toString();
}

export async function getGitHubReleaseByTag(
  tag: string,
): Promise<GitHubRelease> {
  const safeTag = String(tag || '').trim();
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(safeTag)) {
    throw new Error('A valid FreeTrans release tag is required.');
  }

  const response = await fetch(
    `${releaseApiBase}/tags/${encodeURIComponent(safeTag)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'FreeTrans',
      },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub Release request failed (${response.status}).`);
  }

  const release = (await response.json()) as GitHubRelease;
  if (release.tag_name !== safeTag) {
    throw new Error('GitHub returned an unexpected release.');
  }
  return release;
}
