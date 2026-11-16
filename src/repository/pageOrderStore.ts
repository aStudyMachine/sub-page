import { VaultAdapter } from "../adapters/vaultAdapter";
import { OrderMap } from "../models/pageOrder";
import { joinPath, normalizePath } from "../utils/pathUtils";

export const ORDER_FILE_NAME = ".subpage-order.json";

export function orderFilePath(pageRoot: string): string {
	return joinPath(pageRoot, ORDER_FILE_NAME);
}

export interface OrderLoadResult {
	order: OrderMap;
	/** 文件存在但读不懂时给出原因，调用侧据此提示用户（不阻断使用）。 */
	problem: string | null;
}

/**
 * 顺序文件读写。
 *
 * 损坏时绝不能因此拒绝显示树：退回名称排序 + 一句可点击的提示，是唯一可接受的行为。
 * 损坏的原文件不删、不覆盖 —— 用户可能想自己修回来。第一次真正写入时才覆盖。
 */
export class PageOrderStore {
	private order: OrderMap = {};
	private loaded = false;
	private loadProblem: string | null = null;
	/** 自写抑制：自己写文件触发的 modify 事件不该被当成外部变更再读一遍。 */
	private writing = false;

	constructor(private readonly adapter: VaultAdapter, private pageRoot: string) {}

	get current(): OrderMap {
		return this.order;
	}

	get problem(): string | null {
		return this.loadProblem;
	}

	get isWriting(): boolean {
		return this.writing;
	}

	setPageRoot(pageRoot: string): void {
		this.pageRoot = normalizePath(pageRoot);
		this.loaded = false;
		this.order = {};
		this.loadProblem = null;
	}

	async load(): Promise<OrderLoadResult> {
		const path = orderFilePath(this.pageRoot);
		const raw = await this.adapter.readText(path);
		this.loaded = true;
		if (raw === null) {
			this.order = {};
			this.loadProblem = null;
			return { order: this.order, problem: null };
		}
		const parsed = parseOrderFile(raw);
		this.order = parsed.order;
		this.loadProblem = parsed.problem;
		return { order: this.order, problem: parsed.problem };
	}

	async ensureLoaded(): Promise<OrderMap> {
		if (!this.loaded) await this.load();
		return this.order;
	}

	getKeys(scope: string): string[] {
		return this.order[scope] ?? [];
	}

	async setKeys(scope: string, keys: string[]): Promise<void> {
		await this.ensureLoaded();
		if (keys.length === 0) {
			if (this.order[scope] === undefined) return;
			delete this.order[scope];
		} else {
			this.order[scope] = [...keys];
		}
		await this.flush();
	}

	/** 改名：只替换一个元素，位置不动。 */
	async renameKey(scope: string, oldKey: string, newKey: string): Promise<void> {
		const keys = this.getKeys(scope);
		if (!keys.includes(oldKey)) return;
		await this.setKeys(scope, keys.map((key) => (key === oldKey ? newKey : key)));
	}

	/** 移动：从源作用域摘掉，插到目标作用域末尾。两个作用域相同时等价于改名。 */
	async moveKey(fromScope: string, toScope: string, key: string, newKey = key): Promise<void> {
		await this.ensureLoaded();
		if (fromScope === toScope) {
			await this.renameKey(fromScope, key, newKey);
			return;
		}
		const from = this.getKeys(fromScope).filter((item) => item !== key);
		const to = this.getKeys(toScope).filter((item) => item !== newKey);
		to.push(newKey);
		if (from.length === 0) delete this.order[fromScope];
		else this.order[fromScope] = from;
		this.order[toScope] = to;
		await this.flush();
	}

	/** 只从某个作用域里摘掉一项（父页面被删但目录留下时用）。 */
	async removeFromScope(scope: string, key: string): Promise<void> {
		const keys = this.getKeys(scope);
		if (!keys.includes(key)) return;
		await this.setKeys(scope, keys.filter((item) => item !== key));
	}

	/**
	 * 删除：从所有作用域里清掉这个 key，并删掉以它为作用域的那一段。
	 * 后者对应「整棵子树都走了」——留下孤立的作用域只会在结构检查里变成噪音。
	 * 注意删父页面时目录还在（子页面保留），那种情况由调用侧显式 reorder，不走这里。
	 */
	async removeKey(key: string): Promise<void> {
		await this.ensureLoaded();
		let changed = false;
		for (const scope of Object.keys(this.order)) {
			const filtered = this.order[scope].filter((item) => item !== key);
			if (filtered.length !== this.order[scope].length) {
				changed = true;
				if (filtered.length === 0) delete this.order[scope];
				else this.order[scope] = filtered;
			}
		}
		if (this.order[key] !== undefined) {
			delete this.order[key];
			changed = true;
		}
		if (changed) await this.flush();
	}

	/** 直接铺一个作用域的完整次序（拖拽排序用）。 */
	async reorder(scope: string, keys: string[]): Promise<void> {
		await this.setKeys(scope, keys);
	}

	private async flush(): Promise<void> {
		this.writing = true;
		try {
			await this.adapter.writeText(orderFilePath(this.pageRoot), JSON.stringify(this.order, null, 2) + "\n");
		} finally {
			this.writing = false;
		}
	}
}

export function parseOrderFile(raw: string): { order: OrderMap; problem: string | null } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { order: {}, problem: "顺序文件不是合法 JSON，已退回按名称排序" };
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { order: {}, problem: "顺序文件的结构不对，已退回按名称排序" };
	}
	const order: OrderMap = {};
	for (const [scope, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (!Array.isArray(value)) continue;
		const keys = value.filter((item): item is string => typeof item === "string" && item.length > 0);
		if (keys.length > 0) order[scope] = keys;
	}
	return { order, problem: null };
}
