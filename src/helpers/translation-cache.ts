import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import {
  ensureDirSync,
  pathExistsSync,
  readJsonSync,
  writeJsonSync,
} from 'fs-extra';

const debug = require('../preload-safe-debug')('Ferdium:TranslationCache');

const CACHE_FILE_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 5000;

interface TranslationCacheKeyInput {
  sourceText: string;
  fromLanguage: string;
  toLanguage: string;
  engine: string;
}

interface TranslationCacheEntry extends TranslationCacheKeyInput {
  key: string;
  translatedText: string;
  updatedAt: number;
  createdAt: number;
}

interface TranslationCacheFilePayload {
  version: number;
  entries: TranslationCacheEntry[];
}

interface ReverseLookupInput {
  translatedText: string;
  fromLanguage?: string;
  toLanguage?: string;
  engine?: string;
}

const normalizeLanguage = (value: string) =>
  String(value || '')
    .trim()
    .replaceAll('_', '-')
    .toLowerCase();

const normalizeText = (value: string) =>
  String(value || '')
    .replaceAll('\r\n', '\n')
    .trim();

const toLanguageBase = (value: string) => {
  const normalized = normalizeLanguage(value);
  if (!normalized) return '';
  if (normalized.startsWith('zh')) return 'zh';
  return normalized.split('-')[0] || normalized;
};

const languageMatches = (left: string, right: string) => {
  const normalizedLeft = normalizeLanguage(left);
  const normalizedRight = normalizeLanguage(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return (
    normalizedLeft === normalizedRight ||
    toLanguageBase(normalizedLeft) === toLanguageBase(normalizedRight)
  );
};

const buildCacheKey = ({
  sourceText,
  fromLanguage,
  toLanguage,
  engine,
}: TranslationCacheKeyInput) => {
  const hashSource = JSON.stringify({
    sourceText: normalizeText(sourceText),
    fromLanguage: normalizeLanguage(fromLanguage),
    toLanguage: normalizeLanguage(toLanguage),
    engine: normalizeLanguage(engine),
  });
  return createHash('sha1').update(hashSource, 'utf8').digest('hex');
};

export class TranslationCache {
  private readonly filePath: string;

  private readonly maxEntries: number;

  private readonly entryByKey = new Map<string, TranslationCacheEntry>();

  constructor(filePath: string, maxEntries = DEFAULT_MAX_ENTRIES) {
    this.filePath = String(filePath || '').trim();
    this.maxEntries =
      Number.isFinite(maxEntries) && maxEntries > 0
        ? Math.floor(maxEntries)
        : DEFAULT_MAX_ENTRIES;
    this.loadFromDisk();
  }

  lookup(input: TranslationCacheKeyInput): string | null {
    const key = buildCacheKey(input);
    const hit = this.entryByKey.get(key);
    if (!hit) {
      return null;
    }

    hit.updatedAt = Date.now();
    return String(hit.translatedText || '');
  }

  lookupOriginalByTranslatedText(input: ReverseLookupInput): string | null {
    const translatedText = normalizeText(input.translatedText);
    if (!translatedText) return null;

    const normalizedToLanguage = normalizeLanguage(input.toLanguage || '');
    const normalizedFromLanguage = normalizeLanguage(input.fromLanguage || '');
    const normalizedEngine = normalizeLanguage(input.engine || '');

    const candidates = [...this.entryByKey.values()].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );

    let bestEntry: TranslationCacheEntry | null = null;
    let bestScore = -1;
    for (const entry of candidates) {
      const translatedMatches =
        normalizeText(entry.translatedText) === translatedText;
      const toLanguageMatches =
        !normalizedToLanguage ||
        languageMatches(entry.toLanguage, normalizedToLanguage);

      if (translatedMatches && toLanguageMatches) {
        let score = 0;
        if (normalizedToLanguage) {
          score += 4;
        }
        if (
          normalizedEngine &&
          normalizeLanguage(entry.engine) === normalizedEngine
        ) {
          score += 2;
        }
        if (
          normalizedFromLanguage &&
          languageMatches(entry.fromLanguage, normalizedFromLanguage)
        ) {
          score += 1;
        }

        if (
          score > bestScore ||
          (score === bestScore &&
            bestEntry &&
            Number(entry.updatedAt || 0) > Number(bestEntry.updatedAt || 0))
        ) {
          bestScore = score;
          bestEntry = entry;
        }
      }
    }

    if (!bestEntry?.sourceText) return null;
    return normalizeText(bestEntry.sourceText);
  }

  save(input: TranslationCacheKeyInput, translatedText: string) {
    const normalizedTranslatedText = normalizeText(translatedText);
    if (!normalizedTranslatedText) return;

    const normalizedInput: TranslationCacheKeyInput = {
      sourceText: normalizeText(input.sourceText),
      fromLanguage: normalizeLanguage(input.fromLanguage),
      toLanguage: normalizeLanguage(input.toLanguage),
      engine: normalizeLanguage(input.engine),
    };
    if (!normalizedInput.sourceText) return;

    const now = Date.now();
    const key = buildCacheKey(normalizedInput);
    const existing = this.entryByKey.get(key);
    this.entryByKey.set(key, {
      key,
      sourceText: normalizedInput.sourceText,
      fromLanguage: normalizedInput.fromLanguage,
      toLanguage: normalizedInput.toLanguage,
      engine: normalizedInput.engine,
      translatedText: normalizedTranslatedText,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });

    this.pruneIfNeeded();
    this.persistToDisk();
  }

  private loadFromDisk() {
    if (!this.filePath) return;
    if (!pathExistsSync(this.filePath)) return;
    try {
      const payload = readJsonSync(this.filePath, {
        throws: false,
      }) as TranslationCacheFilePayload | null;
      if (
        !payload ||
        payload.version !== CACHE_FILE_VERSION ||
        !Array.isArray(payload.entries)
      ) {
        return;
      }

      for (const entry of payload.entries) {
        const isValidEntry = Boolean(
          entry?.key &&
            entry.sourceText &&
            entry.translatedText &&
            entry.fromLanguage &&
            entry.toLanguage &&
            entry.engine,
        );
        if (isValidEntry) {
          this.entryByKey.set(entry.key, {
            ...entry,
            sourceText: normalizeText(entry.sourceText),
            translatedText: normalizeText(entry.translatedText),
            fromLanguage: normalizeLanguage(entry.fromLanguage),
            toLanguage: normalizeLanguage(entry.toLanguage),
            engine: normalizeLanguage(entry.engine),
            createdAt: Number(entry.createdAt || Date.now()),
            updatedAt: Number(entry.updatedAt || Date.now()),
          });
        }
      }

      this.pruneIfNeeded();
    } catch (error) {
      debug('Failed to load translation cache from disk', {
        filePath: this.filePath,
        error,
      });
    }
  }

  private persistToDisk() {
    if (!this.filePath) return;
    try {
      ensureDirSync(dirname(this.filePath));
      const payload: TranslationCacheFilePayload = {
        version: CACHE_FILE_VERSION,
        entries: [...this.entryByKey.values()].sort(
          (left, right) => right.updatedAt - left.updatedAt,
        ),
      };
      writeJsonSync(this.filePath, payload, {
        spaces: 2,
      });
    } catch (error) {
      debug('Failed to persist translation cache to disk', {
        filePath: this.filePath,
        error,
      });
    }
  }

  private pruneIfNeeded() {
    if (this.entryByKey.size <= this.maxEntries) return;

    const sortedByOldest = [...this.entryByKey.values()].sort(
      (left, right) => left.updatedAt - right.updatedAt,
    );
    const overflowCount = this.entryByKey.size - this.maxEntries;
    for (let index = 0; index < overflowCount; index += 1) {
      const stale = sortedByOldest[index];
      if (stale?.key) {
        this.entryByKey.delete(stale.key);
      }
    }
  }
}

const cacheByFilePath = new Map<string, TranslationCache>();

export const getTranslationCache = (filePath: string, maxEntries?: number) => {
  const normalizedPath = String(filePath || '').trim();
  if (!normalizedPath) return null;
  const existed = cacheByFilePath.get(normalizedPath);
  if (existed) return existed;

  const created = new TranslationCache(normalizedPath, maxEntries);
  cacheByFilePath.set(normalizedPath, created);
  return created;
};

export const clearTranslationCacheInstancesForTests = () => {
  cacheByFilePath.clear();
};
