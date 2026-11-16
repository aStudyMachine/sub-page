import { FolderListing, VaultAdapter } from "../adapters/vaultAdapter";
import { PageId } from "../models/pageId";
import { PageNode } from "../models/pageNode";
import { PageOrderStore } from "../repository/pageOrderStore";
import { checkName } from "../utils/nameValidator";
import { basename, dirname, isMarkdownFile, joinPath, normalizePath } from "../utils/pathUtils";

export type OpFailureReason = "invalid-name" | "name-conflict" | "not-found" | "not-allowed" | "io-error";

export type OpResult<T = void> = { ok: true; value: T } | { ok: false; reason: OpFailureReason; message: string };

const ok = <T>(value: T): OpResult<T> => ({ ok: true, value });
const fail = (reason: OpFailureReason, message: string): OpResult<never> => ({ ok: false, reason, message });

export interface DeleteOptions {
	/** 连同子页面一起删除。false 时只删父页面自己的笔记，目录与子页面留下并降级为分组目录。 */
	withChildren: boolean;
	/** true 走系统回收站，false 走库内回收站。 */
	useTrash: boolean;
}

export interface CreateOptions {
	/** 同时创建同名目录，让新页面直接可以放子页面。 */
	withFolder?: boolean;
	template?: string;
}

export interface OperationDeps {
	adapter: VaultAdapter;
	order: PageOrderStore;
	getNode(id: PageId): PageNode | undefined;
	/** 某个作用域当前显示顺序（已应用顺序文件）。 */
	getChildren(scope: PageId | null): PageNode[];
	getPageRoot(): string;
	refresh(): Promise<void>;
}

/**
 * 所有写操作的唯一入口。每个动作都是「校验 → 执行 → 刷新 → 补偿」：
 * 校验全部在动文件之前完成，中途失败则把已经改了的部分恢复回去。
 * 返回结果类型而不是抛异常 —— 界面需要一句能读懂的原因，而不是一个 Error 对象。
 */
export class PageOperationService {
	private readonly adapter: VaultAdapter;
	private readonly order: PageOrderStore;

	constructor(private readonly deps: OperationDeps) {
		this.adapter = deps.adapter;
		this.order = deps.order;
	}

	private abs(relative: string): string {
		return joinPath(this.deps.getPageRoot(), relative);
	}

	private async checkConflict(folderPath: string, title: string): Promise<boolean> {
		const filePath = joinPath(folderPath, title + ".md");
		const folder = joinPath(folderPath, title);
		return (await this.adapter.exists(filePath)) || (await this.adapter.exists(folder));
	}

	private async assertCanHoldChildren(parentId: PageId | null): Promise<OpResult | null> {
		if (!parentId) return null;
		const parent = this.deps.getNode(parentId);
		if (!parent) return fail("not-found", "父页面不在索引里，请先重建索引");
		if (parent.kind === "leaf") return fail("not-allowed", "叶子页面还不能放子页面，请先为它创建同名目录");
		return null;
	}

	// ---------------------------------------------------------------- 新建

	async createPage(parentId: PageId | null, rawTitle: string, options: CreateOptions = {}): Promise<OpResult<PageId>> {
		const title = rawTitle.trim();
		const check = checkName(title);
		if (!check.ok) return fail("invalid-name", describeNameProblem(check.problem, check.detail));

		const parentProblem = await this.assertCanHoldChildren(parentId);
		if (parentProblem && !parentProblem.ok) return parentProblem;

		const parentFolder = parentId ? this.abs(parentId) : this.deps.getPageRoot();
		if (await this.checkConflict(parentFolder, title)) {
			return fail("name-conflict", `同级已经有一个「${title}」了`);
		}

		const folderPath = joinPath(parentFolder, title);
		// withFolder 时笔记必须落在目录里 —— 这才是配对模型，也是 id 变成目录路径的前提。
		const filePath = options.withFolder ? joinPath(folderPath, title + ".md") : joinPath(parentFolder, title + ".md");
		let createdFolder = false;
		try {
			if (options.withFolder) {
				await this.adapter.createFolder(folderPath);
				createdFolder = true;
			}
			// 建文件放在最后一步：它之前失败都能干净退出。
			await this.adapter.createFile(filePath, renderTemplate(options.template, title));
		} catch (error) {
			// 目录建好但文件没建成，留下空目录会让人以为「什么都没发生」。
			if (createdFolder) await this.adapter.trash(folderPath).catch(() => undefined);
			return fail("io-error", `新建页面失败：${messageOf(error)}`);
		}

		await this.deps.refresh();
		return ok((options.withFolder ? this.relativeId(folderPath) : this.relativeId(filePath)) as PageId);
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
		if (await this.checkConflict(parentFolder, title)) {
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

		const targetProblem = await this.assertCanHoldChildren(targetParentId);
		if (targetProblem && !targetProblem.ok) return targetProblem;

		const targetFolder = targetParentId ? this.abs(targetParentId) : this.deps.getPageRoot();
		if (await this.checkConflict(targetFolder, node.title)) {
			return fail("name-conflict", `目标位置已经有「${node.title}」了`);
		}

		const oldScope = scopeOfNode(node);
		const newScope = targetParentId ?? "";

		if (node.kind === "leaf") {
			const from = node.filePath!;
			const to = joinPath(targetFolder, basename(from));
			try {
				// 目标目录可能还不存在（往一个还没有子页面的父页面里放东西）。
				await this.adapter.createFolder(targetFolder);
				await this.adapter.renameFile(from, to);
			} catch (error) {
				return fail("io-error", `移动失败：${messageOf(error)}`);
			}
			await this.order.moveKey(oldScope, newScope, basename(from));
			await this.deps.refresh();
			return ok(this.relativeId(to) as PageId);
		}

		const from = node.folderPath;
		const to = joinPath(targetFolder, node.title);
		try {
			await this.adapter.createFolder(targetFolder);
			await this.adapter.renameFolder(from, to);
		} catch (error) {
			return fail("io-error", `移动失败：${messageOf(error)}`);
		}
		await this.order.moveKey(oldScope, newScope, basename(from));
		await this.deps.refresh();
		return ok(this.relativeId(to) as PageId);
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
			await this.order.removeFromScope(scopeOfNode(node), basename(node.folderPath));
			await this.deps.refresh();
			return ok({ deletedPages: 1 });
		}

		const target = node.kind === "leaf" ? node.filePath! : node.folderPath;
		const deletedPages = node.kind === "leaf" ? 1 : node.descendantCount + 1;
		try {
			await this.adapter.trash(target, options.useTrash);
		} catch (error) {
			return fail("io-error", `删除失败：${messageOf(error)}`);
		}
		await this.order.removeFromScope(scopeOfNode(node), basename(target));
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

		if (node.kind === "leaf") {
			// 配对 = 建目录 + 把它自己搬进去。只建目录不改位置的话，笔记会留在外面，
			// 目录立刻变成「有内容但没同名笔记」的分组目录，等于什么都没配对。
			const folderPath = joinPath(dirname(node.filePath!), node.title);
			if (await this.adapter.exists(folderPath)) return fail("name-conflict", "已经有了同名目录");
			const from = node.filePath!;
			const to = joinPath(folderPath, basename(from));
			try {
				await this.adapter.createFolder(folderPath);
			} catch (error) {
				return fail("io-error", `创建目录失败：${messageOf(error)}`);
			}
			try {
				await this.adapter.renameFile(from, to);
			} catch (error) {
				await this.adapter.trash(folderPath).catch(() => undefined);
				return fail("io-error", `创建目录成功但笔记搬不进去：${messageOf(error)}`);
			}
			await this.order.moveKey(scopeOfNode(node), folderPath, basename(from), basename(to));
			await this.deps.refresh();
			return ok(this.relativeId(folderPath) as PageId);
		}

		const filePath = joinPath(node.folderPath, basename(node.folderPath) + ".md");
		if (await this.adapter.exists(filePath)) return fail("name-conflict", "这个目录已经有同名笔记了");
		try {
			await this.adapter.createFile(filePath, renderTemplate(template, basename(node.folderPath)));
		} catch (error) {
			return fail("io-error", `创建页面失败：${messageOf(error)}`);
		}
		await this.deps.refresh();
		return ok(this.relativeId(node.folderPath) as PageId);
	}

	/** 解除配对：父页面降级为叶子页面。目录必须为空，否则先让用户把子页面移走。 */
	async unpairPage(id: PageId): Promise<OpResult<PageId>> {
		const node = this.deps.getNode(id);
		if (!node) return fail("not-found", "页面不在索引里，请先重建索引");
		if (node.kind !== "parent") return fail("not-allowed", "只有父页面可以解除配对");

		const listing: FolderListing | null = await this.adapter.listFolder(node.folderPath);
		if (!listing) return fail("not-found", "读不到这个目录");
		const leftovers =
			listing.folders.length +
			listing.files.filter((file) => isMarkdownFile(file.name) && file.path !== node.filePath).length;
		if (leftovers > 0) return fail("not-allowed", "目录里还有内容，先把子页面移走再解除配对");

		const parentFolder = dirname(node.folderPath);
		try {
			await this.adapter.renameFile(node.filePath!, joinPath(parentFolder, node.title + ".md"));
		} catch (error) {
			return fail("io-error", `解除配对失败：${messageOf(error)}`);
		}
		try {
			// 目录此时只剩空壳；留着它会立刻又变回一个空的分组目录。
			await this.adapter.trash(node.folderPath);
		} catch (error) {
			return fail("io-error", `笔记已移出，但空目录没删掉：${messageOf(error)}`);
		}
		await this.order.removeKey(node.id);
		await this.deps.refresh();
		return ok(this.relativeId(joinPath(parentFolder, node.title + ".md")) as PageId);
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