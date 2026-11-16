import { beforeEach, describe, expect, it } from "vitest";
import { PageOperationService, renderTemplate } from "../../src/core/pageOperationService";
import { PageId } from "../../src/models/pageId";
import { PageIndex } from "../../src/repository/pageIndex";
import { PageOrderStore } from "../../src/repository/pageOrderStore";
import { scan } from "../../src/repository/pageScanner";
import { FakeVault, sampleVault } from "../fixtures/fakeVault";

interface Harness {
	vault: FakeVault;
	index: PageIndex;
	order: PageOrderStore;
	ops: PageOperationService;
	refresh(): Promise<void>;
}

async function harness(vault: FakeVault, pageRoot = ""): Promise<Harness> {
	const index = new PageIndex();
	const order = new PageOrderStore(vault, pageRoot);
	await order.load();
	const refresh = async () => {
		index.replace(await scan(vault, pageRoot, { order: order.current }));
	};
	await refresh();
	const ops = new PageOperationService({
		adapter: vault,
		order,
		getNode: (id) => index.getNode(id),
		getChildren: (scope) => index.getChildren(scope),
		getPageRoot: () => pageRoot,
		refresh,
	});
	return { vault, index, order, ops, refresh };
}

const id = (value: string) => value as PageId;

describe("新建页面", () => {
	it("在根层建叶子页面，只产生一个 .md", async () => {
		const h = await harness(new FakeVault());
		const result = await h.ops.createPage(null, "新页面");
		expect(result).toMatchObject({ ok: true, value: "新页面.md" });
		expect(h.vault.filePaths()).toEqual(["新页面.md"]);
		expect(h.vault.folderPaths()).toEqual([]);
		expect(h.vault.content("新页面.md")).toBe("# 新页面\n");
	});

	it("withFolder 时同时建目录，得到父页面", async () => {
		const h = await harness(new FakeVault());
		const result = await h.ops.createPage(null, "项目", { withFolder: true });
		expect(result).toMatchObject({ ok: true, value: "项目" });
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

	it("叶子页面不能直接建子页面", async () => {
		const h = await harness(sampleVault());
		const result = await h.ops.createPage(id("首页.md"), "子");
		expect(result).toMatchObject({ ok: false, reason: "not-allowed" });
		expect(h.vault.filePaths()).not.toContain("首页.md/子.md");
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

	it("建目录成功但建文件失败时把空目录清掉", async () => {
		const vault = new FakeVault();
		vault.createFile = async () => {
			throw new Error("磁盘满了");
		};
		const h = await harness(vault);
		const result = await h.ops.createPage(null, "半成品", { withFolder: true });
		expect(result).toMatchObject({ ok: false, reason: "io-error" });
		expect(h.vault.folderPaths()).toEqual([]);
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
		await h.ops.createPage(null, "归档", { withFolder: true });
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

	it("移到叶子页面下被挡住", async () => {
		const h = await harness(sampleVault());
		expect(await h.ops.movePage(id("笔记规范.md"), id("首页.md"))).toMatchObject({ ok: false, reason: "not-allowed" });
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
