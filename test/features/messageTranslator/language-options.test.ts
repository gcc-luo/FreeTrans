import {
  getMyLanguageOptions,
  getTargetLanguageOptions,
  normalizeVisibleLanguageValue,
  TARGET_LANGUAGE_OPTIONS,
  VISIBLE_LANGUAGE_OPTIONS,
} from '../../../src/features/messageTranslator/language-options';

describe('messageTranslator language options', () => {
  it('exposes id/hi in my-language options', () => {
    const options = getMyLanguageOptions('');
    const values = new Set(options.map(option => option.value));
    expect(values.has('id')).toBe(true);
    expect(values.has('hi')).toBe(true);
  });

  it('exposes id/hi in target-language options', () => {
    const options = getTargetLanguageOptions('');
    const values = new Set(options.map(option => option.value));
    expect(values.has('id')).toBe(true);
    expect(values.has('hi')).toBe(true);
  });

  it('keeps selected id/hi values instead of falling back', () => {
    const myOptions = getMyLanguageOptions('');
    const targetOptions = getTargetLanguageOptions('');
    expect(normalizeVisibleLanguageValue('id', myOptions, 'auto')).toBe('id');
    expect(normalizeVisibleLanguageValue('hi', targetOptions, 'en')).toBe('hi');
  });
});

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
