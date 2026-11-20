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
	const input = raw && typeof raw === "object" && !Array.isArray(raw)
		? raw as Record<string, unknown>
		: {};
	const settings: SubPageSettings = {
		pageRoot: typeof input.pageRoot === "string" ? input.pageRoot : DEFAULT_SETTINGS.pageRoot,
		defaultView: input.defaultView === "card" ? "card" : DEFAULT_SETTINGS.defaultView,
		defaultSort: input.defaultSort === "created" || input.defaultSort === "modified" || input.defaultSort === "manual"
			? input.defaultSort : DEFAULT_SETTINGS.defaultSort,
		showEmptyFolders: typeof input.showEmptyFolders === "boolean" ? input.showEmptyFolders : DEFAULT_SETTINGS.showEmptyFolders,
		collapseEmptyParents: typeof input.collapseEmptyParents === "boolean" ? input.collapseEmptyParents : DEFAULT_SETTINGS.collapseEmptyParents,
		confirmDelete: typeof input.confirmDelete === "boolean" ? input.confirmDelete : DEFAULT_SETTINGS.confirmDelete,
		templatePath: typeof input.templatePath === "string" ? input.templatePath : DEFAULT_SETTINGS.templatePath,
		language: input.language === "zh" || input.language === "en" ? input.language : DEFAULT_SETTINGS.language,
		expandedIds: stringList(input.expandedIds),
		excludedFolders: stringList(input.excludedFolders),
		debugLog: typeof input.debugLog === "boolean" ? input.debugLog : DEFAULT_SETTINGS.debugLog,
	};
	const changed = Object.entries(settings).some(([key, next]) => {
		const previous = input[key];
		if (Array.isArray(next)) return !Array.isArray(previous) || next.length !== previous.length;
		return next !== previous;
	});
	return { settings, changed };
}

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item: unknown): item is string => typeof item === "string") : [];
}
