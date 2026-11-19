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

async function openTree(initiallyExpanded: string[] = [folder.id]) {
	let activeFile = Object.assign(new TFile(), { path: note.filePath });
	let onFileOpen: (file: TFile | null) => void = () => {};
	const workspace = {
		getActiveFile: () => activeFile,
		on: (_event: string, callback: typeof onFileOpen) => { onFileOpen = callback; },
	};
	let saved = new Set(initiallyExpanded);
	const plugin = {
		expandedIds: saved,
		setExpandedIds: (ids: Set<string>) => { saved = new Set(ids); },
		service: {
			index: { current: { nodes: new Map([folder, note, other].map((node) => [node.id, node])) } },
			getRoots: () => [folder, other],
			getChildren: () => [note],
			getAncestors: (id: PageId) => id === note.id ? [folder] : [],
			nodeForFilePath: (path: string) => [note, other].find((node) => node.filePath === path),
		},
	} as unknown as SubPagePlugin;
	const leaf = { app: { workspace, loadLocalStorage: () => true } } as unknown as WorkspaceLeaf;
	const view = new PageTreeView(leaf, plugin);
	const rows: { id: PageId; current: boolean }[] = [];
	Object.assign(view, {
		buildChrome: () => {},
		listEl: {
			children: [],
			empty: () => { rows.length = 0; },
			removeClass: () => {},
			querySelectorAll: () => rows.map((row) => ({
				getAttribute: () => row.id,
				toggleClass: (_name: string, current: boolean) => { row.current = current; },
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
		clickFolder: () => view["onRowClick"]({ target: { closest: () => null } } as unknown as MouseEvent, folder as PageNode),
		press: (key: string) => view["onKeyDown"]({ key, preventDefault: () => {} } as KeyboardEvent),
		open: (path: string) => {
			if (path !== activeFile.path) activeFile = Object.assign(new TFile(), { path });
			onFileOpen(activeFile);
		},
	};
}

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
