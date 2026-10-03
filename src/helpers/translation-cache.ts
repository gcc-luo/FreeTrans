import { createHash } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ensureDirSync,
  pathExistsSync,
  readJsonSync,
  removeSync,
  writeJsonSync,
} from 'fs-extra';

const debug = require('../preload-safe-debug')('Ferdium:TranslationCache');

const CACHE_FILE_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 5000;
export const TRANSLATION_CACHE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface TranslationCacheKeyInput {
  serviceId?: string;
  sourceText: string;
  fromLanguage: string;
  toLanguage: string;
  engine: string;
}

interface TranslationCacheEntry extends TranslationCacheKeyInput {
  key: string;
  translatedText: string;
  usedEngine?: string;
  updatedAt: number;
  createdAt: number;
}

interface TranslationCacheFilePayload {
  version: number;
  entries: TranslationCacheEntry[];
}

interface ReverseLookupInput {
  serviceId?: string;
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
  serviceId,
  sourceText,
  fromLanguage,
  toLanguage,
  engine,
}: TranslationCacheKeyInput) => {
  const hashSource = JSON.stringify({
    ...(serviceId ? { serviceId: String(serviceId).trim() } : {}),
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
    return this.lookupResult(input)?.text || null;
  }

  lookupResult(input: TranslationCacheKeyInput): {
    text: string;
    usedEngine: string;
  } | null {
    if (this.pruneIfNeeded()) this.persistToDisk();
    const key = buildCacheKey(input);
    const hit = this.entryByKey.get(key);
    if (!hit) {
      return null;
    }

    hit.updatedAt = Date.now();
    return {
      text: String(hit.translatedText || ''),
      usedEngine: hit.usedEngine || hit.engine,
    };
  }

  lookupOriginalByTranslatedText(input: ReverseLookupInput): string | null {
    if (this.pruneIfNeeded()) this.persistToDisk();
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
      const serviceMatches =
        String(entry.serviceId || '') === String(input.serviceId || '');
      const translatedMatches =
        normalizeText(entry.translatedText) === translatedText;
      const toLanguageMatches =
        !normalizedToLanguage ||
        languageMatches(entry.toLanguage, normalizedToLanguage);

      if (serviceMatches && translatedMatches && toLanguageMatches) {
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

  save(
    input: TranslationCacheKeyInput,
    translatedText: string,
    usedEngine?: string,
  ) {
    const normalizedTranslatedText = normalizeText(translatedText);
    if (!normalizedTranslatedText) return;

    const normalizedInput: TranslationCacheKeyInput = {
      serviceId: String(input.serviceId || '').trim(),
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
      serviceId: normalizedInput.serviceId,
      sourceText: normalizedInput.sourceText,
      fromLanguage: normalizedInput.fromLanguage,
      toLanguage: normalizedInput.toLanguage,
      engine: normalizedInput.engine,
      translatedText: normalizedTranslatedText,
      usedEngine: usedEngine || normalizedInput.engine,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });

    this.pruneIfNeeded();
    this.persistToDisk();
  }

  clear() {
    this.entryByKey.clear();
    if (this.filePath) removeSync(this.filePath);
  }

  clearService(serviceId: string) {
    const normalizedServiceId = String(serviceId || '').trim();
    if (!normalizedServiceId) return;
    for (const [key, entry] of this.entryByKey) {
      // Older cache entries have no service ID, so their owner cannot be
      // determined safely when the user requests a service-level clear.
      if (!entry.serviceId || entry.serviceId === normalizedServiceId)
        this.entryByKey.delete(key);
    }
    this.persistToDisk();
  }

  private loadFromDisk() {
    if (!this.filePath) return;
    if (!pathExistsSync(this.filePath)) return;
    try {
      if (process.platform !== 'win32') chmodSync(this.filePath, 0o600);
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
      this.persistToDisk();
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
        mode: 0o600,
      });
      if (process.platform !== 'win32') chmodSync(this.filePath, 0o600);
    } catch (error) {
      debug('Failed to persist translation cache to disk', {
        filePath: this.filePath,
        error,
      });
    }
  }

  private pruneIfNeeded() {
    const initialSize = this.entryByKey.size;
    const expiresBefore = Date.now() - TRANSLATION_CACHE_RETENTION_MS;
    for (const [key, entry] of this.entryByKey) {
      if (Number(entry.createdAt || 0) < expiresBefore)
        this.entryByKey.delete(key);
    }
    if (this.entryByKey.size <= this.maxEntries)
      return this.entryByKey.size !== initialSize;

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
    return this.entryByKey.size !== initialSize;
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
