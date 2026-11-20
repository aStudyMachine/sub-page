import { VaultAdapter } from "../adapters/vaultAdapter";
import { childIdOf, PageId } from "../models/pageId";
import { PageNode } from "../models/pageNode";
import { PageOrderStore } from "../repository/pageOrderStore";
import { DEFAULT_MAX_DEPTH, isExcludedFolder } from "../repository/pageScanner";
import { checkName } from "../utils/nameValidator";
import { basename, dirname, isMarkdownFile, joinPath, normalizePath, stripExtension } from "../utils/pathUtils";
import { AgentSkillInstaller } from "./agentSkillInstaller";

export type OpFailureReason = "invalid-name" | "name-conflict" | "not-found" | "not-allowed" | "io-error";

export type OpResult<T = void> = { ok: true; value: T; warning?: string } | { ok: false; reason: OpFailureReason; message: string };

const ok = <T>(value: T): OpResult<T> => ({ ok: true, value });
const fail = (reason: OpFailureReason, message: string): OpResult<never> => ({ ok: false, reason, message });

export interface DeleteOptions {
	/** 连同子页面一起删除。false 时只删父页面自己的笔记，目录与子页面留下并降级为分组目录。 */
	withChildren: boolean;
	/** true 走系统回收站，false 走库内回收站。 */
	useTrash: boolean;
}

export interface CreateOptions {
	template?: string;
	defaultTitle?: string;
}

export interface OperationDeps {
	adapter: VaultAdapter;
	order: PageOrderStore;
	getNode(id: PageId): PageNode | undefined;
	/** 某个作用域当前显示顺序（已应用顺序文件）。 */
	getChildren(scope: PageId | null): PageNode[];
	getPageRoot(): string;
	getExcludedFolders?(): string[];
	collapseEmptyParents?(): boolean;
	refresh(): Promise<void>;
	/**
	 * 整棵子树的 id 变了（改名 / 移动）。展开状态是按 id 存进设置里的，
	 * 不搬的话用户排好的展开层级会在下一次 pruneExpanded 里被当成脏数据丢掉。
	 */
	renameIds?(from: string, to: string): Promise<void>;
}

/**
 * 所有写操作的唯一入口。每个动作都是「校验 → 执行 → 刷新 → 补偿」：
 * 校验全部在动文件之前完成，中途失败则把已经改了的部分恢复回去。
 * 返回结果类型而不是抛异常 —— 界面需要一句能读懂的原因，而不是一个 Error 对象。
 */
export class PageOperationService {
	readonly agentSkill: AgentSkillInstaller;
	private readonly adapter: VaultAdapter;
	private readonly order: PageOrderStore;
	private readonly changingPairs = new Set<PageId>();

	constructor(private readonly deps: OperationDeps) {
		this.agentSkill = new AgentSkillInstaller(deps.adapter);
		this.adapter = deps.adapter;
		this.order = deps.order;
	}

	private abs(relative: string): string {
		return joinPath(this.deps.getPageRoot(), relative);
	}

	/**
	 * 同级重名检查。
	 *
	 * 不用 exists 逐条试，而是把父目录列出来比名字：改名时自己就是「已经存在的那个」，
	 * 只有看见列表才分得清命中的是它自己还是同名邻居。在 Windows 上 exists("Abc.md") 对
	 * 磁盘上的 abc.md 也返回真，靠路径精确比较绕不过去，只改大小写的改名会被误判成重名。
	 */
	private async checkConflict(
		folderPath: string,
		title: string,
		ignore: readonly string[] = [],
	): Promise<boolean> {
		const listing = await this.adapter.listFolder(folderPath);
		// 父目录还不存在（往空父页面里搬东西）时不可能有冲突。
		if (!listing) return false;
		const wanted = title.toLowerCase();
		const self = new Set(ignore.map((path) => normalizePath(path)));
		for (const entry of listing.folders) {
			if (entry.name.toLowerCase() !== wanted) continue;
			if (!self.has(normalizePath(entry.path))) return true;
		}
		for (const entry of listing.files) {
			if (!isMarkdownFile(entry.name)) continue;
			if (stripExtension(entry.name).toLowerCase() !== wanted) continue;
			if (!self.has(normalizePath(entry.path))) return true;
		}
		return false;
	}

	/** 改名时要把自己的旧路径从冲突检查里排掉：叶子是文件，父页面是目录加同名文件。 */
	private selfPaths(node: PageNode): string[] {
		if (node.kind === "leaf") return node.filePath ? [node.filePath] : [];
		return node.filePath ? [node.folderPath, node.filePath] : [node.folderPath];
	}

	// ---------------------------------------------------------------- 新建

	async createPage(parentId: PageId | null, rawTitle: string, options: CreateOptions = {}): Promise<OpResult<PageId>> {
		const enteredTitle = rawTitle.trim();
		const baseTitle = enteredTitle || options.defaultTitle || "";
		const check = checkName(baseTitle);
		if (!check.ok) return fail("invalid-name", describeNameProblem(check.problem, check.detail));

		const parent = parentId ? this.deps.getNode(parentId) : undefined;
		if (parentId && !parent) return fail("not-found", "父页面不在索引里，请先重建索引");

		const parentFolder = parent?.folderPath ?? this.deps.getPageRoot();
		let title = baseTitle;
		if (!enteredTitle) {
			for (let suffix = 2; await this.childNameTaken(parent, parentFolder, title); suffix++) {
				title = `${baseTitle} ${suffix}`;
			}
			const generatedCheck = checkName(title);
			if (!generatedCheck.ok) return fail("invalid-name", describeNameProblem(generatedCheck.problem, generatedCheck.detail));
		}

		if (parent?.kind === "leaf") {
			if (parent.title.toLowerCase() === title.toLowerCase()) {
				return fail("name-conflict", `子页面不能与配对笔记「${parent.title}」同名`);
			}
			return this.pairLeaf(parent, (folder) => this.writePage(folder, title, options));
		}

		if (await this.checkConflict(parentFolder, title)) {
			return fail("name-conflict", `同级已经有一个「${title}」了`);
		}

		let id: PageId;
		try {
			id = await this.writePage(parentFolder, title, options);
		} catch (error) {
			return fail("io-error", `新建页面失败：${messageOf(error)}`);
		}
		await this.deps.refresh();
		return ok(id);
	}

	private async childNameTaken(parent: PageNode | undefined, folder: string, title: string): Promise<boolean> {
		// 叶子即将配对，原笔记会是新目录里的第一篇。
		if (parent?.kind === "leaf") return parent.title.toLowerCase() === title.toLowerCase();
		return this.checkConflict(folder, title);
	}

	private async writePage(parentFolder: string, title: string, options: CreateOptions): Promise<PageId> {
		const filePath = joinPath(parentFolder, title + ".md");
		await this.adapter.createFile(filePath, renderTemplate(options.template, title));
		return this.relativeId(filePath) as PageId;
	}

	// ---------------------------------------------------------------- 改名

	async renamePage(id: PageId, rawTitle: string): Promise<OpResult<PageId>> {
		const node = this.deps.getNode(id);
		if (!node) return fail("not-found", "页面不在索引里，请先重建索引");
		const title = rawTitle.trim();
		if (title === node.title) return ok(id);
		const check = checkName(title);
		if (!check.ok) return fail("invalid-name", describeNameProblem(check.problem, check.detail));

		const parentFolder = node.parentId ? this.abs(node.parentId) : this.deps.getPageRoot();
		if (await this.checkConflict(parentFolder, title, this.selfPaths(node))) {
			return fail("name-conflict", `同级已经有一个「${title}」了`);
		}

		if (node.kind === "leaf") {
			const from = node.filePath!;
			const to = joinPath(parentFolder, title + ".md");
			try {
				await this.adapter.renameFile(from, to);
			} catch (error) {
				return fail("io-error", `重命名失败：${messageOf(error)}`);
			}
			await this.order.renameKey(scopeOfNode(node), basename(from), basename(to));
			await this.deps.refresh();
			return ok(this.relativeId(to) as PageId);
		}

		if (node.kind === "group") {
			const from = node.folderPath;
			const to = joinPath(dirname(from), title);
			try {
				await this.adapter.renameFolder(from, to);
			} catch (error) {
				return fail("io-error", `重命名失败：${messageOf(error)}`);
			}
		await this.order.renameKey(scopeOfNode(node), basename(from), title);
		await this.order.remapScopeTree(node.id, this.relativeId(to));
		await this.deps.renameIds?.(node.id, this.relativeId(to));
		await this.deps.refresh();
		return ok(this.relativeId(to) as PageId);
	}

		// 父页面：目录与同名笔记都要改。先改目录、再改笔记；第二步失败必须把目录改回去，
		// 否则会留下「目录叫新名、笔记还叫旧名」的半个状态 —— 那棵树是自相矛盾的。
		const fromFolder = node.folderPath;
		const toFolder = joinPath(dirname(fromFolder), title);
		const fromFile = node.filePath!;
		try {
			await this.adapter.renameFolder(fromFolder, toFolder);
		} catch (error) {
			return fail("io-error", `重命名失败：${messageOf(error)}`);
		}
		try {
			await this.adapter.renameFile(joinPath(toFolder, basename(fromFile)), joinPath(toFolder, title + ".md"));
		} catch (error) {
			await this.adapter.renameFolder(toFolder, fromFolder).catch(() => undefined);
			return fail("io-error", `重命名失败（已回滚）：${messageOf(error)}`);
		}
		await this.order.renameKey(scopeOfNode(node), basename(fromFolder), title);
		// 子页面的排列顺序与展开状态都挂在以旧 id 为作用域的地方，必须一起搬过去。
		await this.order.remapScopeTree(node.id, this.relativeId(toFolder));
		await this.deps.renameIds?.(node.id, this.relativeId(toFolder));
		await this.deps.refresh();
		return ok(this.relativeId(toFolder) as PageId);
	}

	// ---------------------------------------------------------------- 移动

	async movePage(id: PageId, targetParentId: PageId | null): Promise<OpResult<PageId>> {
		const node = this.deps.getNode(id);
		if (!node) return fail("not-found", "页面不在索引里，请先重建索引");
		if (targetParentId && isDescendantId(targetParentId, id)) {
			return fail("not-allowed", "不能把页面移到它自己或它的子页面里");
		}
		if (normalizePath(node.parentId ?? "") === normalizePath(targetParentId ?? "")) return ok(id);

		const parent = targetParentId ? this.deps.getNode(targetParentId) : undefined;
		if (targetParentId && !parent) return fail("not-found", "父页面不在索引里，请先重建索引");

		if (parent?.kind === "leaf") {
			if (parent.title.toLowerCase() === node.title.toLowerCase()) {
				return fail("name-conflict", `目标位置已经有「${node.title}」了`);
			}
			if (this.exceedsFolderDepth(node, parent.depth + 1)) {
				return fail("not-allowed", "移动后子页面目录将超出页面树扫描范围");
			}
			return this.pairLeaf(
				parent,
				(folder) => this.moveIntoFolder(node, folder),
				(resultId, parentId) => this.recordMove(node, parentId, resultId),
			);
		}

		const targetFolder = targetParentId ? this.abs(targetParentId) : this.deps.getPageRoot();
		if (await this.checkConflict(targetFolder, node.title)) {
			return fail("name-conflict", `目标位置已经有「${node.title}」了`);
		}

		let resultId: PageId;
		try {
			await this.adapter.createFolder(targetFolder);
			resultId = await this.moveIntoFolder(node, targetFolder);
		} catch (error) {
			return fail("io-error", `移动失败：${messageOf(error)}`);
		}
		let warning: string | undefined;
		try {
			await this.recordMove(node, targetParentId ?? "", resultId);
		} catch (error) {
			warning = "页面已移动，顺序或展开状态未能保存：" + messageOf(error);
		}
		await this.deps.refresh();
		return warning ? { ok: true, value: resultId, warning } : ok(resultId);
	}

	private exceedsFolderDepth(node: PageNode, targetDepth: number): boolean {
		if (node.kind === "leaf") return false;
		return targetDepth > DEFAULT_MAX_DEPTH ||
			this.deps.getChildren(node.id).some((child) => this.exceedsFolderDepth(child, targetDepth + 1));
	}

	private async moveIntoFolder(node: PageNode, folder: string): Promise<PageId> {
		const from = node.kind === "leaf" ? node.filePath! : node.folderPath;
		const to = joinPath(folder, basename(from));
		if (node.kind === "leaf") await this.adapter.renameFile(from, to);
		else await this.adapter.renameFolder(from, to);
		return this.relativeId(to) as PageId;
	}

	private async recordMove(node: PageNode, scope: string, resultId: PageId): Promise<void> {
		await this.order.moveKey(scopeOfNode(node), scope, childKey(node));
		if (node.kind === "leaf") return;
		// 子树 ID 变更后，顺序作用域与展开状态需要跟着搬。
		await this.order.remapScopeTree(node.id, resultId);
		await this.deps.renameIds?.(node.id, resultId);
	}

	// ---------------------------------------------------------------- 删除

	async deletePage(id: PageId, options: DeleteOptions): Promise<OpResult<{ deletedPages: number }>> {
		const node = this.deps.getNode(id);
		if (!node) return fail("not-found", "页面不在索引里，请先重建索引");

		if (node.kind === "parent" && !options.withChildren) {
			// 只删这一篇笔记：目录留下、子页面留下，目录降级为分组目录。
			try {
				await this.adapter.trash(node.filePath!, options.useTrash);
			} catch (error) {
				return fail("io-error", `删除失败：${messageOf(error)}`);
			}
			// 不摘顺序条目：目录还在，它降级成同名的分组目录，键一个字符都没变。
			// 摘掉等于把用户排好的位置悄悄打回按名排序。
			await this.deps.refresh();
			return ok({ deletedPages: 1 });
		}

		const target = node.kind === "leaf" ? node.filePath! : node.folderPath;
		// 分组目录自己没有笔记，后代数就是全部页面数；父页面要把它自己那一篇算上。
		const deletedPages = node.kind === "leaf" ? 1 : node.kind === "group" ? node.descendantCount : node.descendantCount + 1;
		try {
			await this.adapter.trash(target, options.useTrash);
		} catch (error) {
			return fail("io-error", `删除失败：${messageOf(error)}`);
		}
		await this.order.removeFromScope(scopeOfNode(node), basename(target));
		// 整棵子树都进回收站了，它下面每一层的作用域都成了孤立条目。
		await this.order.removeScopeTree(node.id);
		await this.order.removeKey(node.id);
		await this.deps.refresh();
		return ok({ deletedPages });
	}

	// ---------------------------------------------------------------- 配对

	/** 把分组目录或叶子页面原地升级为父页面。这是唯一的模型升级路径。 */
	async pairPage(id: PageId, template?: string): Promise<OpResult<PageId>> {
		const node = this.deps.getNode(id);
		if (!node) return fail("not-found", "页面不在索引里，请先重建索引");
		if (node.kind === "parent") return ok(id);

		const autoCollapse = this.deps.collapseEmptyParents?.();
		const autoCollapseProblem = "已开启自动还原，请先添加子页面再配对";
		if (node.kind === "leaf") {
			return autoCollapse ? fail("not-allowed", autoCollapseProblem) : this.pairLeaf(node);
		}

		const filePath = joinPath(node.folderPath, basename(node.folderPath) + ".md");
		if (await this.adapter.exists(filePath)) return fail("name-conflict", "这个目录已经有同名笔记了");
		try {
			if (autoCollapse && node.childIds.length === 0) {
				const { files, folders } = await this.adapter.listFolderContents(node.folderPath);
				if (files.length === 0 && folders.length === 0) return fail("not-allowed", autoCollapseProblem);
			}
			await this.adapter.createFile(filePath, renderTemplate(template, basename(node.folderPath)));
		} catch (error) {
			return fail("io-error", `创建页面失败：${messageOf(error)}`);
		}
		await this.deps.refresh();
		return ok(this.relativeId(node.folderPath) as PageId);
	}

	/** 首次添加子页面时一并配对，写入或移动失败时恢复原笔记。 */
	private async pairLeaf(
		node: PageNode,
		addChild?: (folder: string) => Promise<PageId>,
		recordChildMove?: (resultId: PageId, parentId: PageId) => Promise<void>,
	): Promise<OpResult<PageId>> {
		const from = node.filePath!;
		const folder = joinPath(dirname(from), node.title);
		const to = joinPath(folder, basename(from));
		const excluded = new Set(this.deps.getExcludedFolders?.().map((name) => name.toLowerCase()));
		if (isExcludedFolder(node.title, excluded) || node.depth > DEFAULT_MAX_DEPTH) {
			return fail("not-allowed", "同名目录超出页面树扫描范围，无法配对");
		}
		if (this.changingPairs.has(node.id)) return fail("not-allowed", "此页面正在变更配对");
		this.changingPairs.add(node.id);
		try {
			const alreadyExists = await this.adapter.exists(folder);
			if (alreadyExists) {
				const { files, folders } = await this.adapter.listFolderContents(folder);
				if (files.length || folders.length) {
					return fail("name-conflict", "同名目录内已有内容，无法自动配对");
				}
			} else {
				await this.adapter.createFolder(folder);
			}

			let paired = false;
			const parentId = this.relativeId(folder) as PageId;
			let resultId = parentId;
			try {
				await this.adapter.renameFile(from, to);
				paired = true;
				if (addChild) resultId = await addChild(folder);
			} catch (error) {
				try {
					if (paired) await this.adapter.renameFile(to, from);
					if (!alreadyExists) await this.adapter.trashEmptyFolder(folder);
				} catch (rollbackError) {
					await this.deps.refresh();
					return fail("io-error", `操作失败：${messageOf(error)}。恢复失败：${messageOf(rollbackError)}`);
				}
				return fail("io-error", `操作失败：${messageOf(error)}`);
			}

			// 键从「名字.md」变成「名字」，原笔记在同级的位置需要保留。
			let warning: string | undefined;
			try {
				await this.order.renameKey(scopeOfNode(node), basename(from), basename(folder));
			} catch (error) {
				warning = `页面已配对，手动顺序未写入：${messageOf(error)}`;
			}
			try {
				await recordChildMove?.(resultId, parentId);
			} catch (error) {
				warning = `页面已移动，顺序或展开状态未能保存：${messageOf(error)}`;
			}
			await this.deps.refresh();
			return warning ? { ok: true, value: resultId, warning } : ok(resultId);
		} catch (error) {
			return fail("io-error", `配对失败：${messageOf(error)}`);
		} finally {
			this.changingPairs.delete(node.id);
		}
	}

	async unpairPage(id: PageId): Promise<OpResult<PageId>> {
		const node = this.deps.getNode(id);
		if (!node) return fail("not-found", "页面不在索引里，请先重建索引");
		if (node.kind !== "parent") return fail("not-allowed", "只有父页面可以解除配对");

		const result = await this.collapseEmptyParent(node);
		await this.deps.refresh();
		return result;
	}

	/** 供索引发布前收尾。这里不刷新，避免重入正在执行的扫描。 */
	async collapseEmptyParent(node: PageNode, pageRoot = this.deps.getPageRoot()): Promise<OpResult<PageId>> {
		const from = node.filePath!;
		const parentFolder = dirname(node.folderPath);
		const to = joinPath(parentFolder, basename(from));
		const leafId = childIdOf(node.parentId, basename(to));
		if (this.changingPairs.has(leafId)) return fail("not-allowed", "此页面正在变更配对");
		this.changingPairs.add(leafId);
		try {
			const { files, folders } = await this.adapter.listFolderContents(node.folderPath);
			if (folders.length || files.length !== 1 || files[0] !== from) {
				return fail("not-allowed", "目录内仍有其他文件或子目录");
			}
			if (await this.adapter.exists(to) || await this.checkConflict(parentFolder, node.title, [node.folderPath])) {
				return fail("name-conflict", `目标位置已经有「${node.title}」了`);
			}
			await this.adapter.renameFile(from, to);
			try {
				if (!await this.adapter.trashEmptyFolder(node.folderPath)) throw new Error("目录内容已变更");
			} catch (error) {
				try {
					await this.adapter.renameFile(to, from);
				} catch (rollbackError) {
					return fail("io-error", `笔记已移至 ${to}，恢复失败：${messageOf(rollbackError)}`);
				}
				return fail("io-error", `解除配对失败：${messageOf(error)}`);
			}
			try {
				await this.order.collapseScope(pageRoot, node.id, scopeOfNode(node), childKey(node), basename(to));
			} catch (error) {
				return { ok: true, value: leafId, warning: `笔记已移出，手动顺序未写入：${messageOf(error)}` };
			}
			return ok(leafId);
		} catch (error) {
			return fail("io-error", `解除配对失败：${messageOf(error)}`);
		} finally {
			this.changingPairs.delete(leafId);
		}
	}

	// ---------------------------------------------------------------- 排序

	async reorderScope(scope: PageId | null, keys: string[]): Promise<OpResult> {
		await this.order.setKeys(scope ?? "", keys);
		await this.deps.refresh();
		return ok(undefined);
	}

	async reorderOne(id: PageId, direction: "up" | "down" | "first" | "last"): Promise<OpResult> {
		const node = this.deps.getNode(id);
		if (!node) return fail("not-found", "页面不在索引里");
		const scope = node.parentId;
		const siblings = this.deps.getChildren(scope).map(childKey);
		const current = siblings.indexOf(childKey(node));
		if (current === -1) return fail("not-found", "页面不在当前顺序里");

		const next = [...siblings];
		next.splice(current, 1);
		const index =
			direction === "up"
				? Math.max(0, current - 1)
				: direction === "down"
					? Math.min(next.length, current + 1)
					: direction === "first"
						? 0
						: next.length;
		next.splice(index, 0, childKey(node));
		return this.reorderScope(scope, next);
	}

	private relativeId(absolutePath: string): string {
		const root = normalizePath(this.deps.getPageRoot());
		const path = normalizePath(absolutePath);
		if (root === "") return path;
		return path.toLowerCase().startsWith(root.toLowerCase() + "/") ? path.slice(root.length + 1) : path;
	}
}

/** 子项在顺序文件里的键：文件名带 .md，目录名不带。 */
export function childKey(node: PageNode): string {
	return node.kind === "leaf" ? basename(node.filePath ?? node.title) : basename(node.folderPath);
}

function scopeOfNode(node: PageNode): string {
	return node.parentId ?? "";
}

export function isDescendantId(candidate: PageId, ancestor: PageId): boolean {
	const target = normalizePath(candidate).toLowerCase();
	const base = normalizePath(ancestor).toLowerCase();
	if (base === "") return true;
	return target === base || target.startsWith(base + "/");
}

export function renderTemplate(template: string | undefined, title: string): string {
	if (!template) return `# ${title}\n`;
	const now = new Date();
	const pad = (value: number) => String(value).padStart(2, "0");
	return template
		.replace(/\{\{title\}\}/g, title)
		.replace(/\{\{date\}\}/g, `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
		.replace(/\{\{time\}\}/g, `${pad(now.getHours())}:${pad(now.getMinutes())}`);
}

export function describeNameProblem(problem: string | undefined, detail?: string): string {
	switch (problem) {
		case "empty":
			return "名称不能为空";
		case "too-long":
			return "名称太长了（上限 100 个字符）";
		case "illegal-char":
			return `名称不能包含 ${detail ?? "特殊字符"}`;
		case "dot-name":
			return "名称不能是 . 或 ..";
		case "edge-dot-or-space":
			return "名称不能以空格开头或结尾，也不能以点结尾";
		case "reserved":
			return "这是系统保留名，换一个";
		default:
			return "名称不合法";
	}
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
