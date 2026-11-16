import {
	FileEntry,
	FolderEntry,
	FolderListing,
	VaultAdapter,
	VaultEvent,
} from "../../src/adapters/vaultAdapter";
import { basename, dirname, isMarkdownFile, joinPath, normalizePath } from "../../src/utils/pathUtils";

/**
 * 内存假库：适配层接口的第二实现，也是全部自动化测试的接缝。
 * 刻意只做真库会做的事（目录、文件、front matter、事件），不提供任何捷径，
 * 否则测试会依赖假库的行为而不是插件的契约。
 *
 * 时间戳用单调递增的假时钟，保证 created/modified 排序可断言。
 */
export class FakeVault implements VaultAdapter {
	private folders = new Set<string>([""]);
	private files = new Map<string, { content: string; mtime: number; ctime: number }>();
	private handler: ((event: VaultEvent) => void) | null = null;
	private clock = 1_700_000_000_000;

	constructor(seed: Record<string, string> = {}) {
		for (const [path, content] of Object.entries(seed)) {
			this.seedFile(normalizePath(path), content);
		}
	}

	/** 直接铺一个文件，不触发事件（用于构造初始状态）。 */
	seedFile(path: string, content = ""): void {
		const normalized = normalizePath(path);
		this.ensureFolder(dirname(normalized));
		const time = this.tick();
		this.files.set(normalized, { content, mtime: time, ctime: time });
	}

	seedFolder(path: string): void {
		this.ensureFolder(normalizePath(path));
	}

	tick(): number {
		this.clock += 1000;
		return this.clock;
	}

	private ensureFolder(path: string): void {
		if (path === "" || this.folders.has(path)) return;
		this.ensureFolder(dirname(path));
		this.folders.add(path);
	}

	private emit(event: VaultEvent): void {
		this.handler?.(event);
	}

	async listFolder(path: string): Promise<FolderListing | null> {
		const normalized = normalizePath(path);
		if (!this.folders.has(normalized)) return null;
		const prefix = normalized === "" ? "" : normalized + "/";
		const folders: FolderEntry[] = [];
		const files: FileEntry[] = [];
		for (const folder of this.folders) {
			if (folder === normalized || !folder.startsWith(prefix)) continue;
			const rest = folder.slice(prefix.length);
			if (rest.includes("/")) continue;
			folders.push({ path: folder, name: rest });
		}
		for (const [file, meta] of this.files) {
			if (!file.startsWith(prefix)) continue;
			const rest = file.slice(prefix.length);
			if (rest.includes("/")) continue;
			files.push({ path: file, name: rest, mtime: meta.mtime, ctime: meta.ctime });
		}
		folders.sort((a, b) => a.name.localeCompare(b.name));
		files.sort((a, b) => a.name.localeCompare(b.name));
		return { folders, files };
	}

	async exists(path: string): Promise<boolean> {
		const normalized = normalizePath(path);
		return this.folders.has(normalized) || this.files.has(normalized);
	}

	async readText(path: string): Promise<string | null> {
		return this.files.get(normalizePath(path))?.content ?? null;
	}

	async writeText(path: string, content: string): Promise<void> {
		const normalized = normalizePath(path);
		const existing = this.files.get(normalized);
		this.files.set(normalized, { content, mtime: this.tick(), ctime: existing?.ctime ?? this.clock });
		this.emit({ kind: "modify", path: normalized });
	}

	async createFolder(path: string): Promise<void> {
		const normalized = normalizePath(path);
		if (this.folders.has(normalized)) return;
		this.ensureFolder(normalized);
		this.emit({ kind: "create", path: normalized });
	}

	async createFile(path: string, content: string): Promise<void> {
		const normalized = normalizePath(path);
		if (this.files.has(normalized)) throw new Error(`文件已存在：${normalized}`);
		this.ensureFolder(dirname(normalized));
		const time = this.tick();
		this.files.set(normalized, { content, mtime: time, ctime: time });
		this.emit({ kind: "create", path: normalized });
	}

	async renameFolder(from: string, to: string): Promise<void> {
		const source = normalizePath(from);
		const target = normalizePath(to);
		if (!this.folders.has(source)) throw new Error(`目录不存在：${source}`);
		const prefix = source + "/";
		for (const folder of Array.from(this.folders)) {
			if (folder === source || folder.startsWith(prefix)) {
				this.folders.delete(folder);
				this.folders.add(target + folder.slice(source.length));
			}
		}
		for (const [file, meta] of Array.from(this.files)) {
			if (file.startsWith(prefix)) {
				this.files.delete(file);
				this.files.set(target + file.slice(source.length), { ...meta, mtime: this.tick() });
			}
		}
		this.emit({ kind: "rename", path: target, oldPath: source, oldName: basename(source) });
	}

	async renameFile(from: string, to: string): Promise<void> {
		const source = normalizePath(from);
		const target = normalizePath(to);
		const meta = this.files.get(source);
		if (!meta) throw new Error(`文件不存在：${source}`);
		this.files.delete(source);
		this.files.set(target, { ...meta, mtime: this.tick() });
		this.emit({ kind: "rename", path: target, oldPath: source, oldName: basename(source) });
	}

	/** 记录删除调用，供测试断言「永久删除」与「走回收站」确实走了不同分支。 */
	readonly trashLog: { path: string; system: boolean }[] = [];

	async trash(path: string, system = true): Promise<void> {
		this.trashLog.push({ path: normalizePath(path), system });
		const normalized = normalizePath(path);
		if (this.files.delete(normalized)) {
			this.emit({ kind: "delete", path: normalized });
			return;
		}
		const prefix = normalized + "/";
		for (const [file] of Array.from(this.files)) {
			if (file.startsWith(prefix)) this.files.delete(file);
		}
		for (const folder of Array.from(this.folders)) {
			if (folder === normalized || folder.startsWith(prefix)) this.folders.delete(folder);
		}
		this.emit({ kind: "delete", path: normalized });
	}

	async readFrontMatter(path: string): Promise<Record<string, unknown> | null> {
		const content = this.files.get(normalizePath(path))?.content;
		if (content === undefined) return null;
		return parseFrontMatter(content).data;
	}

	async updateFrontMatter(path: string, mutate: (frontmatter: Record<string, unknown>) => void): Promise<void> {
		const normalized = normalizePath(path);
		const meta = this.files.get(normalized);
		if (!meta) throw new Error(`文件不存在：${normalized}`);
		const parsed = parseFrontMatter(meta.content);
		const data = { ...parsed.data };
		mutate(data);
		const body = parsed.body;
		this.files.set(normalized, { ...meta, content: serializeFrontMatter(data) + body, mtime: this.tick() });
		this.emit({ kind: "modify", path: normalized });
	}

	subscribe(handler: (event: VaultEvent) => void): () => void {
		this.handler = handler;
		return () => {
			if (this.handler === handler) this.handler = null;
		};
	}

	// ---- 断言用的快照 ----

	/** 所有文件路径（排序后），用来断言「磁盘上最后是什么样」。 */
	filePaths(): string[] {
		return Array.from(this.files.keys()).sort();
	}

	/** 所有目录路径（排序后）。 */
	folderPaths(): string[] {
		return Array.from(this.folders).filter((path) => path !== "").sort();
	}

	content(path: string): string | undefined {
		return this.files.get(normalizePath(path))?.content;
	}

	/** 清掉已排队的事件处理器，避免无关测试互相干扰。 */
	stopEvents(): void {
		this.handler = null;
	}
}

export function parseFrontMatter(content: string): { data: Record<string, unknown>; body: string } {
	if (!content.startsWith("---")) return { data: {}, body: content };
	const end = content.indexOf("\n---", 3);
	if (end === -1) return { data: {}, body: content };
	const header = content.slice(3, end).trim();
	const body = content.slice(content.indexOf("\n", end + 1) + 1);
	const data: Record<string, unknown> = {};
	for (const line of header.split("\n")) {
		const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
		if (!match) continue;
		const [, key, rawValue] = match;
		data[key] = rawValue.replace(/^["']|["']$/g, "");
	}
	return { data, body };
}

export function serializeFrontMatter(data: Record<string, unknown>): string {
	const keys = Object.keys(data);
	if (keys.length === 0) return "";
	const lines = keys.map((key) => `${key}: ${String(data[key])}`);
	return `---\n${lines.join("\n")}\n---\n`;
}

/** 从假库铺出「真库形状」的夹具：分组目录 + 叶子页面 + 一个父页面。 */
export function sampleVault(): FakeVault {
	return new FakeVault({
		"首页.md": "# 首页",
		"笔记规范.md": "# 笔记规范",
		"Java/jvm/堆内存.md": "# 堆内存",
		"Java/jvm/垃圾回收.md": "# 垃圾回收",
		"Java/并发/线程池.md": "# 线程池",
		"项目A/项目A.md": "---\nicon: \"📁\"\ndescription: 一个父页面\n---\n# 项目A",
		"项目A/需求.md": "# 需求",
		"项目A/设计/设计.md": "# 设计",
		"_assets/图片.png": "binary",
	});
}

export { joinPath, isMarkdownFile };
