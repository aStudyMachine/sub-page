import { describe, expect, it, vi } from "vitest";
import { PageService } from "../../src/core/pageService";
import { PageId } from "../../src/models/pageId";
import { DEFAULT_SETTINGS } from "../../src/models/settings";
import { FakeVault, sampleVault } from "../fixtures/fakeVault";

const id = (value: string) => value as PageId;

function makeService(vault: FakeVault, overrides: Partial<typeof DEFAULT_SETTINGS> = {}, debounceMs = 5) {
	const changes: string[] = [];
	const problems: string[] = [];
	const service = new PageService({
		adapter: vault,
		settings: () => ({ ...DEFAULT_SETTINGS, ...overrides }),
		onChange: (reason) => changes.push(reason),
		onProblem: (message) => problems.push(message),
		debounceMs,
	});
	return { service, changes, problems };
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

describe("启动与刷新", () => {
	it("启动后索引可用", async () => {
		const { service } = makeService(sampleVault());
		await service.start();
		expect(service.getRoots().length).toBeGreaterThan(0);
		expect(service.stats().pages).toBe(8);
		service.dispose();
	});

	it("页面根指向子目录时只索引那一部分", async () => {
		const vault = new FakeVault({ "Knowledge/a.md": "", "别的/b.md": "" });
		const { service } = makeService(vault, { pageRoot: "Knowledge" });
		await service.start();
		expect(service.getRoots().map((n) => n.title)).toEqual(["a"]);
		service.dispose();
	});

	it("刷新会通知界面", async () => {
		const { service, changes } = makeService(sampleVault());
		await service.start();
		changes.length = 0;
		await service.refresh();
		expect(changes).toContain("refresh");
		service.dispose();
	});

	it("并发刷新合并成串行，不重入扫描", async () => {
		const { service } = makeService(sampleVault());
		await service.start();
		let active = 0;
		let max = 0;
		const original = service.index.replace.bind(service.index);
		service.index.replace = (snapshot) => {
			active += 1;
			max = Math.max(max, active);
			original(snapshot);
			active -= 1;
		};
		await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
		expect(max).toBe(1);
		service.dispose();
	});
});

describe("事件驱动刷新", () => {
	it("外部新建文件后会出现在索引里", async () => {
		const vault = sampleVault();
		const { service } = makeService(vault);
		await service.start();
		await vault.createFile("新笔记.md", "# 新");
		await settle();
		expect(service.getNode(id("新笔记.md"))).toBeDefined();
		service.dispose();
	});

	it("外部删除文件后从索引消失", async () => {
		const vault = sampleVault();
		const { service } = makeService(vault);
		await service.start();
		await vault.trash("首页.md");
		await settle();
		expect(service.getNode(id("首页.md"))).toBeUndefined();
		service.dispose();
	});

	it("连发多条事件只扫一次", async () => {
		const vault = sampleVault();
		const { service } = makeService(vault, {}, 20);
		await service.start();
		const spy = vi.spyOn(service, "refresh");
		await vault.createFolder("批量");
		await vault.createFile("批量/a.md", "");
		await vault.createFile("批量/b.md", "");
		await settle(60);
		expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
		expect(service.getNode(id("批量/a.md"))).toBeDefined();
		service.dispose();
	});

	it("页面根之外的变更不触发刷新", async () => {
		const vault = new FakeVault({ "Knowledge/a.md": "", "别处/b.md": "" });
		const { service } = makeService(vault, { pageRoot: "Knowledge" });
		await service.start();
		const spy = vi.spyOn(service, "refresh");
		await vault.createFile("别处/c.md", "");
		await settle();
		expect(spy).not.toHaveBeenCalled();
		service.dispose();
	});

	it("自己写顺序文件不触发刷新", async () => {
		const vault = sampleVault();
		const { service } = makeService(vault);
		await service.start();
		const spy = vi.spyOn(service, "refresh");
		await service.operations.reorderScope(null, ["首页.md"]);
		spy.mockClear();
		await settle();
		expect(spy).not.toHaveBeenCalled();
		service.dispose();
	});
});

describe("页面根切换", () => {
	it("切换后索引与顺序都换成新根", async () => {
		const vault = new FakeVault({ "A/a.md": "", "B/b.md": "" });
		const settings = { ...DEFAULT_SETTINGS };
		const service = new PageService({
			adapter: vault,
			settings: () => settings,
			onChange: () => undefined,
			debounceMs: 5,
		});
		await service.start();
		expect(service.getRoots().map((n) => n.title)).toEqual(["A", "B"]);

		settings.pageRoot = "B";
		await service.setPageRoot("B");
		expect(service.getRoots().map((n) => n.title)).toEqual(["b"]);
		service.dispose();
	});
});

describe("查询", () => {
	it("按文件路径找节点", async () => {
		const { service } = makeService(sampleVault());
		await service.start();
		expect(service.nodeForFilePath("项目A/设计/设计.md")?.id).toBe("项目A/设计");
		service.dispose();
	});

	it("正文块用 sourcePath 找到自身页面", async () => {
		const { service } = makeService(sampleVault());
		await service.start();
		// 父页面的笔记路径 → 父页面
		expect(service.nodeForSourcePath("项目A/项目A.md")?.kind).toBe("parent");
		// 目录路径 → 同一个父页面
		expect(service.nodeForSourcePath("项目A")?.id).toBe("项目A");
		service.dispose();
	});

	it("读取元数据来自 front matter", async () => {
		const { service } = makeService(sampleVault());
		await service.start();
		const metadata = await service.metadataFor(id("项目A"));
		expect(metadata.icon).toBe("📁");
		expect(metadata.description).toBe("一个父页面");
		service.dispose();
	});

	it("没有元数据的页面返回空对象", async () => {
		const { service } = makeService(sampleVault());
		await service.start();
		expect(await service.metadataFor(id("首页.md"))).toEqual({});
		service.dispose();
	});

	it("搜索命中标题片段", async () => {
		const { service } = makeService(sampleVault());
		await service.start();
		expect(service.search("内存").map((n) => n.title)).toEqual(["堆内存"]);
		service.dispose();
	});
});

describe("顺序文件损坏", () => {
	it("降级为名称排序并上报问题，不阻断显示", async () => {
		const vault = sampleVault();
		await vault.seedFile(".subpage-order.json", "{ 这不是 JSON");
		const { service, problems } = makeService(vault);
		await service.start();
		expect(service.getRoots().length).toBeGreaterThan(0);
		expect(problems.some((message) => message.includes("JSON"))).toBe(true);
		service.dispose();
	});
});

describe("与操作服务协作", () => {
	it("新建后索引立刻可见，无需等事件", async () => {
		const { service } = makeService(sampleVault());
		await service.start();
		const result = await service.operations.createPage(null, "立即出现");
		expect(result.ok).toBe(true);
		expect(service.getNode(id("立即出现.md"))).toBeDefined();
		service.dispose();
	});

	it("删除后索引立刻消失", async () => {
		const { service } = makeService(sampleVault());
		await service.start();
		await service.operations.deletePage(id("首页.md"), { withChildren: true, useTrash: true });
		expect(service.getNode(id("首页.md"))).toBeUndefined();
		service.dispose();
	});
});
