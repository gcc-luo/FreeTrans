/* eslint-disable no-await-in-loop, no-console, no-use-before-define */
import { spawnSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const platform = process.argv[2];
const packageJson = JSON.parse(
  await readFile(resolve(projectRoot, 'package.json'), 'utf8'),
);

if (!['mac', 'win'].includes(platform)) {
  throw new Error('Usage: node scripts/release-desktop.mjs <mac|win>');
}

const token = process.env.GITEE_TOKEN;
const owner = process.env.GITEE_OWNER || 'BoltTool';
const repository = process.env.GITEE_REPO || 'ferdium-app';
const apiBase = (
  process.env.GITEE_API_BASE || 'https://gitee.com/api/v5'
).replace(/\/$/);

if (!token) {
  throw new Error(
    'GITEE_TOKEN must be configured as a secret pipeline variable.',
  );
}
if (
  platform === 'mac' &&
  (!process.env.CSC_LINK || !process.env.CSC_KEY_PASSWORD)
) {
  throw new Error(
    'CSC_LINK and CSC_KEY_PASSWORD must be configured for signed macOS auto-updates.',
  );
}

const tag = await getTag();
const tagVersion = tag.replace(/^v/, '');
if (tagVersion !== packageJson.version) {
  throw new Error(
    `Release tag ${tag} does not match package.json version ${packageJson.version}.`,
  );
}

const startedAt = Date.now();
const isWindows = process.platform === 'win32';
const packageManager = isWindows ? 'pnpm.cmd' : 'pnpm';
run(packageManager, ['install', '--frozen-lockfile']);
run(packageManager, ['run', `build:release:${platform}`]);

const artifacts = await findArtifacts(platform, startedAt);
if (artifacts.length === 0) {
  throw new Error(
    `No ${platform} release artifacts found in the out directory.`,
  );
}

const release = await getOrCreateRelease();
const existingAttachments = await listAttachments(release.id);
const existingArtifacts = artifacts.filter(artifact =>
  existingAttachments.has(basename(artifact)),
);
if (
  existingArtifacts.length > 0 &&
  existingArtifacts.length !== artifacts.length
) {
  throw new Error(
    `The ${platform} Release contains only part of this build's attachments. Remove the partial attachments for ${tag} before retrying, to keep the update manifest and installers in sync.`,
  );
}

if (existingArtifacts.length === artifacts.length) {
  console.log(
    `Skipping the complete existing ${platform} artifact set for ${tag}.`,
  );
} else {
  for (const artifact of artifacts) {
    const filename = basename(artifact);
    await uploadAttachment(release.id, artifact);
    console.log(`Uploaded Gitee Release attachment: ${filename}`);
  }
}

async function getTag() {
  const configuredTag = process.env.GITEE_TAG || process.env.GITEE_REF;
  if (configuredTag) {
    return configuredTag.replace(/^refs\/tags\//, '');
  }

  const result = spawnSync(
    'git',
    ['describe', '--tags', '--exact-match', 'HEAD'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
    },
  );
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }

  throw new Error(
    'Cannot determine the release tag. Set GITEE_TAG or run this pipeline from a tag checkout.',
  );
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    shell: isWindows,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with status ${result.status}.`,
    );
  }
}

async function findArtifacts(targetPlatform, buildStartedAt) {
  const outputDirectory = resolve(projectRoot, 'out');
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  const requiredArtifacts =
    targetPlatform === 'mac'
      ? ['.dmg', '.zip', 'latest-mac.yml']
      : ['.exe', 'latest.yml'];
  const expectedExtensions =
    targetPlatform === 'mac'
      ? ['.dmg', '.zip', '.blockmap']
      : ['.exe', '.blockmap'];
  const found = [];

  for (const entry of entries) {
    const isReleaseArtifact =
      entry.isFile() &&
      (expectedExtensions.some(extension => entry.name.endsWith(extension)) ||
        requiredArtifacts.includes(entry.name)) &&
      (entry.name.includes(packageJson.version) ||
        requiredArtifacts.includes(entry.name));
    if (isReleaseArtifact) {
      const artifactPath = resolve(outputDirectory, entry.name);
      const metadata = await stat(artifactPath);
      if (metadata.mtimeMs >= buildStartedAt - 1000) found.push(artifactPath);
    }
  }

  const artifactNames = new Set(found.map(path => basename(path)));
  const missing = requiredArtifacts.filter(
    artifact =>
      !artifactNames.has(artifact) &&
      ![...artifactNames].some(name => name.endsWith(artifact)),
  );
  if (missing.length > 0) {
    throw new Error(
      `The ${targetPlatform} build is missing required update artifacts: ${missing.join(', ')}.`,
    );
  }

  const manifestName =
    targetPlatform === 'mac' ? 'latest-mac.yml' : 'latest.yml';
  const manifestPath = found.find(path => basename(path) === manifestName);
  const manifestText = await readFile(manifestPath, 'utf8');
  const referencedAssets = [
    ...manifestText.matchAll(
      /^\s*(?:-\s*)?url:\s*["']?([^\n\r"']+)["']?\s*$/gm,
    ),
  ]
    .map(match =>
      basename(decodeURIComponent(match[1].trim().split(/[#?]/, 1)[0])),
    )
    .filter(Boolean);
  const missingReferencedAssets = referencedAssets.filter(
    asset => !artifactNames.has(asset),
  );
  if (referencedAssets.length === 0 || missingReferencedAssets.length > 0) {
    throw new Error(
      `The ${manifestName} does not reference uploaded artifacts: ${missingReferencedAssets.join(', ') || 'no assets found'}.`,
    );
  }

  const expectedBlockmap =
    targetPlatform === 'mac'
      ? referencedAssets.find(asset => asset.endsWith('.zip'))
      : referencedAssets.find(asset => asset.endsWith('.exe'));
  if (expectedBlockmap && !artifactNames.has(`${expectedBlockmap}.blockmap`)) {
    throw new Error(
      `The ${targetPlatform} build is missing ${expectedBlockmap}.blockmap required for differential updates.`,
    );
  }

  return found.sort((left, right) =>
    basename(left).localeCompare(basename(right)),
  );
}

function releaseUrl(pathname) {
  return `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}${pathname}`;
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  const responseText = await response.text();
  let body;
  try {
    body = responseText ? JSON.parse(responseText) : undefined;
  } catch {
    body = responseText;
  }
  return { response, body };
}

async function getRelease() {
  const { response, body } = await apiRequest(
    releaseUrl(`/releases/tags/${encodeURIComponent(tag)}`),
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Gitee Release lookup failed (${response.status}): ${formatBody(body)}`,
    );
  }
  return body;
}

async function getOrCreateRelease() {
  const currentRelease = await getRelease();
  if (currentRelease !== null) return currentRelease;

  const commit = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  if (commit.status !== 0 || !commit.stdout.trim()) {
    throw new Error('Cannot determine the commit SHA for the Gitee Release.');
  }

  const { response, body } = await apiRequest(releaseUrl('/releases'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: tag,
      body: `FreeTrans ${tag} 桌面端安装包。`,
      prerelease: tagVersion.includes('-'),
      target_commitish: commit.stdout.trim(),
    }),
  });
  if (response.ok) return body;

  // macOS and Windows jobs can create the shared release at the same time.
  if (response.status === 409 || response.status === 422) {
    const racedRelease = await getRelease();
    if (racedRelease !== null) return racedRelease;
  }

  throw new Error(
    `Gitee Release creation failed (${response.status}): ${formatBody(body)}`,
  );
}

async function listAttachments(releaseId) {
  const { response, body } = await apiRequest(
    releaseUrl(`/releases/${releaseId}/attach_files`),
  );
  if (!response.ok) {
    throw new Error(
      `Gitee attachment lookup failed (${response.status}): ${formatBody(body)}`,
    );
  }
  if (!Array.isArray(body)) {
    throw new TypeError(
      'Gitee attachment lookup returned an unexpected response.',
    );
  }
  return new Set(body.map(attachment => attachment.name).filter(Boolean));
}

async function uploadAttachment(releaseId, artifactPath) {
  const artifact = await readFile(artifactPath);
  const form = new FormData();
  form.append('file', new Blob([artifact]), basename(artifactPath));

  const { response, body } = await apiRequest(
    releaseUrl(`/releases/${releaseId}/attach_files`),
    { method: 'POST', body: form },
  );
  if (!response.ok) {
    throw new Error(
      `Gitee attachment upload failed for ${basename(artifactPath)} (${response.status}): ${formatBody(body)}`,
    );
  }
}

function formatBody(body) {
  if (typeof body === 'string') return body.slice(0, 500);
  return JSON.stringify(body);
}
