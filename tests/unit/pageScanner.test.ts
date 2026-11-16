import { describe, expect, it } from "vitest";
import { scan } from "../../src/repository/pageScanner";
import { PageIndex } from "../../src/repository/pageIndex";
import { FakeVault, sampleVault } from "../fixtures/fakeVault";

const titles = (snapshot: { roots: string[]; nodes: Map<string, { title: string }> }) =>
	snapshot.roots.map((id) => snapshot.nodes.get(id)?.title);

describe("扫描：三类节点", () => {
	it("现有库形状零配对也能成树", async () => {
		const vault = new FakeVault({
			"首页.md": "",
			"笔记规范.md": "",
			"Java/jvm/堆内存.md": "",
			"Java/并发/线程池.md": "",
		});
		const snapshot = await scan(vault, "");
		expect(titles(snapshot as never)).toEqual(["Java", "笔记规范", "首页"].sort((a, b) => a.localeCompare(b, "zh")));
		expect(snapshot.nodes.get("Java" as never)?.kind).toBe("group");
		expect(snapshot.nodes.get("Java/jvm/堆内存.md" as never)?.kind).toBe("leaf");
		expect(snapshot.folderCount).toBe(3);
	});

	it("目录里有同名笔记时成为父页面，笔记本身不重复出现", async () => {
		const vault = new FakeVault({ "项目A/项目A.md": "", "项目A/需求.md": "" });
		const snapshot = await scan(vault, "");
		expect(snapshot.roots).toEqual(["项目A"]);
		const parent = snapshot.nodes.get("项目A" as never)!;
		expect(parent.kind).toBe("parent");
		expect(parent.filePath).toBe("项目A/项目A.md");
		expect(parent.childIds).toEqual(["项目A/需求.md"]);
	});

	it("同名笔记与同名目录是两种节点，可以并存", async () => {
		const vault = new FakeVault({ "项目A.md": "", "项目A/子.md": "" });
		const snapshot = await scan(vault, "");
		expect(snapshot.roots).toEqual(["项目A", "项目A.md"]);
		expect(snapshot.nodes.get("项目A" as never)?.kind).toBe("group");
		expect(snapshot.nodes.get("项目A.md" as never)?.kind).toBe("leaf");
	});

	it("没有页面后代的目录默认不出现，也不进 warnings", async () => {
		const vault = new FakeVault({ "首页.md": "", "_assets/图片.png": "", "空目录/.keep": "" });
		const snapshot = await scan(vault, "");
		expect(snapshot.roots).toEqual(["首页.md"]);
		expect(snapshot.warnings).toHaveLength(0);
	});

	it("打开显示空目录后以分组目录出现", async () => {
		const vault = new FakeVault({ "空目录/.keep": "" });
		const snapshot = await scan(vault, "", { showEmptyFolders: true });
		expect(snapshot.nodes.get("空目录" as never)?.kind).toBe("group");
	});

	it("隐藏目录永远不出现，即使里面有笔记", async () => {
		const vault = new FakeVault({ ".obsidian/x.md": "", ".trash/y.md": "", "正常.md": "" });
		const snapshot = await scan(vault, "");
		expect(snapshot.roots).toEqual(["正常.md"]);
	});

	it("额外排除目录不区分大小写", async () => {
		const vault = new FakeVault({ "Assets/图.md": "", "正常.md": "" });
		const snapshot = await scan(vault, "", { excludedFolders: ["assets"] });
		expect(snapshot.roots).toEqual(["正常.md"]);
	});

	it("非 Markdown 文件不进树也不报异常", async () => {
		const vault = new FakeVault({ "项目A/项目A.md": "", "项目A/图.png": "", "项目A/数据.json": "" });
		const snapshot = await scan(vault, "");
		expect(snapshot.nodes.get("项目A" as never)?.childIds).toEqual([]);
	});

	it("扩展名大小写不敏感", async () => {
		const vault = new FakeVault({ "笔记.MD": "" });
		const snapshot = await scan(vault, "");
		expect(snapshot.nodes.get("笔记.MD" as never)?.kind).toBe("leaf");
	});

	it("页面根可以是非根目录", async () => {
		const vault = new FakeVault({ "Knowledge/首页.md": "", "Knowledge/Java/a.md": "", "其他/x.md": "" });
		const snapshot = await scan(vault, "Knowledge");
		expect(snapshot.pageRoot).toBe("Knowledge");
		expect(snapshot.nodes.get("首页.md" as never)?.filePath).toBe("Knowledge/首页.md");
		expect(snapshot.nodes.has("其他" as never)).toBe(false);
	});

	it("页面根不存在时返回空树并报警", async () => {
		const vault = new FakeVault({ "a.md": "" });
		const snapshot = await scan(vault, "不存在的目录");
		expect(snapshot.roots).toEqual([]);
		expect(snapshot.warnings[0]?.kind).toBe("read-error");
	});

	it("深层嵌套与中文空格路径", async () => {
		const vault = new FakeVault({ "一/二/三/第 2 章.md": "" });
		const snapshot = await scan(vault, "");
		const node = snapshot.nodes.get("一/二/三/第 2 章.md" as never)!;
		expect(node.depth).toBe(4);
		expect(node.title).toBe("第 2 章");
	});

	it("超过深度上限时截断并报警而不是静默丢", async () => {
		const vault = new FakeVault({ "a/b/c/d/e.md": "" });
		const snapshot = await scan(vault, "", { maxDepth: 2 });
		expect(snapshot.warnings.some((w) => w.kind === "depth-limit")).toBe(true);
	});

	it("同级只差大小写时报冲突", async () => {
		const vault = new FakeVault({ "Java/a.md": "", "Java/A.md": "" });
		const snapshot = await scan(vault, "");
		expect(snapshot.warnings.some((w) => w.kind === "case-conflict")).toBe(true);
	});
});

describe("扫描：排序与统计", () => {
	it("默认按名称自然排序，数字按数值", async () => {
		const vault = new FakeVault({ "第10章.md": "", "第2章.md": "", "第1章.md": "" });
		const snapshot = await scan(vault, "");
		expect(titles(snapshot as never)).toEqual(["第1章", "第2章", "第10章"]);
	});

	it("顺序文件生效，未登记的排在后面", async () => {
		const vault = new FakeVault({ "a.md": "", "b.md": "", "c.md": "" });
		const snapshot = await scan(vault, "", { order: { "": ["c.md", "a.md"] } });
		expect(titles(snapshot as never)).toEqual(["c", "a", "b"]);
	});

	it("后代数量包含整棵子树", async () => {
		const vault = sampleVault();
		const snapshot = await scan(vault, "");
		expect(snapshot.nodes.get("Java" as never)?.descendantCount).toBe(3);
	});

	it("父页面的后代数量不含自己", async () => {
		const vault = sampleVault();
		const snapshot = await scan(vault, "");
		// 项目A 下：需求.md、设计（父页面，它的 设计.md 是自己，不算后代）
		expect(snapshot.nodes.get("项目A" as never)?.descendantCount).toBe(2);
	});

	it("读取元数据由独立步骤完成，扫描本身不读文件内容", async () => {
		const vault = sampleVault();
		const snapshot = await scan(vault, "");
		expect(snapshot.nodes.get("项目A" as never)?.metadata).toEqual({});
	});
});

describe("索引查询", () => {
	it("按文件路径反查节点", async () => {
		const vault = sampleVault();
		const index = new PageIndex();
		index.replace(await scan(vault, ""));
		expect(index.findByFilePath("项目A/项目A.md")?.id).toBe("项目A");
		expect(index.findByFilePath("项目A/项目A.MD")?.id).toBe("项目A");
		expect(index.findByFilePath("不存在.md")).toBeUndefined();
	});

	it("祖先链从根到父", async () => {
		const vault = sampleVault();
		const index = new PageIndex();
		index.replace(await scan(vault, ""));
		// 配对之后父页面的 id 是目录路径，不能用文件路径反查。
		const leafId = index.findByFilePath("项目A/设计/设计.md")!.id;
		expect(leafId).toBe("项目A/设计");
		expect(index.getAncestors(leafId).map((n) => n.id)).toEqual(["项目A"]);
	});

	it("根层子节点即 roots", async () => {
		const vault = sampleVault();
		const index = new PageIndex();
		index.replace(await scan(vault, ""));
		expect(index.getChildren(null).map((n) => n.title)).toEqual(index.getRoots().map((n) => n.title));
	});

	it("搜索只命中页面，不含分组目录", async () => {
		const vault = sampleVault();
		const index = new PageIndex();
		index.replace(await scan(vault, ""));
		expect(index.search("内存").map((n) => n.title)).toEqual(["堆内存"]);
		expect(index.search("Java")).toHaveLength(0);
	});

	it("统计区分页面与分组目录", async () => {
		const vault = sampleVault();
		const index = new PageIndex();
		index.replace(await scan(vault, ""));
		const stats = index.stats();
		// Java、Java/jvm、Java/并发 是分组目录；设计 是父页面。
		expect(stats.groups).toBe(3);
		expect(stats.pages).toBe(8);
	});
});
