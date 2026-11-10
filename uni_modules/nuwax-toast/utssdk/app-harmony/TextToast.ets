import { ComponentContent, UIContext } from '@kit.ArkUI';

class ToastContent {
  title: string;
  maxWidth: number;

  constructor(title: string, maxWidth: number) {
    this.title = title;
    this.maxWidth = maxWidth;
  }
}

@Builder
function toastBuilder(content: ToastContent) {
  Text(content.title)
    .fontColor(Color.White)
    .fontSize(16)
    .textAlign(TextAlign.Center)
    .wordBreak(WordBreak.BREAK_WORD)
    .padding({ top: 12, bottom: 12, left: 20, right: 20 })
    .constraintSize({ maxWidth: content.maxWidth })
    .backgroundColor('#CC4C4C4C')
    .borderRadius(10)
    .hitTestBehavior(HitTestMode.None)
}

let currentToast: ComponentContent<ToastContent> | null = null;
let currentContext: UIContext | null = null;
let currentTimer: number | null = null;

export function hideToastOverlay(): void {
  if (currentTimer !== null) {
    clearTimeout(currentTimer);
    currentTimer = null;
  }
  const toast = currentToast;
  const context = currentContext;
  currentToast = null;
  currentContext = null;
  if (toast !== null && context !== null) {
    try {
      context.getOverlayManager().removeComponentContent(toast);
      toast.dispose();
    } catch (_error) {
      // 页面或窗口已销毁时，仍清掉本地引用和定时器。
    }
  }
}

export function showToastOverlay(context: UIContext, title: string, maxWidth: number, duration: number): boolean {
  hideToastOverlay();
  const toast = new ComponentContent(context, wrapBuilder(toastBuilder), new ToastContent(title, maxWidth));
  try {
    // OverlayManager 默认居中，不添加蒙层；点击穿透到原页面。
    context.getOverlayManager().addComponentContent(toast);
  } catch (_error) {
    toast.dispose();
    return false;
  }
  currentToast = toast;
  currentContext = context;
  currentTimer = setTimeout(() => {
    if (currentToast === toast) hideToastOverlay();
  }, duration);
  return true;
}
