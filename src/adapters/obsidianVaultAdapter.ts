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
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) return null;
		try {
			// cachedRead 会走宿主的文件缓存：同一文件反复读（元数据、正文块）不重复落盘。
			return await this.app.vault.cachedRead(file);
		} catch {
			return null;
		}
	}

	async writeText(path: string, content: string): Promise<void> {
		const normalized = normalizePath(path);
		const file = this.app.vault.getAbstractFileByPath(normalized);
		if (file instanceof TFile) {
			// process 保证写入与宿主的其它写入不互相覆盖。
			await this.app.vault.process(file, () => content);
			return;
		}
		await this.app.vault.create(normalized, content);
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
		// system=true 进系统回收站；false 进库内 .trash（宿主的「Obsidian 回收站」设置）。
		await this.app.fileManager.trashFile(target);
		void system;
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
