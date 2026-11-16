import { basename, joinPath, normalizePath, stripExtension } from "../utils/pathUtils";

/**
 * 页面标识。刻意做成不透明品牌类型：业务代码不该解析它的内部结构，
 * 路径 ⇄ 标识的换算只允许出现在本文件（ADR-0002）。
 *
 * 编码规则（当前实现，可替换）：
 *   - 目录型节点（父页面、分组目录）→ 相对页面根的目录路径，如 "项目A"
 *   - 文件型节点（叶子页面）        → 相对页面根的 .md 路径，如 "Java/jvm/堆内存.md"
 * 两种形态天然不冲突：同名目录与同名文件可以并存，id 不同。
 *
 * "" 不是页面，而是「页面根的直属作用域」的标识（顺序文件的根键）。
 */
export type PageId = string & { readonly __brand: "PageId" };

export const ROOT_SCOPE = "" as PageId;

export function toPageId(raw: string): PageId {
	return normalizePath(raw) as PageId;
}

export function isRootScope(id: PageId | null | undefined): boolean {
	return !id || id === ROOT_SCOPE;
}

/** 节点的显示名：文件节点去掉 .md，目录节点取最后一段。 */
export function nameOf(id: PageId): string {
	return stripExtension(basename(id));
}

/** id 的最后一段，保留扩展名，用于构造 vault 路径。 */
export function keyOf(id: PageId): string {
	return basename(id);
}

/** id 是否代表一个文件（叶子页面）。 */
export function isFileId(id: PageId): boolean {
	return /.md$/i.test(id);
}

export function scopeOf(id: PageId): PageId {
	const parent = id.slice(0, Math.max(0, id.lastIndexOf("/")));
	return parent as PageId;
}

export function childIdOf(parent: PageId | null, name: string): PageId {
	return joinPath(parent ?? "", name) as PageId;
}
