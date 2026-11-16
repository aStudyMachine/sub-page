import { MarkdownPostProcessorContext, MarkdownRenderChild } from "obsidian";
import type SubPagePlugin from "../main";
import { PageNode } from "../models/pageNode";
import { PageId } from "../models/pageId";
import { parseSubPageBlock, SubPageBlockConfig } from "../utils/subPageConfigParser";
import { renderPageIcon } from "../components/pageIcon";
import { openCreate, openPage } from "../components/pageContextMenu";

export const SUBPAGES_LANGUAGE = "subpages";

/**
 * 正文里的 ```subpages 块：列出「当前笔记所在页面」的子页面。
 *
 * 定位只用 ctx.sourcePath —— 它指向这段代码块所属的笔记文件。
 * 不能用 workspace.getActiveFile()：那样在预览、导出、多标签页时都会指错页面。
 */
export function registerSubPageBlockProcessor(plugin: SubPagePlugin): boolean {
	try {
		plugin.registerMarkdownCodeBlockProcessor(
			SUBPAGES_LANGUAGE,
			(source, el, ctx) => renderBlock(plugin, source, el, ctx),
			-100,
		);
		return true;
	} catch (error) {
		// 同一语言被别的插件先注册了：宿主会抛错，这里降级为不接管而不是让插件加载失败。
		console.warn("[sub-page] 无法注册 subpages 代码块：", error);
		return false;
	}
}

function renderBlock(
	plugin: SubPagePlugin,
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	const { config, warnings } = parseSubPageBlock(source, {
		view: plugin.settings.defaultView,
		sort: plugin.settings.defaultSort,
	});
	if (warnings.length > 0 && plugin.settings.debugLog) {
		console.warn("[sub-page] subpages 块配置有问题：", warnings);
	}
	el.addClass("sp-block");
	el.empty();

	const draw = (): void => {
		const node = plugin.service.nodeForSourcePath(ctx.sourcePath);
		if (!node) {
			el.createDiv({ cls: "sp-block-note", text: plugin.t("block.notAPage") });
			return;
		}
		const children = sortChildren(plugin.service.getChildren(node.id), config.sort);
		const shown = config.limit > 0 ? children.slice(0, config.limit) : children;
		if (shown.length === 0) {
			const empty = el.createDiv({ cls: "sp-block-empty" });
			empty.createSpan({ text: plugin.t("block.empty") });
			const create = empty.createEl("button", { text: plugin.t("block.create"), cls: "mod-cta" });
			create.addEventListener("click", () => openCreate(plugin, node.id));
			return;
		}
		const header = el.createDiv({ cls: "sp-block-header" });
		header.createSpan({ cls: "sp-block-count", text: plugin.t("block.count", { count: children.length }) });
		if (config.view === "card") {
			renderCards(plugin, el, shown, config);
		} else {
			renderList(plugin, el, shown, config);
		}
	};

	draw();

	// 索引变了要重画。用 MarkdownRenderChild 挂生命周期：预览关闭时宿主会调 onunload，
	// 那时才把刷新回调摘掉，否则每次打开预览都往插件里积一份闭包。
	const refresher = (): void => {
		el.empty();
		draw();
	};
	plugin.registerBlockRefresher(refresher);
	ctx.addChild(
		new (class extends MarkdownRenderChild {
			onunload(): void {
				plugin.unregisterBlockRefresher(refresher);
			}
		})(el),
	);
}

/** `manual` 保持索引顺序（即顺序文件的结果），其余按对应字段重排。 */
function sortChildren(nodes: PageNode[], sort: SubPageBlockConfig["sort"]): PageNode[] {
	if (sort === "manual") return nodes;
	if (sort === "created") return [...nodes].sort((a, b) => b.createdAt - a.createdAt);
	if (sort === "modified") return [...nodes].sort((a, b) => b.modifiedAt - a.modifiedAt);
	return nodes;
}

function renderList(
	plugin: SubPagePlugin,
	el: HTMLElement,
	nodes: PageNode[],
	config: SubPageBlockConfig,
): void {
	const list = el.createDiv({ cls: "sp-block-list" });
	for (const node of nodes) {
		const row = list.createDiv({ cls: "sp-block-row" });
		row.addEventListener("click", () => void openPage(plugin, node));
		if (config.showIcon) {
			const icon = row.createSpan({ cls: "sp-icon" });
			renderPageIcon(icon, node.kind, node.metadata);
		}
		row.createSpan({ cls: "sp-block-title", text: node.title });
		if (config.showDescription) {
			// 描述来自 frontmatter，主线程同步读不到 —— 先占位，读到再填。
			void plugin.service.metadataFor(node.id).then((metadata) => {
				if (!metadata.description) return;
				row.createSpan({ cls: "sp-block-desc", text: metadata.description });
			});
		}
	}
}

function renderCards(
	plugin: SubPagePlugin,
	el: HTMLElement,
	nodes: PageNode[],
	config: SubPageBlockConfig,
): void {
	const grid = el.createDiv({ cls: "sp-block-cards" });
	grid.style.setProperty("--sp-columns", String(Math.max(1, config.columns)));
	for (const node of nodes) {
		const card = grid.createDiv({ cls: "sp-card" });
		card.addEventListener("click", () => void openPage(plugin, node));
		if (config.showIcon) {
			const icon = card.createDiv({ cls: "sp-icon" });
			renderPageIcon(icon, node.kind, node.metadata);
		}
		card.createDiv({ cls: "sp-card-title", text: node.title });
		if (config.showDescription) {
			void plugin.service.metadataFor(node.id).then((metadata) => {
				if (!metadata.description) return;
				card.createDiv({ cls: "sp-card-desc", text: metadata.description });
			});
		}
		if (node.descendantCount > 0) {
			card.createDiv({ cls: "sp-card-badge", text: String(node.descendantCount) });
		}
	}
}
