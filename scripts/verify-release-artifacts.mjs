import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const platform = process.argv[2];
const outputDirectory = resolve(projectRoot, process.argv[3] || 'out');
if (!['mac', 'win'].includes(platform)) {
  throw new Error(
    'Usage: node scripts/verify-release-artifacts.mjs <mac|win> [directory]',
  );
}

const { version } = JSON.parse(
  readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
);
const artifacts = readdirSync(outputDirectory).filter(name =>
  statSync(resolve(outputDirectory, name)).isFile(),
);
const artifactNames = new Set(artifacts);
const manifestName = platform === 'mac' ? 'latest-mac.yml' : 'latest.yml';
const installerExtension = platform === 'mac' ? '.dmg' : '.exe';
const updateExtension = platform === 'mac' ? '.zip' : '.exe';

if (!artifactNames.has(manifestName)) {
  throw new Error(`Missing update manifest: ${manifestName}.`);
}
if (
  !artifacts.some(
    name => name.includes(version) && name.endsWith(installerExtension),
  )
) {
  throw new Error(`Missing ${platform} ${installerExtension} installer.`);
}

const manifestText = readFileSync(
  resolve(outputDirectory, manifestName),
  'utf8',
);
const referencedAssets = [
  ...manifestText.matchAll(/^\s*(?:-\s*)?url:\s*["']?([^\n\r"']+)["']?\s*$/gm),
].map(match =>
  basename(decodeURIComponent(match[1].trim().split(/[#?]/, 1)[0])),
);
if (
  referencedAssets.length === 0 ||
  !referencedAssets.some(name => name.endsWith(updateExtension))
) {
  throw new Error(`${manifestName} has no ${platform} update package.`);
}

for (const asset of referencedAssets) {
  if (!artifactNames.has(asset)) {
    throw new Error(`${manifestName} references a missing asset: ${asset}.`);
  }
  if (!artifactNames.has(`${asset}.blockmap`)) {
    throw new Error(`Missing differential update file: ${asset}.blockmap.`);
  }
}

console.log(
  `Verified ${platform} release: ${manifestName} and ${referencedAssets.length} update package(s).`,
);
