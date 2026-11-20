import { setIcon } from "obsidian";
import { PageMetadata } from "../models/pageMetadata";
import { NodeKind } from "../models/pageNode";

/** 使用宿主图标，靠叠页、目录和单页的轮廓区分三种节点。 */
const DEFAULT_ICON: Record<NodeKind, string> = {
	parent: "files",
	group: "folder",
	leaf: "file",
};

const LUCIDE_PREFIX = "lucide:";

/**
 * 图标支持两种写法：emoji 原样显示，\`lucide:xxx\` 交给宿主渲染。
 * 不认识的写法也按文本显示 —— 用户写了 \`icon: 待办\` 就该看到「待办」，而不是一个破图标。
 */
export function renderPageIcon(el: HTMLElement, kind: NodeKind, metadata: PageMetadata): void {
	el.empty();
	el.removeClass("sp-icon-lucide", "sp-icon-default");
	const icon = metadata.icon;
	if (icon && !icon.startsWith(LUCIDE_PREFIX)) {
		el.setText(icon);
		return;
	}
	if (icon) setIcon(el, icon.slice(LUCIDE_PREFIX.length).trim());
	// 父页面图标同时是展开入口，无效的自定义图标也需要保留可点击的轮廓。
	if (!el.hasChildNodes()) {
		setIcon(el, DEFAULT_ICON[kind]);
		el.addClass("sp-icon-default");
	}
	el.addClass("sp-icon-lucide");
}
