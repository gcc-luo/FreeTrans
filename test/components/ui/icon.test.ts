import { resolveIconPath } from '../../../src/components/ui/icon';

describe('ui/icon resolveIconPath', () => {
  it('优先使用 path', () => {
    const result = resolveIconPath({
      path: 'M 0 0',
      icon: 'M 1 1',
    } as any);
    expect(result).toBe('M 0 0');
  });

  it('path 缺失时回退 icon', () => {
    const result = resolveIconPath({
      icon: 'M 1 1',
    } as any);
    expect(result).toBe('M 1 1');
  });

  it('path 和 icon 都缺失时返回空字符串', () => {
    const result = resolveIconPath({} as any);
    expect(result).toBe('');
  });
});
