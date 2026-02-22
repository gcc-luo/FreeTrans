import { app } from 'electron';
import { appendFileSync, ensureDirSync, ensureFileSync } from 'fs-extra';
import { existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const LOG_FILE_PREFIX = 'ferdium-app';
const MAX_LOG_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_LOG_FILE_BACKUPS = 7;

let resolvedLogFilePath: string | null = null;
let resolvedLogsDirPath: string | null = null;
let resolvedLogDate: string | null = null;
const bufferedLines: string[] = [];
let consolePatched = false;

const normalizeLine = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Error)
    return `${value.name}: ${value.message}\n${value.stack || ''}`;
  try {
    return inspect(value, {
      depth: 5,
      breakLength: 120,
      compact: true,
      maxArrayLength: 100,
      maxStringLength: 10_000,
    });
  } catch {
    return String(value);
  }
};

const getDatePart = (date = new Date()) => date.toISOString().slice(0, 10);

const getDailyLogFilePath = (logsDir: string, datePart: string) =>
  join(logsDir, `${LOG_FILE_PREFIX}-${datePart}.log`);

const getRotatedPath = (basePath: string, index: number) =>
  `${basePath}.${index}`;

function rotateIfNeeded(nextLine: string): void {
  if (!resolvedLogFilePath) return;
  try {
    if (!existsSync(resolvedLogFilePath)) {
      ensureFileSync(resolvedLogFilePath);
      return;
    }
    const currentSize = statSync(resolvedLogFilePath).size;
    const nextSize = Buffer.byteLength(nextLine, 'utf8');
    if (currentSize + nextSize < MAX_LOG_FILE_SIZE_BYTES) return;

    for (let i = MAX_LOG_FILE_BACKUPS; i >= 1; i -= 1) {
      const from = getRotatedPath(resolvedLogFilePath, i);
      if (existsSync(from)) {
        if (i === MAX_LOG_FILE_BACKUPS) {
          unlinkSync(from);
        } else {
          const to = getRotatedPath(resolvedLogFilePath, i + 1);
          renameSync(from, to);
        }
      }
    }

    const rotatedFirst = getRotatedPath(resolvedLogFilePath, 1);
    if (existsSync(resolvedLogFilePath)) {
      renameSync(resolvedLogFilePath, rotatedFirst);
    }
    ensureFileSync(resolvedLogFilePath);
  } catch {
    // Keep silent to avoid recursive logging loops.
  }
}

const writeLine = (line: string) => {
  if (!resolvedLogFilePath || !resolvedLogsDirPath) {
    bufferedLines.push(line);
    return;
  }
  rotateIfNeeded(`${line}\n`);
  try {
    appendFileSync(resolvedLogFilePath, `${line}\n`, 'utf8');
  } catch {
    // Avoid recursive logging if file writing fails.
  }
};

const syncDailyLogTarget = () => {
  const logsDir = resolvedLogsDirPath || app.getPath('logs');
  ensureDirSync(logsDir);
  resolvedLogsDirPath = logsDir;

  const datePart = getDatePart();
  if (resolvedLogDate === datePart && resolvedLogFilePath) return;
  resolvedLogDate = datePart;
  resolvedLogFilePath = getDailyLogFilePath(logsDir, datePart);
  ensureFileSync(resolvedLogFilePath);
};

export const initializeFileLogger = (): string => {
  syncDailyLogTarget();

  if (bufferedLines.length > 0 && resolvedLogFilePath) {
    try {
      const bufferedPayload = `${bufferedLines.join('\n')}\n`;
      rotateIfNeeded(bufferedPayload);
      appendFileSync(resolvedLogFilePath, bufferedPayload, 'utf8');
    } catch {
      // Keep silent to avoid recursive noise.
    } finally {
      bufferedLines.length = 0;
    }
  }

  return resolvedLogFilePath;
};

export const getFileLogPath = (): string => {
  return initializeFileLogger();
};

export const writeToFileLog = (
  level: LogLevel,
  scope: string,
  ...args: unknown[]
): void => {
  syncDailyLogTarget();
  const timestamp = new Date().toISOString();
  const processType = process.type || 'browser';
  const body = args.map(arg => normalizeLine(arg)).join(' ');
  writeLine(
    `[${timestamp}] [${processType}] [${level.toUpperCase()}] [${scope}] ${body}`,
  );
};

export const attachMainConsoleToFileLog = () => {
  if (consolePatched) return;
  consolePatched = true;

  /* eslint-disable no-console -- intentional: patching console to also write to file */
  const originalLog = console.log.bind(console);
  const originalInfo = console.info.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    writeToFileLog('info', 'main-console', ...args);
    originalLog(...args);
  };
  console.info = (...args: unknown[]) => {
    writeToFileLog('info', 'main-console', ...args);
    originalInfo(...args);
  };
  console.warn = (...args: unknown[]) => {
    writeToFileLog('warn', 'main-console', ...args);
    originalWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    writeToFileLog('error', 'main-console', ...args);
    originalError(...args);
  };
  /* eslint-enable no-console */
};
