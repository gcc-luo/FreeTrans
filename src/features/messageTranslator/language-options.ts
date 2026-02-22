export interface LanguageOption {
  value: string;
  label: string;
}

const BASE_LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: 'auto', label: '自动' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英语' },
  { value: 'yue', label: '粤语' },
  { value: 'wyw', label: '文言文' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
  { value: 'fr', label: '法语' },
  { value: 'es', label: '西班牙语' },
  { value: 'th', label: '泰语' },
  { value: 'ar', label: '阿拉伯语' },
  { value: 'ru', label: '俄语' },
  { value: 'pt', label: '葡萄牙语' },
  { value: 'de', label: '德语' },
  { value: 'it', label: '意大利语' },
  { value: 'el', label: '希腊语' },
  { value: 'nl', label: '荷兰语' },
  { value: 'pl', label: '波兰语' },
  { value: 'bg', label: '保加利亚语' },
  { value: 'et', label: '爱沙尼亚语' },
  { value: 'da', label: '丹麦语' },
  { value: 'fi', label: '芬兰语' },
  { value: 'cs', label: '捷克语' },
  { value: 'ro', label: '罗马尼亚语' },
  { value: 'sl', label: '斯洛文尼亚语' },
  { value: 'sv', label: '瑞典语' },
  { value: 'hu', label: '匈牙利语' },
  { value: 'zh-TW', label: '繁体中文' },
  { value: 'vi', label: '越南语' },
  { value: 'id', label: '印尼语' },
  { value: 'hi', label: '印地语' },
];

const HIDDEN_LANGUAGE_VALUES = new Set(['yue', 'zh-TW']);

export const VISIBLE_LANGUAGE_OPTIONS = BASE_LANGUAGE_OPTIONS.filter(
  option => !HIDDEN_LANGUAGE_VALUES.has(option.value),
);

export const TARGET_LANGUAGE_OPTIONS = VISIBLE_LANGUAGE_OPTIONS.filter(
  option => option.value !== 'auto',
);

export const filterLanguageOptions = (
  options: LanguageOption[],
  query: string,
) => {
  const keyword = String(query || '')
    .trim()
    .toLowerCase();
  if (!keyword) return options;
  return options.filter(
    option =>
      option.label.toLowerCase().includes(keyword) ||
      option.value.toLowerCase().includes(keyword),
  );
};

export const getMyLanguageOptions = (query: string) =>
  filterLanguageOptions(VISIBLE_LANGUAGE_OPTIONS, query);

export const getTargetLanguageOptions = (query: string) =>
  filterLanguageOptions(TARGET_LANGUAGE_OPTIONS, query);

export const normalizeVisibleLanguageValue = (
  value: string,
  options: LanguageOption[],
  fallbackValue: string,
) => {
  const normalized = String(value || '').trim();
  if (options.some(option => option.value === normalized)) {
    return normalized;
  }
  return fallbackValue;
};
