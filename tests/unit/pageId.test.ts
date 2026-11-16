import { describe, expect, it } from "vitest";
import { childIdOf, isFileId, isRootScope, nameOf, scopeOf, toPageId } from "../../src/models/pageId";
import { isSameOrDescendantPath, joinPath, normalizePath } from "../../src/utils/pathUtils";

describe("page id", () => {
	it("规范化分隔符与首尾斜杠", () => {
		expect(toPageId("/Java//jvm/")).toBe("Java/jvm");
	});

	it("文件名 id 保留 .md，目录 id 不保留", () => {
		expect(isFileId(toPageId("Java/jvm/堆内存.md"))).toBe(true);
		expect(isFileId(toPageId("项目A"))).toBe(false);
	});

	it("显示名去掉扩展名", () => {
		expect(nameOf(toPageId("Java/jvm/堆内存.md"))).toBe("堆内存");
		expect(nameOf(toPageId("项目A"))).toBe("项目A");
	});

	it("同名目录与同名文件是不同的 id", () => {
		expect(toPageId("项目A")).not.toBe(toPageId("项目A.md"));
	});

	it("作用域是父目录", () => {
		expect(scopeOf(toPageId("Java/jvm/堆内存.md"))).toBe("Java/jvm");
		expect(scopeOf(toPageId("首页.md"))).toBe("");
	});

	it("空 id 表示根作用域", () => {
		expect(isRootScope(null)).toBe(true);
		expect(isRootScope(toPageId(""))).toBe(true);
		expect(isRootScope(toPageId("首页.md"))).toBe(false);
	});

	it("子 id 由父作用域与名称拼接", () => {
		expect(childIdOf(null, "项目A")).toBe("项目A");
		expect(childIdOf(toPageId("Java"), "jvm")).toBe("Java/jvm");
	});

	it("后代判定：自身、子、孙为真，兄弟与无关路径为假", () => {
		expect(isSameOrDescendantPath("Java/jvm", "Java")).toBe(true);
		expect(isSameOrDescendantPath("Java", "Java")).toBe(true);
		expect(isSameOrDescendantPath("Java/jvm/堆内存.md", "Java")).toBe(true);
		expect(isSameOrDescendantPath("JavaScript", "Java")).toBe(false);
		expect(isSameOrDescendantPath("Java2/x", "Java")).toBe(false);
		expect(isSameOrDescendantPath("任何/路径", "")).toBe(true);
	});

	it("大小写不敏感地比较路径", () => {
		expect(isSameOrDescendantPath("java/JVM", "Java")).toBe(true);
	});

	it("拼接不会产生双斜杠或尾斜杠", () => {
		expect(joinPath("Java/", "/jvm/")).toBe("Java/jvm");
		expect(joinPath("", "")).toBe("");
		expect(normalizePath("a\\b")).toBe("a/b");
	});
});
