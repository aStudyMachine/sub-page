import { describe, expect, it } from "vitest";
import { buildDiagnostics } from "../../src/core/diagnostics";
import { PageIndex } from "../../src/repository/pageIndex";
import { scan } from "../../src/repository/pageScanner";
import { sampleVault } from "../fixtures/fakeVault";

async function snapshot() {
	const vault = sampleVault();
	await scan(vault, "", {});
	const index = new PageIndex();
	index.replace(await scan(vault, "", {}));
	return index.current;
}

describe("诊断信息", () => {
	it("统计页面与分组，不输出笔记名", async () => {
		const text = buildDiagnostics({
			pluginVersion: "0.0.1",
			appVersion: "1.15.1",
			platform: "desktop",
			language: "zh",
			settings: {
				pageRoot: "",
				defaultView: "list",
				defaultSort: "name",
				showEmptyFolders: false,
				excludedFolders: ["_assets"],
			},
			snapshot: await snapshot(),
			order: { "": ["首页.md"] },
			orderProblem: null,
			expandedCount: 3,
		});
		expect(text).toContain("父页面 2 / 叶子页面 6");
		expect(text).toContain("分组目录：3");
		expect(text).toContain("作用域 1 个，条目 1 条");
		expect(text).toContain("读取状态：正常");
		// 报障信息会被贴到公开场合，笔记名不该跟着出去。
		expect(text).not.toContain("堆内存");
		expect(text).not.toContain("项目A");
	});

	it("顺序文件坏掉时把原因写进去", async () => {
		const text = buildDiagnostics({
			pluginVersion: "0.0.1",
			appVersion: "1.15.1",
			platform: "mobile",
			language: "en",
			settings: {
				pageRoot: "Pages",
				defaultView: "card",
				defaultSort: "manual",
				showEmptyFolders: true,
				excludedFolders: [],
			},
			snapshot: await snapshot(),
			order: {},
			orderProblem: "顺序文件不是合法 JSON，已退回按名称排序",
			expandedCount: 0,
		});
		expect(text).toContain("读取状态：顺序文件不是合法 JSON");
		// 页面根可以不写进报障信息，但「是不是库根」要能看出来。
		expect(text).toContain("- 页面根：自定义");
		expect(text).toContain("- 排除目录：（无）");
	});
});
