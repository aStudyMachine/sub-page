/**
 * 一次改三处版本号，顺便同步 package-lock 里的根版本。
 *
 * 三处不同步是社区提交最常见的翻车点：manifest 与 versions 不一致会让宿主
 * 拒绝加载；package.json 不一致会让 CI 的版本守卫失败。
 *
 * 用法: npm run bump -- 0.0.2
 */
import { readFileSync, writeFileSync } from "node:fs";

const next = process.argv[2];
if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
	console.error("用法: npm run bump -- <x.y.z>");
	process.exit(1);
}

function readJson(file) {
	return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
	writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const pkg = readJson("package.json");
pkg.version = next;
writeJson("package.json", pkg);

const manifest = readJson("manifest.json");
manifest.version = next;
writeJson("manifest.json", manifest);

const versions = readJson("versions.json");
// 只追加，不删除历史版本 —— 老用户升级时宿主会回查这张表。
versions[next] = manifest.minAppVersion;
writeJson("versions.json", versions);

const lockFile = "package-lock.json";
try {
	const lock = readJson(lockFile);
	lock.version = next;
	if (lock.packages?.[""]) lock.packages[""].version = next;
	writeJson(lockFile, lock);
} catch {
	console.warn("没有 package-lock.json，跳过同步。先跑一次 npm install 生成它。");
}

console.log(`版本已更新为 ${next}（package.json / manifest.json / versions.json）`);
