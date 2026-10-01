import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const { appId, productName } = JSON.parse(
  readFileSync(join(projectDirectory, 'package.json'), 'utf8'),
);

const setPlistValue = (plistPath, key, value) => {
  execFileSync('/usr/libexec/PlistBuddy', [
    '-c',
    `Set :${key} "${value}"`,
    plistPath,
  ]);
};

let executablePath = require('electron');

if (process.platform === 'darwin') {
  // The Dock reads the app bundle and executable names, not app.setName().
  const electronPackageDirectory = dirname(
    require.resolve('electron/package.json'),
  );
  const electronAppPath = join(
    electronPackageDirectory,
    'dist',
    'Electron.app',
  );
  const devAppPath = join(projectDirectory, 'out', 'dev', `${productName}.app`);
  const devExecutablePath = join(devAppPath, 'Contents', 'MacOS', productName);
  const runtimeStampPath = join(projectDirectory, 'out', 'dev', '.runtime');
  const runtimeStamp = JSON.stringify({
    electronPackageDirectory,
    electronVersion: require('electron/package.json').version,
    productName,
    appId,
  });

  mkdirSync(dirname(devAppPath), { recursive: true });
  if (
    !existsSync(devExecutablePath) ||
    !existsSync(runtimeStampPath) ||
    readFileSync(runtimeStampPath, 'utf8') !== runtimeStamp
  ) {
    rmSync(devAppPath, { recursive: true, force: true });
    execFileSync('/bin/cp', ['-pcR', electronAppPath, devAppPath], {
      stdio: 'inherit',
    });

    const infoPlistPath = join(devAppPath, 'Contents', 'Info.plist');
    setPlistValue(infoPlistPath, 'CFBundleName', productName);
    setPlistValue(infoPlistPath, 'CFBundleDisplayName', productName);
    setPlistValue(infoPlistPath, 'CFBundleExecutable', productName);
    setPlistValue(infoPlistPath, 'CFBundleIdentifier', `${appId}.dev`);

    renameSync(
      join(devAppPath, 'Contents', 'MacOS', 'Electron'),
      devExecutablePath,
    );
    writeFileSync(runtimeStampPath, runtimeStamp);
  }

  executablePath = devExecutablePath;
}

const appProcess = spawn(
  executablePath,
  [join(projectDirectory, 'build'), ...process.argv.slice(2)],
  {
    cwd: projectDirectory,
    // A renamed .app looks packaged to Electron even when it loads ./build.
    env: { ...process.env, ELECTRON_IS_DEV: '1' },
    stdio: 'inherit',
  },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => appProcess.kill(signal));
}

appProcess.on('error', error => {
  console.error(error);
  process.exitCode = 1;
});

appProcess.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 128 : 1);
});
