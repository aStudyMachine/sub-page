import { SubPageSort, SubPageView } from "../models/settings";

/**
 * ```subpages 块里能写的键。刻意不用完整 YAML 解析：
 * 块里只有十来个扁平键值，上 yaml 依赖会为了「能写列表/锚点」付出体积与出错面。
 */
export interface SubPageBlockConfig {
	view: SubPageView;
	sort: SubPageSort;
	showIcon: boolean;
	showDescription: boolean;
	/** 卡片视图的列数；列表视图忽略。 */
	columns: number;
	/** 只显示有限条数，0 表示不限。 */
	limit: number;
}

export const DEFAULT_BLOCK_CONFIG: SubPageBlockConfig = {
	view: "list",
	sort: "name",
	showIcon: true,
	showDescription: false,
	columns: 2,
	limit: 0,
};

export interface ParsedBlockConfig {
	config: SubPageBlockConfig;
	/** 认不出的键或不合法的值 —— 只提示，不阻断渲染。 */
	warnings: string[];
}

/**
 * 解析规则：每行 `key: value`，忽略空行与 # 注释，值两侧引号会去掉。
 * 未知键进 warnings 而不是抛错：块是用户手写的，写错一个键不该让整块消失。
 */
export function parseSubPageBlock(
	source: string,
	fallback: Partial<SubPageBlockConfig> = {},
): ParsedBlockConfig {
	// 块里没写的键退回调用方给的默认值（通常来自插件设置的「默认视图 / 默认排序」）。
	const config: SubPageBlockConfig = { ...DEFAULT_BLOCK_CONFIG, ...fallback };
	const warnings: string[] = [];

	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#")) continue;
		const separator = line.indexOf(":");
		if (separator === -1) {
			warnings.push(`无法解析这一行：${line}`);
			continue;
		}
		const key = line.slice(0, separator).trim().toLowerCase();
		const value = unquote(line.slice(separator + 1).trim());

		switch (key) {
			case "view":
				if (value === "list" || value === "card") config.view = value;
				else warnings.push(`view 只能是 list 或 card，收到 "${value}"`);
				break;
			case "sort":
				if (value === "name" || value === "created" || value === "modified" || value === "manual") {
					config.sort = value;
				} else warnings.push(`sort 只能是 name / created / modified / manual，收到 "${value}"`);
				break;
			case "show-icon":
			case "showicon":
				config.showIcon = parseBoolean(value, true, warnings, "show-icon");
				break;
			case "show-description":
			case "showdescription":
				config.showDescription = parseBoolean(value, false, warnings, "show-description");
				break;
			case "columns":
				config.columns = parsePositiveInteger(value, config.columns, warnings, "columns");
				break;
			case "limit":
				config.limit = parseNonNegativeInteger(value, config.limit, warnings, "limit");
				break;
			case "":
				warnings.push(`无法解析这一行：${line}`);
				break;
			default:
				warnings.push(`不认识的键：${key}`);
		}
	}
	return { config, warnings };
}

function unquote(value: string): string {
	if (value.length >= 2) {
		const first = value[0];
		const last = value[value.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			return value.slice(1, -1);
		}
	}
	return value;
}

function parseBoolean(value: string, fallback: boolean, warnings: string[], key: string): boolean {
	if (value === "true" || value === "yes" || value === "1") return true;
	if (value === "false" || value === "no" || value === "0") return false;
	warnings.push(`${key} 只能是 true 或 false，收到 "${value}"`);
	return fallback;
}

function parsePositiveInteger(value: string, fallback: number, warnings: string[], key: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		warnings.push(`${key} 需要是正整数，收到 "${value}"`);
		return fallback;
	}
	return parsed;
}

function parseNonNegativeInteger(value: string, fallback: number, warnings: string[], key: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) {
		warnings.push(`${key} 需要是非负整数，收到 "${value}"`);
		return fallback;
	}
	return parsed;
}
