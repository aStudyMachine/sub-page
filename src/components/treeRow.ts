import { Platform } from "obsidian";
import { PageNode } from "../models/pageNode";
import { PageMetadata, EMPTY_METADATA } from "../models/pageMetadata";
import { renderPageIcon } from "./pageIcon";

export interface RowOptions {
	node: PageNode;
	expanded: boolean;
	current: boolean;
	/** 祖先路径文字，只在搜索结果里显示。 */
	trail?: string;
	metadata?: PageMetadata;
	/** 搜索命中时高亮的片段。 */
	highlight?: string;
}

/** 一行的 DOM 结构，纯构建函数：不订阅事件、不读写任何状态。 */
export function buildRow(options: RowOptions): HTMLElement {
	const { node, expanded, current } = options;
	const row = createDiv({ cls: "sp-row" });
	row.setAttribute("role", "treeitem");
	row.setAttribute("data-id", node.id);
	row.setAttribute("aria-level", String(node.depth));
	row.setAttribute("tabindex", "-1");
	// HTML5 拖放的前提：元素本身可拖。缺了这一条 dragstart 永远不会触发。
	// 移动端用手势排序，不要留下可拖状态。
	if (Platform.isDesktopApp) row.setAttribute("draggable", "true");
	// 模型深度从 1 数起，首层页面在侧栏里没有层级缩进。
	row.style.setProperty("--sp-depth", String(node.depth - 1));
	if (node.childIds.length > 0) row.setAttribute("aria-expanded", String(expanded));
	if (current) row.addClass("is-current");
	if (node.kind === "group") row.addClass("is-group");
	if (node.kind === "parent") row.addClass("is-parent");

	const icon = row.createSpan({ cls: "sp-icon" });
	renderPageIcon(icon, node.kind, options.metadata ?? EMPTY_METADATA);

	const title = row.createSpan({ cls: "sp-title" });
	const highlight = options.highlight?.trim();
	if (highlight) appendHighlighted(title, node.title, highlight);
	else title.setText(node.title);

	if (options.trail) row.createSpan({ cls: "sp-trail", text: options.trail });

	if (node.descendantCount > 0) {
		row.createSpan({ cls: "sp-badge", text: String(node.descendantCount) });
	}
	return row;
}

/** 把命中片段包成 <mark>；大小写不敏感，只高亮第一处。 */
function appendHighlighted(parent: HTMLElement, title: string, needle: string): void {
	const index = title.toLowerCase().indexOf(needle.toLowerCase());
	if (index === -1) {
		parent.setText(title);
		return;
	}
	parent.appendText(title.slice(0, index));
	parent.createEl("mark", { text: title.slice(index, index + needle.length) });
	parent.appendText(title.slice(index + needle.length));
}
