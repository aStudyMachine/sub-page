import type { App } from "obsidian";

/**
 * 会与「同名笔记 + 目录 = 一层页面」这套模型互相踩踏的插件。
 * 只认已知的几个 id 前缀：宁可漏报，也不要把无关插件吓一遍。
 */
const CONFLICT_PATTERNS = [/^obsidian-folder-note/i, /^folder-notes?/i, /^obsidian-folder-notes/i, /^waypoint/i];

/** `App.plugins` 没有类型声明，只能窄化后读。 */
type AppWithPlugins = App & { plugins?: { enabledPlugins?: Record<string, boolean> } };

/** 列出已启用的冲突插件。只读，不改别人的启用状态 —— 那是用户的选择。 */
export function findConflictingPlugins(app: App): string[] {
	const enabled = (app as AppWithPlugins).plugins?.enabledPlugins ?? {};
	return Object.keys(enabled).filter((id) => CONFLICT_PATTERNS.some((pattern) => pattern.test(id)));
}
