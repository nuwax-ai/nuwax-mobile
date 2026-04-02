import { reactive } from "vue";
import { DEFAULT_LANG } from "@/constants/i18n.constants";
import { getLocalFallback, toBundleKey } from "@/constants/i18n.local.constants";

export interface UniLoadMoreContentText {
  contentdown: string;
  contentrefresh: string;
  contentnomore: string;
}

interface ThirdPartyLocaleState {
  currentLang: string;
}

/**
 * 第三方库语言状态适配层。
 * 这里不维护独立词典，只缓存当前项目语言，确保所有第三方入口都跟随主 i18n 状态。
 */
export const thirdPartyLocaleState = reactive<ThirdPartyLocaleState>({
  currentLang: DEFAULT_LANG,
});

const normalizeThirdPartyLang = (lang: string): string => {
  return toBundleKey(lang);
};

/**
 * 同步第三方库当前语言。
 * 目前先作为统一收口点，后续新增 dayjs / markdown / UI 库时只需要继续往这里扩展。
 */
export const syncThirdPartyLocales = (lang: string) => {
  thirdPartyLocaleState.currentLang = normalizeThirdPartyLang(lang);
};

/**
 * 获取 `uni-load-more` 组件所需的文案对象。
 * 通过显式传入 `content-text`，避免组件内部继续使用自己的默认语言逻辑。
 */
export const getUniLoadMoreContentText = (
  overrides: Partial<UniLoadMoreContentText> = {},
): UniLoadMoreContentText => {
  const lang = normalizeThirdPartyLang(thirdPartyLocaleState.currentLang);
  return {
    contentdown:
      overrides.contentdown || getLocalFallback(lang, "Mobile.Common.loadMore"),
    contentrefresh:
      overrides.contentrefresh || getLocalFallback(lang, "Mobile.Page.loadingMore"),
    contentnomore:
      overrides.contentnomore || getLocalFallback(lang, "Mobile.Common.noMoreData"),
  };
};
