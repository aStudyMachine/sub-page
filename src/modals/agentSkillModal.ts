import { Modal, Notice, Setting, TextAreaComponent } from "obsidian";
import { AGENT_SKILL, AgentSkillError, DEFAULT_SKILLS_FOLDER, agentSkillPath } from "../core/agentSkillInstaller";
import type SubPagePlugin from "../main";

export class AgentSkillModal extends Modal {
	constructor(private readonly plugin: SubPagePlugin) {
		super(plugin.app);
	}

	onOpen(): void {
		const t = (key: string, vars?: Record<string, string>) => this.plugin.t(key, vars);
		this.setTitle(t("agentSkill.title"));
		this.contentEl.addClass("sp-agent-skill-modal");
		this.contentEl.createEl("p", { text: t("agentSkill.scope") });
		let folder = DEFAULT_SKILLS_FOLDER;
		let writeInstructions = true;
		let installing = false;
		let pathValid = true;
		let loading = true;
		const preset = (path: string) => t("agentSkill.preset", { path: encodeURI(path).replace(/#/g, "%23") });
		let defaultInstruction = preset(agentSkillPath(folder));
		let instruction!: TextAreaComponent;

		const pathPreview = this.contentEl.createEl("code", { text: agentSkillPath(folder) });
		new Setting(this.contentEl).setName(t("agentSkill.folder")).addText((text) => text
			.setValue(folder)
			.onChange((value) => {
				folder = value;
				try {
					const path = agentSkillPath(folder);
					pathPreview.setText(path);
					const previousDefault = defaultInstruction;
					defaultInstruction = preset(path);
					if (instruction.getValue() === previousDefault) instruction.setValue(defaultInstruction);
					pathValid = true;
				} catch {
					pathPreview.setText(t("agentSkill.error.path"));
					pathValid = false;
				}
				install.disabled = loading || installing || !pathValid;
			}));

		const skillPreview = this.contentEl.createEl("details", { attr: { open: "" } });
		skillPreview.createEl("summary", { text: "SKILL.md" });
		skillPreview.createEl("pre", { text: AGENT_SKILL });

		new Setting(this.contentEl)
			.setName(t("agentSkill.writeInstructions"))
			.setDesc(t("agentSkill.managed"))
			.addToggle((toggle) => toggle.setValue(true).onChange((value) => {
				writeInstructions = value;
				instruction.setDisabled(!value);
			}));
		new Setting(this.contentEl).setName(t("agentSkill.instruction")).addTextArea((text) => {
			instruction = text.setValue(defaultInstruction);
			text.inputEl.rows = 3;
		});

		const errorEl = this.contentEl.createDiv({ cls: "sp-modal-error", attr: { role: "alert" } });
		const buttons = this.contentEl.createDiv({ cls: "sp-modal-buttons" });
		const install = buttons.createEl("button", { text: t("agentSkill.install"), cls: "mod-cta" });
		install.disabled = true;
		const installer = this.plugin.service.operations.agentSkill;
		const showError = (error: unknown) => errorEl.setText(error instanceof AgentSkillError
			? t(error.key, { detail: error.detail })
			: t("agentSkill.error.write", { detail: error instanceof Error ? error.message : String(error) }));
		void installer.readInstruction().then((existing) => {
			if (existing !== null && instruction.getValue() === defaultInstruction) instruction.setValue(existing);
		}).catch(showError).finally(() => {
			loading = false;
			install.disabled = !pathValid;
		});
		buttons.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
		install.addEventListener("click", () => {
			if (loading || installing || !pathValid) return;
			installing = true;
			install.disabled = true;
			errorEl.empty();
			void installer.install(folder, writeInstructions ? instruction.getValue() : null)
				.then((path) => {
					new Notice(t("agentSkill.installed", { path }));
					this.close();
				})
				.catch(showError)
				.finally(() => {
					installing = false;
					install.disabled = !pathValid;
				});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
