const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

module.exports = async context => {
  if (
    context.electronPlatformName !== 'darwin' ||
    process.env.CSC_LINK ||
    process.env.CSC_NAME
  ) {
    return;
  }

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const entitlementsPath = join(
    context.packager.projectDir,
    'build-helpers/entitlements.mas.plist',
  );

  console.log(`[afterPack] Applying ad-hoc signature to ${appPath}`);
  execFileSync(
    'codesign',
    [
      '--force',
      '--deep',
      '--sign',
      '-',
      '--options',
      'runtime',
      '--entitlements',
      entitlementsPath,
      appPath,
    ],
    { stdio: 'inherit' },
  );
  execFileSync(
    'codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', appPath],
    { stdio: 'inherit' },
  );
};
