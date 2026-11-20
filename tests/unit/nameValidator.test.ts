import { describe, expect, it } from "vitest";
import { checkName, isScannableName } from "../../src/utils/nameValidator";

describe("名称校验", () => {
	it("接受普通、中文、空格、全角标点", () => {
		for (const name of ["项目A", "堆内存 与 GC", "你好，世界", "a-b_c", "第 2 章"]) {
			expect(checkName(name).ok).toBe(true);
		}
	});

	it("拒绝空名与纯空格", () => {
		expect(checkName("").problem).toBe("empty");
		expect(checkName("   ").problem).toBe("empty");
	});

	it("拒绝路径分隔符与非法字符", () => {
		for (const name of ["a/b", "a\\b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a|b"]) {
			expect(checkName(name).problem).toBe("illegal-char");
		}
	});

	it("校验和扫描都会拒绝 32 个控制字符", () => {
		for (let code = 0; code < 32; code++) {
			const character = String.fromCharCode(code);
			const name = "a" + character + "b";
			expect(checkName(name)).toMatchObject({ problem: "illegal-char", detail: character });
			expect(isScannableName(name)).toBe(false);
		}
	});

	it("拒绝 . 与 ..", () => {
		expect(checkName(".").problem).toBe("dot-name");
		expect(checkName("..").problem).toBe("dot-name");
	});

	it("拒绝首尾空格与结尾点", () => {
		expect(checkName(" a").problem).toBe("edge-dot-or-space");
		expect(checkName("a.").problem).toBe("edge-dot-or-space");
	});

	it("拒绝 Windows 保留名（含带扩展名）", () => {
		expect(checkName("con").problem).toBe("reserved");
		expect(checkName("NUL.md").problem).toBe("reserved");
	});

	it("拒绝超长名", () => {
		expect(checkName("a".repeat(101)).problem).toBe("too-long");
		expect(checkName("a".repeat(100)).ok).toBe(true);
	});

	it("扫描用宽松判定只挡真正破坏路径的名字", () => {
		expect(isScannableName("a b")).toBe(true);
		expect(isScannableName("a/b")).toBe(false);
		expect(isScannableName("a.")).toBe(true);
	});
});
