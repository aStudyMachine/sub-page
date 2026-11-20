import { VaultAdapter } from "../adapters/vaultAdapter";
import { OrderMap } from "../models/pageOrder";
import { equalsPath, joinPath, normalizePath } from "../utils/pathUtils";

export const ORDER_FILE_NAME = "order.json";
export const LEGACY_ORDER_FILE_NAME = ".subpage-order.json";

type OrdersByRoot = Record<string, OrderMap>;

export interface OrderLoadResult {
	order: OrderMap;
	/** 文件存在但读不懂时给出原因，调用侧据此提示用户（不阻断使用）。 */
	problem: string | null;
}

/**
 * 顺序文件读写。
 *
 * 损坏时绝不能因此拒绝显示树：退回名称排序 + 一句可点击的提示，是唯一可接受的行为。
 * 插件顺序文件无法解析时保留原文件，以免覆盖其他页面根的数据。
 */
export class PageOrderStore {
	private order: OrderMap = {};
	private loaded = false;
	private loadProblem: string | null = null;
	/** 自写抑制：自己写文件触发的 modify 事件不该被当成外部变更再读一遍。 */
	private writing = false;
	private pending = Promise.resolve();
	private pageRoot: string;

	constructor(
		private readonly adapter: VaultAdapter,
		pageRoot: string,
		readonly path: string,
	) {
		this.pageRoot = normalizePath(pageRoot);
	}

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
		const root = this.pageRoot;
		return this.enqueue(() => this.loadRoot(root));
	}

	private async loadRoot(root: string): Promise<OrderLoadResult> {
		const legacyPath = joinPath(root, LEGACY_ORDER_FILE_NAME);
		let order: OrderMap = {};
		let problem: string | null = null;
		try {
			const raw = await this.adapter.readText(this.path);
			const roots = parsePluginOrder(raw);
			if (roots[root] !== undefined) {
				order = roots[root];
			} else {
				const legacy = await this.adapter.readText(legacyPath);
				if (legacy !== null) {
					({ order, problem } = parseOrderFile(legacy));
					if (!problem) order = await this.saveRoot(root, order, true);
				}
			}
		} catch (error) {
			problem = `无法读取或迁移顺序文件：${String(error)}`;
		}
		if (this.pageRoot === root) {
			this.order = order;
			this.loadProblem = problem;
			this.loaded = true;
		}
		return { order, problem };
	}

	async ensureLoaded(): Promise<OrderMap> {
		if (!this.loaded) await this.load();
		return this.order;
	}

	/**
	 * 内容真的变了才重读。返回是否发生了变更。
	 *
	 * 用来接两件事：同步盘把别处的顺序文件覆盖过来（必须跟随），
	 * 以及宿主延迟送达的自写 modify（内容一样，重读只是白跑一次整树重扫）。
	 * 只比内容不比时间戳 —— 同一毫秒写两次时时间戳分不出来。
	 */
	async reloadIfChanged(): Promise<boolean> {
		const before = JSON.stringify(this.order);
		const problem = this.loadProblem;
		await this.load();
		return JSON.stringify(this.order) !== before || this.loadProblem !== problem;
	}

	matchesPath(path: string): boolean {
		return equalsPath(path, this.path);
	}

	getKeys(scope: string): string[] {
		return Object.prototype.hasOwnProperty.call(this.order, scope) ? this.order[scope] : [];
	}

	async setKeys(scope: string, keys: string[]): Promise<void> {
		const next = [...keys];
		return this.mutate((order) => this.replaceKeys(order, scope, next));
	}

	private replaceKeys(order: OrderMap, scope: string, keys: string[]): void {
		if (keys.length === 0) delete order[scope];
		else order[scope] = keys;
	}

	/** 改名时保留原来的手动排序位置。 */
	async renameKey(scope: string, oldKey: string, newKey: string): Promise<void> {
		return this.mutate((order) => {
			const keys = order[scope];
			if (keys?.includes(oldKey)) order[scope] = keys.map((key) => key === oldKey ? newKey : key);
		});
	}

	/** 从源作用域摘掉，插到目标作用域末尾。 */
	async moveKey(fromScope: string, toScope: string, key: string, newKey = key): Promise<void> {
		if (fromScope === toScope) return this.renameKey(fromScope, key, newKey);
		return this.mutate((order) => {
			this.replaceKeys(order, fromScope, (order[fromScope] ?? []).filter((item) => item !== key));
			order[toScope] = [...(order[toScope] ?? []).filter((item) => item !== newKey), newKey];
		});
	}

	async removeFromScope(scope: string, key: string): Promise<void> {
		return this.mutate((order) => {
			if (order[scope]?.includes(key)) this.replaceKeys(order, scope, order[scope].filter((item) => item !== key));
		});
	}

	async removeKey(key: string): Promise<void> {
		return this.mutate((order) => {
			for (const scope of Object.keys(order)) {
				if (order[scope].includes(key)) this.replaceKeys(order, scope, order[scope].filter((item) => item !== key));
			}
			delete order[key];
		});
	}

	/** 父页面改名或移动时，将整棵子树的作用域搬到新路径。 */
	async remapScopeTree(from: string, to: string): Promise<void> {
		if (from === to) return;
		return this.mutate((order) => {
			for (const key of Object.keys(order)) {
				if (key !== from && !key.startsWith(from + "/")) continue;
				const next = to + key.slice(from.length);
				const keys = order[key];
				delete order[key];
				const existing = order[next] ?? [];
				order[next] = [...existing, ...keys.filter((item) => !existing.includes(item))];
			}
		});
	}

	async removeScopeTree(scope: string): Promise<void> {
		return this.mutate((order) => this.deleteScopeTree(order, scope));
	}

	async collapseScope(root: string, scope: string, parentScope: string, folderKey: string, noteKey: string): Promise<void> {
		return this.mutate((order) => {
			const siblings = order[parentScope];
			if (siblings?.includes(folderKey)) {
				order[parentScope] = siblings.filter((key) => key !== noteKey).map((key) => key === folderKey ? noteKey : key);
			}
			this.deleteScopeTree(order, scope);
		}, normalizePath(root));
	}

	private deleteScopeTree(order: OrderMap, scope: string): void {
		for (const key of Object.keys(order)) {
			if (key === scope || key.startsWith(scope + "/")) delete order[key];
		}
	}

	async reorder(scope: string, keys: string[]): Promise<void> {
		await this.setKeys(scope, keys);
	}

	private mutate(update: (order: OrderMap) => void, root = this.pageRoot): Promise<void> {
		return this.enqueue(async () => {
			const current = this.pageRoot === root && this.loaded ? this.order : (await this.loadRoot(root)).order;
			const draft: OrderMap = Object.assign(Object.create(null), current);
			update(draft);
			if (JSON.stringify(draft) === JSON.stringify(current)) return;
			await this.saveRoot(root, draft);
			if (this.pageRoot === root) this.order = draft;
		});
	}

	private enqueue<T>(work: () => Promise<T>): Promise<T> {
		const result = this.pending.then(work);
		this.pending = result.then(() => undefined, () => undefined);
		return result;
	}

	private async saveRoot(root: string, order: OrderMap, migrating = false): Promise<OrderMap> {
		const raw = await this.adapter.readText(this.path);
		const roots = parsePluginOrder(raw);
		// 同步文件可能在迁移读取旧文件期间到达，已有根的顺序优先。
		if (migrating && roots[root] !== undefined) return roots[root];
		roots[root] = order;
		const content = JSON.stringify({ roots }, null, 2) + "\n";
		this.writing = true;
		try {
			if (migrating) await this.adapter.writeVerifiedText(this.path, content, raw);
			else await this.adapter.writeText(this.path, content);
		} finally {
			this.writing = false;
		}
		return order;
	}
}

function parsePluginOrder(raw: string | null): OrdersByRoot {
	const roots: OrdersByRoot = Object.create(null);
	if (raw === null) return roots;
	const parsed = JSON.parse(raw) as { roots?: unknown } | null;
	if (!parsed?.roots || typeof parsed.roots !== "object" || Array.isArray(parsed.roots)) {
		throw new Error("插件顺序文件的结构不对");
	}
	for (const [root, value] of Object.entries(parsed.roots)) {
		if (!value || typeof value !== "object" || Array.isArray(value) ||
			Object.values(value).some((keys) => !Array.isArray(keys) || keys.some((key) => typeof key !== "string" || !key))) {
			throw new Error("插件顺序文件的结构不对");
		}
		roots[root] = Object.assign(Object.create(null), value) as OrderMap;
	}
	return roots;
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
	const order: OrderMap = Object.create(null);
	for (const [scope, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (!Array.isArray(value)) continue;
		const keys = value.filter((item): item is string => typeof item === "string" && item.length > 0);
		if (keys.length > 0) order[scope] = keys;
	}
	return { order, problem: null };
}
