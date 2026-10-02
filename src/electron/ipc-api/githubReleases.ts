import semver from 'semver';

const releaseApiBase =
  'https://api.github.com/repos/gcc-luo/FreeTrans/releases';
const repositoryApiBase = 'https://api.github.com/repos/gcc-luo/FreeTrans';

export interface GitHubRelease {
  tag_name: string;
  body?: string | null;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name: string; browser_download_url: string }[];
}

export interface GitHubCommitSummary {
  sha: string;
  message: string;
}

export interface GitHubReleaseNotes {
  version: string;
  date: string | null;
  previousVersion: string | null;
  commits: GitHubCommitSummary[];
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
  if (!/^v\d+\.\d+\.\d+(?:-[\d.A-Za-z-]+)?$/.test(safeTag)) {
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

export async function getLatestGitHubReleaseInfo(): Promise<GitHubRelease> {
  const response = await fetch(`${releaseApiBase}/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'FreeTrans',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub Releases request failed (${response.status}).`);
  }

  const release = (await response.json()) as GitHubRelease;
  if (!/^v\d+\.\d+\.\d+(?:-[\d.A-Za-z-]+)?$/.test(release.tag_name)) {
    throw new Error('GitHub returned an invalid release tag.');
  }
  return release;
}

export async function getGitHubReleaseNotes(
  tag?: string,
): Promise<GitHubReleaseNotes> {
  const release = tag
    ? await getGitHubReleaseByTag(tag)
    : await getLatestGitHubReleaseInfo();

  const releasesResponse = await fetch(`${releaseApiBase}?per_page=100`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'FreeTrans',
    },
  });
  if (!releasesResponse.ok) {
    throw new Error(
      `GitHub Releases request failed (${releasesResponse.status}).`,
    );
  }

  const releases = (await releasesResponse.json()) as GitHubRelease[];
  const previousRelease = releases
    .filter(
      candidate =>
        !candidate.draft &&
        candidate.tag_name !== release.tag_name &&
        semver.valid(candidate.tag_name) &&
        semver.lt(candidate.tag_name, release.tag_name),
    )
    .sort((left, right) => semver.rcompare(left.tag_name, right.tag_name))[0];

  const commits: GitHubCommitSummary[] = [];
  if (previousRelease) {
    const compareUrl = `${repositoryApiBase}/compare/${encodeURIComponent(
      previousRelease.tag_name,
    )}...${encodeURIComponent(release.tag_name)}`;
    const firstPageResponse = await fetch(`${compareUrl}?per_page=100&page=1`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'FreeTrans',
      },
    });
    if (!firstPageResponse.ok) {
      throw new Error(
        `GitHub comparison request failed (${firstPageResponse.status}).`,
      );
    }

    const firstPage = (await firstPageResponse.json()) as {
      total_commits?: number;
      commits?: { sha: string; commit: { message: string } }[];
    };
    commits.push(
      ...(firstPage.commits ?? []).map(commit => ({
        sha: commit.sha,
        message: commit.commit.message,
      })),
    );

    const pageCount = Math.ceil(
      (firstPage.total_commits ?? commits.length) / 100,
    );
    for (let page = 2; page <= pageCount; page += 1) {
      // eslint-disable-next-line no-await-in-loop -- Avoid bursting the GitHub API with paginated requests.
      const response = await fetch(`${compareUrl}?per_page=100&page=${page}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'FreeTrans',
        },
      });
      if (!response.ok) {
        throw new Error(
          `GitHub comparison request failed (${response.status}).`,
        );
      }

      // eslint-disable-next-line no-await-in-loop -- Parse each page before requesting the next one.
      const result = (await response.json()) as {
        commits?: { sha: string; commit: { message: string } }[];
      };
      commits.push(
        ...(result.commits ?? []).map(commit => ({
          sha: commit.sha,
          message: commit.commit.message,
        })),
      );
    }
  }

  return {
    version: release.tag_name,
    date: release.published_at ?? null,
    previousVersion: previousRelease?.tag_name ?? null,
    commits,
  };
}
