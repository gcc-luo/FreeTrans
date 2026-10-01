import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const tag = process.argv[2] || process.env.GITHUB_REF_NAME;
const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag || '');

if (!match) {
  throw new Error(`Invalid release tag: ${tag || '(missing)'}.`);
}

const packageJson = JSON.parse(
  readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
);
if (match[1] !== packageJson.version) {
  throw new Error(
    `Release tag ${tag} does not match package.json version ${packageJson.version}.`,
  );
}

console.log(`Release version verified: ${match[1]}`);
