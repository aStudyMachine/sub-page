import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sha256(data) {
	return createHash("sha256").update(data).digest("hex");
}

export function sha256File(file) {
	return sha256(readFileSync(file));
}
