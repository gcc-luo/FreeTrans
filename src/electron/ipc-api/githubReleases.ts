const releaseApiBase =
  'https://api.github.com/repos/gcc-luo/FreeTrans/releases';

interface GitHubRelease {
  tag_name: string;
  body?: string | null;
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
