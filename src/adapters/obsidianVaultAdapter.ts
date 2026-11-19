import { App, TAbstractFile, TFile, TFolder, normalizePath as obsidianNormalize } from "obsidian";
import {
	FileEntry,
	FolderEntry,
	FolderListing,
	VaultAdapter,
	VaultEvent,
} from "./vaultAdapter";
import { normalizePath } from "../utils/pathUtils";

/**
 * 真实宿主适配器：整个插件里唯一 import obsidian 文件系统 API 的地方。
 *
 * 路径在进出时都做一次规范化 —— 宿主给的路径不以 "/" 开头，而
 * getAbstractFileByPath 对大小写与斜杠很敏感，出错的代价是「文件明明在却找不到」。
 */
export class ObsidianVaultAdapter implements VaultAdapter {
	constructor(private readonly app: App) {}

	async listFolder(path: string): Promise<FolderListing | null> {
		const target = this.app.vault.getAbstractFileByPath(this.key(path));
		if (!target || !(target instanceof TFolder)) return null;
		const folders: FolderEntry[] = [];
		const files: FileEntry[] = [];
		for (const child of target.children) {
			if (child instanceof TFolder) {
				folders.push({ path: child.path, name: child.name });
			} else if (child instanceof TFile) {
				files.push({
					path: child.path,
					name: child.name,
					mtime: child.stat.mtime,
					ctime: child.stat.ctime,
				});
			}
		}
		return { folders, files };
	}

	private key(path: string): string {
		const normalized = normalizePath(path);
		return normalized === "" ? "/" : obsidianNormalize(normalized);
	}

	async exists(path: string): Promise<boolean> {
		const normalized = normalizePath(path);
		if (normalized === "") return true;
		return this.app.vault.getAbstractFileByPath(normalized) !== null;
	}

	async readText(path: string): Promise<string | null> {
		const normalized = normalizePath(path);
		const adapter = this.app.vault.adapter;
		// 顺序文件以点开头，存在于磁盘上但不会进入 Vault 的文件索引。
		return (await adapter.exists(normalized)) ? adapter.read(normalized) : null;
	}

	async writeText(path: string, content: string): Promise<void> {
		await this.app.vault.adapter.write(normalizePath(path), content);
	}

	async createFolder(path: string): Promise<void> {
		const normalized = normalizePath(path);
		if (normalized === "" || (await this.exists(normalized))) return;
		await this.app.vault.createFolder(normalized);
	}

	async createFile(path: string, content: string): Promise<void> {
		const normalized = normalizePath(path);
		if (await this.exists(normalized)) throw new Error(`文件已存在：${normalized}`);
		const parent = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
		if (parent) await this.createFolder(parent);
		await this.app.vault.create(normalized, content);
	}

	async renameFolder(from: string, to: string): Promise<void> {
		const target = this.app.vault.getAbstractFileByPath(normalizePath(from));
		if (!(target instanceof TFolder)) throw new Error(`目录不存在：${from}`);
		// vault.rename 只改目录本身，里面的笔记路径跟着变，但指向它们的链接不会被改写 ——
		// 这是配对模型必须接受的代价（同名笔记单独走 renameFile 才有链接维护）。
		await this.app.vault.rename(target, normalizePath(to));
	}

	async renameFile(from: string, to: string): Promise<void> {
		const target = this.app.vault.getAbstractFileByPath(normalizePath(from));
		if (!(target instanceof TFile)) throw new Error(`文件不存在：${from}`);
		// 必须走 fileManager：它会同步更新所有指向这个笔记的 [[链接]]。
		await this.app.fileManager.renameFile(target, normalizePath(to));
	}

	async trash(path: string, system = true): Promise<void> {
		const target = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!target) return;
		if (system) {
			// 走宿主的回收站设置：文件进系统回收站或库内 .trash，两种都能反悔。
			await this.app.fileManager.trashFile(target);
			return;
		}
		// 永久删除必须绕开 fileManager —— 它只会把文件挪进回收站。
		// force=true 是宿主的确认关口，调用方（删除弹窗）已经问过用户了。
		await this.app.vault.delete(target, true);
	}

	async readFrontMatter(path: string): Promise<Record<string, unknown> | null> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) return null;
		const cache = this.app.metadataCache.getFileCache(file);
		return (cache?.frontmatter as Record<string, unknown> | undefined) ?? null;
	}

	async updateFrontMatter(path: string, mutate: (frontmatter: Record<string, unknown>) => void): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) throw new Error(`文件不存在：${path}`);
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			mutate(frontmatter as Record<string, unknown>);
		});
	}

	subscribe(handler: (event: VaultEvent) => void): () => void {
		const vault = this.app.vault;
		const refs = [
			vault.on("create", (file: TAbstractFile) => handler({ kind: "create", path: file.path })),
			vault.on("delete", (file: TAbstractFile) => handler({ kind: "delete", path: file.path })),
			vault.on("rename", (file: TAbstractFile, oldPath: string) =>
				handler({ kind: "rename", path: file.path, oldPath, oldName: oldPath.split("/").pop() }),
			),
			vault.on("modify", (file: TAbstractFile) => handler({ kind: "modify", path: file.path })),
		];
		return () => {
			for (const ref of refs) vault.offref(ref);
		};
	}
}
