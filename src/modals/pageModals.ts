import { App, Modal, Notice, Setting, TextComponent } from "obsidian";
import { PageId } from "../models/pageId";
import { PageNode } from "../models/pageNode";
import { checkName } from "../utils/nameValidator";
import type SubPagePlugin from "../main";

/**
 * 弹窗基类：三个弹窗都要「输入框 + 实时校验 + 回车提交 + Esc 取消」，
 * 把这段重复的接线收在一处，子类只填内容与提交动作。
 */
abstract class InputModal extends Modal {
	protected input!: TextComponent;
	protected errorEl!: HTMLElement;
	protected submitButton!: HTMLButtonElement;
	private problem: string | null = null;

	constructor(
		app: App,
		protected readonly plugin: SubPagePlugin,
	) {
		super(app);
	}

	abstract get titleText(): string;
	abstract get placeholderText(): string;
	abstract get initialValue(): string;
	/** 返回一句错误文案表示拒绝，返回 null 表示可以提交。 */
	abstract validate(value: string): string | null;
	abstract submit(value: string): Promise<void>;

	onOpen(): void {
		this.titleEl.setText(this.titleText);
		const setting = new Setting(this.contentEl).addText((text) => {
			this.input = text;
			text.setPlaceholder(this.placeholderText)
				.setValue(this.initialValue)
				.onChange(() => this.revalidate());
			text.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
				if (event.key === "Enter") {
					event.preventDefault();
					void this.trySubmit();
				}
			});
		});
		setting.setClass("sp-modal-input");
		this.errorEl = this.contentEl.createDiv({ cls: "sp-modal-error" });

		const buttons = this.contentEl.createDiv({ cls: "sp-modal-buttons" });
		this.submitButton = buttons.createEl("button", {
			text: this.plugin.t("modal.confirm"),
			cls: "mod-cta",
		});
		this.submitButton.addEventListener("click", () => void this.trySubmit());
		buttons.createEl("button", { text: this.plugin.t("modal.cancel") }).addEventListener("click", () => this.close());

		this.revalidate();
		// 选中原名，改名时直接打就能替换。
		window.setTimeout(() => {
			this.input.inputEl.focus();
			this.input.inputEl.select();
		}, 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private revalidate(): void {
		this.problem = this.validate(this.input.getValue());
		this.errorEl.setText(this.problem ?? "");
		this.submitButton.toggleClass("is-disabled", this.problem !== null);
	}

	private async trySubmit(): Promise<void> {
		this.revalidate();
		if (this.problem !== null) {
			new Notice(this.problem);
			return;
		}
		await this.submit(this.input.getValue().trim());
		this.close();
	}
}

/** 名称类弹窗的共用校验：合法名字 + 同级重名。 */
function nameProblem(plugin: SubPagePlugin, existing: PageNode[], value: string, ignoreId?: PageId): string | null {
	const trimmed = value.trim();
	const check = checkName(trimmed);
	if (!check.ok) return localizedNameProblem(plugin, check.problem, check.detail);
	const lowered = trimmed.toLowerCase();
	const clash = existing.find((node) => node.id !== ignoreId && node.title.toLowerCase() === lowered);
	if (clash) return plugin.t("error.nameConflict");
	return null;
}

export function localizedNameProblem(
	plugin: SubPagePlugin,
	problem: string | undefined,
	detail?: string,
): string {
	const key = problemKey(problem);
	return plugin.t(key, { detail: detail ?? "" }) === key ? plugin.t("error.invalidName") : plugin.t(key, { detail: detail ?? "" });
}

function problemKey(problem: string | undefined): string {
	switch (problem) {
		case "empty":
			return "error.name.empty";
		case "too-long":
			return "error.name.tooLong";
		case "illegal-char":
			return "error.name.illegalChar";
		case "dot-name":
			return "error.name.dotName";
		case "edge-dot-or-space":
			return "error.name.edge";
		case "reserved":
			return "error.name.reserved";
		default:
			return "error.invalidName";
	}
}

export interface CreateModalOptions {
	/** null = 页面根。 */
	parentId: PageId | null;
	/** 已经点过「新建」的位置，默认带上的名字。 */
	parentTitle?: string;
	defaultTitle?: string;
	onCreated(id: PageId): void;
}

export class CreatePageModal extends InputModal {
	constructor(
		app: App,
		plugin: SubPagePlugin,
		private readonly options: CreateModalOptions,
	) {
		super(app, plugin);
		this.modalEl.addClass("sp-create-modal");
	}

	get titleText(): string {
		return this.plugin.t("modal.create.title");
	}
	get placeholderText(): string {
		if (this.options.defaultTitle) {
			return this.plugin.t("modal.create.optionalName", { title: this.options.defaultTitle });
		}
		return this.plugin.t("modal.create.placeholder");
	}
	get initialValue(): string {
		return "";
	}

	validate(value: string): string | null {
		if (this.options.defaultTitle && value.trim() === "") return null;
		const parent = this.plugin.service.getNode(this.options.parentId);
		if (parent?.kind === "leaf" && value.trim().toLowerCase() === parent.title.toLowerCase()) {
			return this.plugin.t("error.nameConflict");
		}
		const siblings = this.plugin.service.getChildren(this.options.parentId);
		return nameProblem(this.plugin, siblings, value);
	}

	async submit(value: string): Promise<void> {
		const template = await this.plugin.loadTemplate();
		const result = await this.plugin.service.operations.createPage(this.options.parentId, value, {
			template,
			defaultTitle: this.options.defaultTitle,
		});
		if (!result.ok) {
			new Notice(result.message);
			return;
		}
		const title = this.plugin.service.getNode(result.value)?.title ?? (value || this.options.defaultTitle);
		new Notice(this.plugin.t("notice.created", { title: title ?? "" }));
		if (result.warning) new Notice(result.warning);
		this.options.onCreated(result.value);
	}

	onOpen(): void {
		const parent = this.plugin.service.getNode(this.options.parentId);
		if (parent?.kind === "leaf") {
			this.contentEl.createDiv({
				cls: "setting-item-description",
				text: this.plugin.t("modal.create.pairParent", { title: parent.title }),
			});
		}
		super.onOpen();
	}
}

export class RenamePageModal extends InputModal {
	constructor(
		app: App,
		plugin: SubPagePlugin,
		private readonly node: PageNode,
	) {
		super(app, plugin);
	}

	get titleText(): string {
		return this.plugin.t("modal.rename.title");
	}
	get placeholderText(): string {
		return this.plugin.t("modal.create.placeholder");
	}
	get initialValue(): string {
		return this.node.title;
	}

	validate(value: string): string | null {
		if (value.trim() === this.node.title) return null;
		const siblings = this.plugin.service
			.getChildren(this.node.parentId)
			.filter((sibling) => sibling.id !== this.node.id);
		return nameProblem(this.plugin, siblings, value);
	}

	async submit(value: string): Promise<void> {
		if (value === this.node.title) return;
		const result = await this.plugin.service.operations.renamePage(this.node.id, value);
		if (!result.ok) {
			new Notice(result.message);
			return;
		}
		new Notice(this.plugin.t("notice.renamed", { title: value }));
	}
}

export class MovePageModal extends InputModal {
	constructor(
		app: App,
		plugin: SubPagePlugin,
		private readonly node: PageNode,
	) {
		super(app, plugin);
	}

	get titleText(): string {
		return this.plugin.t("modal.move.title");
	}
	get placeholderText(): string {
		return this.plugin.t("modal.move.placeholder");
	}
	get initialValue(): string {
		return "";
	}

	validate(value: string): string | null {
		const target = this.resolveTarget(value);
		if (typeof target === "string") return target;
		return null;
	}

	/** 输入的是「目标页面的标题路径」，如 `Java/jvm`；空串表示根。 */
	private resolveTarget(value: string): PageId | null | string {
		const trimmed = value.trim();
		if (trimmed === "") return null;
		const match = this.plugin.service.nodes.find(
			(node) => node.kind !== "leaf" && node.id.toLowerCase() === trimmed.toLowerCase(),
		);
		if (!match) return this.plugin.t("error.notFound");
		if (match.id === this.node.id) return this.plugin.t("error.moveIntoSelf");
		if (match.id.toLowerCase().startsWith(this.node.id.toLowerCase() + "/")) {
			return this.plugin.t("error.moveIntoDescendant");
		}
		return match.id;
	}

	async submit(value: string): Promise<void> {
		const target = this.resolveTarget(value);
		if (typeof target === "string") {
			new Notice(target);
			return;
		}
		const result = await this.plugin.service.operations.movePage(this.node.id, target);
		if (!result.ok) {
			new Notice(result.message);
			return;
		}
		new Notice(this.plugin.t("notice.moved", { target: value.trim() || "/" }));
		if (result.warning) new Notice(result.warning);
	}
}

export interface DeleteModalResult {
	withChildren: boolean;
	useTrash: boolean;
}

export class DeletePageModal extends Modal {
	private withChildren = true;
	private useTrash = true;

	constructor(
		app: App,
		private readonly plugin: SubPagePlugin,
		private readonly node: PageNode,
		private readonly onConfirm: (options: DeleteModalResult) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.plugin.t("modal.delete.title"));
		const body = this.contentEl.createDiv({ cls: "sp-modal-body" });
		body.createEl("p", { text: this.node.title });

		if (this.node.kind === "group") {
			// 分组目录没有自己的笔记，删它就是删整个目录 —— 不写清楚会把「删一个空壳」
			// 当成小事，实际连里面所有笔记一起走。
			body.createEl("p", {
				text: this.plugin.t("modal.delete.groupImpact", {
					direct: this.node.childIds.length,
					all: this.node.descendantCount,
				}),
			});
		}

		if (this.node.kind === "parent") {
			// 有子页面才有第二个选项，否则「连带删除」与「只删笔记」是同一件事。
			if (this.node.descendantCount > 0) {
				// 两个数字分开给：直接子页面是「我看得见的几行」，全部后代是「会一起被移走的页面数」。
				// 只给后者的话，深层子页面会被当成不存在。
				body.createEl("p", {
					text: this.plugin.t("modal.delete.impact", {
						direct: this.node.childIds.length,
						all: this.node.descendantCount,
					}),
				});
				new Setting(this.contentEl)
					.setName(this.plugin.t("modal.delete.withChildren", { count: this.node.descendantCount }))
					.setDesc(this.plugin.t("modal.delete.noteOnly"))
					.addToggle((toggle) => toggle.setValue(this.withChildren).onChange((value) => (this.withChildren = value)));
			} else {
				this.withChildren = false;
			}
		}

		new Setting(this.contentEl)
			.setName(this.plugin.t("modal.delete.useTrash"))
			.addToggle((toggle) => toggle.setValue(true).onChange((value) => (this.useTrash = value)));

		const buttons = this.contentEl.createDiv({ cls: "sp-modal-buttons" });
		buttons
			.createEl("button", { text: this.plugin.t("modal.delete.confirm"), cls: "mod-warning" })
			.addEventListener("click", () => {
				this.onConfirm({ withChildren: this.withChildren, useTrash: this.useTrash });
				this.close();
			});
		buttons
			.createEl("button", { text: this.plugin.t("modal.cancel") })
			.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * 通用确认框。批量动作数量到了一定规模时用 ——
 * 多一次点击，比事后修一棵改错的结构便宜。
 */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: SubPagePlugin,
		private readonly message: string,
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.plugin.t("modal.confirmTitle"));
		this.contentEl.createEl("p", { text: this.message });
		const buttons = this.contentEl.createDiv({ cls: "sp-modal-buttons" });
		buttons
			.createEl("button", { text: this.plugin.t("modal.confirm"), cls: "mod-warning" })
			.addEventListener("click", () => {
				this.onConfirm();
				this.close();
			});
		buttons.createEl("button", { text: this.plugin.t("modal.cancel") }).addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
