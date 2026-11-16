import { describe, expect, it } from "vitest";
import { DEFAULT_BLOCK_CONFIG, parseSubPageBlock } from "../../src/utils/subPageConfigParser";

describe("subpages 块配置", () => {
	it("空块得到默认值", () => {
		expect(parseSubPageBlock("").config).toEqual(DEFAULT_BLOCK_CONFIG);
		expect(parseSubPageBlock("   \n\n").config).toEqual(DEFAULT_BLOCK_CONFIG);
	});

	it("只写部分键时其余保持默认", () => {
		const { config } = parseSubPageBlock("view: card");
		expect(config.view).toBe("card");
		expect(config.sort).toBe("name");
		expect(config.columns).toBe(2);
	});

	it("认所有合法键", () => {
		const { config, warnings } = parseSubPageBlock(
			["view: card", "sort: modified", "show-icon: false", "show-description: true", "columns: 4", "limit: 10"].join("\n"),
		);
		expect(config).toEqual({
			view: "card",
			sort: "modified",
			showIcon: false,
			showDescription: true,
			columns: 4,
			limit: 10,
		});
		expect(warnings).toEqual([]);
	});

	it("忽略注释与空行", () => {
		const { config, warnings } = parseSubPageBlock("# 这是注释\n\nview: list");
		expect(config.view).toBe("list");
		expect(warnings).toEqual([]);
	});

	it("去掉值两侧的引号", () => {
		expect(parseSubPageBlock('view: "card"').config.view).toBe("card");
		expect(parseSubPageBlock("view: 'card'").config.view).toBe("card");
	});

	it("未知键只警告不报错", () => {
		const { config, warnings } = parseSubPageBlock("view: card\ncolumns-x: 3");
		expect(config.view).toBe("card");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("columns-x");
	});

	it("非法枚举值保留默认并警告", () => {
		const { config, warnings } = parseSubPageBlock("view: grid\nsort: random");
		expect(config.view).toBe("list");
		expect(config.sort).toBe("name");
		expect(warnings).toHaveLength(2);
	});

	it("非法数字保留默认并警告", () => {
		const { config, warnings } = parseSubPageBlock("columns: 0\nlimit: -1");
		expect(config.columns).toBe(2);
		expect(config.limit).toBe(0);
		expect(warnings).toHaveLength(2);
	});

	it("无法解析的行进警告", () => {
		const { warnings } = parseSubPageBlock("this line has no colon");
		expect(warnings).toHaveLength(1);
	});

	it("布尔值接受 yes / no", () => {
		expect(parseSubPageBlock("show-icon: no").config.showIcon).toBe(false);
		expect(parseSubPageBlock("show-icon: yes").config.showIcon).toBe(true);
	});

	it("大小写不敏感地认键", () => {
		expect(parseSubPageBlock("View: card").config.view).toBe("card");
	});

	it("列数与条数接受非负整数 0", () => {
		expect(parseSubPageBlock("limit: 0").config.limit).toBe(0);
	});
});
