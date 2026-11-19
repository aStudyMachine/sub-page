import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deployArtifacts } from "../../scripts/deploy-artifacts.mjs";

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

describe("deployArtifacts", () => {
	let root: string;
	let source: string;
	let target: string;
	let backups: string;

	beforeEach(() => {
		root = fs.mkdtempSync(join(tmpdir(), "sub-page-deploy-"));
		source = join(root, "source");
		target = join(root, "target");
		backups = join(root, "backups");
		fs.mkdirSync(source);
		fs.mkdirSync(target);
		fs.writeFileSync(join(source, "main.js"), "新脚本");
		fs.writeFileSync(join(source, "styles.css"), "新样式");
		fs.writeFileSync(join(target, "main.js"), "原脚本");
		fs.writeFileSync(join(target, "styles.css"), "原样式");
	});

	afterEach(() => {
		vi.mocked(fs.renameSync).mockReset();
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("仅更新选中的文件并保留原文件备份", () => {
		const backup = deployArtifacts(source, target, backups, ["styles.css"]);
		expect(backup).toBeDefined();
		expect(fs.readFileSync(join(backup!, "styles.css"), "utf8")).toBe("原样式");
		expect(fs.readFileSync(join(target, "styles.css"), "utf8")).toBe("新样式");
		expect(fs.readFileSync(join(target, "main.js"), "utf8")).toBe("原脚本");
		expect(fs.existsSync(join(target, ".deploy-lock"))).toBe(false);
	});

	it("后续文件写入失败时恢复旧文件并清除本次新增文件", async () => {
		const actual = await vi.importActual<typeof fs>("node:fs");
		fs.writeFileSync(join(source, "manifest.json"), "{}");
		vi.mocked(fs.renameSync)
			.mockImplementationOnce(actual.renameSync)
			.mockImplementationOnce(actual.renameSync)
			.mockImplementationOnce(() => { throw new Error("模拟写入失败"); });

		expect(() => deployArtifacts(source, target, backups, ["main.js", "manifest.json", "styles.css"]))
			.toThrow("模拟写入失败；已回滚此次部署");
		expect(fs.readFileSync(join(target, "main.js"), "utf8")).toBe("原脚本");
		expect(fs.readFileSync(join(target, "styles.css"), "utf8")).toBe("原样式");
		expect(fs.existsSync(join(target, "manifest.json"))).toBe(false);
		expect(fs.existsSync(join(target, ".deploy-lock"))).toBe(false);
	});

	it("已有部署锁时保留原文件和锁", () => {
		const lock = join(target, ".deploy-lock");
		fs.mkdirSync(lock);
		expect(() => deployArtifacts(source, target, backups, ["styles.css"])).toThrow("部署锁已存在");
		expect(fs.readFileSync(join(target, "styles.css"), "utf8")).toBe("原样式");
		expect(fs.existsSync(lock)).toBe(true);
	});

	it("持锁后发现缺少已安装文件时终止样式部署", () => {
		expect(() => deployArtifacts(source, target, backups, ["styles.css"], ["main.js", "manifest.json"]))
			.toThrow("缺少已安装的 manifest.json");
		expect(fs.readFileSync(join(target, "styles.css"), "utf8")).toBe("原样式");
		expect(fs.existsSync(join(target, ".deploy-lock"))).toBe(false);
	});

	it("写入内容与来源不一致时回滚", async () => {
		const actual = await vi.importActual<typeof fs>("node:fs");
		const style = join(target, "styles.css");
		vi.mocked(fs.renameSync).mockImplementationOnce((from, to) => {
			actual.renameSync(from, to);
			actual.writeFileSync(style, "内容异常");
		});

		expect(() => deployArtifacts(source, target, backups, ["styles.css"])).toThrow("SHA-256 校验失败");
		expect(fs.readFileSync(style, "utf8")).toBe("原样式");
	});
});
