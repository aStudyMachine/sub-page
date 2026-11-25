import { PageId, isRootScope } from "../models/pageId";
import { PageNode, PageTreeSnapshot } from "../models/pageNode";

/**
 * 内存索引：整树扫描替换快照，笔记保存仅替换对应节点。
 */
export class PageIndex {
	private snapshot: PageTreeSnapshot = {
		pageRoot: "",
		rootMissing: false,
		nodes: new Map(),
		roots: [],
		warnings: [],
		folderCount: 0,
		createdAt: 0,
	};

	replace(snapshot: PageTreeSnapshot): void {
		this.snapshot = snapshot;
	}

	get current(): PageTreeSnapshot {
		return this.snapshot;
	}

	get pageRoot(): string {
		return this.snapshot.pageRoot;
	}

	get size(): number {
		return this.snapshot.nodes.size;
	}

	get warnings() {
		return this.snapshot.warnings;
	}

	getNode(id: PageId | null | undefined): PageNode | undefined {
		if (!id) return undefined;
		return this.snapshot.nodes.get(id);
	}

	getRoots(): PageNode[] {
		return this.snapshot.roots.map((id) => this.snapshot.nodes.get(id)).filter((node): node is PageNode => !!node);
	}

	getChildren(id: PageId | null): PageNode[] {
		const ids = isRootScope(id) ? this.snapshot.roots : this.snapshot.nodes.get(id as PageId)?.childIds ?? [];
		return ids.map((childId) => this.snapshot.nodes.get(childId)).filter((node): node is PageNode => !!node);
	}

	/** 从根到该节点的祖先链（不含自身）。 */
	getAncestors(id: PageId): PageNode[] {
		const chain: PageNode[] = [];
		let current = this.snapshot.nodes.get(id);
		while (current?.parentId) {
			const parent = this.snapshot.nodes.get(current.parentId);
			if (!parent) break;
			chain.unshift(parent);
			current = parent;
		}
		return chain;
	}

	/** 找到能容纳页面笔记的节点：文件路径 → 节点（分组目录没有文件，返回 undefined）。 */
	findByFilePath(filePath: string): PageNode | undefined {
		const lowered = filePath.toLowerCase();
		// 区分大小写的库可以同时存在仅大小写不同的笔记。
		let caseInsensitive: PageNode | undefined;
		for (const node of this.snapshot.nodes.values()) {
			if (node.filePath === filePath) return node;
			if (!caseInsensitive && node.filePath?.toLowerCase() === lowered) caseInsensitive = node;
		}
		return caseInsensitive;
	}

	updateModifiedAt(node: PageNode, modifiedAt: number): void {
		if (node.modifiedAt === modifiedAt) return;
		this.snapshot.nodes.set(node.id, { ...node, modifiedAt });
	}

/**
	 * 找到「这个目录本身」代表的节点（父页面或分组目录）。
	 * 不能只比 folderPath —— 目录里的每个文件都把 folderPath 指向同一个目录，
	 * 那样会随机返回目录里的某个叶子页面。目录自身的 id 就是它的相对路径。
	 */
	findByFolderPath(folderPath: string): PageNode | undefined {
		return this.snapshot.nodes.get(folderPath as PageId);
	}

	search(fragment: string): PageNode[] {
		const needle = fragment.trim().toLowerCase();
		if (needle === "") return [];
		const hits: PageNode[] = [];
		for (const node of this.snapshot.nodes.values()) {
			if (node.kind === "group") continue;
			if (node.title.toLowerCase().includes(needle)) hits.push(node);
		}
		return hits;
	}

	stats(): { pages: number; groups: number; roots: number; warnings: number } {
		let groups = 0;
		for (const node of this.snapshot.nodes.values()) {
			if (node.kind === "group") groups += 1;
		}
		return {
			pages: this.snapshot.nodes.size - groups,
			groups,
			roots: this.snapshot.roots.length,
			warnings: this.snapshot.warnings.length,
		};
	}
}
