import { TFile, WorkspaceLeaf } from "obsidian";
import { expect, it, vi } from "vitest";
import type SubPagePlugin from "../../src/main";
import type { PageId } from "../../src/models/pageId";
import type { PageNode } from "../../src/models/pageNode";
import { PageTreeView } from "../../src/views/pageTreeView";

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	Modal: class {},
	ItemView: class {
		constructor(leaf: { app: unknown }) {
			Object.assign(this, { app: leaf.app });
		}
		registerEvent() {}
	},
}));

const folder = {
	id: "jvm" as PageId, kind: "group", childIds: ["jvm/gc" as PageId], filePath: null,
} satisfies Partial<PageNode>;
const note = { id: "jvm/gc" as PageId, childIds: [], filePath: "jvm/gc.md" };
const other = { id: "home" as PageId, childIds: [], filePath: "home.md" };
const parent = { ...folder, kind: "parent", filePath: "jvm/jvm.md" } satisfies Partial<PageNode>;

async function openTree(
	initiallyExpanded: string[] = [folder.id],
	branch: Partial<PageNode> = folder,
) {
	let activeFile = Object.assign(new TFile(), { path: note.filePath });
	let onFileOpen: (file: TFile | null) => void = () => {};
	const workspace = {
		getActiveFile: () => activeFile,
		getLeaf: () => ({ openFile }),
		on: (_event: string, callback: typeof onFileOpen) => { onFileOpen = callback; },
	};
	const file = Object.assign(new TFile(), { path: branch.filePath });
	const openFile = vi.fn(async (_file: TFile) => {});
	let saved = new Set(initiallyExpanded);
	let setCalls = 0;
	const movePage = vi.fn(async (_source: PageId, _target: PageId) => ({ ok: true, value: note.id }));
	const index = { current: { nodes: new Map([branch, note, other].map((node) => [node.id, node])) } };
	const plugin = {
		app: { workspace, vault: { getAbstractFileByPath: () => file } },
		get expandedIds() { return new Set(saved); },
		setExpandedIds: (ids: Set<string>) => { saved = new Set(ids); setCalls += 1; },
		service: {
			operations: { movePage },
			isCurrentOperationSource: () => true,
			index,
			getRoots: () => [branch, other],
			getChildren: () => [note],
			getAncestors: (id: PageId) => id === note.id ? [folder] : [],
			nodeForFilePath: (path: string) => [branch, note, other].find((node) => node.filePath === path),
		},
	} as unknown as SubPagePlugin;
	const leaf = { app: { workspace, loadLocalStorage: () => true } } as unknown as WorkspaceLeaf;
	const view = new PageTreeView(leaf, plugin);
	const rows: { id: PageId; current: boolean }[] = [];
	Object.assign(view, {
		buildChrome: () => {},
		listEl: {
			ownerDocument: { activeElement: null },
			contains: () => false,
			children: [],
			empty: () => { rows.length = 0; },
			removeClass: () => {},
			querySelectorAll: () => rows.map((row) => ({
				ownerDocument: { activeElement: null },
				getAttribute: () => row.id,
				toggleClass: (name: string, enabled: boolean) => {
					if (name === "is-current") row.current = enabled;
				},
				setAttribute: () => {},
				focus: () => {},
			})),
			querySelector: () => null,
		},
		appendRow: (node: PageNode, options: { current: boolean }) => rows.push({ id: node.id, current: options.current }),
		renderEmptyState: () => {},
		ensureMetadata: async () => {},
	});
	await view.onOpen();
	return {
		view,
		rows,
		saved: () => [...saved],
		setCalls: () => setCalls,
		setSaved: (ids: string[]) => { saved = new Set(ids); },
		movePage,
		openFile,
		clickFolder: (icon = false) => view["onRowClick"](
			{ target: { closest: () => icon ? {} : null } } as unknown as MouseEvent, branch as PageNode,
		),
		press: (key: string) => view["onKeyDown"]({
			key,
			target: { closest: () => ({ getAttribute: () => folder.id }) },
			preventDefault: () => {},
		} as unknown as KeyboardEvent),
		open: (path: string) => {
			if (path !== activeFile.path) activeFile = Object.assign(new TFile(), { path });
			onFileOpen(activeFile);
		},
	};
}

it("点击折叠的父页面标题立即展开并打开笔记，图标只切换展开状态", async () => {
	const tree = await openTree([], parent);
	tree.clickFolder();
	expect(tree.openFile).toHaveBeenCalledWith(expect.objectContaining({ path: parent.filePath }));
	expect(tree.rows.map((row) => row.id)).toContain(note.id);
	tree.clickFolder(true);
	expect(tree.rows.map((row) => row.id)).not.toContain(note.id);
	tree.clickFolder(true);
	expect(tree.rows.map((row) => row.id)).toContain(note.id);
	expect(tree.openFile).toHaveBeenCalledTimes(1);
});

it.each([note.filePath, other.filePath])("从 %s 打开已展开的父页面时保留子页面，再点才折叠", async (path) => {
	const tree = await openTree([parent.id], parent);
	tree.open(path);
	tree.clickFolder();
	expect(tree.openFile).toHaveBeenCalledWith(expect.objectContaining({ path: parent.filePath }));
	expect(tree.rows.map((row) => row.id)).toContain(note.id);
	expect(tree.saved()).toEqual([parent.id]);
	tree.open(parent.filePath);
	expect(tree.rows).toContainEqual({ id: parent.id, current: true });
	tree.clickFolder();
	expect(tree.rows.map((row) => row.id)).not.toContain(note.id);
	expect(tree.saved()).toEqual([]);
});

it("当前笔记位于分组内时，点击和键盘仍可折叠或展开分组", async () => {
	const tree = await openTree();
	tree.clickFolder();
	expect(tree.saved()).toEqual([]);
	tree.view.render();
	tree.open(note.filePath);
	expect(tree.rows.map((row) => row.id)).toEqual([folder.id, other.id]);
	tree.clickFolder();
	expect(tree.rows).toContainEqual({ id: note.id, current: true });
	tree.press("ArrowLeft");
	expect(tree.rows.map((row) => row.id)).toEqual([folder.id, other.id]);
	tree.press("ArrowRight");
	expect(tree.rows).toContainEqual({ id: note.id, current: true });
});

it("拖入页面后使用移动结果展开目标的祖先链", async () => {
	const tree = await openTree([]);
	const previousTargetId = "jvm.md" as PageId;
	tree.view["moveAsChild"](note.id, previousTargetId);
	await vi.waitFor(() => expect(tree.saved()).toEqual([folder.id]));
	expect(tree.movePage).toHaveBeenCalledWith(note.id, previousTargetId);
	expect(tree.rows.map((row) => row.id)).toContain(note.id);
});

it("首次重绘保留折叠状态，切换笔记和主动定位仍会展开祖先链", async () => {
	const tree = await openTree([]);
	expect(tree.saved()).toEqual([]);
	tree.open(other.filePath);
	expect(tree.rows).toContainEqual({ id: other.id, current: true });
	tree.open(note.filePath);
	expect(tree.saved()).toEqual([folder.id]);
	expect(tree.rows).toContainEqual({ id: note.id, current: true });
	tree.view.collapseAll();
	expect(tree.saved()).toEqual([]);
	tree.view.revealCurrent();
	expect(tree.rows).toContainEqual({ id: note.id, current: true });
});

it("重绘只读设置不回写：构造时设置为空也不会把空展开态洗掉", async () => {
	// 真实根因：视图构造早于 loadSettings，首帧 render 曾把空集写回设置，
	// 覆盖掉已持久化的展开态。现在 render 一律不写，改动只由交互落盘。
	const tree = await openTree([], folder);
	expect(tree.setCalls()).toBe(0);
	// 设置加载完成后重绘，从设置重新读取展开态。
	tree.setSaved([folder.id]);
	tree.view.render();
	expect(tree.rows.map((row) => row.id)).toContain(note.id);
	// 重绘仍然不写盘。
	expect(tree.setCalls()).toBe(0);
	expect(tree.saved()).toEqual([folder.id]);
});

it("重绘每次都重读设置，折叠态在连续重绘间保持稳定", async () => {
	const tree = await openTree([folder.id], folder);
	expect(tree.rows.map((row) => row.id)).toContain(note.id);
	// 外部（loadSettings/remap）更新了设置，下一次重绘要跟上。
	tree.setSaved([]);
	tree.view.render();
	expect(tree.rows.map((row) => row.id)).not.toContain(note.id);
	tree.setSaved([folder.id]);
	tree.view.render();
	expect(tree.rows.map((row) => row.id)).toContain(note.id);
	expect(tree.setCalls()).toBe(0);
});
