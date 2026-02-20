import {
  TARGET_LANGUAGE_OPTIONS,
  VISIBLE_LANGUAGE_OPTIONS,
  getMyLanguageOptions,
  getTargetLanguageOptions,
  normalizeVisibleLanguageValue,
} from '../../../src/features/messageTranslator/language-options';

describe('MessageTranslator language options', () => {
  it('hides Cantonese and Traditional Chinese from panel options', () => {
    const values = VISIBLE_LANGUAGE_OPTIONS.map(option => option.value);
    expect(values).not.toContain('yue');
    expect(values).not.toContain('zh-TW');
  });

  it('keeps auto only in my-language options and excludes it from target', () => {
    const myValues = getMyLanguageOptions('').map(option => option.value);
    const targetValues = TARGET_LANGUAGE_OPTIONS.map(option => option.value);
    expect(myValues).toContain('auto');
    expect(targetValues).not.toContain('auto');
  });

  it('supports dropdown searching by language label and code', () => {
    const byLabel = getMyLanguageOptions('法语');
    expect(byLabel.map(option => option.value)).toContain('fr');

    const byCode = getTargetLanguageOptions('de');
    expect(byCode.map(option => option.value)).toContain('de');
  });

  it('falls back hidden or unsupported selected values to a safe default', () => {
    const myOptions = getMyLanguageOptions('');
    const targetOptions = getTargetLanguageOptions('');

    expect(normalizeVisibleLanguageValue('yue', myOptions, 'auto')).toBe(
      'auto',
    );
    expect(normalizeVisibleLanguageValue('zh-TW', targetOptions, 'en')).toBe(
      'en',
    );
    expect(normalizeVisibleLanguageValue('fr', targetOptions, 'en')).toBe('fr');
  });
});
