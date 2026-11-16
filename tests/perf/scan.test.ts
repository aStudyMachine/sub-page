import { describe, expect, it } from "vitest";
import { FakeVault } from "../fixtures/fakeVault";
import { scan } from "../../src/repository/pageScanner";

/**
 * 规模基线。默认跳过，只有 `npm run perf` 才跑 —— CI 的机器性能不可控，
 * 把耗时断言塞进常规测试只会得到一堆假红灯。
 *
 * 用的是内存假库，测的是扫描算法自身的增长曲线，不含真实磁盘 IO。
 */
const running = process.env.npm_lifecycle_event === "perf";

function buildVault(pages: number): FakeVault {
	const vault = new FakeVault();
	let created = 0;
	let group = 0;
	while (created < pages) {
		group += 1;
		const folder = `分组${String(group).padStart(3, "0")}`;
		if (group % 10 === 0) {
			vault.seedFile(`${folder}/${folder}.md`, "# 父页面\n");
			created += 1;
		}
		for (let index = 0; index < 20 && created < pages; index += 1) {
			vault.seedFile(`${folder}/笔记${String(index + 1).padStart(3, "0")}.md`, "# 叶子\n");
			created += 1;
		}
	}
	return vault;
}

describe.skipIf(!running)("扫描规模基线", () => {
	for (const pages of [100, 1000, 5000, 10000]) {
		it(`${pages} 个页面`, async () => {
			const vault = buildVault(pages);
			const started = performance.now();
			const snapshot = await scan(vault, "");
			const elapsed = performance.now() - started;
			const stats = { pages: snapshot.nodes.size, folders: snapshot.folderCount, roots: snapshot.roots.length };
			console.log(`扫描 ${pages} 页：${elapsed.toFixed(1)}ms`, stats);
			expect(snapshot.nodes.size).toBeGreaterThan(pages);
			// 只挡数量级级别的退化（例如误改成每层重扫整库），不挡常数因子。
			expect(elapsed).toBeLessThan(pages * 2);
		});
	}
});
