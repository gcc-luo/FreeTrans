import { spawnSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import fsExtra from 'fs-extra';

const { copyFileSync, ensureDirSync, pathExistsSync, removeSync } = fsExtra;

const rootDir = process.cwd();
const buildDir = resolve(rootDir, 'build');
const buildLockFile = resolve(buildDir, 'pnpm-lock.yaml');
const rootLockFile = resolve(rootDir, 'pnpm-lock.yaml');
const buildSqliteBindingDir = resolve(
  rootDir,
  'build/node_modules/sqlite3/lib/binding',
);
const rootPnpmDir = resolve(rootDir, 'node_modules/.pnpm');

const getSqliteBinaryFilesFromBindingDir = bindingDir => {
  if (!pathExistsSync(bindingDir)) {
    return [];
  }

  return fsExtra
    .readdirSync(bindingDir)
    .map(abiDir => resolve(bindingDir, abiDir, 'node_sqlite3.node'))
    .filter(filePath => pathExistsSync(filePath));
};

const getRootSqliteBinaryFiles = () => {
  if (!pathExistsSync(rootPnpmDir)) {
    return [];
  }

  const sqlitePackageDirs = fsExtra
    .readdirSync(rootPnpmDir)
    .filter(entry => entry.startsWith('sqlite3@'))
    .map(entry =>
      resolve(rootPnpmDir, entry, 'node_modules/sqlite3/lib/binding'),
    );

  return sqlitePackageDirs.flatMap(bindingDir =>
    getSqliteBinaryFilesFromBindingDir(bindingDir),
  );
};

const getBuildSqliteBinaryFiles = () => {
  return getSqliteBinaryFilesFromBindingDir(buildSqliteBindingDir);
};

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}`,
    );
  }
};

const ensureSqliteBinaryForBuild = async () => {
  const bundledBinaryPaths = getBuildSqliteBinaryFiles();
  if (bundledBinaryPaths.length > 0) {
    return;
  }

  const rootBinaryPaths = getRootSqliteBinaryFiles();
  if (rootBinaryPaths.length === 0) {
    throw new Error(
      'sqlite3 native binary was not found in root node_modules. Run "pnpm install" before packaging.',
    );
  }

  for (const sourcePath of rootBinaryPaths) {
    const abiDirectory = basename(dirname(sourcePath));
    const targetPath = resolve(
      rootDir,
      'build/node_modules/sqlite3/lib/binding',
      abiDirectory ?? '',
      'node_sqlite3.node',
    );
    ensureDirSync(dirname(targetPath));
    copyFileSync(sourcePath, targetPath);
  }

  const copiedBinaryPaths = getBuildSqliteBinaryFiles();
  if (copiedBinaryPaths.length === 0) {
    throw new Error('Failed to copy sqlite3 native binary into build folder.');
  }
};

const main = async () => {
  removeSync(resolve(buildDir, 'node_modules'));
  removeSync(buildLockFile);
  copyFileSync(rootLockFile, buildLockFile);

  run('pnpm', [
    'install',
    '--prod',
    '--prefer-offline',
    '--frozen-lockfile',
    '--ignore-workspace',
    '--ignore-scripts',
    '--dir',
    './build',
  ]);

  await ensureSqliteBinaryForBuild();

  const hasSqliteBinary = getBuildSqliteBinaryFiles();
  if (hasSqliteBinary.length === 0 || !pathExistsSync(hasSqliteBinary[0])) {
    throw new Error(
      'sqlite3 native binary is still missing after preparation.',
    );
  }
};

try {
  await main();
} catch (error) {
  console.error('[prepare-build-app-deps] Failed:', error);
  process.exitCode = 1;
}
