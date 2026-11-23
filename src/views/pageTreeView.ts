import { ItemView, Notice, TFile, WorkspaceLeaf, Platform } from "obsidian";
import { PageId } from "../models/pageId";
import { PageNode } from "../models/pageNode";
import type SubPagePlugin from "../main";
import { buildRow } from "../components/treeRow";
import { iconButton, openPage, openCreate, openPageMenu, openPageMenuAt, openRename, requestDelete } from "../components/pageContextMenu";
import { createDragController } from "../components/dragController";
import { isDescendantId } from "../core/pageOperationService";
import type { PageOperationService } from "../core/pageOperationService";
import { expandAncestors, flattenTree, navigate, pruneExpanded } from "./treeState";

import { PageMetadata } from "../models/pageMetadata";
import { hintSeen, markHintSeen } from "../hints";
import { findConflictingPlugins } from "../utils/conflictingPlugins";

export const PAGE_TREE_VIEW_TYPE = "sub-page-tree";

/**
 * 侧栏。只做三件事：读 plugin.service 的索引 → 构建行 → 把交互转交给门面。
 * 不读写文件、不判断模型规则（那些都在 core 里）。
 */
export class PageTreeView extends ItemView {
	private expanded = new Set<string>();
	private rows: PageNode[] = [];
	private listEl!: HTMLElement;
	private emptyEl!: HTMLElement;
	private searchEl!: HTMLInputElement;
	private searchTerm = "";
	private focusId: PageId | null = null;
	private renderedOperations?: PageOperationService;
	private lastOpenedFile: TFile | null = null;
	private metadataCache = new Map<string, PageMetadata>();
	private metadataEpoch = -1;
	private drag = createDragController({
		isForbidden: (draggedId, targetId) =>
			draggedId === targetId || isDescendantId(targetId as PageId, draggedId as PageId),
		onDropOn: (draggedId, targetId) => this.moveAsChild(draggedId, targetId),
		onDropBetween: (draggedId, targetId, position) => this.reorderBefore(draggedId, targetId, position),
		onDropRoot: (draggedId) => this.moveAsChild(draggedId, null),
	});

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: SubPagePlugin,
	) {
		super(leaf);
		// 展开态不在这里从 plugin 拷贝：视图可能早于 loadSettings 构造，
		// 那一刻的 settings 是默认空值。render() 每帧重读才是唯一入口。
	}

	private get service() {
		return this.plugin.service;
	}

	getViewType(): string {
		return PAGE_TREE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.plugin.t("view.tree.name");
	}

	getIcon(): string {
		return "list-tree";
	}

	async onOpen(): Promise<void> {
		this.buildChrome();
		this.lastOpenedFile = this.app.workspace.getActiveFile();
		this.render();
		this.registerEvent(this.app.workspace.on("file-open", (file) => this.onFileOpen(file)));
		// 页面模型是「任意笔记都是页面」，这件事光看树看不出来 —— 第一次打开说一遍。
		if (!hintSeen(this.app, "welcome")) {
			markHintSeen(this.app, "welcome");
			new Notice(this.plugin.t("hint.welcome"), 8000);
		}
		if (findConflictingPlugins(this.app).length > 0 && !hintSeen(this.app, "folder-note")) {
			markHintSeen(this.app, "folder-note");
			new Notice(this.plugin.t("hint.folderNote"), 12000);
		}
	}

	async onClose(): Promise<void> {
		this.drag.destroy();
	}

	// ------------------------------------------------------------ 骨架

	private buildChrome(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass("sp-sidebar");

		const toolbar = container.createDiv({ cls: "sp-toolbar" });
		this.searchEl = toolbar.createEl("input", {
			cls: "sp-search",
			attr: { type: "search", placeholder: this.plugin.t("action.search"), "aria-label": this.plugin.t("action.search") },
		});
		// 先更新可操作的行，避免按 Tab 后仍能操作上一条查询的结果。
		this.searchEl.addEventListener("input", () => {
			this.searchTerm = this.searchEl.value;
			this.render();
		});
		this.searchEl.addEventListener("keydown", (event: KeyboardEvent) => {
			if (event.key === "Escape" && this.searchEl.value !== "") {
				event.stopPropagation();
				this.searchEl.value = "";
				this.searchTerm = "";
				this.render();
			}
		});
		iconButton(toolbar, "plus", this.plugin.t("action.newPage")).addEventListener("click", () =>
			openCreate(this.plugin, null),
		);

		this.listEl = container.createDiv({ cls: "sp-tree", attr: { role: "tree", "aria-label": this.plugin.t("view.tree.name") } });
		this.listEl.addEventListener("contextmenu", (event) => {
			if (event.target === this.listEl) {
				event.preventDefault();
				openPageMenu(this.plugin, event, { node: null });
			}
		});
		this.listEl.addEventListener("keydown", (event) => this.onKeyDown(event));
		const ownerWindow = this.listEl.ownerDocument.defaultView;
		if (ownerWindow) {
			// 侧栏行聚焦时优先处理 F2，避免宿主把按键交给正文标题。
			this.registerDomEvent(ownerWindow, "keydown", (event) => {
				if (event.key !== "F2" || !this.listEl.contains(event.target as Node | null)) return;
				this.onKeyDown(event);
				if (event.defaultPrevented) event.stopPropagation();
			}, true);
		}
		this.listEl.addEventListener("focusout", (event) => {
			if (!this.listEl.contains(event.relatedTarget as Node | null)) {
				this.listEl.querySelector(".is-focused")?.removeClass("is-focused");
			}
		});
		this.drag.attach(this.listEl);

		this.emptyEl = container.createDiv({ cls: "sp-empty" });
	}

	// ------------------------------------------------------------ 渲染

	/** 设置里的展开状态被整体搬动过（改名 / 移动）后，视图收下新版而不是自己再算一遍。 */
	applyExpanded(ids: ReadonlySet<string>): void {
		this.expanded = new Set(ids);
	}

	render(): void {
		if (!this.listEl) return;
		const restoreFocus = this.listEl.contains(this.listEl.ownerDocument.activeElement);
		const operations = this.service.operations;
		if (this.metadataEpoch !== this.service.metadataEpoch) {
			this.metadataEpoch = this.service.metadataEpoch;
			this.metadataCache.clear();
		}
		if (this.renderedOperations !== operations) {
			this.renderedOperations = operations;
			this.focusId = null;
			this.drag.reset();
		}
		// 展开态以设置为唯一真相，每帧重读。视图可能早于 loadSettings 构造，
		// 构造时拿到的是默认空值；若在首帧把空集写回设置，就会把持久化的展开态洗掉。
		// 因此 render 只读不写，变更一律由交互方法显式 setExpandedIds 落盘。
		this.expanded = new Set(this.plugin.expandedIds);
		const snapshotIds = new Set(Array.from(this.service.index.current.nodes.keys()) as string[]);
		// 失效 ID 只在显示层裁掉，不回写设置——回写只能由交互方法做。
		this.expanded = pruneExpanded(this.expanded, snapshotIds);

		if (this.searchTerm.trim() !== "") {
			this.renderSearch();
		} else {
			this.renderTree();
		}
		const focusId = this.rows.find((row) => row.id === this.focusId)?.id ?? this.rows[0]?.id ?? null;
		this.setFocusRing(focusId, restoreFocus);
		if (!focusId && restoreFocus) this.searchEl.focus();
		void this.ensureMetadata(this.rows);
	}

	private renderTree(): void {
		this.rows = flattenTree({
			getRoots: () => this.service.getRoots(),
			getChildren: (id) => this.service.getChildren(id),
			expanded: this.expanded,
		});

		this.listEl.empty();
		this.listEl.removeClass("is-search");
		const current = this.currentPageId();
		for (const node of this.rows) {
			this.appendRow(node, { expanded: this.expanded.has(node.id), current: node.id === current });
		}
		this.renderEmptyState();
	}

	/**
	 * 图标和描述在 frontmatter 里，扫描时读不到（读文件比读目录贵一个数量级）。
	 * 所以先按缺省图标画出来，读到真实值再重画一次。只重画一次，避免抖动。
	 */
	private async ensureMetadata(nodes: PageNode[]): Promise<void> {
		const epoch = this.service.metadataEpoch;
		const missing = nodes.filter((node) => node.filePath && !this.metadataCache.has(node.id));
		if (missing.length === 0) return;
		let decorated = false;
		for (const node of missing) {
			if (this.metadataCache.has(node.id)) continue;
			const metadata = await this.service.metadataFor(node.id).catch(() => node.metadata);
			if (epoch !== this.service.metadataEpoch) return;
			if (this.metadataCache.has(node.id)) continue;
			this.metadataCache.set(node.id, metadata);
			if (metadata.icon || metadata.description) decorated = true;
		}
		// 全都没有自定义图标时，重画也不会变，白白闪一下。
		if (decorated) this.render();
	}

	private renderSearch(): void {
		const hits = this.rows = this.service.search(this.searchTerm);
		this.listEl.empty();
		this.listEl.addClass("is-search");
		if (hits.length === 0) {
			this.listEl.createDiv({ cls: "sp-empty-hint", text: this.plugin.t("notice.noMatches") });
		}
		for (const node of hits) {
			const trail = this.service
				.getAncestors(node.id)
				.map((ancestor) => ancestor.title)
				.join(" / ");
			this.appendRow(node, { expanded: false, current: false, trail, highlight: this.searchTerm });
		}
		this.emptyEl.empty();
	}

	private appendRow(node: PageNode, options: { expanded: boolean; current: boolean; trail?: string; highlight?: string }): void {
		const row = buildRow({
			node,
			...options,
			metadata: this.metadataCache.get(node.id) ?? node.metadata,
		});
		this.listEl.appendChild(row);
		const operations = this.service.operations;
		row.addEventListener("focus", () => this.setFocusRing(node.id, false));
		row.addEventListener("click", (event) => this.onRowClick(event, node));
		row.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.focusId = node.id;
			openPageMenu(this.plugin, event, { node });
		});
		// 移动端没有右键：长按 500ms 弹出同一套菜单。
		if (!Platform.isDesktopApp) this.attachLongPress(row, node, operations);
	}

	private renderEmptyState(): void {
		this.emptyEl.empty();
		if (this.rows.length > 0) return;
		const { pageRoot: root, rootMissing } = this.service.index.current;
		if (rootMissing) {
			// 页面根不存在与页面根为空要分开说 —— 前者是配置错了。
			this.emptyEl.createDiv({ cls: "sp-empty-text", text: this.plugin.t("notice.rootMissing", { path: root }) });
			const pick = this.emptyEl.createEl("button", { text: this.plugin.t("action.chooseRoot") });
			pick.addEventListener("click", () => {
				// 打开插件设置页，让用户自己选目录 —— 不在这里猜一个目录名。
				this.plugin.openSettings();
			});
			return;
		}
		this.emptyEl.createDiv({ cls: "sp-empty-text", text: this.plugin.t("notice.empty") });
		const create = this.emptyEl.createEl("button", { text: this.plugin.t("action.newPage"), cls: "mod-cta" });
		create.addEventListener("click", () => openCreate(this.plugin, null));
	}

	// ------------------------------------------------------------ 交互

	private onRowClick(event: MouseEvent, node: PageNode): void {
		this.focusId = node.id;
		const target = event.target as HTMLElement;
		const canToggle = node.childIds.length > 0 && !this.searchTerm.trim();
		const opensNote = node.kind !== "group" && !(canToggle && target.closest(".sp-icon"));
		const shouldToggleParent = node.kind === "parent" && canToggle &&
			(!opensNote || !this.expanded.has(node.id) || this.currentPageId() === node.id);
		if ((node.kind === "group" && canToggle) || shouldToggleParent) this.toggle(node);
		this.setFocusRing(node.id);
		if (opensNote) void openPage(this.plugin, node);
	}

	private toggle(node: PageNode): void {
		if (node.childIds.length === 0) return;
		if (this.expanded.has(node.id)) this.expanded.delete(node.id);
		else this.expanded.add(node.id);
		void this.plugin.setExpandedIds(this.expanded);
		this.render();
	}

	private onKeyDown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		const id = target?.closest(".sp-row")?.getAttribute("data-id");
		const node = this.rows.find((row) => row.id === id);
		if (!node) return;
		const map: Record<string, "up" | "down" | "left" | "right" | "home" | "end"> = {
			ArrowUp: "up",
			ArrowDown: "down",
			ArrowLeft: "left",
			ArrowRight: "right",
			Home: "home",
			End: "end",
		};
		const direction = map[event.key];
		if (direction) {
			event.preventDefault();
			if (this.searchTerm.trim() && (direction === "left" || direction === "right")) return;
			const result = navigate(this.rows, node.id, direction, this.expanded);
			if (result.focusId) {
				this.focusId = result.focusId;
				if (result.expanded !== null) {
					if (result.expanded) this.expanded.add(result.focusId);
					else this.expanded.delete(result.focusId);
					void this.plugin.setExpandedIds(this.expanded);
					this.render();
				}
				this.setFocusRing(result.focusId);
			}
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			void openPage(this.plugin, node);
		} else if (event.key === "F2") {
			event.preventDefault();
			openRename(this.plugin, node);
		} else if (event.key === "Delete" || event.key === "Backspace") {
			event.preventDefault();
			void requestDelete(this.plugin, node);
		}
	}

	private setFocusRing(id: PageId | null, focus = true): void {
		if (!this.listEl) return;
		this.focusId = id;
		let target: HTMLElement | undefined;
		for (const element of this.listEl.querySelectorAll<HTMLElement>(".sp-row")) {
			const isTarget = element.getAttribute("data-id") === id;
			element.toggleClass("is-focused", isTarget && (focus || element === element.ownerDocument.activeElement));
			element.setAttribute("tabindex", isTarget ? "0" : "-1");
			if (isTarget) target = element;
		}
		if (focus) target?.focus();
	}

	private attachLongPress(row: HTMLElement, node: PageNode, operations: PageOperationService): void {
		let timer: number | null = null;
		row.addEventListener("touchstart", () => {
			timer = window.setTimeout(() => {
				if (!row.isConnected || !this.service.isCurrentOperationSource(operations)) return;
				const rect = row.getBoundingClientRect();
				// 长按弹的是同一套菜单：移动端没有右键，条目不该有两份实现。
				openPageMenuAt(this.plugin, { x: rect.left + 24, y: rect.top + rect.height / 2 }, { node });
			}, 500);
		});
		const cancel = () => {
			if (timer !== null) window.clearTimeout(timer);
			timer = null;
		};
		row.addEventListener("touchend", cancel);
		row.addEventListener("touchmove", cancel);
	}

	// ------------------------------------------------------------ 拖拽落点

	private moveAsChild(draggedId: string, targetId: string | null): void {
		const operations = this.service.operations;
		void operations.movePage(draggedId as PageId, targetId as PageId | null).then((result) => {
			if (!result.ok) {
				new Notice(result.message);
				return;
			}
			if (result.warning) new Notice(result.warning);
			if (targetId && this.service.isCurrentOperationSource(operations) && this.expandPageAncestors(result.value)) this.render();
		});
	}

	private reorderBefore(draggedId: string, targetId: string, position: "before" | "after"): void {
		void this.service.operations.moveBeside(draggedId as PageId, targetId as PageId, position).then((result) => {
			if (!result.ok) new Notice(result.message);
			else if (result.warning) new Notice(result.warning);
		});
	}

	// ------------------------------------------------------------ 当前页面

	private currentPageId(file = this.app.workspace.getActiveFile()): PageId | null {
		if (!(file instanceof TFile)) return null;
		return this.service.nodeForFilePath(file.path)?.id ?? null;
	}

	private expandPageAncestors(id: PageId): boolean {
		const ancestors = this.service.getAncestors(id).map((node) => node.id);
		const expanded = expandAncestors(this.expanded, ancestors);
		if (expanded.size === this.expanded.size) return false;
		this.expanded = expanded;
		void this.plugin.setExpandedIds(this.expanded);
		return true;
	}

	/** 切换文件时才自动展开，保留用户对当前文件所在目录的折叠操作。 */
	private onFileOpen(file: TFile | null): void {
		if (file === this.lastOpenedFile) return;
		this.lastOpenedFile = file;
		const id = this.currentPageId(file);
		if (id && this.expandPageAncestors(id)) this.render();
		for (const row of Array.from(this.listEl.querySelectorAll<HTMLElement>(".sp-row"))) {
			row.toggleClass("is-current", row.getAttribute("data-id") === id);
		}
		this.listEl.querySelector<HTMLElement>(`.sp-row.is-current`)?.scrollIntoView({ block: "nearest" });
	}

	/** 展开/折叠当前页面的整条祖先链，命令面板用。 */
	expandAll(): void {
		const ids = new Set<string>();
		for (const node of this.service.nodes) {
			if (node.childIds.length > 0) ids.add(node.id);
		}
		this.expanded = ids;
		void this.plugin.setExpandedIds(this.expanded);
		this.render();
	}

	collapseAll(): void {
		this.expanded = new Set();
		void this.plugin.setExpandedIds(this.expanded);
		this.render();
	}

	/** 主动定位会退出搜索并展开当前文件的祖先链。 */
	revealCurrent(): void {
		const id = this.currentPageId();
		if (!id) return;
		this.searchTerm = "";
		if (this.searchEl) this.searchEl.value = "";
		// expandPageAncestors 变化时已落盘；没变化则无需写。
		this.expandPageAncestors(id);
		this.render();
		this.setFocusRing(id);
		this.listEl?.querySelector<HTMLElement>(`.sp-row[data-id="${cssEscape(id)}"]`)?.scrollIntoView({ block: "nearest" });
	}
}

/** 属性选择器里的 id 可能含引号或中文标点，转义一次再查。 */
function cssEscape(value: string): string {
	return value.replace(/["\\]/g, "\\$&");
}
