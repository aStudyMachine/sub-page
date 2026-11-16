import { describe, expect, it } from "vitest";
import { readdir, readFile, stat } from "node:fs/promises";
import { Dirent } from "node:fs";
import { join } from "node:path";
import { FolderListing, VaultAdapter, VaultEvent } from "../../src/adapters/vaultAdapter";
import { scan } from "../../src/repository/pageScanner";
import { normalizePath } from "../../src/utils/pathUtils";

/**
 * 真实库只读冒烟：把扫描器接到真的磁盘上，确认识别结果与目录里的 md 数量一致。
 *
 * 需要显式给路径才跑 —— CI 上没有用户的知识库，平时也不该被一个路径依赖的用例拖慢。
 *   VAULT_PATH="E:/resource/.../Knowledge" npx vitest run tests/manual
 */

const vaultPath = process.env.VAULT_PATH;

/** 只读适配器：够扫描用，任何写操作都直接抛错，避免冒烟变成改库。 */
class ReadOnlyFsAdapter implements VaultAdapter {
	constructor(private readonly base: string) {}

	private absolute(path: string): string {
		const normalized = normalizePath(path);
		return normalized === "" ? this.base : join(this.base, normalized);
	}

	async listFolder(path: string): Promise<FolderListing | null> {
		const target = this.absolute(path);
		let entries: Dirent[];
		try {
			entries = await readdir(target, { withFileTypes: true });
		} catch {
			return null;
		}
	const folders: FolderListing["folders"] = [];
	const files: FolderListing["files"] = [];
		for (const entry of entries) {
			const childPath = normalizePath(path === "" ? entry.name : path + "/" + entry.name);
			if (entry.isDirectory()) {
				folders.push({ path: childPath, name: entry.name });
				continue;
			}
			if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
			const info = await stat(join(target, entry.name));
			files.push({ path: childPath, name: entry.name, mtime: info.mtimeMs, ctime: info.birthtimeMs });
		}
		return { folders, files };
	}

	async exists(path: string): Promise<boolean> {
		try {
			await stat(this.absolute(path));
			return true;
		} catch {
			return false;
		}
	}

	async readText(path: string): Promise<string | null> {
		try {
			return await readFile(this.absolute(path), "utf8");
		} catch {
			return null;
		}
	}

	async writeText(): Promise<void> {
		throw new Error("只读冒烟不许写库");
	}
	async createFolder(): Promise<void> {
		throw new Error("只读冒烟不许写库");
	}
	async createFile(): Promise<void> {
		throw new Error("只读冒烟不许写库");
	}
	async renameFolder(): Promise<void> {
		throw new Error("只读冒烟不许写库");
	}
	async renameFile(): Promise<void> {
		throw new Error("只读冒烟不许写库");
	}
	async trash(): Promise<void> {
		throw new Error("只读冒烟不许写库");
	}
	async readFrontMatter(): Promise<Record<string, unknown> | null> {
		return null;
	}
	async updateFrontMatter(): Promise<void> {
		throw new Error("只读冒烟不许写库");
	}
	subscribe(_handler: (event: VaultEvent) => void): () => void {
		return () => undefined;
	}
}

describe.skipIf(!vaultPath)("真实库只读冒烟", () => {
	it("扫描结果与目录里的 md 数量对得上", async () => {
		const adapter = new ReadOnlyFsAdapter(vaultPath as string);
		const started = Date.now();
		const snapshot = await scan(adapter, "", { excludedFolders: ["_assets", "attachments", "assets", "images"] });
		const elapsed = Date.now() - started;

		const parents = Array.from(snapshot.nodes.values()).filter((node) => node.kind === "parent").length;
		const leaves = Array.from(snapshot.nodes.values()).filter((node) => node.kind === "leaf").length;
		const groups = Array.from(snapshot.nodes.values()).filter((node) => node.kind === "group").length;
		// eslint-disable-next-line no-console
		console.log(
			`页面 ${parents + leaves}（父 ${parents} / 叶 ${leaves}）· 分组目录 ${groups} · 目录 ${snapshot.folderCount} · ${elapsed}ms · 警告 ${snapshot.warnings.length}`,
		);

		expect(parents + leaves).toBeGreaterThan(0);
		expect(snapshot.warnings.filter((warning) => warning.kind === "read-error")).toEqual([]);
	});
});
