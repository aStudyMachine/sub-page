import skill from "../../skills/sub-page-organize/SKILL.md?raw";
import type { VaultAdapter } from "../adapters/vaultAdapter";
import { checkName } from "../utils/nameValidator";
import { dirname, joinPath } from "../utils/pathUtils";

export const DEFAULT_SKILLS_FOLDER = ".agents/skills";
export const AGENT_SKILL = skill;
const AGENTS_PATH = "AGENTS.md";
const START = "<!-- sub-page-organize:start -->";
const END = "<!-- sub-page-organize:end -->";
const OWNERSHIP = "<!-- managed-by: sub-page-organize -->";

export class AgentSkillError extends Error {
	constructor(readonly key: string, readonly detail = "") {
		super(key);
	}
}

export function agentSkillPath(folder: string): string {
	if (folder.split("/").some((part) => {
		const name = part.startsWith(".") ? part.slice(1) : part;
		return !checkName(name).ok || part !== part.trim();
	})) throw new AgentSkillError("agentSkill.error.path");
	return joinPath(folder, "sub-page-organize", "SKILL.md");
}

function managedSection(original: string): { start: number; end: number } | null {
	const start = original.indexOf(START);
	const end = original.indexOf(END);
	if (start === -1 && end === -1) return null;
	if (start === -1 || end < start || original.lastIndexOf(START) !== start || original.lastIndexOf(END) !== end) {
		throw new AgentSkillError("agentSkill.error.markers");
	}
	for (const [position, marker] of [[start, START], [end, END]] as const) {
		if ((position > 0 && original[position - 1] !== "\n") ||
			!/^(?:\r?\n|$)/.test(original.slice(position + marker.length))) {
			throw new AgentSkillError("agentSkill.error.markers");
		}
	}
	return { start, end };
}

function updateInstructions(original: string, instruction: string): string {
	if (!instruction.trim() || instruction.includes(START) || instruction.includes(END)) {
		throw new AgentSkillError("agentSkill.error.instruction");
	}
	const newline = original.includes("\r\n") ? "\r\n" : "\n";
	const block = [START, instruction.trim().replace(/\r?\n/g, newline), END].join(newline);
	const section = managedSection(original);
	if (section) return original.slice(0, section.start) + block + original.slice(section.end + END.length);
	const separator = !original || original.endsWith(newline + newline) ? "" :
		original.endsWith(newline) ? newline : newline + newline;
	return original + separator + block + newline;
}

export class AgentSkillInstaller {
	constructor(private readonly adapter: Pick<VaultAdapter, "readText" | "writeVerifiedText" | "ensureConfigFolders">) {}

	async readInstruction(): Promise<string | null> {
		const original = (await this.adapter.readText(AGENTS_PATH)) ?? "";
		const section = managedSection(original);
		return section ? original.slice(section.start + START.length, section.end).trim() : null;
	}

	async install(folder: string, instruction: string | null): Promise<string> {
		const path = agentSkillPath(folder);
		const previousSkill = await this.adapter.readText(path);
		if (previousSkill !== null && !previousSkill.trimEnd().endsWith(OWNERSHIP)) {
			throw new AgentSkillError("agentSkill.error.occupied", path);
		}
		const previousInstructions = instruction === null ? null : await this.adapter.readText(AGENTS_PATH);
		const nextInstructions = instruction === null ? null : updateInstructions(previousInstructions ?? "", instruction);

		if (previousSkill !== AGENT_SKILL) {
			await this.adapter.ensureConfigFolders(dirname(path));
			await this.adapter.writeVerifiedText(path, AGENT_SKILL, previousSkill);
		}
		if (nextInstructions !== null && nextInstructions !== previousInstructions) {
			try {
				await this.adapter.writeVerifiedText(AGENTS_PATH, nextInstructions, previousInstructions, true);
			} catch (error) {
				throw new AgentSkillError("agentSkill.error.partial", error instanceof Error ? error.message : String(error));
			}
		}
		return path;
	}
}
