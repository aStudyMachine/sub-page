import { describe, expect, it } from "vitest";
import { ORDER_FILE_NAME, PageOrderStore, parseOrderFile } from "../../src/repository/pageOrderStore";
import { FakeVault } from "../fixtures/fakeVault";

const path = (root = "") => (root ? root + "/" + ORDER_FILE_NAME : ORDER_FILE_NAME);

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
		const store = new PageOrderStore(new FakeVault(), "");
		const result = await store.load();
		expect(result.order).toEqual({});
		expect(result.problem).toBeNull();
	});

	it("写入后再读回一致，只写一个文件", async () => {
		const vault = new FakeVault({ "a.md": "", "b.md": "" });
		const store = new PageOrderStore(vault, "");
		await store.setKeys("", ["b.md", "a.md"]);
		expect(vault.filePaths()).toContain(path());

		const reloaded = new PageOrderStore(vault, "");
		await reloaded.load();
		expect(reloaded.getKeys("")).toEqual(["b.md", "a.md"]);
	});

	it("页面根下写文件，不写到 vault 根", async () => {
		const vault = new FakeVault({ "Knowledge/a.md": "" });
		const store = new PageOrderStore(vault, "Knowledge");
		await store.setKeys("", ["a.md"]);
		expect(vault.filePaths()).toContain(path("Knowledge"));
	});

	it("改名只替换元素，位置不变", async () => {
		const vault = new FakeVault();
		const store = new PageOrderStore(vault, "");
		await store.setKeys("", ["a.md", "b.md", "c.md"]);
		await store.renameKey("", "b.md", "B2.md");
		expect(store.getKeys("")).toEqual(["a.md", "B2.md", "c.md"]);
	});

	it("改名不在顺序里时什么都不写", async () => {
		const vault = new FakeVault();
		const store = new PageOrderStore(vault, "");
		await store.renameKey("", "x.md", "y.md");
		expect(await vault.exists(path())).toBe(false);
	});

	it("移动跨作用域：从源摘掉，追加到目标末尾", async () => {
		const vault = new FakeVault();
		const store = new PageOrderStore(vault, "");
		await store.setKeys("", ["a.md", "b.md"]);
		await store.setKeys("Java", ["jvm"]);
		await store.moveKey("", "Java", "b.md");
		expect(store.getKeys("")).toEqual(["a.md"]);
		expect(store.getKeys("Java")).toEqual(["jvm", "b.md"]);
	});

	it("移走最后一个元素时清掉空作用域", async () => {
		const vault = new FakeVault();
		const store = new PageOrderStore(vault, "");
		await store.setKeys("Java", ["jvm"]);
		await store.moveKey("Java", "", "jvm");
		expect(store.getKeys("Java")).toEqual([]);
		expect(JSON.parse(vault.content(path())!)).toEqual({ "": ["jvm"] });
	});

	it("删除会从所有作用域清掉", async () => {
		const vault = new FakeVault();
		const store = new PageOrderStore(vault, "");
		await store.setKeys("", ["a.md", "b.md"]);
		await store.setKeys("b.md", ["x.md"]);
		await store.removeKey("b.md");
		expect(store.getKeys("")).toEqual(["a.md"]);
		// 以它为作用域的那一段也一起清掉，否则结构检查里会长期留着孤立条目。
		expect(store.getKeys("b.md")).toEqual([]);
	});

	it("自写期间 isWriting 为真，写完复位", async () => {
		const vault = new FakeVault();
		const store = new PageOrderStore(vault, "");
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
