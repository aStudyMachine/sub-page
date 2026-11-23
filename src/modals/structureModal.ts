import { App, Modal, Notice } from "obsidian";
import type SubPagePlugin from "../main";
import { PageNode } from "../models/pageNode";
import { OrphanEntry } from "../core/structureIssues";
import { ConfirmModal } from "./pageModals";
import type { PageOperationService } from "../core/pageOperationService";

/** 一次改这么多目录已经不是顺手清理了，先让用户看一眼。 */
const BULK_CONFIRM_THRESHOLD = 50;

/**
 * 结构检查。只报「确实不对」的东西，并提供可撤销的修复动作。
 *
 * 注意：没有同名笔记的目录**不是**异常 —— 按 ADR-0001，那是合法的分组目录。
 * 所以这里把「可以升级为父页面」单独归成一节，措辞是建议而不是问题。
 * 规则本身在 `core/structureIssues`，这里只管画。
 */
export class StructureModal extends Modal {
	private bodyEl!: HTMLElement;
	private readonly operations: PageOperationService;

	constructor(
		app: App,
		private readonly plugin: SubPagePlugin,
	) {
		super(app);
		this.operations = plugin.service.operations;
	}

	onOpen(): void {
		this.titleEl.setText(this.plugin.t("structure.title"));
		this.contentEl.addClass("sp-structure");
		this.bodyEl = this.contentEl.createDiv({ cls: "sp-structure-list" });
		this.render();
	}

	private render(): void {
		if (!this.plugin.service.isCurrentOperationSource(this.operations)) {
			this.close();
			return;
		}
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
					void this.cleanAll([orphan]);
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
			// 多选：几十个目录逐个点按钮点不完，勾完一次做完。
			const selected = new Set<string>(report.groups.map((node) => node.id));
			let syncBulk: () => void = () => undefined;
			for (const node of report.groups) {
				const row = section.createDiv({ cls: "sp-structure-row" });
				const box = row.createEl("input", { type: "checkbox", cls: "sp-check" });
				box.checked = true;
				box.setAttribute("aria-label", this.plugin.t("structure.select", { title: node.title }));
				box.addEventListener("change", () => {
					if (box.checked) selected.add(node.id);
					else selected.delete(node.id);
					syncBulk();
				});
				row.createSpan({ cls: "sp-structure-path", text: node.folderPath });
				row.createEl("button", { text: this.plugin.t("structure.fix") }).addEventListener("click", () => {
					void this.pairOne(node);
				});
			}
			if (report.groups.length > 1) {
				const bulk = section.createEl("button", { text: this.plugin.t("structure.pairSelected", { count: selected.size }) });
				syncBulk = () => {
					bulk.setText(this.plugin.t("structure.pairSelected", { count: selected.size }));
					bulk.disabled = selected.size === 0;
				};
				bulk.addEventListener("click", () => {
					const targets = report.groups.filter((node) => selected.has(node.id));
					// 一次改五十个以上的目录就不再是「顺手清理」，得让用户停下来看一眼。
					if (targets.length > BULK_CONFIRM_THRESHOLD) {
						new ConfirmModal(
							this.app,
							this.plugin,
							this.plugin.t("structure.confirmBulk", { count: targets.length }),
							() => void this.pairAll(targets),
						).open();
						return;
					}
					void this.pairAll(targets);
				});
				syncBulk();
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
		const result = await this.operations.cleanOrderEntries(orphans);
		if (!result.ok) new Notice(result.message);
		this.render();
	}

	private async pairOne(node: PageNode): Promise<void> {
		const template = await this.plugin.loadTemplate();
		const result = await this.operations.pairPage(node.id, template);
		if (!result.ok) new Notice(result.message);
		else if (result.warning) new Notice(result.warning);
		this.render();
	}

	private async pairAll(nodes: PageNode[]): Promise<void> {
		const template = await this.plugin.loadTemplate();
		// 逐个补齐：中途失败也要让已完成的留在结果里，而不是整体回滚。
		let failed = 0;
		for (const node of nodes) {
			const result = await this.operations.pairPage(node.id, template);
			if (!result.ok && result.reason === "page-root-changed") {
				new Notice(result.message);
				break;
			}
			if (!result.ok) failed += 1;
			else if (result.warning) new Notice(result.warning);
		}
		if (failed > 0) new Notice(this.plugin.t("structure.bulkFailed", { count: failed }), 6000);
		this.render();
	}
}

function pathOf(orphan: OrphanEntry): string {
	return orphan.scope === "" ? "/" + orphan.key : orphan.scope + "/" + orphan.key;
}
