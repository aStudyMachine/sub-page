import { VaultAdapter } from "../adapters/vaultAdapter";
import { PageId } from "../models/pageId";
import { EMPTY_METADATA } from "../models/pageMetadata";
import { NodeKind, PageNode, PageTreeSnapshot, ScanWarning } from "../models/pageNode";
import { OrderMap, orderChildren } from "../models/pageOrder";
import { naturalCompare } from "../utils/naturalSort";
import { basename, isMarkdownFile, isSameOrDescendantPath, normalizePath, pathDepth, stripExtension } from "../utils/pathUtils";

export interface ScanOptions {
	/** 作用域 → 子项 key 顺序；缺省时全部按名称自然排序。 */
	order?: OrderMap;
	maxDepth?: number;
	/** 额外排除的目录名（默认清单在调用侧拼好）。 */
	excludedFolders?: string[];
	/**
	 * 显示不含任何页面的目录（灰色行，可右键升级为父页面）。
	 * 默认关闭：_assets 这类目录不该干扰视图。
	 */
	showEmptyFolders?: boolean;
}

export const DEFAULT_MAX_DEPTH = 32;

export function isExcludedFolder(name: string, excluded: ReadonlySet<string>): boolean {
	return name.startsWith(".") || excluded.has(name.toLowerCase());
}

interface TempNode {
	id: PageId;
	kind: NodeKind;
	title: string;
	key: string;
	filePath: string | null;
	folderPath: string;
	children: TempNode[];
	mtime: number;
	ctime: number;
}

/**
 * 一次深度优先遍历产出整棵树。
 *
 * 只看目录的直接子项，不用 getMarkdownFiles 全库列表：后者在大库里是 O(全库)
 * 且拿不到「某目录里没有页面」这种信息。整个扫描只读目录元数据，不读文件内容。
 */
export async function scan(adapter: VaultAdapter, pageRoot: string, options: ScanOptions = {}): Promise<PageTreeSnapshot> {
	const root = normalizePath(pageRoot);
	const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
	const excluded = new Set((options.excludedFolders ?? []).map((name) => name.toLowerCase()));
	const warnings: ScanWarning[] = [];
	const nodes = new Map<PageId, PageNode>();

	const relOf = (absolutePath: string): string => {
		if (root === "") return normalizePath(absolutePath);
		return normalizePath(absolutePath).slice(root.length + 1);
	};

	const visitFolder = async (folderPath: string, depth: number): Promise<{ self: TempNode | null; children: TempNode[] }> => {
		const listing = await adapter.listFolder(folderPath);
		if (!listing) {
			warnings.push({ kind: "read-error", path: folderPath, message: "读不到这个目录，已跳过" });
			return { self: null, children: [] };
		}

		const folderName = basename(folderPath);
		const markdownFiles = listing.files.filter((file) => isMarkdownFile(file.name));

		// 配对判定：本目录里存在与本目录同名的 .md（大小写不敏感）。
		// 只在这里判断一次，父子关系完全由文件系统推导，插件不维护额外索引。
		const selfFile =
			depth === 0 ? null : markdownFiles.find((file) => stripExtension(file.name).toLowerCase() === folderName.toLowerCase()) ?? null;

		checkNameConflicts(listing.folders.map((entry) => entry.name), folderPath, warnings);
		checkNameConflicts(markdownFiles.map((entry) => stripExtension(entry.name)), folderPath, warnings);

		const children: TempNode[] = [];

		for (const file of markdownFiles) {
			if (selfFile && file.path.toLowerCase() === selfFile.path.toLowerCase()) continue;
			children.push({
				id: relOf(file.path) as PageId,
				kind: "leaf",
				title: stripExtension(file.name),
				key: file.name,
				filePath: file.path,
				folderPath,
				children: [],
				mtime: file.mtime,
				ctime: file.ctime,
			});
		}

		for (const folder of listing.folders) {
			if (isExcludedFolder(folder.name, excluded)) continue;
			if (depth + 1 > maxDepth) {
				warnings.push({ kind: "depth-limit", path: folder.path, message: `层级超过 ${maxDepth} 层，以下内容未索引` });
				continue;
			}
			const sub = await visitFolder(folder.path, depth + 1);
			if (sub.self) {
				children.push(sub.self);
			} else if (sub.children.length > 0) {
				children.push({
					id: relOf(folder.path) as PageId,
					kind: "group",
					title: folder.name,
					key: folder.name,
					filePath: null,
					folderPath: folder.path,
					children: sub.children,
					mtime: 0,
					ctime: 0,
				});
			} else if (options.showEmptyFolders) {
				children.push({
					id: relOf(folder.path) as PageId,
					kind: "group",
					title: folder.name,
					key: folder.name,
					filePath: null,
					folderPath: folder.path,
					children: [],
					mtime: 0,
					ctime: 0,
				});
			}
		}

		const self: TempNode | null = selfFile
			? {
					id: relOf(folderPath) as PageId,
					kind: "parent",
					title: folderName,
					key: folderName,
					filePath: selfFile.path,
					folderPath,
					children,
					mtime: selfFile.mtime,
					ctime: selfFile.ctime,
				}
			: null;

		return { self, children };
	};

	const rootListing = await adapter.listFolder(root.length === 0 ? "" : root);
	let rootChildren: TempNode[] = [];
	let folderCount = 0;
	if (!rootListing) {
		warnings.push({ kind: "read-error", path: root, message: "页面根不存在" });
	} else {
		const visited = await visitFolder(root.length === 0 ? "" : root, 0);
		rootChildren = visited.children;
	}

	// 页面数量直接从临时树算，不依赖 nodes 是否已经填好 —— 依赖注册顺序会在
	// 「兄弟节点还没轮到自己」时少算，这条路径必须与遍历顺序无关。
	const countPages = (node: TempNode): number =>
		(node.kind === "group" ? 0 : 1) + node.children.reduce((total, child) => total + countPages(child), 0);

	const flatten = (children: TempNode[], parentId: PageId | null, scope: string, depth: number): PageId[] => {
		// 同名笔记与同名目录（`项目A.md` 与 `项目A/`）会得到相同的显示名，
		// 用 key 做第二比较键，保证每次扫描的次序完全一致。
		const sorted = orderChildren(
			[...children].sort((a, b) => naturalCompare(a.title, b.title) || naturalCompare(a.key, b.key)),
			options.order?.[scope],
		);
		const ids: PageId[] = [];
		for (const child of sorted) {
			const childIds = flatten(child.children, child.id, child.id, depth + 1);
			// 只数页面，不数分组目录：删除确认里「全部后代 M 个」指的是会被一起移走的页面。
			const descendantCount = child.children.reduce((total, grandchild) => total + countPages(grandchild), 0);
			nodes.set(child.id, {
				id: child.id,
				kind: child.kind,
				title: child.title,
				depth,
				parentId,
				childIds,
				filePath: child.filePath,
				folderPath: child.folderPath,
				metadata: EMPTY_METADATA,
				descendantCount,
				modifiedAt: child.mtime,
				createdAt: child.ctime,
			});
			folderCount += child.kind === "group" ? 1 : 0;
			ids.push(child.id);
		}
		return ids;
	};

	const roots = flatten(rootChildren, null, "", 1);

	return {
		pageRoot: root,
		nodes,
		roots,
		warnings,
		folderCount,
		createdAt: Date.now(),
	};
}

/** 同一层里只有大小写不同的同级项在 Windows 上会互相覆盖，必须报出来。 */
function checkNameConflicts(names: string[], folderPath: string, warnings: ScanWarning[]): void {
	const seen = new Map<string, string>();
	const reported = new Set<string>();
	for (const name of names) {
		const lowered = name.toLowerCase();
		const previous = seen.get(lowered);
		if (previous !== undefined && previous !== name && !reported.has(lowered)) {
			reported.add(lowered);
			warnings.push({
				kind: "case-conflict",
				path: folderPath,
				message: `"${previous}" 与 "${name}" 只差大小写，在 Windows 上会冲突`,
			});
			continue;
		}
		seen.set(lowered, name);
	}
}

export function isInsidePageRoot(path: string, pageRoot: string): boolean {
	return isSameOrDescendantPath(path, pageRoot);
}

export function depthOf(pageRoot: string, path: string): number {
	const normalizedRoot = normalizePath(pageRoot);
	const normalizedPath = normalizePath(path);
	const relative = normalizedRoot === "" ? normalizedPath : normalizedPath.slice(normalizedRoot.length + 1);
	return pathDepth(relative);
}
