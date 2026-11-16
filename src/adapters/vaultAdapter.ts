import { PageId } from "../models/pageId";

/**
 * 适配层接口：全项目与宿主文件系统的唯一接触点，也是唯一的测试接缝。
 * 上层的扫描器、索引、顺序存储、操作服务只依赖这个接口。
 *
 * 所有路径都是相对 vault 根的 "/" 分隔路径。
 */

export interface FolderEntry {
	path: string;
	name: string;
}

export interface FileEntry {
	path: string;
	name: string;
	/** 修改时间毫秒；假库与真实实现都必须提供。 */
	mtime: number;
	/** 创建时间毫秒。 */
	ctime: number;
}

export interface FolderListing {
	folders: FolderEntry[];
	files: FileEntry[];
}

export type VaultEventKind = "create" | "delete" | "rename" | "modify";

export interface VaultEvent {
	kind: VaultEventKind;
	/** 发生后的路径（rename 的是新路径）。 */
	path: string;
	/** rename 专用：旧路径。 */
	oldPath?: string;
	/** rename 专用：旧路径最后一段的名字。 */
	oldName?: string;
}

export interface VaultAdapter {
	/** 不存在或不是目录时返回 null，不抛异常。 */
	listFolder(path: string): Promise<FolderListing | null>;
	exists(path: string): Promise<boolean>;
	readText(path: string): Promise<string | null>;
	writeText(path: string, content: string): Promise<void>;
	createFolder(path: string): Promise<void>;
	createFile(path: string, content: string): Promise<void>;
	/** 重命名目录（不承担链接维护）。 */
	renameFolder(from: string, to: string): Promise<void>;
	/** 重命名文件，宿主负责更新指向它的链接。 */
	renameFile(from: string, to: string): Promise<void>;
	/** system=true 走系统回收站，false 走库内 .trash。 */
	trash(path: string, system?: boolean): Promise<void>;
	readFrontMatter(path: string): Promise<Record<string, unknown> | null>;
	updateFrontMatter(path: string, mutate: (frontmatter: Record<string, unknown>) => void): Promise<void>;
	subscribe(handler: (event: VaultEvent) => void): () => void;
}

export function pageIdOfPath(relativePath: string): PageId {
	return relativePath as PageId;
}
