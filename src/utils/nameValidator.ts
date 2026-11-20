import { stripExtension } from "./pathUtils";

export type NameProblem =
	| "empty"
	| "too-long"
	| "illegal-char"
	| "dot-name"
	| "edge-dot-or-space"
	| "reserved";

export interface NameCheck {
	ok: boolean;
	problem?: NameProblem;
	/** 出问题的具体字符，用于提示「不能包含 : 」这类文案。 */
	detail?: string;
}

const ILLEGAL_CHARS = /[\\/:*?"<>|]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_LENGTH = 100;

function illegalCharacter(name: string): string | undefined {
	for (const character of name) {
		if (character.charCodeAt(0) < 32 || ILLEGAL_CHARS.test(character)) return character;
	}
	return undefined;
}

/**
 * 名称合法性。比 Obsidian 本身更严：文件名最终要落到 Windows 上，
 * 那边的大小写与保留名限制会变成「建到一半失败」，不如在输入时就挡住。
 */
export function checkName(rawName: string): NameCheck {
	const name = rawName.trim();
	if (name.length === 0) return { ok: false, problem: "empty" };
	if (name.length > MAX_LENGTH) return { ok: false, problem: "too-long" };

	const illegal = illegalCharacter(name);
	if (illegal) return { ok: false, problem: "illegal-char", detail: illegal };

	// "." 与 ".." 是路径语义，不是名字。
	if (name === "." || name === "..") return { ok: false, problem: "dot-name" };
	// 首尾空格与结尾点在 Windows 上会被静默吃掉，最终建出来的名字与用户输入的不一致，
	// 所以宁可让用户当场改，也不替他们裁剪。
	if (name !== rawName || /[. ]$/.test(name)) {
		return { ok: false, problem: "edge-dot-or-space" };
	}
	if (RESERVED.test(stripExtension(name))) {
		return { ok: false, problem: "reserved" };
	}
	return { ok: true };
}

/** 扫描时对已有文件名的宽松判定：只挡真正会破坏路径的名字。 */
export function isScannableName(name: string): boolean {
	return name.length > 0 && illegalCharacter(name) === undefined && name !== "." && name !== "..";
}
