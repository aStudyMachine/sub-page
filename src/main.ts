import { App, Notice, Plugin, TFile, getLanguage } from "obsidian";
import { ObsidianVaultAdapter } from "./adapters/obsidianVaultAdapter";
import { PageService } from "./core/pageService";
import { SubPageSettingTab } from "./settings";
import { DEFAULT_SETTINGS, SubPageSettings, migrateSettings } from "./models/settings";
import { Translator, resolveLanguage } from "./i18n";
import { PAGE_TREE_VIEW_TYPE, PageTreeView } from "./views/pageTreeView";
import { registerSubPageBlockProcessor } from "./views/subPageRenderer";
import { registerCommands } from "./commands";

/**
 * Sub Page —— 在现有 vault 之上的一棵页面树：
 * 任意笔记都是页面，带同名目录的笔记就是父页面，侧栏与正文块共用同一份索引。
 */
export default class SubPagePlugin extends Plugin {
	settings: SubPageSettings = { ...DEFAULT_SETTINGS };
	readonly translator = new Translator("zh");

	/** 索引与写操作的门面；onload 里创建，视图与块都只依赖它。 */
	service!: PageService;
	private pageRootPromise: Promise<void> | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.service = new PageService({
			adapter: new ObsidianVaultAdapter(this.app),
			settings: () => this.settings,
			onChange: () => this.refreshViews(),
			onProblem: (message) => new Notice(message, 6000),
			debounceMs: 200,
		});
		this.register(() => this.service.dispose());
		await this.service.start();

		this.registerView(PAGE_TREE_VIEW_TYPE, (leaf) => new PageTreeView(leaf, this));

		const blockRegistered = registerSubPageBlockProcessor(this);
		if (!blockRegistered) {
			console.warn("[sub-page] subpages 代码块语言已被其它插件占用");
		}

		this.addSettingTab(new SubPageSettingTab(this.app, this));
		registerCommands(this);

		// 界面语言可能跟随 Obsidian 切换，命令面板的标签要跟着重建。
		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				this.refreshLanguage();
			}),
		);
	}

	async onunload(): Promise<void> {
		await this.saveSettings();
	}

	// ------------------------------------------------------------ 生命周期

	async loadSettings(): Promise<void> {
		const stored = await this.loadData();
		const { settings, changed } = migrateSettings(stored);
		this.settings = settings;
		this.refreshLanguage();
		if (changed) await this.saveSettings();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async updateSettings(patch: Partial<SubPageSettings>): Promise<void> {
		this.settings = { ...this.settings, ...patch };
		await this.saveSettings();
	}

	/** 页面根改了：重扫并让所有视图重建，展开状态留在旧根里没有意义。 */
	async applyPageRoot(): Promise<void> {
		this.settings = { ...this.settings, expandedIds: [] };
		await this.saveSettings();
		await this.service.setPageRoot(this.settings.pageRoot);
		this.refreshViews();
	}

	async refreshIndex(): Promise<void> {
		await this.service.refresh();
	}

	// ------------------------------------------------------------ 文案

	get language(): "zh" | "en" {
		let uiLanguage: string | undefined;
		try {
			uiLanguage = getLanguage();
		} catch {
			uiLanguage = undefined;
		}
		return resolveLanguage(this.settings.language, uiLanguage);
	}

	t(key: string, vars?: Record<string, string | number>): string {
		this.translator.setLanguage(this.language);
		return this.translator.t(key, vars);
	}

	/** 语言切换后重建命令与设置面板文案。 */
	refreshLanguage(): void {
		this.translator.setLanguage(this.language);
		registerCommands(this);
	}

	// ------------------------------------------------------------ 展开状态

	get expandedIds(): Set<string> {
		return new Set(this.settings.expandedIds);
	}

	async setExpandedIds(ids: Set<string>): Promise<void> {
		const next = Array.from(ids);
		if (next.length === this.settings.expandedIds.length && next.every((id) => this.settings.expandedIds.includes(id))) {
			return;
		}
		await this.updateSettings({ expandedIds: next });
	}

	// ------------------------------------------------------------ 视图

	/** 正文里 ```subpages 块的重绘回调，随 MarkdownRenderChild 卸载自行摘除。 */
	private readonly blockRefreshers = new Set<() => void>();

	registerBlockRefresher(refresher: () => void): void {
		this.blockRefreshers.add(refresher);
	}

	unregisterBlockRefresher(refresher: () => void): void {
		this.blockRefreshers.delete(refresher);
	}

	private refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(PAGE_TREE_VIEW_TYPE)) {
			if (leaf.view instanceof PageTreeView) leaf.view.render();
		}
		for (const refresher of Array.from(this.blockRefreshers)) {
			try {
				refresher();
			} catch (error) {
				console.error("[sub-page] 正文块重绘失败", error);
			}
		}
	}

	async activateTree(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(PAGE_TREE_VIEW_TYPE);
		if (existing.length > 0) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice(this.t("notice.rootMissing", { path: this.settings.pageRoot }));
			return;
		}
		await leaf.setViewState({ type: PAGE_TREE_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	/** 打开本插件的设置页。`app.setting` 没有类型声明，只能窄化后调用。 */
	openSettings(): void {
		const app = this.app as App & { setting?: { openTabById?: (id: string) => void } };
		app.setting?.openTabById?.(this.manifest.id);
	}

	/** 读取新建页面模板；没配或读不到都返回 undefined，由调用方退回默认正文。 */
	async loadTemplate(): Promise<string | undefined> {
		const path = this.settings.templatePath;
		if (!path) return undefined;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return undefined;
		try {
			return await this.app.vault.cachedRead(file);
		} catch (error) {
			console.warn("[sub-page] 模板读取失败：", path, error);
			return undefined;
		}
	}

	/** 当前活动笔记对应的页面（没有则为 undefined）。 */
	currentPage() {
		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile)) return undefined;
		return this.service.nodeForFilePath(file.path);
	}
}
