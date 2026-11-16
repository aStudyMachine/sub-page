import type { App } from "obsidian";

/**
 * 一次性提示标记。
 *
 * 存在 localStorage 而不是 data.json：这些不是用户配置，写进 data.json 会被
 * 「恢复默认设置」清掉，然后又弹一遍。localStorage 按插件 id 隔离，正好是
 * 「这台机器上这个库」的粒度。
 */
const PREFIX = "sub-page:hint:";

export function hintSeen(app: App, key: string): boolean {
	return app.loadLocalStorage(PREFIX + key) === true;
}

export function markHintSeen(app: App, key: string): void {
	app.saveLocalStorage(PREFIX + key, true);
}
