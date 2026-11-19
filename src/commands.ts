import { Notice } from "obsidian";
import type SubPagePlugin from "./main";
import { openCreate } from "./components/pageContextMenu";
import { PAGE_TREE_VIEW_TYPE, PageTreeView } from "./views/pageTreeView";
import { StructureModal } from "./modals/structureModal";

/**
 * 命令面板。语言切换后会整组重建（`refreshLanguage()` 调这里），
 * 所以必须先 removeCommand，否则宿主里会留下旧语言的重复条目。
 */
let registeredIds: string[] = [];

export function registerCommands(plugin: SubPagePlugin): void {
	// removeCommand 收的是不带插件前缀的 id（addCommand 会自动加前缀）。
	for (const id of registeredIds) plugin.removeCommand(id);
	registeredIds = [];

	const add = (id: string, name: string, run: () => void, enabled?: () => boolean): void => {
		plugin.addCommand({
			// id 不带前缀，宿主会拼成 sub-page:<id>。
			id,
			name,
			// 有 enabled 时必须用 checkCallback 承担执行：宿主只调其中一个。
			checkCallback: enabled
				? (checking: boolean) => {
						if (!enabled()) return false;
						if (!checking) run();
						return true;
					}
				: undefined,
			callback: enabled ? undefined : run,
		});
		registeredIds.push(id);
	};

	const treeView = (): PageTreeView | undefined => {
		for (const leaf of plugin.app.workspace.getLeavesOfType(PAGE_TREE_VIEW_TYPE)) {
			if (leaf.view instanceof PageTreeView) return leaf.view;
		}
		return undefined;
	};

	add("open", plugin.t("cmd.open"), () => void plugin.activateTree());
	add("new-root", plugin.t("cmd.newRootPage"), () => openCreate(plugin, null));
	add("new-child", plugin.t("cmd.newChildPage"), () => {
		const current = plugin.currentPage();
		openCreate(plugin, current?.id ?? null);
	});
	// 从别处跳回来时不该自己在一棵树里找：先把面板开起来，再展开祖先链并聚焦到当前行。
	add("reveal-current", plugin.t("cmd.revealCurrent"), () => {
		void plugin.activateTree().then(() => treeView()?.revealCurrent());
	}, () => plugin.currentPage() !== undefined);
	add("expand-all", plugin.t("cmd.expandAll"), () => treeView()?.expandAll(), () => treeView() !== undefined);
	add("collapse-all", plugin.t("cmd.collapseAll"), () => treeView()?.collapseAll(), () => treeView() !== undefined);
	add("rebuild-index", plugin.t("cmd.rebuildIndex"), () => {
		void plugin.refreshIndex().then(() => {
			new Notice(plugin.t("notice.rebuilt", { count: plugin.service.stats().pages }));
		});
	});
	add("check-structure", plugin.t("cmd.checkStructure"), () => new StructureModal(plugin.app, plugin).open());
	// 报障时最省事的形式是「贴一段文本」，所以直接复制到剪贴板，同时弹一个可复制的面板。
	add("diagnostics", plugin.t("cmd.diagnostics"), () => void plugin.copyDiagnostics());
	// 与原生文件浏览器并存意味着同一份目录会出现两次。给一个一键折叠的命令，
	// 而不是替用户改掉原生设置 —— 想同时看两边的人不该被强扭。
	add("collapse-native", plugin.t("cmd.collapseNative"), () => {
		const explorer = plugin.app.workspace.getLeavesOfType("file-explorer")[0];
		if (explorer) plugin.app.workspace.leftSplit.collapse();
	}, () => plugin.app.workspace.getLeavesOfType("file-explorer").length > 0);
}
