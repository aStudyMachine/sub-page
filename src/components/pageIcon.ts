import { setIcon } from "obsidian";
import { PageMetadata } from "../models/pageMetadata";
import { NodeKind } from "../models/pageNode";

/** 没有自定义图标时的兜底：靠形状区分「能放子页面」「只是分组」「普通页面」。 */
const DEFAULT_ICON: Record<NodeKind, string> = {
	parent: "📘",
	group: "📁",
	leaf: "📄",
};

const LUCIDE_PREFIX = "lucide:";

/**
 * 图标支持两种写法：emoji 原样显示，\`lucide:xxx\` 交给宿主渲染。
 * 不认识的写法也按文本显示 —— 用户写了 \`icon: 待办\` 就该看到「待办」，而不是一个破图标。
 */
export function renderPageIcon(el: HTMLElement, kind: NodeKind, metadata: PageMetadata): void {
	el.empty();
	el.removeClass("sp-icon-lucide");
	const icon = metadata.icon;
	if (icon && icon.startsWith(LUCIDE_PREFIX)) {
		setIcon(el, icon.slice(LUCIDE_PREFIX.length).trim());
		// 侧栏的父页面图标同时是展开入口，宿主未渲染时仍需显示图标。
		if (el.hasChildNodes()) el.addClass("sp-icon-lucide");
		else el.setText(DEFAULT_ICON[kind]);
		return;
	}
	el.setText(icon ?? DEFAULT_ICON[kind]);
}
