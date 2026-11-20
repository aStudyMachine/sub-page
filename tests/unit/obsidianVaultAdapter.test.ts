import { expect, it, vi } from "vitest";
import { type App, TFile, TFolder } from "obsidian";
import { ObsidianVaultAdapter } from "../../src/adapters/obsidianVaultAdapter";
import { PageService } from "../../src/core/pageService";
import { DEFAULT_SETTINGS } from "../../src/models/settings";
import { LEGACY_ORDER_FILE_NAME } from "../../src/repository/pageOrderStore";

it("宿主先返回时，等到原笔记实际移出才结束重命名", async () => {
	const note = Object.assign(new TFile(), { path: "项目/项目.md" });
	const ref = {};
	const on = vi.fn<(event: string, handler: (file: TFile) => void) => object>(() => ref);
	const offref = vi.fn();
	const adapter = new ObsidianVaultAdapter({
		vault: { getAbstractFileByPath: () => note, on, offref },
		fileManager: { renameFile: async () => undefined },
	} as unknown as App);

	const done = vi.fn();
	const moving = adapter.renameFile(note.path, "项目.md").then(done);
	await Promise.resolve();
	const [event, renamed] = on.mock.calls[0]!;
	expect(event).toBe("rename");
	renamed(Object.assign(new TFile(), { path: "项目.md" }));
	expect(offref).not.toHaveBeenCalled();
	expect(done).not.toHaveBeenCalled();
	note.path = "项目.md";
	renamed(note);
	await moving;
	expect(offref).toHaveBeenCalledWith(ref);
	expect(done).toHaveBeenCalledTimes(1);
});

it("清理空目录时检查磁盘隐藏文件，并使用库内回收站", async () => {
	const folder = new TFolder();
	const trash = vi.fn();
	const list = vi.fn()
		.mockResolvedValueOnce({ files: ["项目/.hidden"], folders: [] })
		.mockResolvedValueOnce({ files: [], folders: [] });
	const adapter = new ObsidianVaultAdapter({
		vault: { getAbstractFileByPath: () => folder, adapter: { list }, trash },
	} as unknown as App);

	expect(await adapter.trashEmptyFolder("项目")).toBe(false);
	expect(trash).not.toHaveBeenCalled();
	expect(await adapter.trashEmptyFolder("项目")).toBe(true);
	expect(trash).toHaveBeenCalledWith(folder, false);
});

it("从 Vault 索引之外读取、更新并重新载入手动顺序", async () => {
	const notes = ["a.md", "b.md", "c.md"].map((path) =>
		Object.assign(new TFile(), { path, name: path, stat: { mtime: 0, ctime: 0 } }),
	);
	const root = Object.assign(new TFolder(), { children: notes });
	const orderPath = ".custom/plugins/sub-page/order.json";
	const legacy = JSON.stringify({ "": ["b.md", "c.md", "a.md"] });
	const disk = new Map([[LEGACY_ORDER_FILE_NAME, legacy]]);
	const adapter = new ObsidianVaultAdapter({
		vault: {
			getAbstractFileByPath: (path: string) => (path === "/" ? root : null),
			create: async (path: string, contents: string) => {
				if (disk.has(path)) throw new Error("File already exists.");
				disk.set(path, contents);
			},
			adapter: {
				exists: async (path: string) => disk.has(path),
				read: async (path: string) => disk.get(path),
				write: async (path: string, contents: string) => {
					disk.set(path, contents);
				},
				rename: async (from: string, to: string) => {
					if (disk.has(to)) throw new Error("文件已存在");
					disk.set(to, disk.get(from)!);
					disk.delete(from);
				},
				remove: async (path: string) => { disk.delete(path); },
			},
			on: vi.fn(),
			offref: vi.fn(),
		},
	} as unknown as App);
	const makeService = () => new PageService({
		adapter,
		orderPath,
		settings: () => DEFAULT_SETTINGS,
		onChange: vi.fn(),
	});
	const service = makeService();
	await service.start();
	try {
		expect(service.getRoots().map((node) => node.title)).toEqual(["b", "c", "a"]);
		expect(JSON.parse(disk.get(orderPath)!)).toEqual({ roots: { "": { "": ["b.md", "c.md", "a.md"] } } });
		await service.operations.reorderScope(null, ["c.md", "b.md", "a.md"]);
		expect(service.getRoots().map((node) => node.title)).toEqual(["c", "b", "a"]);
		expect(JSON.parse(disk.get(orderPath)!)).toEqual({ roots: { "": { "": ["c.md", "b.md", "a.md"] } } });
		expect(disk.get(LEGACY_ORDER_FILE_NAME)).toBe(legacy);
	} finally {
		service.dispose();
	}
	const reopened = makeService();
	await reopened.start();
	try {
		expect(reopened.getRoots().map((node) => node.title)).toEqual(["c", "b", "a"]);
	} finally {
		reopened.dispose();
	}
});
