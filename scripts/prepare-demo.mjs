import { cp, mkdir, mkdtemp } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = resolve(root, "demo-vault");
const work = resolve(root, "test-vault");
const hostFiles = new Set(["app.json", "appearance.json", "community-plugins.json"]);
const pluginFiles = new Set(["data.json", "order.json"]);

await mkdir(work, { recursive: true });
const target = await mkdtemp(join(work, "demo-"));
await cp(source, target, {
	recursive: true,
	filter(path) {
		const parts = relative(source, path).split(sep);
		if (parts[0] !== ".obsidian") return !parts.some((part) => part.startsWith("."));
		if (parts.length === 1 || (parts.length === 2 && parts[1] === "plugins")) return true;
		if (parts.length === 2) return hostFiles.has(parts[1]);
		if (parts[1] !== "plugins" || parts[2] !== "sub-page") return false;
		return parts.length === 3 || (parts.length === 4 && pluginFiles.has(parts[3]));
	},
});

// Git 不保留空目录，准备验收副本时补齐。
await Promise.all(["Empty collection", "Reuse folder"].map((name) => mkdir(join(target, "Practice", name))));

// 只输出路径，便于调用方直接交给部署命令。
console.log(join("test-vault", basename(target)));
