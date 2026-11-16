import { describe, expect, it } from "vitest";
import { PageId } from "../../src/models/pageId";
import { PageNode } from "../../src/models/pageNode";
import { expandAncestors, flattenTree, navigate, pruneExpanded, remapExpanded } from "../../src/views/treeState";

function node(id: string, parentId: string | null, childIds: string[] = []): PageNode {
	return {
		id: id as PageId,
		kind: childIds.length > 0 ? "parent" : "leaf",
		title: id.split("/").pop() ?? id,
		depth: id.split("/").length - 1,
		parentId: parentId as PageId | null,
		childIds: childIds as PageId[],
		filePath: `${id}.md`,
		folderPath: id,
metadata: {},
descendantCount: 0,
modifiedAt: 0,
createdAt: 0,
};
}

// a
//   b
//     c
//   d
const a = node("a", null, ["a/b", "a/d"]);
const b = node("a/b", "a", ["a/b/c"]);
const c = node("a/b/c", "a/b");
const d = node("a/d", "a");
const all = new Map<string, PageNode>([
	["a", a],
	["a/b", b],
	["a/b/c", c],
	["a/d", d],
]);

const options = (expanded: Set<string>) => ({
	getRoots: () => [a],
	getChildren: (id: PageId | null) => (id ? (all.get(id)?.childIds ?? []).map((child) => all.get(child)!) : [a]),
	expanded,
});

describe("树的扁平化", () => {
	it("全部折叠时只有根", () => {
		expect(flattenTree(options(new Set())).map((n) => n.id)).toEqual(["a"]);
	});

	it("展开一层只露出直接子节点", () => {
		expect(flattenTree(options(new Set(["a"]))).map((n) => n.id)).toEqual(["a", "a/b", "a/d"]);
	});

	it("展开到底按深度优先排列", () => {
		expect(flattenTree(options(new Set(["a", "a/b"]))).map((n) => n.id)).toEqual(["a", "a/b", "a/b/c", "a/d"]);
	});

	it("子节点展开但父级折叠时不显示", () => {
		expect(flattenTree(options(new Set(["a/b"]))).map((n) => n.id)).toEqual(["a"]);
	});
});

describe("键盘导航", () => {
	const rows = (expanded: Set<string>) => flattenTree(options(expanded));

	it("上下在可见行之间移动", () => {
		const expanded = new Set(["a", "a/b"]);
		const list = rows(expanded);
		expect(navigate(list, "a", "down", expanded).focusId).toBe("a/b");
		expect(navigate(list, "a/b", "up", expanded).focusId).toBe("a");
	});

	it("到底后停在最后一行", () => {
		const expanded = new Set(["a", "a/b"]);
		const list = rows(expanded);
		expect(navigate(list, "a/d", "down", expanded).focusId).toBe("a/d");
		expect(navigate(list, "a", "up", expanded).focusId).toBe("a");
	});

	it("home / end 跳到首尾", () => {
		const expanded = new Set(["a", "a/b"]);
		const list = rows(expanded);
		expect(navigate(list, "a/b", "home", expanded).focusId).toBe("a");
		expect(navigate(list, "a/b", "end", expanded).focusId).toBe("a/d");
	});

	it("右键先展开，再按一次进入第一个子节点", () => {
		const collapsed = new Set<string>();
		expect(navigate(rows(collapsed), "a", "right", collapsed)).toEqual({ focusId: "a", expanded: true });
		const expanded = new Set(["a"]);
		expect(navigate(rows(expanded), "a", "right", expanded).focusId).toBe("a/b");
	});

	it("左键先折叠，已折叠则跳到父节点", () => {
		const expanded = new Set(["a", "a/b"]);
		expect(navigate(rows(expanded), "a/b", "left", expanded)).toEqual({ focusId: "a/b", expanded: false });
		const collapsed = new Set(["a"]);
		expect(navigate(rows(collapsed), "a/b", "left", collapsed).focusId).toBe("a");
	});

	it("没有子节点时左键上跳父级", () => {
		const expanded = new Set(["a"]);
		expect(navigate(rows(expanded), "a/d", "left", expanded).focusId).toBe("a");
	});

	it("没有焦点时向下从第一行开始", () => {
		expect(navigate(rows(new Set()), null, "down", new Set()).focusId).toBe("a");
	});

	it("空树返回 null", () => {
		expect(navigate([], null, "down", new Set())).toEqual({ focusId: null, expanded: null });
	});
});

describe("展开集合维护", () => {
	it("展开祖先链", () => {
		const next = expandAncestors(new Set(["x"]), ["a", "a/b"]);
		expect(Array.from(next).sort()).toEqual(["a", "a/b", "x"]);
	});

	it("剔除已不存在的 id", () => {
		const pruned = pruneExpanded(new Set(["a", "gone"]), new Set(["a"]));
		expect(Array.from(pruned)).toEqual(["a"]);
	});

	it("子树改名后展开状态跟着搬", () => {
		const next = remapExpanded(new Set(["项目A", "项目A/设计", "首页.md"]), "项目A", "项目B");
		expect(Array.from(next).sort()).toEqual(["首页.md", "项目B", "项目B/设计"].sort());
	});

	it("前缀相同但不在子树里的 id 不受影响", () => {
		const next = remapExpanded(new Set(["项目A2", "项目A/设计"]), "项目A", "项目B");
		expect(Array.from(next).sort()).toEqual(["项目B/设计", "项目A2"].sort());
	});

	it("搬到自己身上时原样返回", () => {
		const ids = new Set(["a", "a/b"]);
		expect(Array.from(remapExpanded(ids, "a", "a"))).toEqual(["a", "a/b"]);
	});
});
