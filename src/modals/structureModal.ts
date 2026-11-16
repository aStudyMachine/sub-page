import { App, Modal, Notice } from "obsidian";
import type SubPagePlugin from "../main";
import { PageNode } from "../models/pageNode";
import { PageId } from "../models/pageId";
import { childKey } from "../core/pageOperationService";

/**
 * 结构检查。只报「确实不对」的东西，并提供可撤销的修复动作。
 *
 * 注意：没有同名笔记的目录**不是**异常 —— 按 ADR-0001，那是合法的分组目录。
 * 所以这里把「可以升级为父页面」单独归成一节，措辞是建议而不是问题。
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
		const orphanScopes = this.findOrphanEntries();
		const conflicts = this.plugin.service.index.warnings.filter((warning) => warning.kind === "case-conflict");
		const deep = this.plugin.service.index.warnings.filter((warning) => warning.kind === "depth-limit");
		const groups = this.plugin.service.nodes.filter((node) => node.kind === "group");

		let problems = 0;

		if (orphanScopes.size > 0) {
			problems += 1;
			const section = this.section("structure.section.orphans");
			let total = 0;
			for (const [scope, keys] of orphanScopes) {
				for (const key of keys) {
					total += 1;
					const row = section.createDiv({ cls: "sp-structure-row" });
					row.createSpan({ cls: "sp-structure-path", text: scope === "" ? `/${key}` : `${scope}/${key}` });
					row.createSpan({ cls: "sp-structure-reason", text: this.plugin.t("structure.orphan") });
					row.createEl("button", { text: this.plugin.t("structure.clean") }).addEventListener("click", () => {
						void this.plugin.service.order.removeFromScope(scope, key).then(() => this.render());
					});
				}
			}
			if (total > 1) {
				const all = section.createEl("button", { text: this.plugin.t("structure.cleanAll"), cls: "mod-warning" });
				all.addEventListener("click", () => {
					void (async () => {
						for (const [scope, keys] of orphanScopes) {
							for (const key of keys) await this.plugin.service.order.removeFromScope(scope, key);
						}
						this.render();
					})();
				});
			}
		}

		if (conflicts.length > 0) {
			problems += 1;
			const section = this.section("structure.section.conflicts");
			for (const warning of conflicts) {
				const row = section.createDiv({ cls: "sp-structure-row" });
				row.createSpan({ cls: "sp-structure-path", text: warning.path || "/" });
				row.createSpan({ cls: "sp-structure-reason", text: warning.message });
			}
		}

		if (deep.length > 0) {
			problems += 1;
			const section = this.section("structure.section.depth");
			for (const warning of deep) {
				const row = section.createDiv({ cls: "sp-structure-row" });
				row.createSpan({ cls: "sp-structure-path", text: warning.path });
				row.createSpan({ cls: "sp-structure-reason", text: warning.message });
			}
		}

		if (groups.length > 0) {
			const section = this.section("structure.section.unpaired");
			for (const node of groups) {
				const row = section.createDiv({ cls: "sp-structure-row" });
				row.createSpan({ cls: "sp-structure-path", text: node.folderPath });
				row.createEl("button", { text: this.plugin.t("structure.fix") }).addEventListener("click", () => {
					void this.pair(node);
				});
			}
			if (groups.length > 1) {
				const all = section.createEl("button", { text: this.plugin.t("structure.pairAll") });
				all.addEventListener("click", () => void this.pairAll(groups));
			}
		}

		if (problems === 0 && groups.length === 0) {
			this.bodyEl.createDiv({ cls: "sp-structure-ok", text: this.plugin.t("notice.structureOk") });
		}
	}

	private section(key: string): HTMLElement {
		const wrapper = this.bodyEl.createDiv({ cls: "sp-structure-section" });
		wrapper.createEl("h4", { text: this.plugin.t(key) });
		return wrapper;
	}

	/** 顺序文件里登记了、但磁盘上已经不存在的条目。只报告作用域，不改磁盘。 */
	private findOrphanEntries(): Map<string, string[]> {
		const result = new Map<string, string[]>();
		const order = this.plugin.service.order.current;
		for (const [scope, keys] of Object.entries(order)) {
			const existing = new Set(
				this.plugin.service.getChildren(scope === "" ? null : (scope as PageId)).map((node) => childKey(node)),
			);
			const orphans = keys.filter((key) => !existing.has(key));
			if (orphans.length > 0) result.set(scope, orphans);
		}
		return result;
	}

	private async pair(node: PageNode): Promise<void> {
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
