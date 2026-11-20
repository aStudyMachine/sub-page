import { App, PluginSettingTab, SettingDefinitionItem, TFile } from "obsidian";
import type SubPagePlugin from "./main";
import { EXCLUDED_FOLDER_DEFAULTS, SubPageSettings, migrateSettings } from "./models/settings";
import { AgentSkillModal } from "./modals/agentSkillModal";

/**
 * 设置面板用 1.13 起的声明式定义（`getSettingDefinitions`），不用已废弃的 `display()`。
 * 声明式定义能被宿主的设置搜索索引到，也会自然跟随主题的排版。
 */
export class SubPageSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly subPage: SubPagePlugin,
	) {
		super(app, subPage);
	}

	getControlValue(key: string): unknown {
		const settings = this.subPage.settings;
		if (key === "excludedFolders") return settings.excludedFolders.join("\n");
		return settings[key as keyof SubPageSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === "excludedFolders") {
			const list = String(value ?? "")
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => line.length > 0);
			await this.subPage.updateSettings({ excludedFolders: list });
			await this.subPage.refreshIndex();
			return;
		}
		await this.subPage.updateSettings(migrateSettings({ ...this.subPage.settings, [key]: value }).settings);
		// 页面根变了要重扫；语言变了要重注册命令与重建面板文案。
		if (key === "pageRoot") await this.subPage.applyPageRoot();
		if (key === "language") {
			this.subPage.refreshLanguage();
			this.update();
		}
		if (key === "showEmptyFolders" || key === "collapseEmptyParents") await this.subPage.refreshIndex();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const t = (key: string) => this.subPage.t(key);
		return [
			{
				name: t("settings.pageRoot.name"),
				desc: t("settings.pageRoot.desc"),
				control: {
					type: "folder",
					key: "pageRoot",
					includeRoot: true,
					placeholder: "/",
				},
			},
			{
				type: "group",
				heading: t("settings.section.behavior"),
				items: [
					{
						name: t("settings.defaultView.name"),
						desc: t("settings.defaultView.desc"),
						control: {
							type: "dropdown",
							key: "defaultView",
							options: { list: t("view.list"), card: t("view.card") },
						},
					},
					{
						name: t("settings.defaultSort.name"),
						desc: t("settings.defaultSort.desc"),
						control: {
							type: "dropdown",
							key: "defaultSort",
							options: {
								name: t("sort.name"),
								created: t("sort.created"),
								modified: t("sort.modified"),
								manual: t("sort.manual"),
							},
						},
					},
					{
						name: t("settings.confirmDelete.name"),
						desc: t("settings.confirmDelete.desc"),
						control: { type: "toggle", key: "confirmDelete" },
					},
					{
						name: t("settings.collapseEmptyParents.name"),
						desc: t("settings.collapseEmptyParents.desc"),
						control: { type: "toggle", key: "collapseEmptyParents" },
					},
					{
						name: t("settings.templatePath.name"),
						desc: t("settings.templatePath.desc"),
						control: {
							type: "file",
							key: "templatePath",
							placeholder: "templates/page.md",
							// 模板必须是笔记：选到附件没有意义。
							filter: (file: TFile) => file.extension === "md",
						},
					},
				],
			},
			{
				type: "group",
				heading: t("settings.section.appearance"),
				items: [
					{
						name: t("settings.showEmptyFolders.name"),
						desc: t("settings.showEmptyFolders.desc"),
						control: { type: "toggle", key: "showEmptyFolders" },
					},
					{
						name: t("settings.language.name"),
						desc: t("settings.language.desc"),
						control: {
							type: "dropdown",
							key: "language",
							options: { auto: t("settings.language.auto"), zh: "中文", en: "English" },
						},
					},
				],
			},
			{
				name: t("agentSkill.title"),
				desc: t("agentSkill.settings"),
				action: () => new AgentSkillModal(this.subPage).open(),
			},
			{
				type: "group",
				heading: t("settings.section.advanced"),
				items: [
					{
						name: t("settings.excludedFolders.name"),
						desc: t("settings.excludedFolders.desc"),
						control: {
							type: "textarea",
							key: "excludedFolders",
							rows: 5,
							placeholder: EXCLUDED_FOLDER_DEFAULTS.join("\n"),
						},
					},
					{
						name: t("settings.debugLog.name"),
						desc: t("settings.debugLog.desc"),
						control: { type: "toggle", key: "debugLog" },
					},
				],
			},
		];
	}
}
