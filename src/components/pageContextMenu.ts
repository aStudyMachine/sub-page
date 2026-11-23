import { Menu, Notice, Platform, TFile, setIcon } from "obsidian";
import { PageId } from "../models/pageId";
import { PageNode } from "../models/pageNode";
import type SubPagePlugin from "../main";
import { CreatePageModal, DeletePageModal, MovePageModal, RenamePageModal } from "../modals/pageModals";

export interface MenuTarget {
	/** 被右键的节点；空区右键时为 null（只出「新建页面」）。 */
	node: PageNode | null;
}

/**
 * 右键菜单。桌面与移动端共用菜单实现，移动端靠长按呼出。
 */
export function openPageMenu(plugin: SubPagePlugin, event: MouseEvent, target: MenuTarget): void {
	openPageMenuAt(plugin, { x: event.clientX, y: event.clientY }, target);
}

/** 移动端长按没有 MouseEvent，只给坐标。条目与右键完全一致。 */
export function openPageMenuAt(plugin: SubPagePlugin, position: { x: number; y: number }, target: MenuTarget): void {
	const menu = new Menu();
	const operations = plugin.service.operations;
	const onCurrentRoot = (action: () => void) => () => {
		if (plugin.service.isCurrentOperationSource(operations)) action();
		else new Notice(plugin.t("error.pageRootChanged"));
	};
	const reorder = async (id: PageId, direction: "up" | "down" | "first" | "last") => {
		const result = await operations.reorderOne(id, direction);
		if (!result.ok) new Notice(result.message);
	};
	const node = target.node;
	const t = (key: string, vars?: Record<string, string | number>) => plugin.t(key, vars);

	if (node) {
		menu.addItem((item) =>
			item
				.setTitle(t("menu.newChild"))
				.setIcon("file-plus")
				.onClick(onCurrentRoot(() => openCreate(plugin, node.id))),
		);
		menu.addItem((item) =>
			item.setTitle(t("menu.newSibling")).setIcon("files").onClick(onCurrentRoot(() => openCreate(plugin, node.parentId))),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t("menu.rename"))
				.setIcon("pencil")
				.onClick(onCurrentRoot(() => openRename(plugin, node))),
		);
		menu.addItem((item) =>
			item
				.setTitle(t("menu.moveTo"))
				.setIcon("folder-input")
				.onClick(onCurrentRoot(() => new MovePageModal(plugin.app, plugin, node).open())),
		);
		if (node.kind === "group") {
			menu.addItem((item) =>
				item
					.setTitle(t("menu.pair"))
					.setIcon("file-plus-2")
					.onClick(onCurrentRoot(() => void pair(plugin, node))),
			);
		}
		if (node.kind === "parent") {
			menu.addItem((item) =>
				item
					.setTitle(t("menu.unpair"))
					.setIcon("file-minus-2")
					.onClick(onCurrentRoot(() => void unpair(plugin, node))),
			);
		}
		if (node.kind === "parent" || node.kind === "leaf") {
			menu.addItem((item) =>
				item
					.setTitle(t("menu.copyLink"))
					.setIcon("link")
					.onClick(onCurrentRoot(() => void copyLink(plugin, node))),
			);
		}
		const relativePath = node.filePath ?? node.folderPath;
		const absolutePath = plugin.service.getAbsolutePath(relativePath);
		if (absolutePath !== null) {
			menu.addItem((item) =>
				item
					.setTitle(t("menu.copyAbsolutePath"))
					.setIcon("copy")
					.onClick(onCurrentRoot(() => void copyText(plugin, absolutePath, "notice.pathCopied"))),
			);
		}
		menu.addItem((item) =>
			item
				.setTitle(t("menu.copyRelativePath"))
				.setIcon("copy")
				.onClick(onCurrentRoot(() => void copyText(plugin, relativePath, "notice.pathCopied"))),
		);
		menu.addItem((item) =>
			item
				.setTitle(t("menu.openInNewTab"))
				.setIcon("external-link")
				.onClick(onCurrentRoot(() => void openInNewTab(plugin, node))),
		);
		if (Platform.isDesktopApp) {
			menu.addItem((item) =>
				item
					.setTitle(t("menu.revealInExplorer"))
					.setIcon("folder-open")
					.onClick(onCurrentRoot(() => revealInExplorer(plugin, node))),
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t("menu.moveUp"))
				.setIcon("arrow-up")
				.onClick(onCurrentRoot(() => void reorder(node.id, "up"))),
		);
		menu.addItem((item) =>
			item
				.setTitle(t("menu.moveDown"))
				.setIcon("arrow-down")
				.onClick(onCurrentRoot(() => void reorder(node.id, "down"))),
		);
		menu.addItem((item) =>
			item
				.setTitle(t("menu.moveTop"))
				.setIcon("arrow-up-to-line")
				.onClick(onCurrentRoot(() => void reorder(node.id, "first"))),
		);
		menu.addItem((item) =>
			item
				.setTitle(t("menu.moveBottom"))
				.setIcon("arrow-down-to-line")
				.onClick(onCurrentRoot(() => void reorder(node.id, "last"))),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t("menu.delete"))
				.setIcon("trash")
				.onClick(onCurrentRoot(() => void requestDelete(plugin, node))),
		);
	} else {
		menu.addItem((item) =>
			item
				.setTitle(t("menu.pairFolder"))
				.setIcon("file-plus")
				.onClick(onCurrentRoot(() => openCreate(plugin, null))),
		);
	}

	menu.showAtPosition(position);
}

export function openCreate(plugin: SubPagePlugin, parentId: PageId | null): void {
	new CreatePageModal(plugin.app, plugin, {
		parentId,
		defaultTitle: plugin.t("modal.create.untitled"),
		onCreated: (id) => void openPage(plugin, plugin.service.getNode(id)),
	}).open();
}

export function openRename(plugin: SubPagePlugin, node: PageNode): void {
	new RenamePageModal(plugin.app, plugin, node).open();
}

export async function pair(plugin: SubPagePlugin, node: PageNode): Promise<void> {
	const operations = plugin.service.operations;
	const template = await plugin.loadTemplate();
	const result = await operations.pairPage(node.id, template);
	if (!result.ok) new Notice(result.message);
	else if (result.warning) new Notice(result.warning);
}

export async function unpair(plugin: SubPagePlugin, node: PageNode): Promise<void> {
	const result = await plugin.service.operations.unpairPage(node.id);
	if (!result.ok) new Notice(result.message);
	else if (result.warning) new Notice(result.warning);
}

async function copyLink(plugin: SubPagePlugin, node: PageNode): Promise<void> {
	if (!node.filePath) return;
	const file = plugin.app.vault.getAbstractFileByPath(node.filePath);
	if (!(file instanceof TFile)) {
		new Notice(plugin.t("notice.linkMissing"));
		return;
	}
	const target = plugin.app.metadataCache.fileToLinktext(file, "", true);
	await copyText(plugin, `[[${target}]]`, "notice.linkCopied");
}

async function copyText(plugin: SubPagePlugin, text: string, successKey: "notice.linkCopied" | "notice.pathCopied"): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		new Notice(plugin.t(successKey));
	} catch {
		new Notice(plugin.t("notice.clipboardWriteFailed"));
	}
}

async function openInNewTab(plugin: SubPagePlugin, node: PageNode): Promise<void> {
	if (!node.filePath) return;
	await plugin.app.workspace.openLinkText(node.filePath, "", true);
}

/** 在文件浏览器里定位。走 leaf 视图而不是 `app.internalPlugins`：后者没有类型声明。 */
function revealInExplorer(plugin: SubPagePlugin, node: PageNode): void {
	if (!node.filePath) return;
	const file = plugin.app.vault.getAbstractFileByPath(node.filePath);
	if (!(file instanceof TFile)) return;
	const explorer = plugin.app.workspace.getLeavesOfType("file-explorer")[0];
	const view = explorer?.view as { revealInFolder?: (file: TFile) => void } | undefined;
	view?.revealInFolder?.(file);
}

export async function openPage(plugin: SubPagePlugin, node: PageNode | undefined): Promise<void> {
	if (!node) return;
	if (!node.filePath) return;
	const file = plugin.app.vault.getAbstractFileByPath(node.filePath);
	if (!(file instanceof TFile)) return;
	await plugin.app.workspace.getLeaf(false).openFile(file);
}

export async function requestDelete(plugin: SubPagePlugin, node: PageNode): Promise<void> {
	const operations = plugin.service.operations;
	const run = async (options: { withChildren: boolean; useTrash: boolean }): Promise<void> => {
		const result = await operations.deletePage(node.id, options);
		if (!result.ok) {
			new Notice(result.message);
			return;
		}
		new Notice(plugin.t("notice.deleted", { count: result.value.deletedPages }));
		if (result.warning) new Notice(result.warning);
	};

	if (!plugin.settings.confirmDelete) {
		await run({ withChildren: node.kind !== "leaf", useTrash: true });
		return;
	}
	new DeletePageModal(plugin.app, plugin, node, (options) => void run(options)).open();
}

/** 图标按钮统一入口：aria-label 就是宿主的 tooltip，不要再额外设 title。 */
export function iconButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
	const button = parent.createEl("button", { cls: "sp-icon-button" });
	button.setAttribute("aria-label", label);
	setIcon(button, icon);
	return button;
}
