import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * 生成假库用于性能基线：node scripts/gen-vault.mjs 1000
 *
 * 形状刻意贴近真实笔记库 —— 少量父页面 + 大量两层叶子，
 * 而不是每个页面都配对（那样测出来的扫描成本会偏悲观）。
 */
const target = Number(process.argv[2] ?? 100);
if (!Number.isInteger(target) || target < 1) {
	console.error("用法：node scripts/gen-vault.mjs <页面数量>");
	process.exit(1);
}

const outDir = join(process.cwd(), "test-vault", `perf-${target}`);
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

let created = 0;
let group = 0;

const body = (title) => `# ${title}\n\n假页面，用于性能基线。\n`;

while (created < target) {
	group += 1;
	const folderName = `分组${String(group).padStart(3, "0")}`;
	const folderPath = join(outDir, folderName);
	await mkdir(folderPath, { recursive: true });

	// 每 10 组配一个父页面，其余是分组目录 —— 两种节点都要覆盖到。
	if (group % 10 === 0) {
		await writeFile(join(folderPath, `${folderName}.md`), body(folderName), "utf8");
		created += 1;
	}

	for (let index = 0; index < 20 && created < target; index += 1) {
		const leaf = `笔记${String(index + 1).padStart(3, "0")}`;
		await writeFile(join(folderPath, `${leaf}.md`), body(leaf), "utf8");
		created += 1;
	}
}

// 附带一个排在页面根的笔记，验证根级页面也被计入。
await writeFile(join(outDir, "首页.md"), body("首页"), "utf8");

console.log(`已生成 ${created + 1} 个页面：${outDir}`);
