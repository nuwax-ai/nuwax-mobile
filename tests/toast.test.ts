import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { toastReadingDuration } from '@/utils/toast.uts';

const qrInvalid = '二维码无效或与当前服务不匹配，请在当前服务重新扫码。';

function setup(platform: string) {
  const active = [true];
  const source = readFileSync('utils/toast.uts', 'utf8')
    .split('\n')
    .filter((line) => {
      const start = line.match(/^\s*\/\/ #ifdef (.+)$/);
      if (start) {
        active.push(
          active[active.length - 1] &&
            start[1].split('||').some((name) => name.trim() === platform),
        );
        return false;
      }
      if (/^\s*\/\/ #endif/.test(line)) {
        active.pop();
        return false;
      }
      return active[active.length - 1];
    })
    .join('\n')
    .replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export /gm, '');
  const interceptors = new Map<string, any>();
  const showTextToast = vi.fn().mockReturnValue(true);
  const hideTextToast = vi.fn();
  const hideToast = vi.fn(() => interceptors.get('hideToast')?.invoke());
  const addInterceptor = vi.fn((name: string, interceptor: any) =>
    interceptors.set(name, interceptor),
  );
  const install = runInNewContext(
    transformSync(source + '\ninstallToastInterceptor;', { loader: 'ts' }).code,
    {
      uni: {
        addInterceptor,
        hideToast,
        getWindowInfo: () => ({ windowWidth: 375 }),
      },
      showTextToast,
      hideTextToast,
    },
  );
  install();
  return {
    install,
    interceptors,
    addInterceptor,
    showTextToast,
    hideTextToast,
    hideToast,
  };
}

describe('Toast 阅读时间', () => {
  it('短提示保留轻提示节奏，至少展示两秒', () => {
    expect(toastReadingDuration('已复制', 375)).toBe(2000);
  });
  it('截图中的两行提示延长到四秒，窄屏换行更多时再延长', () => {
    expect(toastReadingDuration(qrInvalid, 375)).toBe(4000);
    expect(toastReadingDuration(qrInvalid, 240)).toBeGreaterThan(4000);
  });
  it('三行以上继续延长，超长提示默认最多八秒', () => {
    expect(
      toastReadingDuration('提示内容'.repeat(12), 375),
    ).toBeGreaterThanOrEqual(5000);
    expect(toastReadingDuration('提示内容'.repeat(100), 375)).toBe(8000);
  });
  it('换行影响阅读时间，中英文与 emoji 都可计算', () => {
    expect(toastReadingDuration('第一行\n第二行\n第三行', 375)).toBe(4000);
    expect(toastReadingDuration('A'.repeat(40), 375)).toBeLessThan(
      toastReadingDuration('中'.repeat(40), 375),
    );
    expect(toastReadingDuration('😀'.repeat(15), 375)).toBe(
      toastReadingDuration('中'.repeat(15), 375),
    );
  });
  it('不缩短调用方已经设置的更长时长', () => {
    expect(toastReadingDuration(qrInvalid, 375, 10000)).toBe(10000);
    expect(toastReadingDuration(qrInvalid, 375, 1500)).toBe(4000);
  });
});

describe.each(['H5', 'APP-ANDROID', 'APP-HARMONY'])(
  'Toast 统一入口 %s',
  (platform) => {
    it('重复初始化不叠加拦截器，现有调用直接获得足够阅读时间', () => {
      const f = setup(platform);
      f.install();
      expect(f.addInterceptor).toHaveBeenCalledTimes(
        platform === 'APP-HARMONY' ? 3 : 1,
      );
      const options = { title: qrInvalid, icon: 'none', duration: 1500 };
      const shouldContinue = f.interceptors.get('showToast').invoke(options);
      expect(options.duration).toBe(4000);
      if (platform === 'APP-HARMONY') {
        expect(shouldContinue).toBe(false);
        expect(f.showTextToast).toHaveBeenCalledWith(qrInvalid, 343, 4000);
      } else {
        expect(shouldContinue).toBe(true);
        expect(f.showTextToast).not.toHaveBeenCalled();
      }
    });
  },
);

describe('鸿蒙纯文字 Toast', () => {
  it('自适应提示显示成功后，业务回调各触发一次', () => {
    const f = setup('APP-HARMONY');
    const success = vi.fn(),
      complete = vi.fn(),
      fail = vi.fn();
    expect(
      f.interceptors
        .get('showToast')
        .invoke({ title: qrInvalid, icon: 'none', success, complete, fail }),
    ).toBe(false);
    expect(success).toHaveBeenCalledExactlyOnceWith({ errMsg: 'showToast:ok' });
    expect(complete).toHaveBeenCalledExactlyOnceWith({
      errMsg: 'showToast:ok',
    });
    expect(fail).not.toHaveBeenCalled();
    expect(f.hideToast).toHaveBeenCalledOnce();
  });
  it.each([
    { icon: 'success' },
    { icon: 'loading' },
    { icon: 'none', image: '/static/icon.png' },
    { icon: 'none', mask: true },
    { icon: 'none', position: 'center' },
  ])('特殊样式 %j 保留框架实现', (style) => {
    const f = setup('APP-HARMONY');
    expect(
      f.interceptors.get('showToast').invoke({ title: qrInvalid, ...style }),
    ).toBe(true);
    expect(f.showTextToast).not.toHaveBeenCalled();
    expect(f.hideTextToast).toHaveBeenCalledOnce();
  });
  it('原生窗口不可用时仍交回原 Toast，不丢失业务提示', () => {
    const f = setup('APP-HARMONY');
    f.showTextToast.mockReturnValue(false);
    const success = vi.fn();
    expect(
      f.interceptors
        .get('showToast')
        .invoke({ title: qrInvalid, icon: 'none', success }),
    ).toBe(true);
    expect(success).not.toHaveBeenCalled();
  });
  it('主动隐藏、加载提示与后续提示都会清理旧文字提示', () => {
    const f = setup('APP-HARMONY');
    f.interceptors.get('showToast').invoke({ title: qrInvalid, icon: 'none' });
    expect(f.interceptors.get('hideToast').invoke()).toBe(true);
    expect(f.interceptors.get('showLoading').invoke()).toBe(true);
    expect(f.hideTextToast).toHaveBeenCalledTimes(4);
  });
});
