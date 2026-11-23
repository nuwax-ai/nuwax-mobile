/**
 * 政治敏感词本地校验单测。
 *
 * 覆盖：领导人姓名（简/繁）、涉台表述、插入分隔符/零宽字符/数字的规避写法、
 * 以及普通文案不误报。词库增减后本测试应同步补充代表性词条。
 */
import { describe, expect, it } from "vitest";
import {
  containsPoliticalSensitiveWord,
  normalizeForSensitiveCheck,
} from "@/utils/politicalSensitiveWords.uts";

describe("normalizeForSensitiveCheck", () => {
  it("去掉空白、标点、数字与零宽字符，并转小写", () => {
    expect(normalizeForSensitiveCheck(" 习 近\t平 ")).toBe("习近平");
    expect(normalizeForSensitiveCheck("习·近平")).toBe("习近平");
    expect(normalizeForSensitiveCheck("习​近平")).toBe("习近平");
    expect(normalizeForSensitiveCheck("习近1平")).toBe("习近平");
    expect(normalizeForSensitiveCheck("Hello, World!")).toBe("helloworld");
    expect(normalizeForSensitiveCheck("   ")).toBe("");
  });
});

describe("containsPoliticalSensitiveWord", () => {
  it("空文本与普通文案不命中", () => {
    expect(containsPoliticalSensitiveWord("")).toBe(false);
    expect(containsPoliticalSensitiveWord("   ")).toBe(false);
    expect(containsPoliticalSensitiveWord("产品经理小王")).toBe(false);
    expect(containsPoliticalSensitiveWord("周末一起打球吗")).toBe(false);
  });

  it("命中历届国家高层领导人姓名（简体）", () => {
    expect(containsPoliticalSensitiveWord("毛泽东")).toBe(true);
    expect(containsPoliticalSensitiveWord("邓小平")).toBe(true);
    expect(containsPoliticalSensitiveWord("习近平")).toBe(true);
    expect(containsPoliticalSensitiveWord("李克强")).toBe(true);
    expect(containsPoliticalSensitiveWord("备注：胡锦涛")).toBe(true);
  });

  it("命中领导人姓名常见繁体写法", () => {
    expect(containsPoliticalSensitiveWord("習近平")).toBe(true);
    expect(containsPoliticalSensitiveWord("鄧小平")).toBe(true);
    expect(containsPoliticalSensitiveWord("溫家寶")).toBe(true);
  });

  it("插入分隔符、零宽字符或数字仍能命中", () => {
    expect(containsPoliticalSensitiveWord("习 近 平")).toBe(true);
    expect(containsPoliticalSensitiveWord("习·近平")).toBe(true);
    expect(containsPoliticalSensitiveWord("習-近平")).toBe(true);
    expect(containsPoliticalSensitiveWord("习​近平")).toBe(true);
    expect(containsPoliticalSensitiveWord("江1泽2民")).toBe(true);
  });

  it("命中涉台敏感表述与涉台政治人物", () => {
    expect(containsPoliticalSensitiveWord("台独")).toBe(true);
    expect(containsPoliticalSensitiveWord("台灣獨立")).toBe(true);
    expect(containsPoliticalSensitiveWord("一边一国")).toBe(true);
    expect(containsPoliticalSensitiveWord("两个中国")).toBe(true);
    expect(containsPoliticalSensitiveWord("赖清德")).toBe(true);
    expect(containsPoliticalSensitiveWord("蔡英文")).toBe(true);
    expect(containsPoliticalSensitiveWord("民进党")).toBe(true);
  });

  it("纯符号或数字归一化后为空，不命中", () => {
    expect(containsPoliticalSensitiveWord("12345")).toBe(false);
    expect(containsPoliticalSensitiveWord("!!!")).toBe(false);
  });
});
