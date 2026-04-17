export interface I18nLangDto {
  id: number;
  name: string;
  lang: string;
  status: number;
  isDefault: number;
  sort: number;
  modified: string;
  created: string;
}

export interface I18nState {
  currentLang: string;
  langMap: Record<string, string>;
  langList: I18nLangDto[];
  loaded: boolean;
  loading: boolean;
}

