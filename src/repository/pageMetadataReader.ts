import { VaultAdapter } from "../adapters/vaultAdapter";
import { PageMetadata, EMPTY_METADATA, metadataFromFrontMatter } from "../models/pageMetadata";
import { PageNode } from "../models/pageNode";

/**
 * 元数据读取：与扫描分开，因为读文件内容比读目录贵一个数量级。
 * 5 千个页面的库如果扫描时就逐个读 front matter，首次加载会明显卡住。
 * 这里按 mtime 缓存：文件没改过就不重读。
 */
export class PageMetadataReader {
	private cache = new Map<string, { mtime: number; metadata: PageMetadata }>();

	constructor(private readonly adapter: VaultAdapter) {}

	forget(path: string): void {
		this.cache.delete(path.toLowerCase());
	}

	clear(): void {
		this.cache.clear();
	}

	async read(node: PageNode): Promise<PageMetadata> {
		if (!node.filePath) return EMPTY_METADATA;
		const key = node.filePath.toLowerCase();
		const cached = this.cache.get(key);
		if (cached) return cached.metadata;
		const frontmatter = await this.adapter.readFrontMatter(node.filePath);
		const metadata = frontmatter ? metadataFromFrontMatter(frontmatter) : EMPTY_METADATA;
		this.cache.set(key, { mtime: 0, metadata });
		return metadata;
	}

	/** 批量补齐，供首屏渲染用。单个失败不影响其它节点。 */
	async readAll(nodes: PageNode[]): Promise<Map<string, PageMetadata>> {
		const result = new Map<string, PageMetadata>();
		for (const node of nodes) {
			try {
				result.set(node.id, await this.read(node));
			} catch {
				result.set(node.id, EMPTY_METADATA);
			}
		}
		return result;
	}
}
