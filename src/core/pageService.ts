import { VaultAdapter, VaultEvent } from "../adapters/vaultAdapter";
import { PageId } from "../models/pageId";
import { PageMetadata } from "../models/pageMetadata";
import { PageNode } from "../models/pageNode";
import { SubPageSettings } from "../models/settings";
import { PageIndex } from "../repository/pageIndex";
import { PageMetadataReader } from "../repository/pageMetadataReader";
import { PageOrderStore } from "../repository/pageOrderStore";
import { scan } from "../repository/pageScanner";
import { isMarkdownFile, isSameOrDescendantPath, normalizePath } from "../utils/pathUtils";
import { PageOperationService } from "./pageOperationService";
import { collectStructureIssues, StructureReport } from "./structureIssues";

export interface PageServiceDeps {
	adapter: VaultAdapter;
	orderPath: string;
	settings: () => SubPageSettings;
	/** 索引变化时通知界面重绘。 */
	onChange: (reason: string) => void;
	/** 需要用户注意的问题（顺序文件损坏、扫描被截断等）。 */
	onProblem?: (message: string) => void;
	/** 观察外部变更的节流窗口（毫秒）。 */
	debounceMs?: number;
	/** 子树 id 整体变了（改名 / 移动），宿主据此搬动展开状态这类按 id 存的界面状态。 */
	onIdsRenamed?: (from: string, to: string) => Promise<void>;
	t?: (key: string, vars?: Record<string, string>) => string;
}

/**
 * 应用层门面：界面对外只认这个类，不碰 Vault，也不碰扫描器。
 *
 * 刷新策略分两档：
 *  - refresh()：整树重建，用于页面根切换、批量变更、和事件对不上时的兜底。
 *  - 事件：合并到一次节流刷新，避免「建目录 + 建文件」两条事件扫两遍。
 * 自己发起的操作在动完文件后主动 refresh —— 不依赖事件回调的时序，
 * 因为真实宿主里事件可能晚于 UI 的下一次渲染。
 */
export class PageService {
	readonly index = new PageIndex();
	readonly order: PageOrderStore;
	readonly metadata: PageMetadataReader;
	private activeOperations: PageOperationService;
	private activeRoot: string;
	private requestedRoot: string;
	private rootVersion = 0;
	private activeVersion = 0;
	private publishedVersion = 0;
	private pendingRoot: Promise<void> | null = null;
	private writes = Promise.resolve();
	private writing = false;

	/** 每次元数据缓存失效就 +1，界面据此丢掉自己那份渲染缓存。 */
	metadataEpoch = 0;

	private unsubscribe: (() => void) | null = null;
	private pending: number | null = null;
	private refreshing: Promise<void> | null = null;
	private readonly modifiedDuringScan = new Map<string, number>();
	private queued = false;
	private started = false;
	private readonly failedCollapses = new Set<string>();

	constructor(private readonly deps: PageServiceDeps) {
		this.activeRoot = this.requestedRoot = normalizePath(deps.settings().pageRoot);
		this.order = new PageOrderStore(deps.adapter, this.activeRoot, deps.orderPath);
		this.metadata = new PageMetadataReader(deps.adapter);
		this.activeOperations = this.createOperations(0);
	}

	get operations(): PageOperationService {
		return this.activeOperations;
	}

	isCurrentOperationSource(operations: PageOperationService): boolean {
		return operations === this.activeOperations && this.publishedVersion === this.rootVersion;
	}

	private createOperations(version: number): PageOperationService {
		return new PageOperationService({
			adapter: this.deps.adapter,
			order: this.order,
			getNode: (id) => this.index.getNode(id),
			getChildren: (scope) => this.index.getChildren(scope),
			getPageRoot: () => this.activeRoot,
			getExcludedFolders: () => this.deps.settings().excludedFolders,
			collapseEmptyParents: () => this.deps.settings().collapseEmptyParents,
			refresh: () => this.refreshNow(),
			renameIds: (from, to) => this.deps.onIdsRenamed?.(from, to) ?? Promise.resolve(),
			t: this.deps.t,
			run: (action) => this.enqueueWrite(async () => {
				if (version !== this.rootVersion) {
					return { ok: false, reason: "page-root-changed",
						message: this.deps.t?.("error.pageRootChanged") ?? "页面根已切换，请重新打开操作" };
				}
				return action();
			}),
		});
	}

	private enqueueWrite<T>(action: () => Promise<T>): Promise<T> {
		const result = this.writes.then(async () => {
			while (this.refreshing) await this.refreshing.catch(() => undefined);
			this.writing = true;
			try {
				return await action();
			} finally {
				this.writing = false;
			}
		});
		this.writes = result.then(() => undefined, () => undefined);
		return result;
	}

	get pageRoot(): string {
		return this.index.pageRoot;
	}

	get nodes(): PageNode[] {
		return Array.from(this.index.current.nodes.values());
	}

	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;
		await this.order.load();
		if (this.order.problem) this.deps.onProblem?.(this.order.problem);
		await this.refresh();
		this.unsubscribe = this.deps.adapter.subscribe((event) => this.handleEvent(event));
	}

	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		if (this.pending !== null) window.clearTimeout(this.pending);
		this.pending = null;
		this.started = false;
		this.failedCollapses.clear();
	}

	/** 页面根变了：顺序文件、索引、元数据缓存全部要跟着换。 */
	setPageRoot(pageRoot: string, save?: () => Promise<void>): Promise<void> {
		const root = normalizePath(pageRoot);
		if (root === this.requestedRoot && this.pendingRoot) return this.pendingRoot;
		if (root === this.requestedRoot && this.activeVersion === this.rootVersion) {
			return this.publishedVersion === this.rootVersion ? Promise.resolve() : this.refresh();
		}
		this.requestedRoot = root;
		const version = ++this.rootVersion;
		const pending = this.enqueueWrite(async () => {
			if (version !== this.rootVersion) return;
			try {
				await save?.();
			} catch (error) {
				if (version === this.rootVersion) {
					this.requestedRoot = this.activeRoot;
					this.activeVersion = version;
					await this.refreshNow();
				}
				throw error;
			}
			this.failedCollapses.clear();
			this.activeRoot = root;
			this.activeVersion = version;
			this.order.setPageRoot(root);
			this.metadata.clear();
			this.metadataEpoch += 1;
			await this.order.load();
			if (this.order.problem) this.deps.onProblem?.(this.order.problem);
			await this.refreshNow();
		}).finally(() => {
			if (this.pendingRoot === pending) this.pendingRoot = null;
		});
		this.pendingRoot = pending;
		return pending;
	}

	rebuild(): Promise<void> {
		return this.enqueueWrite(async () => {
			this.failedCollapses.clear();
			await this.order.load();
			if (this.order.problem) this.deps.onProblem?.(this.order.problem);
			await this.refreshNow();
		});
	}

	refresh(): Promise<void> {
		return this.writing ? this.enqueueWrite(() => this.refreshNow()) : this.refreshNow();
	}

	private refreshNow(): Promise<void> {
		// 同一时刻只允许一次扫描；期间来的请求合并成「再做一次」。
		if (this.refreshing) {
			this.queued = true;
			return this.refreshing;
		}
		this.refreshing = Promise.resolve().then(() => this.drainRefresh());
		return this.refreshing;
	}

	private async drainRefresh(): Promise<void> {
		try {
			do {
				this.queued = false;
				this.modifiedDuringScan.clear();
				await this.doRefresh();
			} while (this.queued);
		} finally {
			this.modifiedDuringScan.clear();
			this.refreshing = null;
		}
	}

	/** 最近一次整树扫描耗时；规模问题最先看这个数。 */
	lastScanMs: number | null = null;

	private async doRefresh(): Promise<void> {
		const version = this.activeVersion;
		if (version !== this.rootVersion) return;
		const settings = this.deps.settings();
		const started = Date.now();
		const root = this.activeRoot;
		await this.order.ensureLoaded();
		if (version !== this.rootVersion) return;
		const readSnapshot = () => scan(this.deps.adapter, root, {
			order: this.order.current,
			excludedFolders: settings.excludedFolders,
			showEmptyFolders: settings.showEmptyFolders,
		});
		let snapshot = await readSnapshot();
		const candidates = new Set<string>();
		if (settings.collapseEmptyParents) {
			let rescan = false;
			for (const node of snapshot.nodes.values()) {
				if (node.kind !== "parent" || node.childIds.length > 0) continue;
				const current = this.deps.settings();
				if (!current.collapseEmptyParents || version !== this.rootVersion) break;
				candidates.add(node.folderPath);
				if (this.failedCollapses.has(node.folderPath)) continue;
				const result = await this.operations.collapseEmptyParent(node, root);
				if (result.ok || result.reason === "io-error") rescan = true;
				if (result.ok && result.warning) this.deps.onProblem?.(result.warning);
				if (!result.ok && result.reason === "io-error") {
					// 回滚也会触发重扫，保留失败记录以免在同一空目录反复移动笔记。
					this.failedCollapses.add(node.folderPath);
					this.deps.onProblem?.(result.message);
				}
			}
			if (rescan && version === this.rootVersion) snapshot = await readSnapshot();
		}
		if (version !== this.rootVersion) return;
		for (const path of this.failedCollapses) {
			if (!candidates.has(path)) this.failedCollapses.delete(path);
		}
		this.lastScanMs = Date.now() - started;
		this.index.replace(snapshot);
		for (const [path, mtime] of this.modifiedDuringScan) {
			const node = this.index.findByFilePath(path);
			if (node) this.index.updateModifiedAt(node, mtime);
		}
		if (this.publishedVersion !== version) {
			this.activeOperations = this.createOperations(version);
			this.publishedVersion = version;
		}
		const warnings = snapshot.warnings.filter((warning) => warning.kind !== "case-conflict");
		if (warnings.length > 0) this.deps.onProblem?.(warnings[0].message);
		this.deps.onChange("refresh");
	}

	private handleEvent(event: VaultEvent): void {
		if (this.order.matchesPath(event.path) || (event.oldPath && this.order.matchesPath(event.oldPath))) {
			if (!this.order.isWriting) {
				void this.order.reloadIfChanged().then((changed) => {
					if (!changed || !this.started) return;
					if (this.order.problem) this.deps.onProblem?.(this.order.problem);
					this.scheduleRefresh();
				});
			}
			return;
		}
		// frontmatter 可能刚被改过（图标 / 描述），缓存必须先失效，否则树会一直显示旧图标。
		if (event.kind === "modify" || event.kind === "rename" || event.kind === "delete") {
			this.metadata.forget(event.path, event.kind !== "modify");
			if (event.oldPath) this.metadata.forget(event.oldPath, true);
			// 视图自己还有一层「已经补过 metadata 的 id」缓存，靠这个数字知道该丢。
			this.metadataEpoch += 1;
		}
		if (!this.touchesPageRoot(event)) return;
		if (event.kind === "modify") {
			// 树形来自目录结构、标题来自文件名，正文与 frontmatter 都改不动它。
			// 若是全量重扫，一万页的库里每存一次盘都要重建一整棵树。
			// 只有「索引里没有的 md」例外：同步盘直接落地的新文件常常只发 modify 不发 create。
			const node = this.index.findByFilePath(event.path);
			if (event.mtime !== undefined && isMarkdownFile(event.path)) {
				if (this.refreshing) this.modifiedDuringScan.set(event.path, event.mtime);
				if (node) this.index.updateModifiedAt(node, event.mtime);
			}
			if (node || !isMarkdownFile(event.path)) {
				this.deps.onChange("metadata");
				return;
			}
		}
		this.scheduleRefresh();
	}

	private touchesPageRoot(event: VaultEvent): boolean {
		const root = this.activeRoot;
		if (root === "") return true;
		return isSameOrDescendantPath(event.path, root) || (!!event.oldPath && isSameOrDescendantPath(event.oldPath, root));
	}

	private scheduleRefresh(): void {
		const delay = this.deps.debounceMs ?? 150;
		if (this.pending !== null) window.clearTimeout(this.pending);
		this.pending = window.setTimeout(() => {
			this.pending = null;
			void this.refresh();
		}, delay);
	}

	// ---------------------------------------------------------------- 查询

	getNode(id: PageId | null | undefined): PageNode | undefined {
		return this.index.getNode(id);
	}

	getAbsolutePath(path: string): string | null {
		return this.deps.adapter.getAbsolutePath?.(path) ?? null;
	}

	getChildren(id: PageId | null): PageNode[] {
		return this.index.getChildren(id);
	}

	getRoots(): PageNode[] {
		return this.index.getRoots();
	}

	getAncestors(id: PageId): PageNode[] {
		return this.index.getAncestors(id);
	}

	/** 侧栏定位：用文件路径找到它属于哪个页面。 */
	nodeForFilePath(path: string): PageNode | undefined {
		return this.index.findByFilePath(normalizePath(path));
	}

	/** 正文块定位：源文件所在目录里有同名笔记时，它就是父页面。 */
	nodeForSourcePath(path: string): PageNode | undefined {
		const normalized = normalizePath(path);
		const node = this.index.findByFilePath(normalized);
		if (node) return node;
		return this.index.findByFolderPath(normalized);
	}

	search(fragment: string): PageNode[] {
		return this.index.search(fragment);
	}

	async metadataFor(id: PageId): Promise<PageMetadata> {
		const node = this.index.getNode(id);
		if (!node) return {};
		return this.metadata.read(node);
	}

	/** 结构检查的原始素材。规则在 `core/structureIssues`，这里只负责取数。 */
	structureReport(): StructureReport {
		return collectStructureIssues({
			order: this.order.current,
			getChildren: (scope) => this.index.getChildren(scope),
			warnings: this.index.warnings,
			nodes: this.nodes,
		});
	}

	stats() {
		return this.index.stats();
	}
}
