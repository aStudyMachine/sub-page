import { PageId } from "../models/pageId";
import { PageNode, ScanWarning } from "../models/pageNode";
import { OrderMap } from "../models/pageOrder";
import { childKey } from "./pageOperationService";

export interface OrphanEntry {
	/** 这个条目登记在哪个作用域下，`""` 表示根。 */
	scope: string;
	key: string;
}

export interface StructureReport {
	/** 顺序文件里登记了、磁盘上已经不存在的条目。 */
	orphans: OrphanEntry[];
	/** 同级同名但大小写不同 —— 在大小写敏感与不敏感的系统之间会打架。 */
	conflicts: ScanWarning[];
	/** 超过最大扫描层级，子树没有索引。 */
	deep: ScanWarning[];
	/** 没有同名笔记的目录。按 ADR-0001 它们是合法分组目录，只是**可以**升级为父页面。 */
	groups: PageNode[];
}

export interface StructureInput {
	order: OrderMap;
	getChildren: (scope: PageId | null) => PageNode[];
	warnings: readonly ScanWarning[];
	nodes: readonly PageNode[];
}

/**
 * 结构检查的规则部分，与弹窗分开 —— 这样能直接跑单测，命令面板将来要复用也不必经过 DOM。
 *
 * 这里只**报告**，不改任何东西：删除用户文件必须由人确认。
 */
export function collectStructureIssues(input: StructureInput): StructureReport {
	const orphans: OrphanEntry[] = [];
	for (const [scope, keys] of Object.entries(input.order)) {
		const existing = new Set(input.getChildren(scope === "" ? null : (scope as PageId)).map(childKey));
		for (const key of keys) {
			if (!existing.has(key)) orphans.push({ scope, key });
		}
	}
	return {
		orphans,
		conflicts: input.warnings.filter((warning) => warning.kind === "case-conflict"),
		deep: input.warnings.filter((warning) => warning.kind === "depth-limit"),
		groups: input.nodes.filter((node) => node.kind === "group"),
	};
}

export function isEmptyReport(report: StructureReport): boolean {
	return (
		report.orphans.length === 0 &&
		report.conflicts.length === 0 &&
		report.deep.length === 0 &&
		report.groups.length === 0
	);
}
