export type SubPageView = "list" | "card";
export type SubPageSort = "name" | "created" | "modified" | "manual";

export interface SubPageSettings {
	pageRoot: string;
	defaultView: SubPageView;
	defaultSort: SubPageSort;
	showEmptyFolders: boolean;
	collapseEmptyParents: boolean;
	confirmDelete: boolean;
	templatePath: string;
	language: "auto" | "zh" | "en";
	/** 展开中的页面 ID，索引重建后按 ID 恢复。 */
	expandedIds: string[];
	/** 额外排除的目录名（不区分大小写）。 */
	excludedFolders: string[];
	debugLog: boolean;
}

export const DEFAULT_SETTINGS: SubPageSettings = {
	pageRoot: "",
	defaultView: "list",
	defaultSort: "name",
	showEmptyFolders: false,
	collapseEmptyParents: true,
	confirmDelete: true,
	templatePath: "",
	language: "auto",
	expandedIds: [],
	excludedFolders: [],
	debugLog: false,
};

export const EXCLUDED_FOLDER_DEFAULTS = ["_assets", "attachments", "assets", "images", "node_modules"];

export interface MigrationResult {
	settings: SubPageSettings;
	changed: boolean;
}

/**
 * 设置迁移。当前只有一个版本，这层存在是为了第一次改字段名时能改数据而不是静默重置。
 * 只做「字段名 → 新字段名」「缺省值补齐」这类无信息损失的迁移；不猜用户意图。
 */
export function migrateSettings(raw: unknown): MigrationResult {
	const input = (raw ?? {}) as Record<string, unknown>;
	const settings: SubPageSettings = { ...DEFAULT_SETTINGS };
	let changed = false;

	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof SubPageSettings)[]) {
		const value = input[key];
		if (value === undefined) {
			changed = true;
			continue;
		}
		if (Array.isArray(DEFAULT_SETTINGS[key])) {
			if (Array.isArray(value)) {
				(settings as unknown as Record<string, unknown>)[key] = value.filter((item) => typeof item === "string");
			} else {
				changed = true;
			}
			continue;
		}
		if (typeof value === typeof DEFAULT_SETTINGS[key]) {
			(settings as unknown as Record<string, unknown>)[key] = value;
		} else {
			changed = true;
		}
	}
	return { settings, changed };
}
