import { expect, it, vi } from "vitest";
import { AGENT_SKILL, AgentSkillInstaller, DEFAULT_SKILLS_FOLDER } from "../../src/core/agentSkillInstaller";
import { FakeVault } from "../fixtures/fakeVault";

const skillPath = ".agents/skills/sub-page-organize/SKILL.md";
const original = "# Vault rules\r\n\r\nKeep this.\r\n";

it("安装并更新管理的小节，保留用户原有规则和换行", async () => {
	const vault = new FakeVault({ "AGENTS.md": original });
	const installer = new AgentSkillInstaller(vault);
	expect(await installer.install(DEFAULT_SKILLS_FOLDER, "Original instruction")).toBe(skillPath);
	expect(vault.content(skillPath)).toBe(AGENT_SKILL);
	await vault.writeText("AGENTS.md", vault.content("AGENTS.md") + "\r\n## Later rule\r\n");
	await installer.install(DEFAULT_SKILLS_FOLDER, "Updated instruction");
	const expected = original + "\r\n<!-- sub-page-organize:start -->\r\nUpdated instruction\r\n<!-- sub-page-organize:end -->\r\n\r\n## Later rule\r\n";
	expect(vault.content("AGENTS.md")).toBe(expected);
	expect(await installer.readInstruction()).toBe("Updated instruction");
	const write = vi.spyOn(vault, "writeVerifiedText");
	await installer.install(DEFAULT_SKILLS_FOLDER, "Updated instruction");
	expect(write).not.toHaveBeenCalled();
});

it("支持自定义目录和跳过 AGENTS.md", async () => {
	const vault = new FakeVault();
	const installer = new AgentSkillInstaller(vault);
	const target = await installer.install("Agent rules/skills", null);
	expect(target).toBe("Agent rules/skills/sub-page-organize/SKILL.md");
	expect(vault.content(target)).toBe(AGENT_SKILL);
	expect(vault.content("AGENTS.md")).toBeUndefined();
});

it.each(["../outside", "/root", "C:/outside", "folder\\child", "folder//child"])("拒绝不合法的目录 %s", async (folder) => {
	const vault = new FakeVault();
	await expect(new AgentSkillInstaller(vault).install(folder, null)).rejects.toMatchObject({ key: "agentSkill.error.path" });
	expect(vault.filePaths()).toEqual([]);
});

it("已有其他 Skill 或管理标记不完整时保留文件", async () => {
	const vault = new FakeVault({ [skillPath]: "Your skill", "AGENTS.md": "<!-- sub-page-organize:start -->" });
	const installer = new AgentSkillInstaller(vault);
	await expect(installer.install(DEFAULT_SKILLS_FOLDER, "Instruction")).rejects.toMatchObject({ key: "agentSkill.error.occupied" });
	await expect(installer.install("Custom", "Instruction")).rejects.toMatchObject({ key: "agentSkill.error.markers" });
	expect(vault.filePaths()).toEqual([skillPath, "AGENTS.md"]);
	expect(vault.content(skillPath)).toBe("Your skill");
});

it("指令写入遇到并发修改时保留该修改，重试安装可补写指令", async () => {
	const vault = new FakeVault({ "AGENTS.md": original });
	const write = vault.writeVerifiedText.bind(vault);
	const concurrent = original + "New rule\r\n";
	const spy = vi.spyOn(vault, "writeVerifiedText").mockImplementation(async (path, content, previous) => {
		if (path === "AGENTS.md") await vault.writeText(path, concurrent);
		await write(path, content, previous);
	});
	const installer = new AgentSkillInstaller(vault);
	await expect(installer.install(DEFAULT_SKILLS_FOLDER, "Preset")).rejects.toMatchObject({ key: "agentSkill.error.partial" });
	expect(vault.content("AGENTS.md")).toBe(concurrent);
	expect(vault.content(skillPath)).toBe(AGENT_SKILL);
	spy.mockRestore();
	await installer.install(DEFAULT_SKILLS_FOLDER, "Preset");
	expect(vault.content("AGENTS.md")).toContain("New rule\r\n");
	expect(vault.content("AGENTS.md")).toContain("Preset");
});
