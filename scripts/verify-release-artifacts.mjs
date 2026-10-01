import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const platform = process.argv[2];
const outputDirectory = resolve(projectRoot, process.argv[3] || 'out');
const arch = process.argv[4];
if (!['mac', 'win'].includes(platform)) {
  throw new Error(
    'Usage: node scripts/verify-release-artifacts.mjs <mac|win> [directory] [arch]',
  );
}

const { version } = JSON.parse(
  readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
);
const extension = platform === 'mac' ? '.dmg' : '.exe';
const packages = readdirSync(outputDirectory).filter(
  name =>
    statSync(resolve(outputDirectory, name)).isFile() &&
    name.startsWith(`FreeTrans-${platform}-`) &&
    name.includes(`-${version}-`) &&
    name.endsWith(extension) &&
    (!arch || name.endsWith(`-${arch}${extension}`)),
);
if (packages.length === 0) {
  throw new Error(`Missing FreeTrans ${platform}/${arch || 'any'} installer.`);
}

console.log(`Verified ${platform} installer(s): ${packages.join(', ')}`);
