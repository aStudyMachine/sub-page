import { PageTreeSnapshot } from "../models/pageNode";
import { OrderMap } from "../models/pageOrder";

/**
 * 诊断信息：用户报障时最缺的是「你那边到底长什么样」。
 * 一次输出环境与结构统计，比来回问十句快。
 *
 * 不输出任何笔记正文、绝对路径与文件名 —— 只需看出规模与结构是否异常，
 * 报障时可以直接贴出来而不泄露库内容。
 */
export interface DiagnosticsInput {
	pluginVersion: string;
	/** 宿主版本，来自 `app.appVersion`。 */
	appVersion: string;
	platform: string;
	language: string;
	settings: {
		pageRoot: string;
		defaultView: string;
		defaultSort: string;
		showEmptyFolders: boolean;
		excludedFolders: string[];
	};
	snapshot: PageTreeSnapshot;
	order: OrderMap;
	orderProblem: string | null;
	/** 顺序文件的作用域数量，用来判断顺序表是否膨胀。 */
	expandedCount: number;
	/** 已知会改写同一份结构的插件（Folder Note / Waypoint 之类）。 */
	conflictingPlugins: string[];
	/** 最近一次整树扫描耗时（毫秒），规模问题最先看这个数。 */
	scanMs: number | null;
}

export function buildDiagnostics(input: DiagnosticsInput): string {
	const { snapshot } = input;
	const nodes = Array.from(snapshot.nodes.values());
	const parents = nodes.filter((node) => node.kind === "parent").length;
	const leaves = nodes.filter((node) => node.kind === "leaf").length;
	const groups = nodes.filter((node) => node.kind === "group").length;
	const deepest = nodes.reduce((max, node) => Math.max(max, node.depth), 0);
	const maxDepth = nodes.reduce((max, node) => Math.max(max, node.childIds.length), 0);
	const orderScopes = Object.keys(input.order);
	const orderEntries = orderScopes.reduce((total, scope) => total + input.order[scope].length, 0);

	const lines = [
		"## Sub Page 诊断信息",
		"",
		`- 插件版本：${input.pluginVersion}`,
		`- 宿主版本：${input.appVersion}`,
		`- 平台：${input.platform}`,
		`- 界面语言：${input.language}`,
		"",
		"### 设置",
		`- 页面根：${input.settings.pageRoot === "" ? "（库根）" : "自定义"} `,
		`- 默认视图 / 排序：${input.settings.defaultView} / ${input.settings.defaultSort}`,
		`- 显示空目录：${input.settings.showEmptyFolders ? "是" : "否"}`,
		`- 排除目录：${input.settings.excludedFolders.join("、") || "（无）"}`,
		"",
		"### 结构统计",
		`- 页面：${parents + leaves}（父页面 ${parents} / 叶子页面 ${leaves}）`,
		`- 分组目录：${groups}`,
		`- 目录总数：${snapshot.folderCount}`,
		`- 最深层级：${deepest}`,
		`- 单个页面最多子项：${maxDepth}`,
		`- 展开状态条目：${input.expandedCount}`,
		"",
		"### 顺序文件",
		`- 作用域 ${orderScopes.length} 个，条目 ${orderEntries} 条`,
		`- 读取状态：${input.orderProblem ?? "正常"}`,
		"",
		"### 性能",
		`- 最近一次扫描：${input.scanMs === null ? "（未记录）" : `${input.scanMs} ms`}`,
		"",
		"### 插件冲突",
	];
	if (input.conflictingPlugins.length === 0) {
		lines.push("- 未发现会改写同一份结构的插件");
	} else {
		for (const id of input.conflictingPlugins) {
			lines.push(`- ${id}：与本插件都会把「同名笔记 + 目录」当成一层页面`);
		}
	}
	lines.push("", "### 扫描警告");
	if (snapshot.warnings.length === 0) {
		lines.push("- 无");
	} else {
		for (const warning of snapshot.warnings) {
			// 警告里的路径可能带笔记名，只保留类型与消息，避免泄露内容。
			lines.push(`- ${warning.kind}：${warning.message}`);
		}
	}
	return lines.join("\n");
}
