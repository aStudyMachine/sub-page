import { PageId } from "./pageId";
import { PageMetadata } from "./pageMetadata";

/**
 * 页面树里的三种节点（ADR-0001）。配对是可选升级动作，不是存在前提 ——
 * 现有库零配对也必须能直接成树。
 */
export type NodeKind = "parent" | "leaf" | "group";

export interface PageNode {
	id: PageId;
	kind: NodeKind;
	/** 显示名：文件节点去掉 .md，目录节点取最后一段。 */
	title: string;
	depth: number;
	/** null 表示直接挂在页面根下。 */
	parentId: PageId | null;
	/** 已按顺序文件排好序的子节点。 */
	childIds: PageId[];
	/** 可直接打开的笔记路径；分组目录没有。 */
	filePath: string | null;
	/** 容纳子页面的目录；叶子页面为自己的父目录。 */
	folderPath: string;
	metadata: PageMetadata;
	/** 递归子页面数量，用于徽标与删除确认。 */
	descendantCount: number;
	/** 文件时间戳；分组目录为 0。正文块按 created / modified 排序时用。 */
	modifiedAt: number;
	createdAt: number;
}

export type ScanWarningKind =
	| "depth-limit"
	| "case-conflict"
	| "read-error"
	| "unpaired-folder";

export interface ScanWarning {
	kind: ScanWarningKind;
	path: string;
	message: string;
}

export interface PageTreeSnapshot {
	pageRoot: string;
	rootMissing: boolean;
	nodes: Map<PageId, PageNode>;
	roots: PageId[];
	warnings: ScanWarning[];
	folderCount: number;
	createdAt: number;
}

export function isPageNode(node: PageNode): boolean {
	return node.kind !== "group";
}
