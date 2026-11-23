import { ORDER_FILE_NAME } from "../../src/repository/pageOrderStore";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("window", globalThis);
import { PageService } from "../../src/core/pageService";
import { PageId } from "../../src/models/pageId";
import { DEFAULT_SETTINGS, migrateSettings } from "../../src/models/settings";
import { FakeVault, sampleVault } from "../fixtures/fakeVault";

const id = (value: string) => value as PageId;

function makeService(vault: FakeVault, overrides: Partial<typeof DEFAULT_SETTINGS> = {}, debounceMs = 5) {
	const changes: string[] = [];
	const problems: string[] = [];
	const service = new PageService({
		adapter: vault,
		orderPath: ORDER_FILE_NAME,
		settings: () => ({ ...DEFAULT_SETTINGS, ...overrides }),
		onChange: (reason) => changes.push(reason),
		onProblem: (message) => problems.push(message),
		debounceMs,
	});
	return { service, changes, problems };
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function gate() {
	let release!: () => void;
	const ready = new Promise<void>((resolve) => { release = resolve; });
	return { ready, release };
}

describe("自动还原无子页面的笔记", () => {
	it("旧设置默认开启，保留明确关闭的设置", () => {
		expect(migrateSettings({}).settings.collapseEmptyParents).toBe(true);
		expect(migrateSettings({ collapseEmptyParents: false }).settings.collapseEmptyParents).toBe(false);
	});

	it("修正旧设置中的无效选项并保留合法列表成员", () => {
		const stored = { ...DEFAULT_SETTINGS, defaultSort: "invalid", expandedIds: ["父页面", 10] };
		expect(migrateSettings(stored)).toMatchObject({
			settings: { defaultSort: "name", expandedIds: ["父页面"] },
			changed: true,
		});
		expect(migrateSettings(DEFAULT_SETTINGS).changed).toBe(false);
	});

	it("启动时还原已有配对，保留手动排序", async () => {
		const vault = new FakeVault({ "A/A.md": "原笔记", "B.md": "" });
		const { service } = makeService(vault, { collapseEmptyParents: false });
		await service.start();
		try {
			await service.operations.reorderScope(null, ["B.md", "A"]);
		} finally {
			service.dispose();
		}
		const reopened = makeService(vault).service;
		await reopened.start();
		try {
			expect(reopened.getRoots().map((node) => node.id)).toEqual(["B.md", "A.md"]);
			expect(reopened.order.getKeys("")).toEqual(["B.md", "A.md"]);
			expect(vault.content("A.md")).toBe("原笔记");
			expect(vault.folderPaths()).not.toContain("A");
		} finally {
			reopened.dispose();
		}
	});

	it.each([true, false])("删除最后一个子页面后按设置处理目录（%s）", async (collapseEmptyParents) => {
		const vault = new FakeVault({ "A/A.md": "", "A/子.md": "" });
		const { service } = makeService(vault, { collapseEmptyParents });
		await service.start();
		try {
			await vault.trash("A/子.md");
			await vi.waitFor(() => expect(service.getNode(id("A/子.md"))).toBeUndefined());
			expect(service.getNode(id(collapseEmptyParents ? "A.md" : "A"))?.kind).toBe(
				collapseEmptyParents ? "leaf" : "parent",
			);
			expect(vault.folderPaths().includes("A")).toBe(!collapseEmptyParents);
		} finally {
			service.dispose();
		}
	});

	it("保留含附件、隐藏文件、子目录或存在同名冲突的配对", async () => {
		const vault = new FakeVault({
			"A/A.md": "", "A/附件.png": "", "B/B.md": "", "B/.hidden": "",
			"C/C.md": "", "C.md": "外层", "D/D.md": "",
		});
		vault.seedFolder("D/空目录");
		const { service } = makeService(vault);
		await service.start();
		try {
			expect(vault.folderPaths()).toEqual(expect.arrayContaining(["A", "B", "C", "D", "D/空目录"]));
			expect(vault.content("C.md")).toBe("外层");
			expect(vault.filePaths()).toContain("B/.hidden");
		} finally {
			service.dispose();
		}
	});

	it("清理前发现新内容时将笔记移回", async () => {
		const vault = new FakeVault({ "A/A.md": "原笔记" });
		const trashEmptyFolder = vault.trashEmptyFolder.bind(vault);
		vi.spyOn(vault, "trashEmptyFolder").mockImplementation(async (path) => {
			vault.seedFile("A/新附件.png");
			return trashEmptyFolder(path);
		});
		const { service } = makeService(vault);
		await service.start();
		try {
			expect(service.getNode(id("A"))?.kind).toBe("parent");
			expect(vault.content("A/A.md")).toBe("原笔记");
			expect(vault.filePaths()).toContain("A/新附件.png");
		} finally {
			service.dispose();
		}
	});

	it("回滚引发的刷新不会反复尝试清理，手动重建可以重试", async () => {
		const vault = new FakeVault({ "A/A.md": "原笔记", "A/子.md": "" });
		const trash = vi.spyOn(vault, "trashEmptyFolder").mockRejectedValueOnce(new Error("目录被占用"));
		const { service, problems } = makeService(vault);
		await service.start();
		try {
			await vault.trash("A/子.md");
			await vi.waitFor(() => expect(problems).toHaveLength(1));
			await settle();
			expect(trash).toHaveBeenCalledTimes(1);
			expect(vault.content("A/A.md")).toBe("原笔记");
			await service.rebuild();
			expect(vault.content("A.md")).toBe("原笔记");
		} finally {
			service.dispose();
		}
	});
});

describe("启动与刷新", () => {
	it("等待扫描期间请求的补扫和排队的新建", async () => {
		const vault = new FakeVault({ "已有.md": "" });
		const { service } = makeService(vault);
		await service.start();
		const scanned = gate();
		const resume = gate();
		const list = vault.listFolder.bind(vault);
		vi.spyOn(vault, "listFolder").mockImplementationOnce(async (path) => {
			const listing = await list(path);
			scanned.release();
			await resume.ready;
			return listing;
		});
		try {
			const first = service.refresh();
			await scanned.ready;
			vault.seedFile("补扫.md");
			const followup = service.refresh();
			const created = service.operations.createPage(null, "操作新建");
			resume.release();
			await followup;
			expect(service.getNode(id("补扫.md"))).toBeDefined();
			await first;
			expect(await created).toMatchObject({ ok: true });
			expect(service.getNode(id("操作新建.md"))).toBeDefined();
		} finally {
			service.dispose();
		}
	});

	it("删除与同时请求的空父页面还原不会交错", async () => {
		const vault = new FakeVault({ "A/A.md": "原笔记" });
		const settings = { collapseEmptyParents: false };
		const { service, problems } = makeService(vault, settings);
		await service.start();
		const trash = vault.trash.bind(vault);
		const resume = gate();
		const rename = vi.spyOn(vault, "renameFile");
		vi.spyOn(vault, "trash").mockImplementationOnce(async (path, system) => {
			await resume.ready;
			return trash(path, system);
		});
		try {
			settings.collapseEmptyParents = true;
			const deletion = service.operations.deletePage(id("A"), { withChildren: true, useTrash: true });
			const refresh = Promise.resolve().then(() => service.refresh());
			await settle(0);
			resume.release();
			await refresh;
			expect(await deletion).toMatchObject({ ok: true, value: { deletedPages: 1 } });
			expect(vault.filePaths()).not.toContain("A.md");
			expect(vault.filePaths()).not.toContain("A/A.md");
			expect(problems).toEqual([]);
			expect(rename).not.toHaveBeenCalled();
		} finally {
			service.dispose();
		}
	});

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

	it("改已入库页面的正文不重扫整树，只通知界面重读元数据", async () => {
const vault = sampleVault();const { service, changes } = makeService(vault, {}, 20);await service.start();const spy = vi.spyOn(service, "refresh");changes.length = 0;await vault.writeText("Java/jvm/堆内存.md", "# 堆内存\n改过");await settle(60);expect(spy).not.toHaveBeenCalled();expect(changes).toContain("metadata");service.dispose();});
it("同步盘只发 modify 的新笔记仍会进索引", async () => {
// 同步客户端把文件直接落到磁盘上时，宿主常常只发 modify 不发 create。
const vault = sampleVault();const { service } = makeService(vault, {}, 20);await service.start();await vault.writeText("Java/新来的.md", "# 新来的");await settle(60);expect(service.getNode(id("Java/新来的.md"))).toBeDefined();service.dispose();});
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
	it("快速切回原根时旧操作不能删除同名页面或更改顺序", async () => {
		const vault = new FakeVault({ "A/同名.md": "甲", "B/同名.md": "乙" });
		const { service } = makeService(vault, { pageRoot: "A" });
		await service.start();
		try {
			const oldOperations = service.operations;
			await oldOperations.reorderScope(null, ["同名.md"]);
			const saving = gate();
			const resume = gate();
			const moveToB = service.setPageRoot("B", async () => {
				saving.release();
				await resume.ready;
			});
			await saving.ready;
			const moveToA = service.setPageRoot("A");
			const stale = oldOperations.deletePage(id("同名.md"), { withChildren: true, useTrash: true });
			resume.release();
			await Promise.all([moveToB, moveToA]);
			expect(await stale).toMatchObject({ ok: false, reason: "page-root-changed" });
			expect(service.pageRoot).toBe("A");
			expect(service.order.getKeys("")).toEqual(["同名.md"]);
			expect(vault.content("A/同名.md")).toBe("甲");
			expect(vault.content("B/同名.md")).toBe("乙");
		} finally {
			service.dispose();
		}
	});

	it("切换后索引与顺序都换成新根", async () => {
		const vault = new FakeVault({ "A/甲.md": "", "B/乙.md": "" });
		const settings = { ...DEFAULT_SETTINGS };
		const service = new PageService({
			adapter: vault,
			orderPath: ORDER_FILE_NAME,
			settings: () => settings,
			onChange: () => undefined,
			debounceMs: 5,
		});
		await service.start();
		expect(service.getRoots().map((n) => n.title)).toEqual(["A", "B"]);

		settings.pageRoot = "B";
		await service.setPageRoot("B");
		expect(service.getRoots().map((n) => n.title)).toEqual(["乙"]);
		service.dispose();
	});
});

describe("查询", () => {
	it("按文件路径找节点", async () => {
		const { service } = makeService(sampleVault(), { collapseEmptyParents: false });
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

	it("同一笔记共用在途元数据，失效后的旧结果不会覆盖新值", async () => {
		const vault = new FakeVault({ "测试.md": "" });
		const { service } = makeService(vault);
		await service.start();
		const resume = gate();
		const read = vi.spyOn(vault, "readFrontMatter")
			.mockImplementationOnce(async () => {
				await resume.ready;
				return { icon: "old" };
			})
			.mockResolvedValueOnce({ icon: "new" });
		try {
			const previous = [service.metadataFor(id("测试.md")), service.metadataFor(id("测试.md"))];
			expect(read).toHaveBeenCalledTimes(1);
			await vault.writeText("测试.md", "新内容");
			expect(await service.metadataFor(id("测试.md"))).toEqual({ icon: "new" });
			resume.release();
			expect(await Promise.all(previous)).toEqual([{}, {}]);
			expect(await service.metadataFor(id("测试.md"))).toEqual({ icon: "new" });
			expect(read).toHaveBeenCalledTimes(2);
		} finally {
			service.dispose();
		}
	});

	it("没有元数据的页面返回空对象", async () => {
		const { service } = makeService(sampleVault());
		await service.start();
		expect(await service.metadataFor(id("首页.md"))).toEqual({});
		service.dispose();
	});

	it("front matter 被改后元数据跟着变，不吃旧缓存", async () => {
		const vault = sampleVault();
		const { service } = makeService(vault);
		await service.start();
		expect((await service.metadataFor(id("项目A"))).icon).toBe("📁");

		const epochBefore = service.metadataEpoch;
		await vault.updateFrontMatter("项目A/项目A.md", (data) => {
			data.icon = "🧩";
		});
		await settle();

		expect(await service.metadataFor(id("项目A")).then((m) => m.icon)).toBe("🧩");
		// 界面靠这个数字知道该丢自己的渲染缓存
		expect(service.metadataEpoch).toBeGreaterThan(epochBefore);
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
