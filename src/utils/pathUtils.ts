/**
 * 路径原语。全项目只有这里可以做字符串层面上的路径运算：
 * 业务模块一律通过 PageId / vaultPath 转换，不自行拼 "/"。
 *
 * vault path 用 "/" 分隔、相对 vault 根、不带前导斜杠。
 * 大小写比较统一忽略大小写：库跑在 Windows 上时 a/b 与 A/B 是同一个位置，
 * 宁可多拒一次移动，也不要写出两个只差大小写的目录。
 */

export function normalizePath(input: string): string {
	if (!input) return "";
	return input
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/^\/+|\/+$/g, "");
}

export function basename(path: string): string {
	const normalized = normalizePath(path);
	if (normalized === "") return "";
	const index = normalized.lastIndexOf("/");
	return index === -1 ? normalized : normalized.slice(index + 1);
}

export function dirname(path: string): string {
	const normalized = normalizePath(path);
	const index = normalized.lastIndexOf("/");
	return index === -1 ? "" : normalized.slice(0, index);
}

export function joinPath(...parts: string[]): string {
	return normalizePath(
		parts
			.map((part) => normalizePath(part))
			.filter((part) => part.length > 0)
			.join("/"),
	);
}

/** 去掉 .md 扩展名；大小写不敏感（用户可能存 .MD）。 */
export function stripExtension(name: string): string {
	return name.replace(/\.md$/i, "");
}

export function isMarkdownFile(name: string): boolean {
	return /\.md$/i.test(name);
}

export function equalsPath(a: string, b: string): boolean {
	return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

/**
 * path 是否等于 ancestor 或位于其下。
 * ancestor 为空串表示 vault 根，任何路径都在其下。
 */
export function isSameOrDescendantPath(path: string, ancestor: string): boolean {
	const target = normalizePath(path).toLowerCase();
	const base = normalizePath(ancestor).toLowerCase();
	if (base === "") return true;
	return target === base || target.startsWith(base + "/");
}

/** 相对路径的深度："" = 0，"a" = 1，"a/b" = 2。 */
export function pathDepth(path: string): number {
	const normalized = normalizePath(path);
	return normalized === "" ? 0 : normalized.split("/").length;
}
