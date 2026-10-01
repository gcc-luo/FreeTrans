const owner = 'BoltTool';
const repository = 'ferdium-app';
const apiBase = 'https://gitee.com/api/v5';

export interface GiteeRelease {
  id: number;
  tag_name: string;
  name?: string;
  body?: string | null;
  prerelease?: boolean;
  draft?: boolean;
  created_at?: string;
  published_at?: string;
}

interface GiteeAttachment {
  name?: string;
}

function getApiUrl(path: string): string {
  return `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}${path}`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Gitee API request failed (${response.status}): ${responseText.slice(0, 300)}`,
    );
  }
  return (await response.json()) as T;
}

export async function getGiteeReleaseByTag(tag: string): Promise<GiteeRelease> {
  const safeTag = String(tag || '').trim();
  if (!safeTag || safeTag.length > 128) {
    throw new Error('A valid Gitee release tag is required.');
  }

  return getJson<GiteeRelease>(
    getApiUrl(`/releases/tags/${encodeURIComponent(safeTag)}`),
  );
}

export async function getLatestGiteeRelease(
  allowPrerelease: boolean,
  manifestName: string,
): Promise<GiteeRelease | undefined> {
  const releases = await getJson<GiteeRelease[]>(
    getApiUrl('/releases?page=1&per_page=100'),
  );
  if (!Array.isArray(releases)) {
    throw new TypeError('Gitee returned an unexpected release list.');
  }

  const candidates = releases
    .filter(
      release =>
        release?.id &&
        release.tag_name &&
        !release.draft &&
        (allowPrerelease || !release.prerelease),
    )
    .sort((left, right) => {
      const leftDate = Date.parse(left.published_at || left.created_at || '');
      const rightDate = Date.parse(
        right.published_at || right.created_at || '',
      );
      return rightDate - leftDate;
    });

  for (const release of candidates) {
    // Check in release order and stop at the first candidate with this platform's feed.
    // eslint-disable-next-line no-await-in-loop
    const attachments = await getJson<GiteeAttachment[]>(
      getApiUrl(`/releases/${release.id}/attach_files`),
    );
    if (
      Array.isArray(attachments) &&
      attachments.some(attachment => attachment?.name === manifestName)
    ) {
      return release;
    }
  }

  return undefined;
}

export function getGiteeReleaseDownloadUrl(tag: string): string {
  return `https://gitee.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/releases/download/${encodeURIComponent(tag)}`;
}
