export type LanguageSetting = "auto" | "zh" | "en";
export type Language = "zh" | "en";

export function detectObsidianLanguage(uiLanguage: string | undefined): Language {
	return (uiLanguage ?? "en").toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function resolveLanguage(setting: LanguageSetting, uiLanguage: string | undefined): Language {
	if (setting === "zh" || setting === "en") return setting;
	return detectObsidianLanguage(uiLanguage);
}

/**
 * 文案用键值表而不是 pick(en, zh) 双份内联字符串：
 * 一条文案只有一处定义，键缺失时能报出键名而不是显示 undefined。
 * 缺键回退到中文并只警告一次 —— 开发期能立刻发现，用户端不会看到空白。
 */
const ZH: Record<string, string> = {
	"view.tree.name": "子页面",

	"cmd.open": "打开子页面面板",
	"cmd.collapseAll": "折叠全部子页面",
	"cmd.expandAll": "展开全部子页面",
	"cmd.newRootPage": "新建根页面",
	"cmd.newChildPage": "新建子页面",
	"cmd.checkStructure": "检查页面结构",
	"cmd.collapseNative": "折叠原生文件浏览器",
	"hint.welcome": "库里的任意笔记都会出现在这里；有同名目录的笔记会自动成为父页面。右键目录可以「补齐配对」。",
	"cmd.rebuildIndex": "重建页面索引",
	"cmd.diagnostics": "复制诊断信息",
	"cmd.revealCurrent": "在子页面面板中定位当前页面",
	"notice.indexing": "正在建立页面索引…",
	"notice.diagnosticsCopied": "诊断信息已复制到剪贴板",
	"notice.diagnosticsConsole": "剪贴板不可用，诊断信息已输出到开发者控制台",
	"hint.folderNote": "检测到 Folder Note 类插件。它也把「同名笔记 + 目录」当成一层页面，同时启用会让同一份结构被两边各改一次。建议只留一个。",

	"menu.newChild": "新建子页面",
	"menu.newSibling": "新建同级页面",
	"menu.rename": "重命名",
	"menu.moveTo": "移动到…",
	"menu.delete": "删除",
	"menu.copyLink": "复制页面链接",
	"menu.openInNewTab": "在新标签页打开",
	"menu.pair": "升级为父页面",
	"menu.pairFolder": "在这里新建页面",
	"menu.unpair": "解除配对（降级为普通页面）",
	"menu.moveUp": "上移",
	"menu.moveDown": "下移",
	"menu.moveTop": "移到最前",
	"menu.moveBottom": "移到最后",
	"menu.revealInExplorer": "在文件浏览器中显示",

	"action.newPage": "新建页面",
	"action.search": "搜索页面…",

	"modal.create.title": "新建页面",
	"modal.create.pairParent": "新建后，「{title}」和子页面将放在「{title}」目录中。",
	"modal.create.placeholder": "页面名称",
	"modal.create.untitled": "未命名",
	"modal.create.optionalName": "留空则使用「{title}」",
	"modal.rename.title": "重命名页面",
	"modal.move.title": "移动页面",
	"modal.move.placeholder": "移动到哪个页面下（留空表示根层）",
	"modal.delete.title": "删除页面",
	"modal.delete.impact": "直接子页面 {direct} 个，全部后代 {all} 个",
	"modal.delete.withChildren": "同时删除 {count} 个子页面",
	"modal.delete.noteOnly": "只删除这一篇笔记，目录与子页面保留",
	"modal.delete.groupImpact": "这是分组目录，没有自己的笔记：连同下面 {direct} 个直接子项、{all} 个后代页面一起移走",
	"modal.delete.useTrash": "移到回收站（取消则永久删除）",
	"modal.confirm": "确定",
	"modal.cancel": "取消",
	"modal.delete.confirm": "删除",

	"notice.created": "已创建「{title}」",
	"notice.renamed": "已改名为「{title}」",
	"notice.moved": "已移动到「{target}」",
	"notice.deleted": "已删除 {count} 个页面",
	"notice.noMatches": "没有匹配的页面",
	"notice.empty": "还没有页面，点下面的按钮开始",
	"notice.rootMissing": "页面根目录不存在：{path}",
	"notice.rebuilt": "已重建索引：{count} 个页面",
	"notice.linkCopied": "已复制页面链接",
	"notice.structureOk": "页面结构正常",

	"error.invalidName": "名称不合法",
	"error.nameConflict": "同级已有同名页面",
	"error.notFound": "页面已不存在，可能被外部改动",
	"error.name.empty": "名称不能为空",
	"error.name.tooLong": "名称太长了（上限 100 个字符）",
	"error.name.illegalChar": "名称不能包含 {detail}",
	"error.name.dotName": "名称不能是 . 或 ..",
	"error.name.edge": "名称不能以空格开头或结尾，也不能以点结尾",
	"error.name.reserved": "这是系统保留名，换一个",
	"error.moveIntoSelf": "不能移动到它自己下面",
	"error.moveIntoDescendant": "不能移动到自己的子页面里",
	"block.empty": "这个页面还没有子页面",
	"block.notAPage": "这里不是页面目录，无法列出子页面",
	"block.notParent": "这篇笔记还不是父页面，没有可以列出的子页面",
	"block.pair": "创建子页面目录",
	"block.create": "新建子页面",
	"block.count": "{count} 个子页面",

	"settings.pageRoot.name": "页面根目录",
	"settings.pageRoot.desc": "从这个目录开始展示页面树。留空表示整个库。",
	"settings.defaultView.name": "正文块默认视图",
	"settings.defaultView.desc": "笔记里的子页面代码块默认用哪种样式显示。",
	"settings.defaultSort.name": "默认排序",
	"settings.defaultSort.desc": "正文子页面块的默认排列方式；侧栏始终按名称排，手动拖过的位置优先。",
	"settings.showEmptyFolders.name": "显示空目录",
	"settings.showEmptyFolders.desc": "把没有页面的目录也列出来，可以右键在里面新建页面。",
	"settings.collapseEmptyParents.name": "无子页面则删除文件夹，还原原本的页面",
	"settings.collapseEmptyParents.desc": "文件夹里只剩原笔记时，将笔记移回上一级，并把空文件夹移入回收站。有其他内容或同名冲突时保留文件夹。",
	"settings.confirmDelete.name": "删除前确认",
	"settings.confirmDelete.desc": "关闭后删除不会弹确认框，只能用回收站恢复。",
	"settings.templatePath.name": "页面模板",
	"settings.templatePath.desc": "新建页面时套用的模板文件路径。留空则写入「# 标题」。",
	"settings.excludedFolders.name": "不索引的目录",
	"settings.excludedFolders.desc": "每行一个目录名（只比名字，不比路径）。",
	"settings.language.name": "界面语言",
	"settings.language.desc": "跟随 Obsidian 或强制指定。",
	"settings.language.auto": "自动（跟随 Obsidian）",
	"settings.debugLog.name": "调试日志",
	"settings.debugLog.desc": "把索引与刷新的细节打到开发者控制台。",
	"settings.section.behavior": "行为",
	"settings.section.appearance": "外观",
	"settings.section.advanced": "高级",

	"sort.name": "名称",
	"sort.created": "创建时间",
	"sort.modified": "修改时间",
	"sort.manual": "手动顺序",
	"view.list": "列表",
	"view.card": "卡片",

	"structure.title": "页面结构检查",
	"structure.fix": "为它创建笔记",
	"structure.section.orphans": "顺序表里的孤立条目",
	"structure.orphan": "这一项在磁盘上已经不存在了",
	"structure.clean": "清掉",
	"structure.cleanAll": "全部清掉",
	"structure.section.conflicts": "大小写冲突",
	"structure.section.depth": "超出层级上限",
	"structure.section.unpaired": "可以升级为父页面的目录",
	"structure.pairSelected": "补齐选中的 {count} 个",
	"structure.select": "选择「{title}」",
	"structure.confirmBulk": "要给 {count} 个目录各建一篇同名笔记，确定继续？",
	"modal.confirmTitle": "请确认",
	"structure.bulkFailed": "有 {count} 个目录没补齐，可能已存在同名笔记",
};

const EN: Record<string, string> = {
	"view.tree.name": "Sub Page",

	"cmd.open": "Open sub page panel",
	"cmd.collapseAll": "Collapse all sub pages",
	"cmd.expandAll": "Expand all sub pages",
	"cmd.newRootPage": "New root page",
	"cmd.newChildPage": "New child page",
	"cmd.checkStructure": "Check page structure",
	"cmd.collapseNative": "Collapse native file explorer",
	"hint.welcome": "Every note in your vault shows up here; a note with a folder of the same name becomes a parent page. Right-click a folder to pair it.",
	"cmd.rebuildIndex": "Rebuild page index",
	"cmd.diagnostics": "Copy diagnostics",
	"cmd.revealCurrent": "Reveal current page in sub page panel",
	"notice.indexing": "Building the page index…",
	"notice.diagnosticsCopied": "Diagnostics copied to the clipboard",
	"notice.diagnosticsConsole": "Clipboard unavailable; diagnostics printed to the developer console",
	"hint.folderNote": "A folder-note plugin is enabled. It also treats a note plus its same-named folder as one page, so the two will keep writing over each other. Keep only one of them.",

	"menu.newChild": "New sub page",
	"menu.newSibling": "New sibling page",
	"menu.rename": "Rename",
	"menu.moveTo": "Move to…",
	"menu.delete": "Delete",
	"menu.copyLink": "Copy page link",
	"menu.openInNewTab": "Open in new tab",
	"menu.pair": "Turn into parent page",
	"menu.pairFolder": "New page here",
	"menu.unpair": "Unpair (back to plain page)",
	"menu.moveUp": "Move up",
	"menu.moveDown": "Move down",
	"menu.moveTop": "Move to top",
	"menu.moveBottom": "Move to bottom",
	"menu.revealInExplorer": "Reveal in file explorer",

	"action.newPage": "New page",
	"action.search": "Search pages…",

	"modal.create.title": "New page",
	"modal.create.pairParent": "The new folder “{title}” will contain both the original page and the child page.",
	"modal.create.placeholder": "Page name",
	"modal.create.untitled": "Untitled",
	"modal.create.optionalName": "Leave blank to use “{title}”",
	"modal.rename.title": "Rename page",
	"modal.move.title": "Move page",
	"modal.move.placeholder": "Target page (leave empty for root)",
	"modal.delete.title": "Delete page",
	"modal.delete.impact": "{direct} direct sub pages, {all} in total",
	"modal.delete.withChildren": "Also delete {count} sub pages",
	"modal.delete.noteOnly": "Delete this note only, keep the folder and sub pages",
	"modal.delete.groupImpact":
		"This is a group folder with no note of its own: {direct} direct children and {all} pages underneath go with it",
	"modal.delete.useTrash": "Move to trash (uncheck to delete permanently)",
	"modal.confirm": "OK",
	"modal.cancel": "Cancel",
	"modal.delete.confirm": "Delete",

	"notice.created": "Created \"{title}\"",
	"notice.renamed": "Renamed to \"{title}\"",
	"notice.moved": "Moved to \"{target}\"",
	"notice.deleted": "Deleted {count} page(s)",
	"notice.noMatches": "No matching pages",
	"notice.empty": "No pages yet. Use the button below to create one.",
	"notice.rootMissing": "Page root does not exist: {path}",
	"notice.rebuilt": "Index rebuilt: {count} page(s)",
	"notice.linkCopied": "Page link copied",
	"notice.structureOk": "Page structure looks fine",

	"error.invalidName": "Invalid name",
	"error.nameConflict": "A page with that name already exists",
	"error.notFound": "Page no longer exists, it may have been changed outside Obsidian",
	"error.name.empty": "Name cannot be empty",
	"error.name.tooLong": "Name is too long (100 characters max)",
	"error.name.illegalChar": "Name cannot contain {detail}",
	"error.name.dotName": "Name cannot be . or ..",
	"error.name.edge": "Name cannot start or end with a space, or end with a dot",
	"error.name.reserved": "That name is reserved by the system",
	"error.moveIntoSelf": "Cannot move a page into itself",
	"error.moveIntoDescendant": "Cannot move a page into its own sub page",
	"block.empty": "This page has no sub pages yet",
	"block.notAPage": "This folder is not a page, cannot list sub pages",
"block.notParent": "This note is not a parent page yet, so it has no sub pages",
"block.pair": "Create sub page folder",
	"block.create": "New sub page",
	"block.count": "{count} sub pages",

	"settings.pageRoot.name": "Page root",
	"settings.pageRoot.desc": "Show the page tree starting from this folder. Leave empty for the whole vault.",
	"settings.defaultView.name": "Default block view",
	"settings.defaultView.desc": "How the sub pages code block is rendered by default.",
	"settings.defaultSort.name": "Default sort",
	"settings.defaultSort.desc": "Default order inside the sub pages block. The sidebar always sorts by name, unless you dragged something.",
	"settings.showEmptyFolders.name": "Show empty folders",
	"settings.showEmptyFolders.desc": "List folders without pages so you can create pages inside them.",
	"settings.collapseEmptyParents.name": "Restore pages that have no children",
	"settings.collapseEmptyParents.desc": "Move the original note up one level and trash its empty folder. Keep the folder if it contains other items or the name conflicts.",
	"settings.confirmDelete.name": "Confirm before delete",
	"settings.confirmDelete.desc": "When off, deleting does not ask; only the trash can bring it back.",
	"settings.templatePath.name": "Page template",
	"settings.templatePath.desc": "Template file used for new pages. Empty means a plain \"# Title\".",
	"settings.excludedFolders.name": "Excluded folders",
	"settings.excludedFolders.desc": "One folder name per line (matched by name, not path).",
	"settings.language.name": "Language",
	"settings.language.desc": "Follow Obsidian or force a language.",
	"settings.language.auto": "Auto (follow Obsidian)",
	"settings.debugLog.name": "Debug log",
	"settings.debugLog.desc": "Log index and refresh details to the developer console.",
	"settings.section.behavior": "Behavior",
	"settings.section.appearance": "Appearance",
	"settings.section.advanced": "Advanced",

	"sort.name": "Name",
	"sort.created": "Created",
	"sort.modified": "Modified",
	"sort.manual": "Manual order",
	"view.list": "List",
	"view.card": "Cards",

	"structure.title": "Page structure check",
	"structure.fix": "Create the note",
	"structure.section.orphans": "Orphaned order entries",
	"structure.orphan": "This entry no longer exists on disk",
	"structure.clean": "Remove",
	"structure.cleanAll": "Remove all",
	"structure.section.conflicts": "Case conflicts",
	"structure.section.depth": "Beyond depth limit",
	"structure.section.unpaired": "Folders that could become parent pages",
	"structure.pairSelected": "Pair {count} selected",
	"structure.select": "Select \"{title}\"",
	"structure.confirmBulk": "Create a matching note in {count} folders. Continue?",
	"modal.confirmTitle": "Please confirm",
	"structure.bulkFailed": "{count} folder(s) could not be paired; a note with the same name may exist",
};

const TABLES: Record<Language, Record<string, string>> = { zh: ZH, en: EN };

/** 供测试用：两套表的键必须完全一致，漏一个就会在界面上显示成键名。 */
export function translationKeys(): { zh: string[]; en: string[] } {
	return { zh: Object.keys(ZH).sort(), en: Object.keys(EN).sort() };
}

export class Translator {
	private warned = new Set<string>();

	constructor(private language: Language = "zh") {}

	setLanguage(language: Language): void {
		this.language = language;
	}

	get current(): Language {
		return this.language;
	}

	t(key: string, vars?: Record<string, string | number>): string {
		const table = TABLES[this.language];
		let text = table[key];
		if (text === undefined) {
			// 缺键：退到中文，再退到键名本身；同一条只警告一次，避免刷屏。
			text = ZH[key];
			if (text === undefined) {
				text = key;
				if (!this.warned.has(key)) {
					this.warned.add(key);
					console.warn(`[sub-page] 缺少文案键：${key}`);
				}
			}
		}
		if (!vars) return text;
		return text.replace(/\{(\w+)\}/g, (match, name: string) =>
			vars[name] === undefined ? match : String(vars[name]),
		);
	}
}
