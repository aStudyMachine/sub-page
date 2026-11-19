import { expect, it, vi } from "vitest";
import { type App, TFile, TFolder } from "obsidian";
import { ObsidianVaultAdapter } from "../../src/adapters/obsidianVaultAdapter";
import { PageService } from "../../src/core/pageService";
import { DEFAULT_SETTINGS } from "../../src/models/settings";
import { ORDER_FILE_NAME } from "../../src/repository/pageOrderStore";

it("从 Vault 索引之外读取、更新并重新载入手动顺序", async () => {
	const notes = ["a.md", "b.md", "c.md"].map((path) =>
		Object.assign(new TFile(), { path, name: path, stat: { mtime: 0, ctime: 0 } }),
	);
	const root = Object.assign(new TFolder(), { children: notes });
	const disk = new Map([[ORDER_FILE_NAME, JSON.stringify({ "": ["b.md", "c.md", "a.md"] })]]);
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
			},
			on: vi.fn(),
			offref: vi.fn(),
		},
	} as unknown as App);
	const makeService = () => new PageService({
		adapter,
		settings: () => DEFAULT_SETTINGS,
		onChange: vi.fn(),
	});
	const service = makeService();
	await service.start();
	try {
		expect(service.getRoots().map((node) => node.title)).toEqual(["b", "c", "a"]);
		await service.operations.reorderScope(null, ["c.md", "b.md", "a.md"]);
		expect(service.getRoots().map((node) => node.title)).toEqual(["c", "b", "a"]);
		expect(JSON.parse(disk.get(ORDER_FILE_NAME)!)).toEqual({ "": ["c.md", "b.md", "a.md"] });
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
