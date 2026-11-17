import { mkdir, readdir, rm, writeFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * 重建手工验收库 test-vault/sandbox 里的样例内容。
 *
 * 验收要跑删除、改名、移动 —— 这些动作会改样板本身，跑一遍就不可复用了。
 * 所以把样板写成脚本：每次验收前 npm run sandbox:reset 回到初始状态。
 *
 * 只重建样例笔记，不动 .obsidian/ —— 插件部署在这里面，删了就得重新 deploy。
 */

const vaultDir = resolve(process.cwd(), "test-vault", "sandbox");
if (!/test-vault[\\/]sandbox$/.test(vaultDir)) {
	console.error("拒绝执行：目标路径不是 test-vault/sandbox。", vaultDir);
	process.exit(1);
}

/** 1x1 透明 PNG：用来证明「非 md 文件不进页面树」。 */
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

const block = (body) => "\n\`\`\`subpages\n" + body.trimEnd() + "\n\`\`\`\n";

/**
 * 三篇带块的笔记分别覆盖块的三种状态：
 *  - 首页：叶子页面 → 「还不是父页面」+ 创建目录按钮
 *  - 手册：父页面有子页面 → 列表视图
 *  - 设计：父页面没有子页面 → 空状态 + 新建按钮
 * 再加 项目A：卡片视图 + 描述，覆盖卡片形态。
 */
const files = {
	"首页.md": "# 首页\n" + block("view: list"),
	"笔记规范.md": "# 笔记规范\n\n这份文件用来验证改名时的反链维护：见 [[项目A]]。\n",
	"手册/手册.md": "# 手册\n" + block("view: list\nsort: name"),
	"手册/快速开始.md": "# 快速开始\n",
	"手册/常见问题.md": "# 常见问题\n",
	"Java/jvm/堆内存.md": "# 堆内存\n",
	"Java/jvm/垃圾回收.md": "# 垃圾回收\n",
	"Java/并发/线程池.md": "# 线程池\n",
	"项目A/项目A.md":
		'---\nicon: "📁"\ndescription: 一个父页面\n---\n\n# 项目A\n' +
		block("view: card\ncolumns: 2\nshow-description: true"),
	"项目A/需求.md": '---\nicon: "📝"\ndescription: 这个页面有子页面吗\n---\n\n# 需求\n',
	"项目A/设计/设计.md": "# 设计\n" + block("view: card"),
};

const entries = await readdir(vaultDir, { withFileTypes: true }).catch(() => []);
if (entries.length === 0) {
	console.error(`找不到验收库：${vaultDir}`);
	process.exit(1);
}

// 清掉上一次验收留下的东西（改名、新建的页面），只保留 .obsidian。
let removed = 0;
for (const entry of entries) {
	if (entry.name === ".obsidian") continue;
	await rm(join(vaultDir, entry.name), { recursive: true, force: true });
	removed += 1;
}

for (const [path, content] of Object.entries(files)) {
	const full = join(vaultDir, path);
	await mkdir(dirname(full), { recursive: true });
	await writeFile(full, content, "utf8");
}
await mkdir(join(vaultDir, "_assets"), { recursive: true });
await writeFile(join(vaultDir, "_assets", "diagram.png"), PNG);

const pluginReady = await stat(join(vaultDir, ".obsidian", "plugins", "sub-page", "main.js"))
	.then(() => true)
	.catch(() => false);

console.log(`已重建验收库：${vaultDir}`);
console.log(`  清掉 ${removed} 个旧条目，写入 ${Object.keys(files).length} 篇笔记 + 1 个图片`);
console.log(
	pluginReady
		? "  插件已在位；直接打开这个目录作为库。"
		: "  插件尚未部署：先跑 npm run deploy -- sandbox --no-check",
);
