/** 页面元数据取自笔记自身的 Properties，不复制到插件数据里（避免双重事实源）。 */
export interface PageMetadata {
	icon?: string;
	description?: string;
}

export const EMPTY_METADATA: PageMetadata = {};

/**
 * 从 front matter 里挑出我们认识的键。icon 支持两种形式：
 *   icon: "📁"         → 原样显示
 *   icon: "lucide:box" → 交给宿主的图标渲染
 */
export function metadataFromFrontMatter(frontmatter: Record<string, unknown> | null | undefined): PageMetadata {
	if (!frontmatter) return EMPTY_METADATA;
	const icon = frontmatter.icon;
	const description = frontmatter.description;
	const result: PageMetadata = {};
	if (typeof icon === "string" && icon.trim().length > 0) {
		result.icon = icon.trim();
	}
	if (typeof description === "string" && description.trim().length > 0) {
		result.description = description.trim();
	}
	return result;
}
