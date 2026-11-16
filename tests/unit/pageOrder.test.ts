import { describe, expect, it } from "vitest";
import { naturalCompare } from "../../src/utils/naturalSort";
import { orderChildren } from "../../src/models/pageOrder";

describe("自然排序", () => {
	it("数字按数值比较", () => {
		const sorted = ["第10章", "第2章", "第1章"].sort(naturalCompare);
		expect(sorted).toEqual(["第1章", "第2章", "第10章"]);
	});

	it("大小写差异不影响次序，但结果稳定", () => {
		expect(naturalCompare("apple", "Apple")).not.toBe(0);
		const a = ["b", "A", "a"].sort(naturalCompare);
		const b = ["A", "a", "b"].sort(naturalCompare);
		expect(a).toEqual(b);
	});
});

describe("顺序应用", () => {
	const children = ["A.md", "B.md", "C.md", "D.md"].map((key) => ({ key }));

	it("未列出的子项排在已列出项之后并保持原相对次序", () => {
		const result = orderChildren(children, ["C.md", "A.md"]).map((c) => c.key);
		expect(result).toEqual(["C.md", "A.md", "B.md", "D.md"]);
	});

	it("没有顺序时原样返回", () => {
		expect(orderChildren(children, undefined).map((c) => c.key)).toEqual(["A.md", "B.md", "C.md", "D.md"]);
		expect(orderChildren(children, []).map((c) => c.key)).toEqual(["A.md", "B.md", "C.md", "D.md"]);
	});

	it("顺序里已被删除的条目被忽略", () => {
		const result = orderChildren(children, ["已删除.md", "B.md"]).map((c) => c.key);
		expect(result).toEqual(["B.md", "A.md", "C.md", "D.md"]);
	});
});
