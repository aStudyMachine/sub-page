import { createHash } from "node:crypto";
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

function buildDeepVault(): FakeVault {
	const vault = new FakeVault();
	for (let branch = 0; branch < 12; branch += 1) {
		let path = `分支${branch}`;
		for (let depth = 2; depth <= 32; depth += 1) {
			const folder = `目录${depth}`;
			path += `/${folder}`;
			for (let note = 0; note < 8; note += 1) vault.seedFile(`${path}/笔记${note}.md`, "");
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

	it.each([
		{ shape: "宽树", build: () => new FakeVault(Object.fromEntries(Array.from({ length: 10000 }, (_, index) => [`笔记${index}.md`, ""]))) },
		{ shape: "深树", build: buildDeepVault },
	])("$shape：耗时和快照形状", async ({ shape, build }) => {
		const vault = build();
		let lists = 0;
		const listFolder = vault.listFolder.bind(vault);
		vault.listFolder = (path) => {
			lists += 1;
			return listFolder(path);
		};
		const snapshot = await scan(vault, "");
		const samples: number[] = [];
		for (let trial = 0; trial < 7; trial += 1) {
			lists = 0;
			const started = performance.now();
			await scan(vault, "");
			samples.push(performance.now() - started);
		}
		samples.sort((a, b) => a - b);
		const structure = [...snapshot.nodes.values()].map(({ id, parentId, childIds, descendantCount }) =>
			[id, parentId, childIds, descendantCount]);
		const digest = createHash("sha256").update(JSON.stringify([snapshot.roots, structure])).digest("hex").slice(0, 12);
		console.log(`${shape}：${samples[3].toFixed(1)}ms（7 次中位数），列目录 ${lists} 次，${snapshot.nodes.size} 个节点，快照 ${digest}`);
		expect(snapshot.nodes.size).toBe(shape === "宽树" ? 10000 : 3360);
		expect(samples[3]).toBeLessThan(2000);
	});
});
