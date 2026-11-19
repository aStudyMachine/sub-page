import { describe, expect, it } from "vitest";
import { LEGACY_ORDER_FILE_NAME, ORDER_FILE_NAME, PageOrderStore, parseOrderFile } from "../../src/repository/pageOrderStore";
import { FakeVault } from "../fixtures/fakeVault";

const path = () => ORDER_FILE_NAME;

describe("顺序文件解析", () => {
	it("读回每个作用域的数组", () => {
		const result = parseOrderFile(JSON.stringify({ "": ["a.md"], Java: ["jvm"] }));
		expect(result.order).toEqual({ "": ["a.md"], Java: ["jvm"] });
		expect(result.problem).toBeNull();
	});

	it("非 JSON 时降级并给原因", () => {
		const result = parseOrderFile("{ broken");
		expect(result.order).toEqual({});
		expect(result.problem).toContain("JSON");
	});

	it("结构不对（数组 / 空）时降级", () => {
		expect(parseOrderFile("[]").problem).toContain("结构");
		expect(parseOrderFile("null").problem).toContain("结构");
	});

	it("过滤掉非字符串与非空数组以外的值", () => {
		const result = parseOrderFile(JSON.stringify({ "": ["a.md", 3, ""], Java: "not-array" }));
		expect(result.order).toEqual({ "": ["a.md"] });
	});
});

describe("顺序文件读写", () => {
	it("文件不存在时视为空顺序，不报错", async () => {
		const store = new PageOrderStore(new FakeVault(), "", ORDER_FILE_NAME);
		const result = await store.load();
		expect(result.order).toEqual({});
		expect(result.problem).toBeNull();
	});

	it("写入后再读回一致，只写一个文件", async () => {
		const vault = new FakeVault({ "a.md": "", "b.md": "" });
		const store = new PageOrderStore(vault, "", ORDER_FILE_NAME);
		await store.setKeys("", ["b.md", "a.md"]);
		expect(vault.filePaths()).toContain(path());

		const reloaded = new PageOrderStore(vault, "", ORDER_FILE_NAME);
		await reloaded.load();
		expect(reloaded.getKeys("")).toEqual(["b.md", "a.md"]);
	});

	it("逐个导入页面根的旧文件，切换时各自恢复顺序", async () => {
		const legacyRoot = JSON.stringify({ "": ["b.md", "a.md"] });
		const legacyKnowledge = JSON.stringify({ "": ["a.md", "b.md"] });
		const legacyPath = "Knowledge/" + LEGACY_ORDER_FILE_NAME;
		const vault = new FakeVault({ [LEGACY_ORDER_FILE_NAME]: legacyRoot, [legacyPath]: legacyKnowledge });
		const store = new PageOrderStore(vault, "Knowledge", ORDER_FILE_NAME);
		expect((await store.load()).order).toEqual({ "": ["a.md", "b.md"] });
		store.setPageRoot("");
		expect((await store.load()).order).toEqual({ "": ["b.md", "a.md"] });
		store.setPageRoot("Knowledge");
		await store.load();
		await store.setKeys("", []);
		store.setPageRoot("");
		await store.load();
		expect(store.getKeys("")).toEqual(["b.md", "a.md"]);
		store.setPageRoot("Knowledge");
		await store.load();
		expect(store.getKeys("")).toEqual([]);
		expect(vault.content(LEGACY_ORDER_FILE_NAME)).toBe(legacyRoot);
		expect(vault.content(legacyPath)).toBe(legacyKnowledge);
	});

	it("迁移写入失败时沿用旧排序，下次加载重试", async () => {
		const legacy = JSON.stringify({ "": ["b.md", "a.md"] });
		const vault = new FakeVault({ [LEGACY_ORDER_FILE_NAME]: legacy });
		const store = new PageOrderStore(vault, "", ORDER_FILE_NAME);
		const writeText = vault.writeText.bind(vault);
		vault.writeText = async () => { throw new Error("磁盘不可写"); };
		expect(await store.load()).toMatchObject({ order: { "": ["b.md", "a.md"] }, problem: expect.stringContaining("磁盘不可写") });
		expect(vault.content(LEGACY_ORDER_FILE_NAME)).toBe(legacy);
		vault.writeText = writeText;
		expect((await store.load()).problem).toBeNull();
		expect(JSON.parse(vault.content(path())!)).toEqual({ roots: { "": { "": ["b.md", "a.md"] } } });
	});

	it("改名只替换元素，位置不变", async () => {
		const vault = new FakeVault();
		const store = new PageOrderStore(vault, "", ORDER_FILE_NAME);
		await store.setKeys("", ["a.md", "b.md", "c.md"]);
		await store.renameKey("", "b.md", "B2.md");
		expect(store.getKeys("")).toEqual(["a.md", "B2.md", "c.md"]);
	});

	it("改名不在顺序里时什么都不写", async () => {
		const vault = new FakeVault();
		const store = new PageOrderStore(vault, "", ORDER_FILE_NAME);
		await store.renameKey("", "x.md", "y.md");
		expect(await vault.exists(path())).toBe(false);
	});

	it("移动跨作用域：从源摘掉，追加到目标末尾", async () => {
		const vault = new FakeVault();
		const store = new PageOrderStore(vault, "", ORDER_FILE_NAME);
		await store.setKeys("", ["a.md", "b.md"]);
		await store.setKeys("Java", ["jvm"]);
		await store.moveKey("", "Java", "b.md");
		expect(store.getKeys("")).toEqual(["a.md"]);
		expect(store.getKeys("Java")).toEqual(["jvm", "b.md"]);
	});

	it("移走最后一个元素时清掉空作用域", async () => {
		const vault = new FakeVault();
		const store = new PageOrderStore(vault, "", ORDER_FILE_NAME);
		await store.setKeys("Java", ["jvm"]);
		await store.moveKey("Java", "", "jvm");
		expect(store.getKeys("Java")).toEqual([]);
		expect(JSON.parse(vault.content(path())!)).toEqual({ roots: { "": { "": ["jvm"] } } });
	});

	it("删除会从所有作用域清掉", async () => {
		const vault = new FakeVault();
		const store = new PageOrderStore(vault, "", ORDER_FILE_NAME);
		await store.setKeys("", ["a.md", "b.md"]);
		await store.setKeys("b.md", ["x.md"]);
		await store.removeKey("b.md");
		expect(store.getKeys("")).toEqual(["a.md"]);
		// 以它为作用域的那一段也一起清掉，否则结构检查里会长期留着孤立条目。
		expect(store.getKeys("b.md")).toEqual([]);
	});

	it("外部改写了顺序文件时 reloadIfChanged 跟随", async () => {
		const vault = new FakeVault({ "a.md": "", "b.md": "" });
		const store = new PageOrderStore(vault, "", ORDER_FILE_NAME);
		await store.load();
		vault.stopEvents();
		await vault.writeText(path(), JSON.stringify({ roots: { "": { "": ["b.md", "a.md"] } } }));
		expect(await store.reloadIfChanged()).toBe(true);
		expect(store.getKeys("")).toEqual(["b.md", "a.md"]);
	});

	it("内容没变时 reloadIfChanged 返回 false", async () => {
		const vault = new FakeVault({ "a.md": "", "b.md": "" });
		const store = new PageOrderStore(vault, "", ORDER_FILE_NAME);
		await store.load();
		await store.reorder("", ["b.md", "a.md"]);
		// 宿主延迟送达的自写 modify 就是这种形状：文件还是自己写的那一份。
		expect(await store.reloadIfChanged()).toBe(false);
	});

	it("重载过程中提交的新排序在内存和磁盘一致", async () => {
		const vault = new FakeVault();
		const store = new PageOrderStore(vault, "", ORDER_FILE_NAME);
		await store.setKeys("", ["old.md"]);
		const read = vault.readText.bind(vault);
		let unblock!: () => void;
		let reading!: () => void;
		const blocked = new Promise<void>((resolve) => { unblock = resolve; });
		const started = new Promise<void>((resolve) => { reading = resolve; });
		vault.readText = async (path) => {
			const raw = await read(path);
			reading();
			await blocked;
			return raw;
		};
		const reload = store.load();
		await started;
		const save = store.setKeys("", ["new.md"]);
		unblock();
		await Promise.all([reload, save]);
		expect(store.getKeys("")).toEqual(["new.md"]);
		expect(JSON.parse((await read(ORDER_FILE_NAME))!)).toEqual({ roots: { "": { "": ["new.md"] } } });
	});

	it("文件还不存在时 reloadIfChanged 不报变更", async () => {
		const store = new PageOrderStore(new FakeVault({ "a.md": "" }), "", ORDER_FILE_NAME);
		await store.load();
		expect(await store.reloadIfChanged()).toBe(false);
	});

	it("自写期间 isWriting 为真，写完复位", async () => {
		const vault = new FakeVault();
		const store = new PageOrderStore(vault, "", ORDER_FILE_NAME);
		const seen: boolean[] = [];
		const original = vault.writeText.bind(vault);
		vault.writeText = async (p, c) => {
			seen.push(store.isWriting);
			return original(p, c);
		};
		await store.setKeys("", ["a.md"]);
		expect(seen).toEqual([true]);
		expect(store.isWriting).toBe(false);
	});
});
