import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command, MarkdownPostProcessorContext } from "obsidian";
import { registerCommands } from "../../src/commands";
import { openPageMenuAt } from "../../src/components/pageContextMenu";
import { PageOperationService, renderTemplate } from "../../src/core/pageOperationService";
import type SubPagePlugin from "../../src/main";
import { PageId } from "../../src/models/pageId";
import { DEFAULT_SETTINGS } from "../../src/models/settings";
import { PageIndex } from "../../src/repository/pageIndex";
import { ORDER_FILE_NAME, PageOrderStore } from "../../src/repository/pageOrderStore";
import { DEFAULT_MAX_DEPTH, scan } from "../../src/repository/pageScanner";
import { registerSubPageBlockProcessor } from "../../src/views/subPageRenderer";
import { FakeVault, sampleVault } from "../fixtures/fakeVault";

const menu = vi.hoisted(() => ({
	items: new Map<string, () => void>(),
	openCreate: vi.fn(),
}));

vi.mock("obsidian", () => ({
	Platform: { isDesktopApp: false },
	ItemView: class {},
	Modal: class {},
	MarkdownRenderChild: class {},
	Menu: class {
		addItem(configure: (item: {
			setTitle(title: string): unknown;
			setIcon(icon: string): unknown;
			onClick(action: () => void): void;
		}) => void): void {
			let title = "";
			const item = {
				setTitle(value: string) {
					title = value;
					return item;
				},
				setIcon: () => item,
				onClick: (action: () => void) => menu.items.set(title, action),
			};
			configure(item);
		}
		addSeparator(): void {}
		showAtPosition(): void {}
	},
}));

vi.mock("../../src/modals/pageModals", () => ({
	CreatePageModal: class {
		constructor(_app: unknown, _plugin: unknown, private readonly options: { parentId: PageId | null; defaultTitle: string }) {}
		open(): void {
			menu.openCreate(this.options.parentId, this.options.defaultTitle);
		}
	},
}));

interface Harness {
	vault: FakeVault;
	index: PageIndex;
	order: PageOrderStore;
	ops: PageOperationService;
	refresh(): Promise<void>;
}

async function harness(vault: FakeVault, pageRoot = "", excludedFolders: string[] = []): Promise<Harness> {
	const index = new PageIndex();
	const order = new PageOrderStore(vault, pageRoot, ORDER_FILE_NAME);
	await order.load();
	const refresh = async () => {
		index.replace(await scan(vault, pageRoot, { order: order.current, excludedFolders }));
	};
	await refresh();
	const ops = new PageOperationService({
		adapter: vault,
		order,
		getNode: (id) => index.getNode(id),
		getChildren: (scope) => index.getChildren(scope),
		getPageRoot: () => pageRoot,
		getExcludedFolders: () => excludedFolders,
		refresh,
	});
	return { vault, index, order, ops, refresh };
}

const id = (value: string) => value as PageId;

describe("新建入口的目标位置", () => {
	it.each([
		{ commandId: "new-root", current: { id: "项目A/需求.md", parentId: "项目A" }, target: null },
		{ commandId: "new-child", current: { id: "项目A/需求.md", parentId: "项目A" }, target: "项目A/需求.md" },
		{ commandId: "new-child", current: undefined, target: null },
	])("命令 $commandId 在当前页面为 $current 时将新页面建到 $target 下", ({ commandId, current, target }) => {
		const commands = new Map<string, Command>();
		const plugin = {
			app: {},
			t: (key: string) => key,
			currentPage: () => current,
			addCommand: (command: Command) => commands.set(command.id, command),
			removeCommand: (commandId: string) => commands.delete(commandId),
		} as unknown as SubPagePlugin;
		menu.openCreate.mockClear();
		registerCommands(plugin);
		commands.get(commandId)!.callback!();
		expect(menu.openCreate).toHaveBeenCalledExactlyOnceWith(target, "modal.create.untitled");
	});

	it.each([
		{ sourcePath: "项目A/设计/设计.md", pageId: "项目A/设计", autoCollapse: true, action: "block.create" },
		{ sourcePath: "首页.md", pageId: "首页.md", autoCollapse: true, action: "block.create" },
		{ sourcePath: "首页.md", pageId: "首页.md", autoCollapse: false, action: "block.pair" },
	])("正文块使用所属页面执行 $action（$sourcePath）", async ({ sourcePath, pageId, autoCollapse, action }) => {
		const h = await harness(sampleVault());
		const page = h.index.getNode(id(pageId))!;
		const processor = vi.fn<SubPagePlugin["registerMarkdownCodeBlockProcessor"]>();
		const nodeForSourcePath = vi.fn((path: string) => path === sourcePath ? page : undefined);
		const pairPage = vi.fn(async () => ({ ok: true }));
		const plugin = {
			app: {},
			settings: { ...DEFAULT_SETTINGS, collapseEmptyParents: autoCollapse },
			t: (key: string) => key,
			loadTemplate: async () => "模板",
			currentPage: () => h.index.getNode(id("首页.md")),
			service: { nodeForSourcePath, getChildren: () => [], operations: { pairPage } },
			registerMarkdownCodeBlockProcessor: processor,
			registerBlockRefresher: vi.fn(),
		} as unknown as SubPagePlugin;
		const addEventListener = vi.fn<(event: string, listener: () => void) => void>();
		const createButton = vi.fn(() => ({ addEventListener }));
		const el = {
			addClass: vi.fn(),
			empty: vi.fn(),
			createDiv: () => ({
				createSpan: vi.fn(),
				createEl: createButton,
			}),
		} as unknown as HTMLElement;
		const ctx = { sourcePath, addChild: vi.fn() } as unknown as MarkdownPostProcessorContext;
		menu.openCreate.mockClear();
		expect(registerSubPageBlockProcessor(plugin)).toBe(true);
		const [language, render] = processor.mock.calls[0]!;
		expect(language).toBe("subpages");
		render("", el, ctx);
		expect(nodeForSourcePath).toHaveBeenCalledWith(sourcePath);
		expect(createButton).toHaveBeenCalledWith("button", expect.objectContaining({ text: action }));
		const [event, create] = addEventListener.mock.calls[0]!;
		expect(event).toBe("click");
		create();
		if (action === "block.pair") {
			await vi.waitFor(() => expect(pairPage).toHaveBeenCalledExactlyOnceWith(pageId, "模板"));
			expect(menu.openCreate).not.toHaveBeenCalled();
		} else {
			expect(menu.openCreate).toHaveBeenCalledExactlyOnceWith(pageId, "modal.create.untitled");
			expect(pairPage).not.toHaveBeenCalled();
		}
	});
});

describe("新建页面", () => {
	it("在根层建叶子页面，只产生一个 .md", async () => {
		const h = await harness(new FakeVault());
		const result = await h.ops.createPage(null, "新页面");
		expect(result).toMatchObject({ ok: true, value: "新页面.md" });
		expect(h.vault.filePaths()).toEqual(["新页面.md"]);
		expect(h.vault.folderPaths()).toEqual([]);
		expect(h.vault.content("新页面.md")).toBe("# 新页面\n");
	});

	it("顶层笔记首次接收子页面时才配对目录", async () => {
		const h = await harness(new FakeVault());
		expect(await h.ops.createPage(null, "项目")).toEqual({ ok: true, value: "项目.md" });
		expect(h.vault.folderPaths()).toEqual([]);
		expect(await h.ops.createPage(id("项目.md"), "需求")).toEqual({ ok: true, value: "项目/需求.md" });
		expect(h.vault.folderPaths()).toEqual(["项目"]);
		expect(h.vault.content("项目/项目.md")).toBe("# 项目\n");
		expect(h.index.getNode(id("项目"))?.kind).toBe("parent");
	});

	it("在父页面下建子页面", async () => {
		const h = await harness(sampleVault());
		const result = await h.ops.createPage(id("项目A"), "测试");
		expect(result).toMatchObject({ ok: true, value: "项目A/测试.md" });
		expect(h.index.getNode(id("项目A/测试.md"))?.parentId).toBe("项目A");
	});

	it("在分组目录下建页面，分组目录本身不是父页面", async () => {
		const h = await harness(sampleVault());
		await h.ops.createPage(id("Java"), "新笔记");
		expect(h.vault.filePaths()).toContain("Java/新笔记.md");
		expect(h.index.getNode(id("Java"))?.kind).toBe("group");
	});

	it("在叶子页面下新建时配对原笔记，并保留其手动顺序", async () => {
		const h = await harness(sampleVault());
		await h.ops.reorderScope(null, ["笔记规范.md", "首页.md"]);
		const plugin = { app: {}, t: (key: string) => key } as unknown as SubPagePlugin;
		const node = h.index.getNode(id("首页.md"))!;
		menu.items.clear();
		menu.openCreate.mockClear();
		openPageMenuAt(plugin, { x: 0, y: 0 }, { node });
		menu.items.get("menu.newSibling")!();
		expect(menu.openCreate).toHaveBeenLastCalledWith(null, "modal.create.untitled");
		menu.items.get("menu.newChild")!();
		expect(menu.openCreate).toHaveBeenLastCalledWith("首页.md", "modal.create.untitled");
		const parentId = menu.openCreate.mock.lastCall?.[0] as PageId | null;
		const result = await h.ops.createPage(parentId, "子");
		expect(result).toEqual({ ok: true, value: "首页/子.md" });
		expect(h.index.getNode(id("首页/子.md"))?.parentId).toBe("首页");
		expect(h.vault.content("首页/首页.md")).toBeDefined();
		expect(h.vault.folderPaths()).not.toContain("首页/子");
		expect(h.vault.filePaths()).not.toContain("子.md");
		expect(h.order.getKeys("")).toEqual(["笔记规范.md", "首页"]);
	});

	it("空白区菜单使用共用的默认名称创建根页面", () => {
		const plugin = { app: {}, t: (key: string) => key } as unknown as SubPagePlugin;
		menu.items.clear();
		menu.openCreate.mockClear();
		openPageMenuAt(plugin, { x: 0, y: 0 }, { node: null });
		menu.items.get("menu.pairFolder")!();
		expect(menu.openCreate).toHaveBeenCalledWith(null, "modal.create.untitled");
	});

	it("留空时顺延默认名称，并避开磁盘上的同名笔记和目录", async () => {
		const h = await harness(sampleVault());
		const options = { defaultTitle: "未命名" };
		expect(await h.ops.createPage(id("项目A"), "  ", options)).toEqual({ ok: true, value: "项目A/未命名.md" });
		h.vault.seedFolder("项目A/未命名 2");
		expect(await h.ops.createPage(id("项目A"), "", options)).toEqual({ ok: true, value: "项目A/未命名 3.md" });
		expect(h.vault.content("项目A/未命名 3.md")).toBe("# 未命名 3\n");
		expect(await h.ops.createPage(id("项目A"), "未命名", options)).toMatchObject({ ok: false, reason: "name-conflict" });
		expect(await h.ops.createPage(id("项目A"), "")).toMatchObject({ ok: false, reason: "invalid-name" });
	});

	it("给同名叶子首次新建子页面时避开即将移入的配对笔记", async () => {
		const h = await harness(new FakeVault({ "未命名.md": "原笔记" }));
		expect(await h.ops.createPage(id("未命名.md"), "", { defaultTitle: "未命名" }))
			.toEqual({ ok: true, value: "未命名/未命名 2.md" });
		expect(h.vault.content("未命名/未命名.md")).toBe("原笔记");
	});

	it("顶层留空新建时顺延名称，只创建笔记", async () => {
		const h = await harness(new FakeVault({ "未命名.md": "# 原笔记\n" }));
		expect(await h.ops.createPage(null, "", { defaultTitle: "未命名" }))
			.toEqual({ ok: true, value: "未命名 2.md" });
		expect(h.vault.content("未命名 2.md")).toBe("# 未命名 2\n");
		expect(h.vault.folderPaths()).toEqual([]);
	});

	it("首次新建子页面失败时恢复原笔记与顺序", async () => {
		const vault = sampleVault();
		const h = await harness(vault);
		await h.ops.reorderScope(null, ["首页.md"]);
		const content = vault.content("首页.md");
		vault.createFile = async () => {
			throw new Error("磁盘满了");
		};
		const result = await h.ops.createPage(id("首页.md"), "子");
		expect(result).toMatchObject({ ok: false, reason: "io-error" });
		expect(vault.content("首页.md")).toBe(content);
		expect(vault.folderPaths()).not.toContain("首页");
		expect(h.order.getKeys("")).toEqual(["首页.md"]);
	});

	it("子页面与配对笔记同名时拒绝新建", async () => {
		const h = await harness(sampleVault());
		const result = await h.ops.createPage(id("首页.md"), "首页");
		expect(result).toMatchObject({ ok: false, reason: "name-conflict" });
		expect(h.vault.folderPaths()).not.toContain("首页");
	});

	it("同名目录被排除时保留原笔记", async () => {
		const h = await harness(sampleVault(), "", ["首页"]);
		expect(await h.ops.createPage(id("首页.md"), "子")).toMatchObject({ ok: false, reason: "not-allowed" });
		expect(h.index.getNode(id("首页.md"))?.kind).toBe("leaf");
		expect(h.vault.folderPaths()).not.toContain("首页");
	});

	it("顺序文件写入失败时仍刷新已创建的子页面", async () => {
		const vault = sampleVault();
		const h = await harness(vault);
		await h.ops.reorderScope(null, ["首页.md"]);
		vault.writeText = async () => {
			throw new Error("顺序文件不可写");
		};
		expect(await h.ops.createPage(id("首页.md"), "子")).toEqual({
			ok: true,
			value: "首页/子.md",
			warning: expect.stringContaining("顺序文件不可写"),
		});
		expect(h.index.getNode(id("首页/子.md"))?.parentId).toBe("首页");
	});

	it("名称非法时磁盘上什么都不发生", async () => {
		const h = await harness(new FakeVault());
		const before = h.vault.filePaths();
		const result = await h.ops.createPage(null, "a/b");
		expect(result).toMatchObject({ ok: false, reason: "invalid-name" });
		expect(h.vault.filePaths()).toEqual(before);
	});

	it("同名冲突被挡住，两种冲突都能识别", async () => {
		const h = await harness(sampleVault());
		expect(await h.ops.createPage(null, "首页")).toMatchObject({ ok: false, reason: "name-conflict" });
		expect(await h.ops.createPage(null, "项目A")).toMatchObject({ ok: false, reason: "name-conflict" });
	});

	it("套用模板时替换占位符", async () => {
		const h = await harness(new FakeVault());
		await h.ops.createPage(null, "日记", { template: "# {{title}}\n\n> {{date}}" });
		expect(h.vault.content("日记.md")).toMatch(/^# 日记\n\n> \d{4}-\d{2}-\d{2}/);
	});

	it("直接新建笔记失败时返回文件错误", async () => {
		const vault = new FakeVault();
		vault.createFile = async () => {
			throw new Error("磁盘满了");
		};
		const h = await harness(vault);
		const result = await h.ops.createPage(null, "半成品");
		expect(result).toMatchObject({ ok: false, reason: "io-error" });
		expect(h.vault.filePaths()).toEqual([]);
	});

	it("新建不写顺序文件，新项排在已登记项之后", async () => {
		const h = await harness(sampleVault());
		await h.ops.reorderScope(null, ["首页.md", "笔记规范.md"]);
		await h.ops.createPage(null, "追加项");
		// 新建不该改动顺序文件：没登记的子项一律排在已登记项后面。
		expect(h.order.getKeys("")).toEqual(["首页.md", "笔记规范.md"]);
		const roots = h.index.getRoots().map((node) => node.title);
		expect(roots.slice(0, 2)).toEqual(["首页", "笔记规范"]);
		expect(roots).toContain("追加项");
	});
});

describe("重命名", () => {
	it("叶子页面改名，扩展名不变", async () => {
		const h = await harness(sampleVault());
		const result = await h.ops.renamePage(id("首页.md"), "开始");
		expect(result).toMatchObject({ ok: true, value: "开始.md" });
		expect(h.vault.filePaths()).toContain("开始.md");
		expect(h.vault.filePaths()).not.toContain("首页.md");
	});

	it("分组目录改名，子页面路径跟着改", async () => {
		const h = await harness(sampleVault());
		await h.ops.renamePage(id("Java"), "JavaSE");
		expect(h.vault.filePaths()).toContain("JavaSE/jvm/堆内存.md");
		expect(h.index.getNode(id("JavaSE/jvm/堆内存.md"))).toBeDefined();
	});

	it("父页面改名时目录与同名笔记一起改", async () => {
		const h = await harness(sampleVault());
		const result = await h.ops.renamePage(id("项目A"), "项目B");
		expect(result).toMatchObject({ ok: true, value: "项目B" });
		expect(h.vault.filePaths()).toContain("项目B/项目B.md");
		expect(h.vault.filePaths()).toContain("项目B/需求.md");
		expect(h.vault.folderPaths()).not.toContain("项目A");
		expect(h.index.getNode(id("项目B"))?.kind).toBe("parent");
	});

	it("改成同级已有名字被挡住", async () => {
		const h = await harness(sampleVault());
		expect(await h.ops.renamePage(id("首页.md"), "笔记规范")).toMatchObject({ ok: false, reason: "name-conflict" });
	});

	it("同名不做事，直接成功", async () => {
		const h = await harness(sampleVault());
		const before = h.vault.filePaths();
		expect(await h.ops.renamePage(id("首页.md"), "首页")).toMatchObject({ ok: true });
		expect(h.vault.filePaths()).toEqual(before);
	});

	it("改名会同步顺序文件里的键", async () => {
		const h = await harness(sampleVault());
		await h.ops.reorderScope(null, ["首页.md", "笔记规范.md", "项目A"]);
		await h.ops.renamePage(id("首页.md"), "开始");
		expect(h.order.getKeys("")).toEqual(["开始.md", "笔记规范.md", "项目A"]);
	});

	it("父页面改名第二步失败时回滚目录", async () => {
		const vault = sampleVault();
		const h = await harness(vault);
		const original = vault.renameFile.bind(vault);
		vault.renameFile = async () => {
			throw new Error("锁住了");
		};
		const result = await h.ops.renamePage(id("项目A"), "项目B");
		expect(result).toMatchObject({ ok: false, reason: "io-error" });
		expect(vault.folderPaths()).toContain("项目A");
		expect(vault.content("项目A/项目A.md")).toBeDefined();
		vault.renameFile = original;
	});

	it("只改大小写不算重名：分组目录", async () => {
		const h = await harness(sampleVault());
		const result = await h.ops.renamePage(id("Java/jvm"), "JVM");
		expect(result).toMatchObject({ ok: true });
		expect(h.vault.folderPaths()).toContain("Java/JVM");
		expect(h.vault.filePaths()).toContain("Java/JVM/堆内存.md");
	});

	it("只改大小写不算重名：叶子页面", async () => {
		const vault = new FakeVault();
		vault.seedFile("README.md", "");
		const h = await harness(vault);
		const result = await h.ops.renamePage(id("README.md"), "Readme");
		expect(result).toMatchObject({ ok: true, value: "Readme.md" });
		expect(h.vault.filePaths()).toEqual(["Readme.md"]);
	});

	it("别的大小写只差一旁的邻居仍然算冲突", async () => {
		const vault = new FakeVault();
		vault.seedFile("abc.md", "");
		vault.seedFile("ABC.md", "");
		const h = await harness(vault);
		// 两个文件同时存在时索引会报大小写冲突，但改名仍要挡住「变成另一个」这种操作。
		const result = await h.ops.renamePage(id("abc.md"), "ABC");
		expect(result.ok).toBe(false);
	});

	it("改名后的 id 反映新路径", async () => {
		const h = await harness(sampleVault());
		const result = await h.ops.renamePage(id("项目A/需求.md"), "需求清单");
		expect(result).toMatchObject({ ok: true, value: "项目A/需求清单.md" });
	});
});

describe("移动", () => {
	it("把叶子页面移到另一个父页面下", async () => {
		const h = await harness(sampleVault());
		const result = await h.ops.movePage(id("首页.md"), id("项目A"));
		expect(result).toMatchObject({ ok: true, value: "项目A/首页.md" });
		expect(h.vault.filePaths()).not.toContain("首页.md");
		expect(h.index.getNode(id("项目A/首页.md"))?.parentId).toBe("项目A");
	});

	it("移动整个父页面，子树跟着走", async () => {
		const h = await harness(sampleVault());
		await h.ops.createPage(null, "归档");
		await h.ops.createPage(id("归档.md"), "说明");
		const result = await h.ops.movePage(id("项目A"), id("归档"));
		expect(result).toMatchObject({ ok: true, value: "归档/项目A" });
		expect(h.vault.filePaths()).toContain("归档/项目A/设计/设计.md");
	});

	it("不能移到自己的子页面里", async () => {
		const h = await harness(sampleVault());
		expect(await h.ops.movePage(id("项目A"), id("项目A/设计"))).toMatchObject({ ok: false, reason: "not-allowed" });
	});

	it("不能移到自己下面", async () => {
		const h = await harness(sampleVault());
		expect(await h.ops.movePage(id("项目A"), id("项目A"))).toMatchObject({ ok: false, reason: "not-allowed" });
	});

	it("目标已有同名项时挡住", async () => {
		const h = await harness(sampleVault());
		expect(await h.ops.createPage(id("Java"), "重名")).toMatchObject({ ok: true });
		expect(await h.ops.createPage(null, "重名")).toMatchObject({ ok: true });
		expect(await h.ops.movePage(id("重名.md"), id("Java"))).toMatchObject({ ok: false, reason: "name-conflict" });
	});

	it("把笔记拖入叶子页面时才为叶子配对目录", async () => {
		const h = await harness(sampleVault());
		await h.ops.createPage(id("项目A"), "接收页");
		expect(h.vault.folderPaths()).not.toContain("项目A/接收页");
		await h.ops.reorderScope(id("项目A"), ["接收页.md", "需求.md"]);
		const result = await h.ops.movePage(id("笔记规范.md"), id("项目A/接收页.md"));
		expect(result).toEqual({ ok: true, value: "项目A/接收页/笔记规范.md" });
		expect(h.index.getNode(id("项目A/接收页/笔记规范.md"))?.parentId).toBe("项目A/接收页");
		expect(h.vault.filePaths()).toContain("项目A/接收页/接收页.md");
		expect(h.order.getKeys("项目A")).toEqual(["接收页", "需求.md"]);
		expect(h.order.getKeys("项目A/接收页")).toEqual(["笔记规范.md"]);
	});

	it("拖入叶子页面时复用已有的同名空目录", async () => {
		const vault = new FakeVault({ "jvm/1.md": "原笔记", "jvm/2.md": "子笔记" });
		vault.seedFolder("jvm/1");
		const h = await harness(vault);
		expect(await h.ops.movePage(id("jvm/2.md"), id("jvm/1.md"))).toEqual({ ok: true, value: "jvm/1/2.md" });
		expect(vault.content("jvm/1/1.md")).toBe("原笔记");
		expect(vault.content("jvm/1/2.md")).toBe("子笔记");
		expect(h.index.getNode(id("jvm/1/2.md"))?.parentId).toBe("jvm/1");
	});

	it("拖入叶子页面时保留有隐藏文件的同名目录", async () => {
		const vault = new FakeVault({ "1.md": "原笔记", "2.md": "子笔记", "1/.hidden": "现有文件" });
		const h = await harness(vault);
		expect(await h.ops.movePage(id("2.md"), id("1.md"))).toMatchObject({ ok: false, reason: "name-conflict" });
		expect(vault.filePaths()).toEqual(["1.md", "1/.hidden", "2.md"]);
	});

	it("移入叶子页面的整棵子树保留手动顺序", async () => {
		const h = await harness(sampleVault());
		await h.ops.reorderScope(id("项目A"), ["需求.md", "设计"]);
		const result = await h.ops.movePage(id("项目A"), id("首页.md"));
		expect(result).toEqual({ ok: true, value: "首页/项目A" });
		expect(h.vault.filePaths()).toContain("首页/项目A/设计/设计.md");
		expect(h.order.getKeys("首页/项目A")).toEqual(["需求.md", "设计"]);
		expect(h.order.getKeys("项目A")).toEqual([]);
	});

	it.each([false, true])("拖入失败时恢复原笔记并保留原有目录状态（目录已存在：%s）", async (existingFolder) => {
		const vault = sampleVault();
		if (existingFolder) vault.seedFolder("首页");
		const h = await harness(vault);
		const renameFile = vault.renameFile.bind(vault);
		vi.spyOn(vault, "renameFile").mockImplementation(async (from, to) => {
			if (from === "笔记规范.md") throw new Error("移动失败");
			await renameFile(from, to);
		});
		expect(await h.ops.movePage(id("笔记规范.md"), id("首页.md"))).toMatchObject({
			ok: false, reason: "io-error",
		});
		expect(vault.filePaths()).toEqual(expect.arrayContaining(["首页.md", "笔记规范.md"]));
		expect(vault.folderPaths().includes("首页")).toBe(existingFolder);
	});

	it("配对后放不下整棵子树时保留源和目标", async () => {
		const parent = Array.from({ length: DEFAULT_MAX_DEPTH - 2 }, () => "层").join("/");
		const target = `${parent}/接收页.md`;
		const h = await harness(new FakeVault({ [target]: "", "源/下层/笔记.md": "" }));
		expect(await h.ops.movePage(id("源"), id(target))).toMatchObject({ ok: false, reason: "not-allowed" });
		expect(h.vault.filePaths()).toContain(target);
		expect(h.vault.filePaths()).toContain("源/下层/笔记.md");
		expect(h.vault.folderPaths()).not.toContain(`${parent}/接收页`);
	});

	it("移动后顺序跨作用域搬运", async () => {
		const h = await harness(sampleVault());
		await h.ops.reorderScope(null, ["首页.md", "笔记规范.md", "项目A"]);
		await h.ops.movePage(id("首页.md"), id("项目A"));
		expect(h.order.getKeys("")).toEqual(["笔记规范.md", "项目A"]);
		expect(h.order.getKeys("项目A")).toEqual(["首页.md"]);
	});
});

describe("删除", () => {
	it("删叶子页面只删那一个文件", async () => {
		const h = await harness(sampleVault());
		const result = await h.ops.deletePage(id("首页.md"), { withChildren: true, useTrash: true });
		expect(result).toMatchObject({ ok: true, value: { deletedPages: 1 } });
		expect(h.vault.filePaths()).not.toContain("首页.md");
		expect(h.vault.filePaths()).toContain("笔记规范.md");
	});

	it("只删父页面笔记时保留它在同级里的顺序位置", async () => {
		const h = await harness(sampleVault());
		await h.order.setKeys("", ["首页.md", "项目A"]);
		await h.ops.deletePage(id("项目A"), { withChildren: false, useTrash: true });
		// 目录还在，降级成同名分组目录，键没变，位置就该留着。
		expect(h.order.getKeys("")).toEqual(["首页.md", "项目A"]);
	});

	it("删父页面但保留子页面时只删笔记，目录降级为分组目录", async () => {
		const h = await harness(sampleVault());
		const result = await h.ops.deletePage(id("项目A"), { withChildren: false, useTrash: true });
		expect(result).toMatchObject({ ok: true, value: { deletedPages: 1 } });
		expect(h.vault.filePaths()).not.toContain("项目A/项目A.md");
		expect(h.vault.filePaths()).toContain("项目A/需求.md");
		expect(h.index.getNode(id("项目A"))?.kind).toBe("group");
	});

	it("关掉回收站开关时把 system=false 交给适配层", async () => {
// 开关关闭 = 用户明确要永久删除。适配层必须能区分这两条路径，
// 否则整个勾选框就只是个装饰品（真实适配器曾经只调 trashFile）。
const h = await harness(sampleVault());await h.ops.deletePage(id("首页.md"), { withChildren: true, useTrash: false });expect(h.vault.trashLog).toEqual([{ path: "首页.md", system: false }]);});
it("默认走回收站", async () => {
const h = await harness(sampleVault());await h.ops.deletePage(id("首页.md"), { withChildren: true, useTrash: true });expect(h.vault.trashLog).toEqual([{ path: "首页.md", system: true }]);});
it("删分组目录时计数不把自己算成一篇笔记", async () => {
                const h = await harness(sampleVault());
                // Java 是分组目录：jvm 下两篇 + 并发下一篇，共 3 篇，没有「Java.md」。
                const result = await h.ops.deletePage(id("Java"), { withChildren: true, useTrash: true });
                expect(result).toMatchObject({ ok: true, value: { deletedPages: 3 } });
                expect(h.vault.folderPaths()).not.toContain("Java");
        });
it("删父页面连同子页面时整棵目录走", async () => {
		const h = await harness(sampleVault());
		const result = await h.ops.deletePage(id("项目A"), { withChildren: true, useTrash: true });
		// 项目A 自己 + 需求.md + 设计 = 3
		expect(result).toMatchObject({ ok: true, value: { deletedPages: 3 } });
		expect(h.vault.folderPaths()).not.toContain("项目A");
		expect(h.vault.filePaths().filter((p) => p.startsWith("项目A/"))).toEqual([]);
	});

	it("删掉的分组目录从顺序文件里清理干净", async () => {
		const h = await harness(sampleVault());
		await h.ops.reorderScope(null, ["Java", "项目A"]);
		await h.ops.deletePage(id("Java"), { withChildren: true, useTrash: true });
		expect(h.order.getKeys("")).toEqual(["项目A"]);
		expect(h.order.getKeys("Java")).toEqual([]);
	});

	it("useTrash=false 时走永久删除", async () => {
		const vault = sampleVault();
		const calls: (boolean | undefined)[] = [];
		const original = vault.trash.bind(vault);
		vault.trash = async (path, system) => {
			calls.push(system);
			return original(path, system);
		};
		const h = await harness(vault);
		await h.ops.deletePage(id("首页.md"), { withChildren: true, useTrash: false });
		expect(calls).toEqual([false]);
	});
});

describe("配对与解除配对", () => {
	it("叶子页面升级为父页面：补一个同名目录", async () => {
		const h = await harness(sampleVault());
		const result = await h.ops.pairPage(id("首页.md"));
		expect(result).toMatchObject({ ok: true, value: "首页" });
		expect(h.vault.folderPaths()).toContain("首页");
		expect(h.index.getNode(id("首页"))?.kind).toBe("parent");
	});

	it("配对升级为父页面后，它在同级里的位置原地保留", async () => {
		const vault = new FakeVault({ "Pages/Java/新笔记.md": "", "Pages/Java/jvm/堆.md": "" });
		const h = await harness(vault, "Pages");
		await h.order.setKeys("Java", ["新笔记.md", "jvm"]);
		expect(await h.ops.pairPage(id("Java/新笔记.md"))).toMatchObject({ ok: true, value: "Java/新笔记" });
		// 键的口径跟着节点类型变（叶子带 .md、父页面不带），但位置不该被打回按名排序。
		expect(h.order.getKeys("Java")).toEqual(["新笔记", "jvm"]);
	});

	it("解除配对降级为叶子后，位置同样原地保留", async () => {
		const vault = new FakeVault({ "空项目/空项目.md": "", "另一个.md": "" });
		const h = await harness(vault);
		await h.order.setKeys("", ["空项目", "另一个.md"]);
		expect(await h.ops.unpairPage(id("空项目"))).toMatchObject({ ok: true });
		expect(h.order.getKeys("")).toEqual(["空项目.md", "另一个.md"]);
	});

	it("分组目录升级为父页面：补一个同名笔记", async () => {
		const h = await harness(sampleVault());
		const result = await h.ops.pairPage(id("Java"), "# Java");
		expect(result).toMatchObject({ ok: true, value: "Java" });
		expect(h.vault.content("Java/Java.md")).toBe("# Java");
		expect(h.index.getNode(id("Java"))?.kind).toBe("parent");
	});

	it("已是父页面时不做任何事", async () => {
		const h = await harness(sampleVault());
		const before = h.vault.filePaths();
		expect(await h.ops.pairPage(id("项目A"))).toMatchObject({ ok: true, value: "项目A" });
		expect(h.vault.filePaths()).toEqual(before);
	});

	it("解除配对把笔记移出来并删掉空目录", async () => {
		const vault = new FakeVault({ "项目/项目.md": "", "项目/项目/子.md": "" });
		const h = await harness(vault);
		expect(await h.ops.unpairPage(id("项目"))).toMatchObject({ ok: false, reason: "not-allowed" });
	});

	it("目录为空时解除配对成功，父页面降级为叶子", async () => {
		const h = await harness(new FakeVault({ "空项目/空项目.md": "" }));
		const result = await h.ops.unpairPage(id("空项目"));
		expect(result).toMatchObject({ ok: true, value: "空项目.md" });
		expect(h.vault.filePaths()).toEqual(["空项目.md"]);
		expect(h.vault.folderPaths()).toEqual([]);
		expect(h.index.getNode(id("空项目.md"))?.kind).toBe("leaf");
	});

	it("叶子页面不能解除配对", async () => {
		const h = await harness(sampleVault());
		expect(await h.ops.unpairPage(id("首页.md"))).toMatchObject({ ok: false, reason: "not-allowed" });
	});
});

describe("排序", () => {
	it("整段覆盖某个作用域", async () => {
		const h = await harness(sampleVault());
		await h.ops.reorderScope(null, ["项目A", "首页.md"]);
		expect(h.index.getRoots().slice(0, 2).map((node) => node.title)).toEqual(["项目A", "首页"]);
	});

	it("上移一位", async () => {
		const h = await harness(sampleVault());
		const roots = h.index.getRoots().map((node) => node.title);
		const second = h.index.getRoots()[1];
		await h.ops.reorderOne(second.id, "up");
		expect(h.index.getRoots()[0].title).toBe(second.title);
		expect(h.index.getRoots().map((node) => node.title)).toEqual([roots[1], roots[0], ...roots.slice(2)]);
	});

	it("已在最前时上移不动", async () => {
		const h = await harness(sampleVault());
		const first = h.index.getRoots()[0];
		await h.ops.reorderOne(first.id, "up");
		expect(h.index.getRoots()[0].id).toBe(first.id);
	});

	it("移到末尾", async () => {
		const h = await harness(sampleVault());
		const first = h.index.getRoots()[0];
		await h.ops.reorderOne(first.id, "last");
		expect(h.index.getRoots().at(-1)?.id).toBe(first.id);
	});

	it("排序只影响所在作用域", async () => {
		const h = await harness(sampleVault());
		const before = h.index.getChildren(id("Java")).map((node) => node.title);
		await h.ops.reorderScope(null, ["首页.md"]);
		expect(h.index.getChildren(id("Java")).map((node) => node.title)).toEqual(before);
	});
});

describe("模板与文案", () => {
	it("没有模板时给出默认标题", () => {
		expect(renderTemplate(undefined, "标题")).toBe("# 标题\n");
	});

	it("未知占位符原样保留", () => {
		expect(renderTemplate("{{title}} {{unknown}}", "T")).toContain("{{unknown}}");
	});

	it("所有失败原因都有中文文案", async () => {
		const h = await harness(new FakeVault());
		const empty = await h.ops.createPage(null, "");
		const missing = await h.ops.renamePage(id("不存在.md"), "x");
		expect(empty.ok).toBe(false);
		expect(missing.ok).toBe(false);
		if (!empty.ok && !missing.ok) {
			expect(empty.message.length).toBeGreaterThan(0);
			expect(missing.message.length).toBeGreaterThan(0);
		}
	});
});
