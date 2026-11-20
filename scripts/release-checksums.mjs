import { join } from "node:path";
import { sha256, sha256File } from "./sha256.mjs";

const [directory = ".", expectedDigest] = process.argv.slice(2);
const assets = ["main.js", "manifest.json", "styles.css"];
// 保留 Linux sha256sum 清单的顺序、两个分隔空格和末尾 LF。
const checksums = assets.map((name) => `${sha256File(join(directory, name))}  ${name}\n`).join("");
const digest = sha256(checksums);

process.stdout.write(checksums);
console.log(`checksums_digest=${digest}`);
if (expectedDigest !== undefined && digest !== expectedDigest) {
	console.error("发布产物与 dry run 的校验和不一致");
	process.exitCode = 1;
}
