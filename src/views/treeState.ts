import { PageId } from "../models/pageId";
import { PageNode } from "../models/pageNode";

/**
 * 侧栏的可见行与键盘焦点，是纯状态机：给一个索引快照与展开集合，
 * 算出「现在屏幕上从上到下有哪些行」。视图层只负责画，不自己算遍历。
 *
 * 单独拆出来的理由：树遍历与键盘导航最容易出错，而在 node 里能直接单测。
 */

export interface TreeRowModel {
	node: PageNode;
	expanded: boolean;
	/** 祖先是否全部展开过 —— 用来判断某个 id 是否真的可见。 */
	visible: boolean;
}

export interface FlattenOptions {
	getChildren(id: PageId | null): PageNode[];
	getRoots(): PageNode[];
	expanded: ReadonlySet<string>;
}

/** 深度优先展开成扁平列表；折叠的节点不往下走。 */
export function flattenTree(options: FlattenOptions): PageNode[] {
	const rows: PageNode[] = [];
	const walk = (nodes: PageNode[]): void => {
		for (const node of nodes) {
			rows.push(node);
			if (node.childIds.length > 0 && options.expanded.has(node.id)) {
				walk(options.getChildren(node.id));
			}
		}
	};
	walk(options.getRoots());
	return rows;
}

/**
 * 键盘导航。上下移动只走可见行；左右是「展开/折叠」而不是「跳到父/子」，
 * 这样和文件浏览器、以及 aria tree 的习惯一致。
 */
export type NavKey = "up" | "down" | "left" | "right" | "home" | "end";

export interface NavResult {
	focusId: PageId | null;
	/** 需要改变展开状态时给出新值，视图据此落盘；null 表示不动。 */
	expanded: boolean | null;
}

export function navigate(rows: PageNode[], currentId: string | null, key: NavKey, expanded: ReadonlySet<string>): NavResult {
	if (rows.length === 0) return { focusId: null, expanded: null };
	const index = currentId ? rows.findIndex((row) => row.id === currentId) : -1;
	const target = index === -1 ? rows[0] : rows[index];

	switch (key) {
		case "up": {
			if (index <= 0) return { focusId: rows[0].id, expanded: null };
			return { focusId: rows[index - 1].id, expanded: null };
		}
		case "down": {
			if (index === -1) return { focusId: rows[0].id, expanded: null };
			if (index >= rows.length - 1) return { focusId: rows[rows.length - 1].id, expanded: null };
			return { focusId: rows[index + 1].id, expanded: null };
		}
		case "home":
			return { focusId: rows[0].id, expanded: null };
		case "end":
			return { focusId: rows[rows.length - 1].id, expanded: null };
		case "right": {
			if (target.childIds.length === 0) return { focusId: target.id, expanded: null };
			// 已展开：进入第一个子节点（树控件的通行行为）。
			if (expanded.has(target.id)) {
				return { focusId: rows[index + 1]?.id ?? target.id, expanded: null };
			}
			return { focusId: target.id, expanded: true };
		}
		case "left": {
			if (target.childIds.length > 0 && expanded.has(target.id)) {
				return { focusId: target.id, expanded: false };
			}
			// 已折叠或没有子节点：跳到父节点。
			return { focusId: target.parentId ?? target.id, expanded: null };
		}
	}
}

/**
 * 展开祖先链 —— 定位到某个深层页面时，它的祖先都必须是展开的，否则它仍然看不见。
 * 这里不查索引，调用方传祖先 id 链即可，避免把索引依赖带进这个纯模块。
 */
export function expandAncestors(expanded: Set<string>, ancestorIds: readonly string[]): Set<string> {
	const next = new Set(expanded);
	for (const id of ancestorIds) next.add(id);
	return next;
}

/** 索引变化后清理不存在的 id：页面被删了，展开状态不该永久留脏数据。 */
export function pruneExpanded(expanded: Set<string>, existing: ReadonlySet<string>): Set<string> {
	const next = new Set<string>();
	for (const id of expanded) {
		if (existing.has(id)) next.add(id);
	}
	return next;
}
