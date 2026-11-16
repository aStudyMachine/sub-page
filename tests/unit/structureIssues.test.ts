import { describe, expect, it } from "vitest";
import { collectStructureIssues, isEmptyReport } from "../../src/core/structureIssues";
import { PageId } from "../../src/models/pageId";
import { PageNode, ScanWarning } from "../../src/models/pageNode";
import { sampleVault } from "../fixtures/fakeVault";
import { scan } from "../../src/repository/pageScanner";
import { PageIndex } from "../../src/repository/pageIndex";

const asId = (value: string | null) => (value === null ? null : (value as PageId));

async function indexOf(vault: ReturnType<typeof sampleVault>) {
	const index = new PageIndex();
	index.replace(await scan(vault, "", {}));
	return index;
}

function inputFrom(index: PageIndex, order: Record<string, string[]> = {}, warnings?: ScanWarning[]) {
	return {
		order,
		getChildren: (scope: PageId | null) => index.getChildren(scope),
		warnings: warnings ?? index.warnings,
		nodes: Array.from(index.current.nodes.values()),
	};
}

describe("结构检查规则", () => {
	it("干净库没有任何报告", async () => {
		const index = await indexOf(sampleVault());
		const report = collectStructureIssues(inputFrom(index));
		expect(report.orphans).toEqual([]);
		expect(report.conflicts).toEqual([]);
		expect(report.deep).toEqual([]);
		expect(report.groups.length).toBe(3);
	});

	it("顺序文件里指向已删除页面的条目被报为孤立", async () => {
		const index = await indexOf(sampleVault());
		const report = collectStructureIssues(inputFrom(index, { "": ["首页.md", "已经删了.md"] }));
		expect(report.orphans).toEqual([{ scope: "", key: "已经删了.md" }]);
	});

	it("孤立的叶子条目按带扩展名的键比对", async () => {
		const index = await indexOf(sampleVault());
		const report = collectStructureIssues(inputFrom(index, { "": ["Java"] }));
		expect(report.orphans).toEqual([]);
	});

	it("单个作用域里有多条孤立时逐条上报", async () => {
		const index = await indexOf(sampleVault());
		const report = collectStructureIssues(inputFrom(index, { Java: ["jvm", "不存在"] }));
		expect(report.orphans).toEqual([{ scope: "Java", key: "不存在" }]);
	});

	it("分组目录单独成节，不算问题", async () => {
		const index = await indexOf(sampleVault());
		const report = collectStructureIssues(inputFrom(index));
		expect(report.groups.map((node) => node.folderPath).sort()).toEqual(["Java", "Java/jvm", "Java/并发"].sort());
		expect(isEmptyReport(report)).toBe(false);
	});

	it("空报告才算干净", () => {
		const empty: PageNode[] = [];
		expect(isEmptyReport(collectStructureIssues({ order: {}, getChildren: () => empty, warnings: [], nodes: [] }))).toBe(true);
	});

	it("大小写冲突与超层级分别归到对应分节", async () => {
		const index = await indexOf(sampleVault());
		const warnings: ScanWarning[] = [
			{ kind: "case-conflict", path: "A", message: "同名" },
			{ kind: "depth-limit", path: "深/更深", message: "太深" },
			{ kind: "read-error", path: "坏", message: "读不了" },
		];
		const report = collectStructureIssues(inputFrom(index, {}, warnings));
		expect(report.conflicts.map((w) => w.path)).toEqual(["A"]);
		expect(report.deep.map((w) => w.path)).toEqual(["深/更深"]);
	});

	it("asId 用于断言作用域类型", () => {
		expect(asId(null)).toBeNull();
		expect(asId("Java")).toBe("Java");
	});
});
