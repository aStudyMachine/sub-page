import { App, Notice, Platform, Plugin, TFile, apiVersion, getLanguage, setTooltip } from "obsidian";
import { ObsidianVaultAdapter } from "./adapters/obsidianVaultAdapter";
import { PageService } from "./core/pageService";
import { SubPageSettingTab } from "./settings";
import { DEFAULT_SETTINGS, SubPageSettings, migrateSettings } from "./models/settings";
import { Translator, resolveLanguage } from "./i18n";
import { PAGE_TREE_VIEW_TYPE, PageTreeView } from "./views/pageTreeView";
import { remapExpanded } from "./views/treeState";
import { registerSubPageBlockProcessor } from "./views/subPageRenderer";
import { registerCommands } from "./commands";
import { findConflictingPlugins } from "./utils/conflictingPlugins";

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
	/** 功能区按钮。语言切换后要改它的提示文字，所以留着引用。 */
	private ribbonEl: HTMLElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.service = new PageService({
			adapter: new ObsidianVaultAdapter(this.app),
			settings: () => this.settings,
			onChange: () => this.refreshViews(),
			onIdsRenamed: (from, to) => this.remapExpandedIds(from, to),
			onProblem: (message) => new Notice(message, 6000),
			debounceMs: 200,
		});
		this.register(() => this.service.dispose());
		// 万页库首扫要几百毫秒。超过阈值才提示，否则正常库会闪一下没用的通知。
		await this.startWithProgress();

		this.registerView(PAGE_TREE_VIEW_TYPE, (leaf) => new PageTreeView(leaf, this));

		const blockRegistered = registerSubPageBlockProcessor(this);
		if (!blockRegistered) {
			console.warn("[sub-page] subpages 代码块语言已被其它插件占用");
		}

		this.addSettingTab(new SubPageSettingTab(this.app, this));
		// 只有命令入口时，装完插件界面上什么都不会变，用户找不到树。功能区给一个显式入口。
		this.ribbonEl = this.addRibbonIcon("list-tree", this.t("view.tree.name"), () => void this.activateTree());
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

	/** 首扫可能要几百毫秒；慢到用户会察觉时才提示，扫完立刻撤掉。 */
	private async startWithProgress(): Promise<void> {
		// 用对象承着：赋值发生在定时器回调里，TS 的控制流分析看不到，
		// 会把变量一直当成 null，从而把 hide() 报成「属性不存在」。
		const holder: { notice: Notice | null } = { notice: null };
		const timer = window.setTimeout(() => {
			holder.notice = new Notice(this.t("notice.indexing"), 0);
		}, 400);
		try {
			await this.service.start();
		} finally {
			window.clearTimeout(timer);
			holder.notice?.hide();
		}
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
		// 命令是整组重建的，功能区按钮只在 onload 建一次，提示文字得手动跟。
		if (this.ribbonEl) setTooltip(this.ribbonEl, this.t("view.tree.name"), { placement: "right" });
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

	/**
	 * 子树改名或移动后，把所有按 id 存的界面状态搬过去。
	 * 只搬设置里那份；已经打开的侧栏自己有副本，一并通知它搬。
	 */
	async remapExpandedIds(from: string, to: string): Promise<void> {
		const next = remapExpanded(new Set(this.settings.expandedIds), from, to);
		this.settings = { ...this.settings, expandedIds: Array.from(next) };
		await this.saveSettings();
		for (const leaf of this.app.workspace.getLeavesOfType(PAGE_TREE_VIEW_TYPE)) {
			if (leaf.view instanceof PageTreeView) leaf.view.applyExpanded(next);
		}
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

	/** 诊断信息：复制到剪贴板并弹一句提示。报障时最省事的形式就是贴一段文本。 */
	async copyDiagnostics(): Promise<void> {
		const { buildDiagnostics } = await import("./core/diagnostics");
		const text = buildDiagnostics({
			pluginVersion: this.manifest.version,
			appVersion: apiVersion,
			platform: Platform.isMobileApp ? "mobile" : "desktop",
			language: this.language,
			settings: {
				pageRoot: this.settings.pageRoot,
				defaultView: this.settings.defaultView,
				defaultSort: this.settings.defaultSort,
				showEmptyFolders: this.settings.showEmptyFolders,
				excludedFolders: this.settings.excludedFolders,
			},
			snapshot: this.service.index.current,
			order: this.service.order.current,
			orderProblem: this.service.order.problem,
			expandedCount: this.settings.expandedIds.length,
			conflictingPlugins: findConflictingPlugins(this.app),
			scanMs: this.service.lastScanMs,
		});
		try {
			await navigator.clipboard.writeText(text);
			new Notice(this.t("notice.diagnosticsCopied"), 6000);
		} catch (error) {
			// 剪贴板不可用（权限 / 非 https）时退成控制台输出，至少还能拿到。
			console.warn("[sub-page] 剪贴板不可用，诊断信息输出到控制台", error);
			console.info(text);
			new Notice(this.t("notice.diagnosticsConsole"), 6000);
		}
	}

	/** 当前活动笔记对应的页面（没有则为 undefined）。 */
	currentPage() {
		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile)) return undefined;
		return this.service.nodeForFilePath(file.path);
	}
}
