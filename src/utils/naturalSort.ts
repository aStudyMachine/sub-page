/**
 * 人类习惯的排序：数字按数值比较（第2章 < 第10章），中文按拼音，
 * 大小写与全半角差异不参与比较（sensitivity: "base"）。
 */
const collator = new Intl.Collator("zh", { numeric: true, sensitivity: "base" });

export function naturalCompare(a: string, b: string): number {
	const result = collator.compare(a, b);
	if (result !== 0) return result;
	// 比较结果相等但原文不同（大小写 / 全半角）时给出稳定的次序，避免排序抖动。
	return a < b ? -1 : a > b ? 1 : 0;
}
