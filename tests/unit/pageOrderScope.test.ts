import { describe, expect, it } from "vitest";
import { PageOperationService } from "../../src/core/pageOperationService";
import { collectStructureIssues } from "../../src/core/structureIssues";
import { PageId } from "../../src/models/pageId";
import { PageIndex } from "../../src/repository/pageIndex";
import { ORDER_FILE_NAME, PageOrderStore } from "../../src/repository/pageOrderStore";
import { scan } from "../../src/repository/pageScanner";
import { FakeVault, sampleVault } from "../fixtures/fakeVault";

/**
 * 顺序文件里每个「子项排列」都挂在父页面 id 下面。id 是路径编码的，
 * 所以任何改变路径的操作（改名、移动、配对、解除配对）都必须把那一整段作用域搬走；
 * 漏搬的后果不是报错，而是用户的排序静默丢失、结构检查里多出一堆孤立条目。
 */

const id = (value: string) => value as PageId;

async function harness(vault: FakeVault, pageRoot = "") {
	const index = new PageIndex();
	const order = new PageOrderStore(vault, pageRoot, ORDER_FILE_NAME);
	await order.load();
	const refresh = async () => {
		index.replace(await scan(vault, pageRoot, { order: order.current }));
	};
	await refresh();
	const ops = new PageOperationService({
		adapter: vault,
		order,
		getNode: (value) => index.getNode(value),
		getChildren: (scope) => index.getChildren(scope),
		getPageRoot: () => pageRoot,
		refresh,
	});
	const orphans = () =>
		collectStructureIssues({
			order: order.current,
			getChildren: (scope) => index.getChildren(scope),
			warnings: index.warnings,
			nodes: Array.from(index.current.nodes.values()),
		}).orphans;
	return { vault, index, order, ops, refresh, orphans };
}

describe("顺序作用域跟着页面路径走", () => {
	it("父页面改名后，子页面的顺序整段搬过去", async () => {
		const h = await harness(sampleVault());
		await h.order.setKeys("", ["项目A", "首页.md"]);
		await h.order.setKeys("项目A", ["设计", "需求.md"]);

		expect(await h.ops.renamePage(id("项目A"), "项目B")).toMatchObject({ ok: true, value: "项目B" });

		expect(h.order.getKeys("项目B")).toEqual(["设计", "需求.md"]);
		expect(h.order.getKeys("项目A")).toEqual([]);
		expect(h.orphans()).toEqual([]);
	});

	it("分层父页面改名时，所有后代作用域一起搬", async () => {
		const h = await harness(sampleVault());
		// 设计 自己有同名笔记（是父页面），再给它一个子页面，让它的作用域里有一条真实顺序。
		await h.vault.createFile("项目A/设计/详设.md", "");
		await h.refresh();
		await h.order.setKeys("项目A", ["设计"]);
		await h.order.setKeys("项目A/设计", ["详设.md"]);

		await h.ops.renamePage(id("项目A"), "项目B");

		expect(h.order.getKeys("项目B/设计")).toEqual(["详设.md"]);
		expect(h.orphans()).toEqual([]);
	});

	it("分组目录改名后，它下面的作用域跟着改名", async () => {
		const h = await harness(sampleVault());
		await h.order.setKeys("Java", ["jvm", "并发"]);

		await h.ops.renamePage(id("Java"), "JVM组");

		expect(h.order.getKeys("JVM组")).toEqual(["jvm", "并发"]);
		expect(h.order.getKeys("Java")).toEqual([]);
	});

	it("父页面移动后，子页面的顺序跟着搬", async () => {
		const h = await harness(sampleVault());
		await h.order.setKeys("项目A", ["设计", "需求.md"]);

		await h.ops.movePage(id("项目A/设计"), id("Java"));

		expect(h.order.getKeys("Java")).toEqual(["设计"]);
		expect(h.orphans()).toEqual([]);
	});

	it("从页面根移出去时，整段作用域跟着换前缀", async () => {
		const vault = new FakeVault({ "甲/甲.md": "", "甲/子/子.md": "", "乙/乙.md": "" });
		const h = await harness(vault);
		await h.order.setKeys("甲", ["子"]);

		await h.ops.movePage(id("甲"), id("乙"));

		expect(h.order.getKeys("乙/甲")).toEqual(["子"]);
		expect(h.orphans()).toEqual([]);
	});

	it("连带删除整棵子树后，它下面每一层的作用域都清掉", async () => {
		const h = await harness(sampleVault());
		await h.order.setKeys("项目A", ["设计", "需求.md"]);
		await h.order.setKeys("项目A/设计", ["设计"]);

		await h.ops.deletePage(id("项目A"), { withChildren: true, useTrash: true });

		expect(h.order.current).toEqual({});
	});
});
