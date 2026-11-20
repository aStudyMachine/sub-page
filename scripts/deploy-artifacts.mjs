import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { sha256File } from "./sha256.mjs";

function isExistingFile(file) {
	const stat = lstatSync(file, { throwIfNoEntry: false });
	if (!stat) return false;
	if (!stat.isFile()) throw new Error(`目标不是普通文件：${file}`);
	return true;
}

/** 同一库的部署串行执行，失败时恢复本次已经触及的文件。 */
export function deployArtifacts(sourceDir, targetDir, backupRoot, names, requiredNames = []) {
	const files = names.map((name) => {
		const source = join(sourceDir, name);
		return { name, source, target: join(targetDir, name), hash: sha256File(source) };
	});
	mkdirSync(targetDir, { recursive: true });
	const lock = join(targetDir, ".deploy-lock");
	try {
		mkdirSync(lock);
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		throw new Error(`部署锁已存在：${lock}。确认没有部署进程运行后，再移走遗留的锁目录。`, { cause: error });
	}
	const staged = join(lock, "artifact");

	try {
		// 其他部署可能在命令预检之后回滚，持锁时重新确认安装完整。
		for (const name of requiredNames) {
			if (!isExistingFile(join(targetDir, name))) {
				throw new Error(`缺少已安装的 ${name}，请先运行完整部署。`);
			}
		}
		const existing = files.filter(({ target }) => isExistingFile(target));
		let backupDir;
		if (existing.length > 0) {
			mkdirSync(backupRoot, { recursive: true });
			backupDir = mkdtempSync(join(backupRoot, "deploy-"));
			for (const file of existing) {
				file.backup = join(backupDir, file.name);
				copyFileSync(file.target, file.backup);
			}
		}

		const touched = [];
		try {
			for (const file of files) {
				// 在目标卷上准备完整文件，替换时只做一次 rename。
				copyFileSync(file.source, staged);
				renameSync(staged, file.target);
				touched.push(file);
				if (sha256File(file.target) !== file.hash) {
					throw new Error(`SHA-256 校验失败：${file.target}`);
				}
			}
		} catch (error) {
			const failures = [];
			for (const { target, backup } of touched.reverse()) {
				try {
					if (backup) {
						copyFileSync(backup, staged);
						renameSync(staged, target);
					} else if (isExistingFile(target)) {
						unlinkSync(target);
					}
				} catch (rollbackError) {
					failures.push(rollbackError.message);
				}
			}
			if (failures.length > 0) {
				throw new Error(`${error.message}；回滚失败：${failures.join("；")}。备份：${backupDir ?? "无"}`, { cause: error });
			}
			throw new Error(`${error.message}；已回滚此次部署。`, { cause: error });
		}
		return backupDir;
	} finally {
		try {
			if (isExistingFile(staged)) unlinkSync(staged);
			rmdirSync(lock);
		} catch (cleanupError) {
			console.warn(`无法清理部署锁 ${lock}：${cleanupError.message}`);
		}
	}
}
