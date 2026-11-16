import { ItemView, Notice, TFile, WorkspaceLeaf, Platform } from "obsidian";
import { PageId } from "../models/pageId";
import { PageNode } from "../models/pageNode";
import type SubPagePlugin from "../main";
import { buildRow } from "../components/treeRow";
import { iconButton, openPage, openCreate, openPageMenu, openPageMenuAt, requestDelete } from "../components/pageContextMenu";
import { createDragController } from "../components/dragController";
import { childKey, isDescendantId } from "../core/pageOperationService";
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
	private metadataCache = new Map<string, PageMetadata>();
	private metadataEpoch = -1;
	private searchTimer: number | null = null;
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
		this.expanded = plugin.expandedIds;
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
		this.render();
		this.registerEvent(this.app.workspace.on("file-open", () => this.highlightCurrent()));
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

	async 	onClose(): Promise<void> {
		if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
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
		// 每敲一个字符就重画整棵树，大库里会有肉眼可见的卡顿；120ms 足够盖住连续输入。
		this.searchEl.addEventListener("input", () => {
			if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
			this.searchTimer = window.setTimeout(() => {
				this.searchTimer = null;
				this.searchTerm = this.searchEl.value;
				this.render();
			}, 120);
		});
		this.searchEl.addEventListener("keydown", (event: KeyboardEvent) => {
			if (event.key === "Escape" && this.searchEl.value !== "") {
				event.stopPropagation();
				if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
				this.searchTimer = null;
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
		this.drag.attach(this.listEl);

		this.emptyEl = container.createDiv({ cls: "sp-empty" });

		const footer = container.createDiv({ cls: "sp-footer" });
		const newButton = footer.createEl("button", { cls: "sp-new-button" });
		newButton.setText(this.plugin.t("action.newPage"));
		newButton.addEventListener("click", () => openCreate(this.plugin, null));
	}

	// ------------------------------------------------------------ 渲染

	/** 设置里的展开状态被整体搬动过（改名 / 移动）后，视图收下新版而不是自己再算一遍。 */
	applyExpanded(ids: ReadonlySet<string>): void {
		this.expanded = new Set(ids);
	}

	render(): void {
		if (!this.listEl) return;
		const snapshotIds = new Set(Array.from(this.service.index.current.nodes.keys()) as string[]);
		this.expanded = pruneExpanded(this.expanded, snapshotIds);
		void this.plugin.setExpandedIds(this.expanded);

		if (this.searchTerm.trim() !== "") {
			this.renderSearch();
			return;
		}

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
		this.highlightCurrent();
		void this.ensureMetadata(this.rows);
	}

	/**
	 * 图标和描述在 frontmatter 里，扫描时读不到（读文件比读目录贵一个数量级）。
	 * 所以先按缺省图标画出来，读到真实值再重画一次。只重画一次，避免抖动。
	 */
	private async ensureMetadata(nodes: PageNode[]): Promise<void> {
		// 服务那层已经因为文件被改而失效了，这份渲染缓存也得跟着丢。
		if (this.metadataEpoch !== this.service.metadataEpoch) {
			this.metadataEpoch = this.service.metadataEpoch;
			this.metadataCache.clear();
		}
		const missing = nodes.filter((node) => node.filePath && !this.metadataCache.has(node.id));
		if (missing.length === 0) return;
		let decorated = false;
		for (const node of missing) {
			const metadata = await this.service.metadataFor(node.id);
			this.metadataCache.set(node.id, metadata);
			if (metadata.icon || metadata.description) decorated = true;
		}
		// 全都没有自定义图标时，重画也不会变，白白闪一下。
		if (decorated) this.render();
	}

	private renderSearch(): void {
		const hits = this.service.search(this.searchTerm);
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
		void this.ensureMetadata(hits);
	}

	private appendRow(node: PageNode, options: { expanded: boolean; current: boolean; trail?: string; highlight?: string }): void {
		const row = buildRow({
			node,
			...options,
			metadata: this.metadataCache.get(node.id) ?? node.metadata,
		});
		this.listEl.appendChild(row);
		row.addEventListener("click", (event) => this.onRowClick(event, node));
		row.addEventListener("dblclick", (event) => {
			event.preventDefault();
			this.openRename(node);
		});
		row.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.focusId = node.id;
			openPageMenu(this.plugin, event, { node });
		});
		// 移动端没有右键：长按 500ms 弹出同一套菜单。
		if (!Platform.isDesktopApp) this.attachLongPress(row, node);
	}

	private renderEmptyState(): void {
		this.emptyEl.empty();
		if (this.rows.length > 0) return;
		const root = this.plugin.settings.pageRoot;
		if (root !== "" && !this.service.index.current.nodes.size) {
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
		this.setFocusRing(node.id);
		const target = event.target as HTMLElement;
		if (target.closest(".sp-twisty")) {
			this.toggle(node);
			return;
		}
		if (node.kind === "group") {
			this.toggle(node);
			return;
		}
		void openPage(this.plugin, node);
	}

	private toggle(node: PageNode): void {
		if (node.childIds.length === 0) return;
		if (this.expanded.has(node.id)) this.expanded.delete(node.id);
		else this.expanded.add(node.id);
		void this.plugin.setExpandedIds(this.expanded);
		this.render();
	}

	private openRename(node: PageNode): void {
		if (node.kind === "group" && !node.filePath) {
			// 分组目录也能改名（它就是一个目录），走同一个服务。
		}
		void import("../modals/pageModals").then(({ RenamePageModal }) => {
			new RenamePageModal(this.app, this.plugin, node).open();
		});
	}

	private onKeyDown(event: KeyboardEvent): void {
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
			const result = navigate(this.rows, this.focusId, direction, this.expanded);
			if (result.focusId) {
				this.focusId = result.focusId as PageId;
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
		const node = this.focusId ? this.service.getNode(this.focusId) : undefined;
		if (!node) return;
		if (event.key === "Enter") {
			event.preventDefault();
			void openPage(this.plugin, node);
		} else if (event.key === "F2") {
			event.preventDefault();
			this.openRename(node);
		} else if (event.key === "Delete" || event.key === "Backspace") {
			event.preventDefault();
			void requestDelete(this.plugin, node);
		}
	}

	private setFocusRing(id: string): void {
		for (const row of Array.from(this.listEl.children)) {
			const element = row as HTMLElement;
			const isTarget = element.getAttribute("data-id") === id;
			element.toggleClass("is-focused", isTarget);
			element.setAttribute("tabindex", isTarget ? "0" : "-1");
		}
		this.listEl.querySelector<HTMLElement>(`.sp-row[data-id="${cssEscape(id)}"]`)?.focus();
	}

	private attachLongPress(row: HTMLElement, node: PageNode): void {
		let timer: number | null = null;
		row.addEventListener("touchstart", () => {
			timer = window.setTimeout(() => {
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
		// 落到叶子页面上没有意义（叶子没有目录，装不下子页面），按「成为它的同级」处理。
		const target = targetId ? this.service.getNode(targetId as PageId) : undefined;
		const parentId = target && target.kind === "leaf" ? target.parentId : (targetId as PageId | null);
		void this.service.operations.movePage(draggedId as PageId, parentId).then((result) => {
			if (!result.ok) new Notice(result.message);
		});
	}

	private reorderBefore(draggedId: string, targetId: string, position: "before" | "after"): void {
		const dragged = this.service.getNode(draggedId as PageId);
		const target = this.service.getNode(targetId as PageId);
		if (!dragged || !target) return;
		// 跨作用域拖拽 = 移动 + 排序，一步做完，避免出现「移过去了但顺序没跟上」。
		const scope = target.parentId;
		if ((dragged.parentId ?? "") !== (scope ?? "")) {
			void this.service.operations.movePage(dragged.id, scope).then((result) => {
				if (!result.ok) {
					new Notice(result.message);
					return;
				}
				this.reorderWithin(result.value, target.id, position);
			});
			return;
		}
		this.reorderWithin(dragged.id, target.id, position);
	}

	private reorderWithin(draggedId: PageId, targetId: PageId, position: "before" | "after"): void {
		const target = this.service.getNode(targetId);
		if (!target) return;
		const siblings = this.service.getChildren(target.parentId).map((node) => node.id);
		const withoutDragged = siblings.filter((id) => id !== draggedId);
		const anchor = withoutDragged.indexOf(targetId);
		const index = position === "before" ? anchor : anchor + 1;
		withoutDragged.splice(index, 0, draggedId);
		const keys = withoutDragged.map((id) => this.service.getNode(id)).filter((node): node is PageNode => !!node).map(childKey);
		void this.service.operations.reorderScope(target.parentId, keys);
	}

	// ------------------------------------------------------------ 当前页面

	private currentPageId(): PageId | null {
		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile)) return null;
		return this.service.nodeForFilePath(file.path)?.id ?? null;
	}

	/** 打开文件时：高亮它，并把它的祖先全部展开。 */
	highlightCurrent(): void {
		const id = this.currentPageId();
		if (!id) return;
		const ancestors = this.service.getAncestors(id).map((node) => node.id as string);
		const before = this.expanded.size;
		this.expanded = expandAncestors(this.expanded, ancestors);
		if (this.expanded.size !== before) {
			void this.plugin.setExpandedIds(this.expanded);
			this.render();
			return;
		}
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
}

/** 属性选择器里的 id 可能含引号或中文标点，转义一次再查。 */
function cssEscape(value: string): string {
	return value.replace(/["\\]/g, "\\$&");
}
