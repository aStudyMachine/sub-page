import { App, Modal, Notice } from "obsidian";
import type SubPagePlugin from "../main";
import { OrphanEntry } from "../core/structureIssues";
import { PageNode } from "../models/pageNode";

/**
 * 结构检查。只报「确实不对」的东西，并提供可撤销的修复动作。
 *
 * 注意：没有同名笔记的目录**不是**异常 —— 按 ADR-0001，那是合法的分组目录。
 * 所以这里把「可以升级为父页面」单独归成一节，措辞是建议而不是问题。
 * 规则本身在 `core/structureIssues`，这里只管画。
 */
export class StructureModal extends Modal {
	private bodyEl!: HTMLElement;

	constructor(
		app: App,
		private readonly plugin: SubPagePlugin,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.plugin.t("structure.title"));
		this.contentEl.addClass("sp-structure");
		this.bodyEl = this.contentEl.createDiv({ cls: "sp-structure-list" });
		this.render();
	}

	private render(): void {
		this.bodyEl.empty();
		const report = this.plugin.service.structureReport();
		let problems = 0;

		if (report.orphans.length > 0) {
			problems += 1;
			const section = this.section("structure.section.orphans");
			for (const orphan of report.orphans) {
				const row = section.createDiv({ cls: "sp-structure-row" });
				row.createSpan({ cls: "sp-structure-path", text: pathOf(orphan) });
				row.createSpan({ cls: "sp-structure-reason", text: this.plugin.t("structure.orphan") });
				row.createEl("button", { text: this.plugin.t("structure.clean") }).addEventListener("click", () => {
					void this.plugin.service.order.removeFromScope(orphan.scope, orphan.key).then(() => this.render());
				});
			}
			if (report.orphans.length > 1) {
				const all = section.createEl("button", { text: this.plugin.t("structure.cleanAll"), cls: "mod-warning" });
				all.addEventListener("click", () => void this.cleanAll(report.orphans));
			}
		}

		if (report.conflicts.length > 0) {
			problems += 1;
			const section = this.section("structure.section.conflicts");
			for (const warning of report.conflicts) {
				const row = section.createDiv({ cls: "sp-structure-row" });
				row.createSpan({ cls: "sp-structure-path", text: warning.path || "/" });
				row.createSpan({ cls: "sp-structure-reason", text: warning.message });
			}
		}

		if (report.deep.length > 0) {
			problems += 1;
			const section = this.section("structure.section.depth");
			for (const warning of report.deep) {
				const row = section.createDiv({ cls: "sp-structure-row" });
				row.createSpan({ cls: "sp-structure-path", text: warning.path });
				row.createSpan({ cls: "sp-structure-reason", text: warning.message });
			}
		}

		if (report.groups.length > 0) {
			const section = this.section("structure.section.unpaired");
			for (const node of report.groups) {
				const row = section.createDiv({ cls: "sp-structure-row" });
				row.createSpan({ cls: "sp-structure-path", text: node.folderPath });
				row.createEl("button", { text: this.plugin.t("structure.fix") }).addEventListener("click", () => {
					void this.pairOne(node);
				});
			}
			if (report.groups.length > 1) {
				const all = section.createEl("button", { text: this.plugin.t("structure.pairAll") });
				all.addEventListener("click", () => void this.pairAll(report.groups));
			}
		}

		if (problems === 0 && report.groups.length === 0) {
			this.bodyEl.createDiv({ cls: "sp-structure-ok", text: this.plugin.t("notice.structureOk") });
		}
	}

	private section(key: string): HTMLElement {
		const wrapper = this.bodyEl.createDiv({ cls: "sp-structure-section" });
		wrapper.createEl("h4", { text: this.plugin.t(key) });
		return wrapper;
	}

	private async cleanAll(orphans: OrphanEntry[]): Promise<void> {
		for (const orphan of orphans) {
			await this.plugin.service.order.removeFromScope(orphan.scope, orphan.key);
		}
		this.render();
	}

	private async pairOne(node: PageNode): Promise<void> {
		const template = await this.plugin.loadTemplate();
		const result = await this.plugin.service.operations.pairPage(node.id, template);
		if (!result.ok) new Notice(result.message);
		this.render();
	}

	private async pairAll(nodes: PageNode[]): Promise<void> {
		const template = await this.plugin.loadTemplate();
		// 逐个补齐：中途失败也要让已完成的留在结果里，而不是整体回滚。
		let failed = 0;
		for (const node of nodes) {
			const result = await this.plugin.service.operations.pairPage(node.id, template);
			if (!result.ok) failed += 1;
		}
		if (failed > 0) new Notice(this.plugin.t("structure.bulkFailed", { count: failed }), 6000);
		this.render();
	}
}

function pathOf(orphan: OrphanEntry): string {
	return orphan.scope === "" ? "/" + orphan.key : orphan.scope + "/" + orphan.key;
}
