import { ipcMain } from 'electron';

import LanguageDetect from 'languagedetect';

const debug = require('../../preload-safe-debug')(
  'Ferdium:ipcApi:languageDetect',
);

export default async () => {
  ipcMain.handle('detect-language', async (_event, payload) => {
    if (!LanguageDetect) {
      return '';
    }
    const sample = String(payload?.sample || '').trim();
    if (!sample) {
      return '';
    }

    try {
      const langDetector = new LanguageDetect();
      langDetector.setLanguageType('iso2');
      debug('Checking language for sample:', sample);
      const result = langDetector.detect(sample, 1);
      debug('Language detection result:', result);

      if (!Array.isArray(result) || result.length === 0) {
        return '';
      }
      const first = result[0];
      if (!Array.isArray(first) || !first[0]) {
        return '';
      }
      return String(first[0] || '').trim();
    } catch (error) {
      debug('Language detection failed:', {
        sample: sample.slice(0, 80),
        error,
      });
      return '';
    }
  });
};
