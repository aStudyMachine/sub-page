/**
 * 顺序文件的内存形态：作用域 ID → 子项 key 数组（key 是不带路径的文件名/目录名，
 * 文件保留 .md）。存名称不存索引，所以改名只替换一个元素、移动只跨数组搬运、
 * 一次拖拽只写一个文件（ADR-0004）。
 */
export type OrderMap = Record<string, string[]>;

export const EMPTY_ORDER: OrderMap = {};

/** 未登记的子项按自然排序排在已登记项之后 —— 手工新建的文件不会因此消失。 */
export function orderChildren<T extends { key: string }>(children: T[], keys: string[] | undefined): T[] {
	if (!keys || keys.length === 0) return children;
	const rank = new Map<string, number>();
	keys.forEach((key, index) => {
		if (!rank.has(key)) rank.set(key, index);
	});
	return children
		.map((child, index) => ({ child, index, rank: rank.get(child.key) }))
		.sort((a, b) => {
			const ar = a.rank ?? Number.POSITIVE_INFINITY;
			const br = b.rank ?? Number.POSITIVE_INFINITY;
			if (ar !== br) return ar - br;
			return a.index - b.index;
		})
		.map((entry) => entry.child);
}
