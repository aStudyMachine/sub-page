import { describe, expect, it, vi } from "vitest";
import { Translator, detectObsidianLanguage, resolveLanguage, translationKeys } from "../../src/i18n";

describe("语言判定", () => {
	it("跟随界面语言", () => {
		expect(detectObsidianLanguage("zh")).toBe("zh");
		expect(detectObsidianLanguage("zh-TW")).toBe("zh");
		expect(detectObsidianLanguage("en")).toBe("en");
		expect(detectObsidianLanguage(undefined)).toBe("en");
	});

	it("强制指定优先于界面语言", () => {
		expect(resolveLanguage("en", "zh")).toBe("en");
		expect(resolveLanguage("zh", "en")).toBe("zh");
		expect(resolveLanguage("auto", "zh-CN")).toBe("zh");
	});
});

describe("文案", () => {
	it("按语言取文案", () => {
		const t = new Translator("zh");
		expect(t.t("menu.rename")).toBe("重命名");
		t.setLanguage("en");
		expect(t.t("menu.rename")).toBe("Rename");
	});

	it("插值替换占位符", () => {
		const t = new Translator("zh");
		expect(t.t("notice.created", { title: "新页面" })).toBe("已创建「新页面」");
	});

	it("缺少变量时保留占位符原样", () => {
		const t = new Translator("zh");
		expect(t.t("notice.created", {})).toContain("{title}");
	});

	it("缺键回退到中文并只警告一次", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const t = new Translator("en");
		expect(t.t("不存在的键")).toBe("不存在的键");
		expect(t.t("不存在的键")).toBe("不存在的键");
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it("中英两套键完全一致", () => {
		// 抽查会漏掉新加的键，所以直接比两张表的键集合。
		const { zh, en } = translationKeys();
		expect(en.filter((key) => !zh.includes(key))).toEqual([]);
		expect(zh.filter((key) => !en.includes(key))).toEqual([]);
	});
});
