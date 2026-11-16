# Obsidian 子页面插件技术设计方案

> 方案版本：v1.0
> 技术定位：基于 Obsidian Vault 文件系统的 Notion 风格嵌套页面管理插件
> 核心选型：`paired + block + independent`

## 1. 项目目标与设计原则

### 1.1 项目目标

实现一套类似 Notion 的页面管理体验，让 Obsidian 用户能够：

1. 在独立侧边栏中查看多级页面树。
2. 创建、重命名、移动、删除页面及子页面。
3. 在父页面正文中直接查看和管理子页面。
4. 通过拖拽调整页面层级。
5. 页面结构直接映射到 Vault 文件系统。
6. 不依赖插件私有数据库保存核心页面关系。
7. 支持 Windows、Android 等 Obsidian 平台。

### 1.2 核心设计原则

| 原则          | 设计要求                                |
| ------------- | --------------------------------------- |
| 文件系统优先  | 页面父子关系由目录结构决定              |
| Markdown 优先 | 页面正文仍是普通 Markdown 文件          |
| 单一数据来源  | 不在 JSON 中重复保存页面树              |
| 统一业务入口  | Sidebar 和正文视图共用 PageService      |
| 官方 API 优先 | 文件操作使用 Obsidian Vault/FileManager |
| 增量更新      | 文件变化后更新索引，避免频繁全量扫描    |
| 跨平台        | 不依赖 Node.js、Electron 私有能力       |
| 可恢复        | 文件结构异常时可以扫描和修复            |

### 1.3 第一版不做什么

为避免项目范围失控，第一版暂不实现：

- 任意页面之间的跨目录逻辑父子关系。
- 页面数据库、关系型元数据存储。
- 实时协同编辑。
- 页面权限系统。
- 正文编辑模式下的原生交互组件。
- 页面内容全文索引。
- 多种页面布局的复杂自定义系统。

# 2. 页面数据模型

## 2.1 paired 文件结构

采用页面文件和同名目录配对的方式。

一个页面由两个部分组成：

- `页面名称.md`：页面正文。
- `页面名称/`：该页面的子页面及附件目录。

例如：

```
Knowledge/
│
├── Java/
│   ├── Java.md
│   │
│   ├── JVM/
│   │   ├── JVM.md
│   │   ├── 运行时数据区/
│   │   │   └── 运行时数据区.md
│   │   └── 垃圾回收/
│   │       └── 垃圾回收.md
│   │
│   └── JUC/
│       └── JUC.md
│
├── Spring/
│   ├── Spring.md
│   └── Spring Boot/
│       └── Spring Boot.md
│
└── README.md
```

对应页面树：

```
Knowledge
├── Java
│   ├── JVM
│   │   ├── 运行时数据区
│   │   └── 垃圾回收
│   └── JUC
└── Spring
    └── Spring Boot
```

这里需要明确：

**页面不是目录，页面是 Markdown 文件与同名目录组成的逻辑实体。**

目录只是页面的子页面容器。

## 2.2 页面路径规则

假设页面根目录配置为 `Knowledge`。

页面名称为 `JVM`，父页面为 `Java`。

| 属性         | 路径                        |
| ------------ | --------------------------- |
| 页面文件     | `Knowledge/Java/JVM/JVM.md` |
| 页面目录     | `Knowledge/Java/JVM/`       |
| 父页面文件   | `Knowledge/Java/Java.md`    |
| 父页面目录   | `Knowledge/Java/`           |
| 页面相对路径 | `Java/JVM`                  |

统一定义：

```
interface PagePath {
  // 页面文件路径
  filePath: string;

  // 页面目录路径
  folderPath: string;

  // 父页面目录路径
  parentFolderPath: string;
}
```

路径计算规则：

```
function getPageFilePath(folderPath: string): string {
  const name = folderPath.split("/").pop()!;
  return `${folderPath}/${name}.md`;
}

function getPageFolderPath(filePath: string): string {
  return filePath.replace(/\/[^/]+\.md$/, "");
}
```

实际实现中应使用独立的 `PathUtils`，统一处理：

- Vault 根路径。
- 路径分隔符。
- 文件扩展名。
- 空格及特殊字符。
- 大小写冲突。
- 页面名称合法性。

不要在各业务模块中直接拼接路径。

## 2.3 页面识别规则

扫描某个目录时，识别规则如下：

1. 遍历当前目录的直接子目录。
2. 检查子目录中是否存在与目录同名的 Markdown 文件。
3. 如果存在，则识别为一个页面。
4. 如果不存在，则视为普通目录或异常目录。
5. 对识别出的页面目录继续递归扫描。

示例：

```
Knowledge/
├── Java/
│   ├── Java.md       # 页面
│   ├── JVM/
│   │   └── JVM.md    # 子页面
│   └── attachments/  # 普通目录
│
└── images/           # 普通目录
```

识别结果：

- Java：页面。
- JVM：Java 的子页面。
- attachments：非页面目录。
- images：非页面目录。

这样可以避免把 Vault 中所有普通文件夹都当成页面。

### 页面根目录

建议提供一个可配置的页面根目录：

```
interface PluginSettings {
  pageRoot: string;
  showEmptyPages: boolean;
  defaultView: "list" | "card";
  defaultSort: "name" | "created" | "modified";
  confirmDelete: boolean;
  deleteChildrenTogether: boolean;
}
```

默认可以设置为 `Pages`，用户也可以选择已有目录。

页面根目录本身不要求存在同名 Markdown 文件，它只是页面树的容器。

## 2.4 核心数据模型

### PageNode

```
import { TFile, TFolder } from "obsidian";

export interface PageNode {
  /**
   * 页面唯一标识。
   * 第一版可以使用规范化 folderPath。
   * 注意：路径会随着页面移动、重命名而变化。
   */
  id: string;

  /** 页面名称 */
  title: string;

  /** 页面 Markdown 文件 */
  file: TFile;

  /** 页面目录 */
  folder: TFolder;

  /** 父页面 ID，根页面为 null */
  parentId: string | null;

  /** 子页面 */
  children: PageNode[];

  /** 当前层级 */
  depth: number;

  /** 是否存在子页面 */
  hasChildren: boolean;

  /** 是否可以作为正常页面展示 */
  valid: boolean;
}
```

### PageMetadata

页面的图标和描述可以使用 Markdown Properties 保存：

```
---
icon: 🧠
description: JVM 内存管理与垃圾回收
---
```

对应模型：

```
export interface PageMetadata {
  icon?: string;
  description?: string;
}
```

不建议在第一版把页面名称、父子关系、排序顺序等重复写进 Properties。

页面层级由文件系统决定，避免出现文件路径和 Properties 中 parent_id 不一致的双重事实来源。

### PageTreeSnapshot

```
export interface PageTreeSnapshot {
  rootPath: string;
  nodes: Map<string, PageNode>;
  roots: PageNode[];
  lastUpdated: number;
}
```

说明：

- `nodes` 用于快速通过 ID 查询节点。
- `roots` 用于渲染页面树。
- `lastUpdated` 用于记录索引更新时间。
- 该对象是运行时缓存，不是持久化数据。

## 2.5 关于稳定 ID

第一版可以使用页面目录路径作为 ID：

```
Knowledge/Java/JVM
```

优点：

- 不需要额外维护 ID。
- 可以直接定位页面。
- 页面移动后自然更新。

缺点：

- 页面重命名或移动时 ID 会变化。
- 展开状态、缓存等需要跟随路径迁移。

因此建议：

- v0.1 使用路径 ID。
- v0.2 增加统一的路径变更事件。
- 后续如果确实需要稳定引用，再考虑引入 UUID Properties。

不建议一开始就增加 UUID，避免给文件迁移和异常恢复引入额外复杂度。

# 3. 文件操作规则

## 3.1 创建页面

创建子页面时，假设父页面目录为：

```
Knowledge/Java/
```

创建 `JVM` 页面后：

```
Knowledge/Java/
└── JVM/
    └── JVM.md
```

创建流程：

```
用户点击创建子页面
        |
        v
校验页面名称
        |
        v
检查同名页面是否存在
        |
        v
创建页面目录
        |
        v
创建同名 Markdown 文件
        |
        v
刷新页面索引
        |
        v
打开新页面
```

注意：目录和 Markdown 文件是两个独立的文件系统操作，不能假设它们具备事务性。

如果创建 Markdown 文件失败，需要尝试清理刚创建的空目录，并向用户报告实际结果。

## 3.2 重命名页面

原页面：

```
Knowledge/Java/JVM/
├── JVM.md
└── GC/
    └── GC.md
```

重命名为 `Java 虚拟机`：

```
Knowledge/Java/Java 虚拟机/
├── Java 虚拟机.md
└── GC/
    └── GC.md
```

重命名必须同时完成：

1. 页面目录重命名。
2. 同名 Markdown 文件重命名。
3. 刷新页面索引。
4. 更新侧栏展开状态和当前选中状态。

推荐通过 `FileManager.renameFile()` 处理 Markdown 文件的重命名，让 Obsidian 有机会维护相关链接。

目录重命名需要通过 Vault 的文件操作 API 完成。

如果两个步骤中途失败，需要执行补偿操作或进入异常状态，不能静默留下不完整的页面结构。

## 3.3 移动页面

移动页面本质上是移动整个页面目录。

例如：

```
Knowledge/Java/JVM/
```

移动到：

```
Knowledge/Computer/JVM/
```

移动后：

```
Knowledge/Computer/
└── JVM/
    └── JVM.md
```

移动前必须校验：

- 目标父页面存在。
- 目标父页面不是当前页面。
- 目标父页面不是当前页面的后代。
- 目标目录不存在同名页面。
- 不允许移动到页面根目录之外。
- 不允许移动到插件管理的临时目录。

移动成功后重新计算 parentId 和 depth。

## 3.4 删除页面

默认建议采用 Obsidian 回收站机制，而不是直接永久删除。

删除页面前提示：

```
确定删除页面「Java」？

该页面包含：
- 2 个直接子页面
- 8 个下级页面
- 相关附件

删除后，整个页面目录将被移动到回收站。
```

建议提供两种策略：

- 删除整个页面目录：包括子页面及附件。
- 仅删除当前页面：如果仍有子页面，则禁止直接删除，或者明确要求先移动子页面。

第一版默认采用删除整个页面目录，且执行前二次确认。

# 4. 核心业务架构

## 4.1 整体架构

```
┌──────────────────────────────────────────────┐
│                   UI Layer                   │
│                                              │
│  ┌─────────────────┐  ┌───────────────────┐  │
│  │ PageTreeView    │  │ SubPageRenderer   │  │
│  │ 左侧页面树       │  │ 正文子页面代码块   │  │
│  └────────┬────────┘  └─────────┬─────────┘  │
│           │                     │            │
│           └──────────┬──────────┘            │
└─────────────────────┼────────────────────────┘
                      │
                      v
┌──────────────────────────────────────────────┐
│              Application Service             │
│                                              │
│  PageService                                  │
│  PageTreeService                              │
│  PageOperationService                         │
│                                              │
└─────────────────────┬────────────────────────┘
                      │
                      v
┌──────────────────────────────────────────────┐
│                 Data Layer                   │
│                                              │
│  PageRepository                               │
│  PageScanner                                  │
│  PageIndex                                    │
│  VaultAdapter                                 │
│                                              │
└─────────────────────┬────────────────────────┘
                      │
                      v
┌──────────────────────────────────────────────┐
│                Obsidian API                  │
│                                              │
│  Vault / FileManager / MetadataCache         │
│  Workspace / ItemView / Plugin               │
└──────────────────────────────────────────────┘
```

核心要求：

**UI 层不允许直接操作 Vault 文件。所有页面操作统一经过 PageService。**

这样 Sidebar 和正文代码块不会各自实现一套创建、删除、移动逻辑。

## 4.2 PageRepository

负责页面数据查询。

```
export interface PageRepository {
  /** 获取页面根节点 */
  getRoots(): Promise<PageNode[]>;

  /** 根据 ID 获取页面 */
  getById(id: string): PageNode | null;

  /** 根据文件路径获取页面 */
  getByFilePath(path: string): PageNode | null;

  /** 获取直接子页面 */
  getChildren(parentId: string): PageNode[];

  /** 获取完整页面树 */
  getTree(): PageTreeSnapshot;

  /** 重新扫描整个页面树 */
  rebuild(): Promise<PageTreeSnapshot>;
}
```

## 4.3 PageService

负责页面查询和核心业务。

```
export interface PageService {
  getPage(id: string): PageNode | null;

  getChildren(parentId: string): PageNode[];

  getAncestors(id: string): PageNode[];

  getDescendants(id: string): PageNode[];

  createPage(
    parentId: string | null,
    title: string
  ): Promise<PageNode>;

  renamePage(
    pageId: string,
    newTitle: string
  ): Promise<PageNode>;

  movePage(
    pageId: string,
    targetParentId: string | null
  ): Promise<void>;

  deletePage(
    pageId: string,
    options?: DeletePageOptions
  ): Promise<void>;

  refresh(): Promise<void>;
}
```

删除选项：

```
export interface DeletePageOptions {
  recursive: boolean;
  useTrash: boolean;
}
```

## 4.4 PageTreeService

负责页面树状态和查询，不负责实际文件操作。

```
export interface PageTreeService {
  getTree(): PageTreeSnapshot;

  getNode(id: string): PageNode | null;

  expand(id: string): void;

  collapse(id: string): void;

  expandAncestors(id: string): void;

  search(keyword: string): PageNode[];

  subscribe(
    listener: (tree: PageTreeSnapshot) => void
  ): () => void;
}
```

## 4.5 PageOperationService

负责复杂文件操作。

建议单独抽离：

```
export interface PageOperationService {
  createPage(
    parentFolder: TFolder,
    title: string
  ): Promise<PageNode>;

  renamePage(
    page: PageNode,
    newTitle: string
  ): Promise<void>;

  movePage(
    page: PageNode,
    targetFolder: TFolder
  ): Promise<void>;

  deletePage(
    page: PageNode,
    options: DeletePageOptions
  ): Promise<void>;
}
```

这样 PageService 负责业务编排，PageOperationService 负责具体操作及异常补偿。

# 5. VaultAdapter 与 Obsidian API 选型

## 5.1 核心 API

| 需求               | Obsidian API                           | 用途                          |
| ------------------ | -------------------------------------- | ----------------------------- |
| 获取页面文件       | `vault.getAbstractFileByPath()`        | 根据路径获取文件或目录        |
| 获取 Markdown 文件 | `vault.getMarkdownFiles()`             | 获取 Vault 中的 Markdown 文件 |
| 获取目录内容       | `TFolder.children`                     | 遍历当前目录直接子项          |
| 创建目录           | `vault.createFolder()`                 | 创建页面目录                  |
| 创建文件           | `vault.create()`                       | 创建页面 Markdown             |
| 移动文件           | `fileManager.renameFile()`             | 移动或重命名 Markdown 文件    |
| 移动目录           | `vault.rename()`                       | 移动或重命名目录              |
| 删除到回收站       | `vault.trash()`                        | 安全删除                      |
| 读取文件           | `vault.cachedRead()`                   | 读取页面内容                  |
| 修改文件           | `vault.process()`                      | 基于最新内容安全修改          |
| 修改 Properties    | `fileManager.processFrontMatter()`     | 更新页面图标、描述等          |
| 监听文件创建       | `vault.on("create")`                   | 感知外部文件变化              |
| 监听文件删除       | `vault.on("delete")`                   | 感知外部删除                  |
| 监听文件重命名     | `vault.on("rename")`                   | 感知移动和重命名              |
| 监听文件修改       | `vault.on("modify")`                   | 感知正文和 Properties 变化    |
| 打开页面           | `workspace.getLeaf()`                  | 打开页面                      |
| 注册侧栏视图       | `registerView()`                       | 注册独立页面树                |
| 注册代码块         | `registerMarkdownCodeBlockProcessor()` | 渲染子页面列表                |

具体方法的参数和签名以当前安装版本的 `obsidian.d.ts` 为准。

## 5.2 VaultAdapter

统一封装 Obsidian 文件 API：

```
export class VaultAdapter {
  constructor(private app: App) {}

  async createFolder(path: string): Promise<TFolder> {
    await this.app.vault.createFolder(path);

    const folder = this.app.vault.getAbstractFileByPath(path);

    if (!(folder instanceof TFolder)) {
      throw new Error(`创建目录失败: ${path}`);
    }

    return folder;
  }

  async createFile(
    path: string,
    content: string
  ): Promise<TFile> {
    return this.app.vault.create(path, content);
  }

  async renameFile(
    file: TFile,
    newPath: string
  ): Promise<void> {
    await this.app.fileManager.renameFile(file, newPath);
  }

  async renameFolder(
    folder: TFolder,
    newPath: string
  ): Promise<void> {
    await this.app.vault.rename(folder, newPath);
  }

  async trash(
    file: TAbstractFile,
    system: boolean
  ): Promise<void> {
    await this.app.vault.trash(file, system);
  }
}
```

实际代码需要根据 Obsidian API 当前版本的签名调整。

## 5.3 为什么不直接使用 Node.js fs？

不推荐：

```
import fs from "fs";
```

直接修改 Vault 文件。

原因：

1. Obsidian 有自己的文件抽象和事件机制。
2. 直接修改文件可能绕过 Obsidian 的缓存和状态管理。
3. 移动、重命名时不容易维护内部链接。
4. Android 等移动平台不具备相同的 Node.js 文件系统能力。

因此第一版应坚持使用 Obsidian API。

# 6. 左侧独立页面树 UI

## 6.1 视图设计

通过自定义 `ItemView` 注册独立 Sidebar。

建议结构：

```
┌──────────────────────────────┐
│ 页面                     ⋯   │
├──────────────────────────────┤
│ 🔍 搜索页面                   │
├──────────────────────────────┤
│                              │
│ ▼ 📁 Knowledge               │
│   ▼ 📘 Java                  │
│     ▼ 📘 JVM                 │
│       📄 运行时数据区         │
│       📄 垃圾回收             │
│     ▶ 📘 JUC                 │
│   ▶ 📘 Spring                │
│                              │
│ ▼ 📁 Projects                │
│   📘 Obsidian 插件开发        │
│                              │
├──────────────────────────────┤
│ ＋ 新建页面                   │
└──────────────────────────────┘
```

## 6.2 页面节点交互

| 操作         | 行为                       |
| ------------ | -------------------------- |
| 单击页面     | 打开 Markdown 页面         |
| 点击箭头     | 展开或折叠子页面           |
| 双击页面名称 | 可选：重命名               |
| Hover        | 显示更多操作               |
| 右键         | 打开上下文菜单             |
| 拖拽         | 移动页面或调整父子关系     |
| 搜索         | 按页面名称过滤             |
| 当前页面变化 | 自动展开祖先并高亮当前节点 |

## 6.3 右键菜单

建议包含：

```
新建子页面
重命名
移动到...
复制页面链接
打开新标签页
删除
```

右键菜单使用 Obsidian `Menu` API。

移动端无法依赖鼠标右键，应提供长按或更多操作按钮。

## 6.4 页面树拖拽

建议使用 HTML Drag and Drop API，先实现桌面端。

拖拽规则：

- 拖到页面节点上：作为该页面的子页面。
- 拖到页面节点之间：调整同级顺序。
- 拖到页面树根区域：移动到页面根目录。

必须防止：

```
A
└── B
    └── C
```

将 A 拖到 C 下面。

可以通过：

```
function isDescendant(
  source: PageNode,
  target: PageNode
): boolean
```

判断是否存在循环嵌套。

注意：第一版不建议将拖拽排序持久化为单独的页面关系数据。若需要手动排序，可以在后续版本增加独立的排序配置；第一版先采用名称排序。

# 7. 正文子页面视图

## 7.1 代码块方案

父页面中通过以下语法展示子页面：

````
```subpages
view: list
```
````

插件注册：

```
this.registerMarkdownCodeBlockProcessor(
  "subpages",
  async (source, el, ctx) => {
    const config = parseSubPageConfig(source);

    const parentPage = this.pageRepository
      .getByFilePath(ctx.sourcePath);

    if (!parentPage) {
      el.createEl("div", {
        text: "当前文件不是页面管理器中的有效页面"
      });
      return;
    }

    const children = this.pageService
      .getChildren(parentPage.id);

    this.subPageRenderer.render(
      el,
      children,
      config
    );
  }
);
```

`ctx.sourcePath` 是定位当前父页面的关键。

不要通过当前活动编辑器获取父页面，因为同一篇笔记可能被嵌入或在非活动 Pane 中渲染。

## 7.2 代码块配置

第一版支持：

```
view: list
sort: name
```

后续扩展：

```
view: card
columns: 3
sort: name
show-icon: true
show-description: true
```

配置模型：

```
export interface SubPageConfig {
  view: "list" | "card";
  sort: "name" | "created" | "modified";
  showIcon: boolean;
  showDescription: boolean;
  columns?: number;
}
```

默认值：

```
const DEFAULT_CONFIG: SubPageConfig = {
  view: "list",
  sort: "name",
  showIcon: true,
  showDescription: false
};
```

## 7.3 列表视图

预期效果：

```
子页面

📘 JVM
   JVM 内存管理与垃圾回收

📘 JUC
   Java 并发编程

📘 集合框架
   Java 常用集合与数据结构

＋ 新建子页面
```

## 7.4 卡片视图

预期效果：

```
┌─────────────────┐ ┌─────────────────┐
│ 🧠 JVM          │ │ ⚙️ JUC          │
│                 │ │                 │
│ 内存管理与 GC   │ │ 并发编程        │
│                 │ │                 │
└─────────────────┘ └─────────────────┘

┌─────────────────┐
│ 📚 集合框架      │
│                 │
│ 常用集合与数据结构│
└─────────────────┘
```

第一版建议只实现列表视图，卡片视图放到 v0.3。

## 7.5 正文中的交互

代码块渲染出来的页面项应支持：

- 单击打开子页面。
- Hover 显示操作入口。
- 创建子页面。
- 重命名。
- 移动。
- 删除。

这些操作仍然调用 PageService。

特别注意：`registerMarkdownCodeBlockProcessor()` 主要面向 Markdown 阅读视图的渲染。第一版不应承诺在 Live Preview 编辑状态下实现完整交互。

后续如果需要编辑模式原生体验，再使用 CodeMirror 6 Widget/Extension 扩展。

# 8. 页面索引与文件变化监听

## 8.1 为什么需要索引？

如果每次展开节点都递归扫描整个 Vault，页面数量增加后会产生明显性能问题。

因此需要维护运行时页面索引：

```
export class PageIndex {
  private nodes = new Map<string, PageNode>();

  private roots: PageNode[] = [];

  get(id: string): PageNode | null {
    return this.nodes.get(id) ?? null;
  }

  getRoots(): PageNode[] {
    return this.roots;
  }

  setTree(snapshot: PageTreeSnapshot): void {
    this.nodes = snapshot.nodes;
    this.roots = snapshot.roots;
  }
}
```

## 8.2 初始化扫描

插件启动时：

```
插件启动
   |
   v
读取配置
   |
   v
检查页面根目录
   |
   v
递归扫描页面目录
   |
   v
识别 paired 页面
   |
   v
构建 PageTreeSnapshot
   |
   v
渲染 Sidebar
```

第一版可以进行一次完整扫描。

## 8.3 文件变化监听

注册以下事件：

```
this.registerEvent(
  this.app.vault.on("create", file => {
    this.handleVaultCreate(file);
  })
);

this.registerEvent(
  this.app.vault.on("delete", file => {
    this.handleVaultDelete(file);
  })
);

this.registerEvent(
  this.app.vault.on("rename", (file, oldPath) => {
    this.handleVaultRename(file, oldPath);
  })
);

this.registerEvent(
  this.app.vault.on("modify", file => {
    this.handleVaultModify(file);
  })
);
```

事件处理策略：

| 事件                | 处理方式                       |
| ------------------- | ------------------------------ |
| 页面目录创建        | 检查是否存在配对 Markdown 文件 |
| Markdown 文件创建   | 检查是否存在配对目录           |
| 页面目录重命名      | 更新该页面及其后代的路径索引   |
| Markdown 文件重命名 | 重新判断页面配对关系           |
| 页面删除            | 移除对应索引节点               |
| Markdown 修改       | 更新页面 Properties 缓存       |

由于创建页面时会连续创建目录和 Markdown 文件，可能连续触发多个事件，因此需要做事件合并和防抖，避免重复刷新。

对于复杂移动操作，建议操作完成后由 PageService 主动刷新相关子树，而不是完全依赖事件回调。

## 8.4 一致性策略

文件系统始终是最终事实来源。

出现以下情况时，需要重新扫描相关目录：

- 外部工具修改文件。
- 同步软件产生冲突。
- 页面目录和 Markdown 文件不匹配。
- 重命名操作中途失败。
- 监听事件无法准确识别变化。

# 9. 异常处理与边界场景

| 场景                            | 处理策略                       |
| ------------------------------- | ------------------------------ |
| 页面目录存在但没有同名 Markdown | 标记为异常目录，不作为页面显示 |
| Markdown 存在但没有同名目录     | 视为未纳入管理的普通笔记       |
| 创建同名页面                    | 阻止创建并提示                 |
| 重命名后目标路径冲突            | 阻止操作                       |
| 父页面移动                      | 整个页面目录一起移动           |
| 删除父页面                      | 默认连同子页面一起进入回收站   |
| 页面移动到自身后代              | 禁止                           |
| 页面根目录被删除                | 提示并暂停页面树操作           |
| 外部工具修改文件                | 监听并刷新索引                 |
| 同步冲突产生重复文件            | 扫描后标记异常，不自动覆盖     |
| 页面名称包含非法字符            | 创建前校验                     |
| 操作中途失败                    | 执行补偿或提示人工修复         |

## 9.1 异常页面修复

建议后续增加一个结构检查命令：

```
检查页面结构
```

扫描并报告：

```
发现 3 个结构异常：

1. Knowledge/Java/JVM/
   缺少 JVM.md

2. Knowledge/Spring/Spring.md
   缺少对应的 Spring/ 目录

3. Knowledge/Projects/Test/
   目录存在，但没有配对页面文件
```

修复策略应由用户确认，不应自动删除文件或目录。

# 10. 插件配置与持久化

## 10.1 插件配置

```
interface PluginSettings {
  pageRoot: string;

  defaultView: "list" | "card";

  defaultSort: "name" | "created" | "modified";

  showEmptyPages: boolean;

  confirmDelete: boolean;

  deleteChildrenTogether: boolean;
}
```

## 10.2 持久化内容

插件的 `data.json` 只保存用户偏好和 UI 状态：

```
{
  "pageRoot": "Knowledge",
  "defaultView": "list",
  "defaultSort": "name",
  "showEmptyPages": true,
  "confirmDelete": true,
  "deleteChildrenTogether": true,
  "expandedNodes": [
    "Knowledge/Java",
    "Knowledge/Java/JVM"
  ]
}
```

不要把完整页面树保存到 JSON 中。

原因：

- 页面树可以从文件系统重建。
- 文件可能被其他工具修改。
- JSON 和 Vault 文件之间容易出现数据不一致。
- 不需要额外维护同步逻辑。

# 11. 项目目录结构

建议采用以下目录：

```
src/
│
├── main.ts
│
├── core/
│   ├── PageService.ts
│   ├── PageTreeService.ts
│   ├── PageOperationService.ts
│   └── PageEventService.ts
│
├── models/
│   ├── PageNode.ts
│   ├── PageMetadata.ts
│   ├── PageTreeSnapshot.ts
│   └── PageSettings.ts
│
├── repository/
│   ├── PageRepository.ts
│   ├── PageScanner.ts
│   └── PageIndex.ts
│
├── adapters/
│   └── VaultAdapter.ts
│
├── views/
│   ├── PageTreeView.ts
│   ├── PageTreeRenderer.ts
│   └── SubPageRenderer.ts
│
├── components/
│   ├── PageTreeItem.ts
│   ├── PageListItem.ts
│   ├── PageCard.ts
│   ├── PageContextMenu.ts
│   └── PageToolbar.ts
│
├── modals/
│   ├── CreatePageModal.ts
│   ├── RenamePageModal.ts
│   ├── MovePageModal.ts
│   └── DeletePageModal.ts
│
├── settings/
│   ├── Settings.ts
│   └── SettingsTab.ts
│
└── utils/
    ├── PathUtils.ts
    ├── PageUtils.ts
    ├── NameValidator.ts
    └── SubPageConfigParser.ts
```

# 12. 开发任务拆解

建议按可独立验收的里程碑推进，不要一开始就同时开发树、拖拽和正文交互。

## Milestone 1：基础工程与页面识别

目标：建立可靠的页面数据模型。

任务：

- 初始化 Obsidian 插件工程。
- 配置 TypeScript、ESBuild/Vite 构建流程。
- 实现插件配置读取和保存。
- 实现页面根目录配置。
- 实现 PathUtils。
- 实现 PageScanner。
- 实现 paired 页面识别。
- 实现 PageNode 数据模型。
- 实现 PageIndex。
- 实现完整页面树扫描。
- 输出异常目录扫描结果。

验收标准：

给定一个包含多级页面的 Vault，能够正确识别页面及其父子关系，并排除普通目录。

## Milestone 2：左侧页面树

目标：完成可用的页面树 Sidebar。

任务：

- 实现 PageTreeView。
- 注册独立 ItemView。
- 实现 PageTreeRenderer。
- 实现页面节点组件。
- 实现展开与折叠。
- 实现当前页面高亮。
- 实现当前页面祖先自动展开。
- 实现单击打开页面。
- 实现展开状态持久化。
- 增加页面树命令入口。

验收标准：

能够在左侧独立显示页面树，不影响 Obsidian 原生文件浏览器。

## Milestone 3：页面 CRUD

目标：完成统一页面管理服务。

任务：

- 实现 VaultAdapter。
- 实现 PageOperationService。
- 实现 PageService。
- 实现创建页面。
- 实现重命名页面。
- 实现移动页面。
- 实现删除页面。
- 实现操作前路径校验。
- 实现异常补偿。
- 实现右键菜单。
- 实现创建、重命名和删除 Modal。

验收标准：

所有页面操作都经过统一业务服务，Sidebar 可以完整执行 CRUD。

## Milestone 4：正文子页面代码块

目标：在父页面正文中展示子页面。

任务：

- 注册 `subpages` 代码块处理器。
- 实现 SubPageConfigParser。
- 通过 `ctx.sourcePath` 定位父页面。
- 实现子页面查询。
- 实现列表视图。
- 实现子页面点击打开。
- 实现正文内创建子页面。
- 实现正文内重命名和删除。
- 处理无效父页面和空子页面状态。

验收标准：

在父页面中插入 `subpages` 代码块后，能够自动读取并展示当前页面的直接子页面。

## Milestone 5：文件事件与索引同步

目标：确保文件变化后页面树能够保持一致。

任务：

- 监听 Vault create 事件。
- 监听 Vault delete 事件。
- 监听 Vault rename 事件。
- 监听 Vault modify 事件。
- 实现事件合并和防抖。
- 实现增量索引更新。
- 实现当前子树刷新。
- 实现全量重建索引。
- 实现异常结构检查。

验收标准：

通过 Obsidian 原生文件浏览器创建、重命名、移动或删除页面文件后，插件页面树能够正确同步。

## Milestone 6：体验完善

目标：提升日常使用体验。

任务：

- 实现页面搜索。
- 实现桌面端拖拽移动。
- 实现同级排序。
- 实现页面图标读取。
- 实现页面描述读取。
- 实现卡片视图。
- 实现页面预览。
- 实现移动端长按菜单。
- 完成主题适配。
- 完成大 Vault 性能测试。

验收标准：

页面树和正文子页面视图具备日常使用体验，桌面端和移动端均可完成核心操作。

# 13. 测试方案

## 13.1 单元测试

重点测试：

- 路径解析。
- 页面识别。
- 页面名称合法性。
- 页面父子关系。
- 页面移动循环检测。
- 子页面配置解析。
- 页面索引更新。

## 13.2 集成测试

建立独立测试 Vault，覆盖：

| 测试场景       | 预期结果                 |
| -------------- | ------------------------ |
| 创建一级页面   | 正确生成 Markdown 和目录 |
| 创建多级子页面 | 正确生成嵌套目录         |
| 重命名页面     | 文件和目录同步重命名     |
| 移动页面       | 子页面整体随父目录移动   |
| 删除父页面     | 子页面按策略一并删除     |
| 外部重命名文件 | 页面索引自动更新         |
| 缺少配对文件   | 显示结构异常             |
| 大量页面扫描   | 页面树正常构建           |
| Android 操作   | 不依赖桌面专属 API       |

## 13.3 性能测试

建议构造以下规模的测试 Vault：

- 100 个页面。
- 1,000 个页面。
- 5,000 个页面。
- 10,000 个页面。

关注：

- 首次扫描耗时。
- 页面树渲染耗时。
- 展开节点耗时。
- 页面创建和移动耗时。
- 文件变化后的索引刷新耗时。
- 内存占用。

不要一开始就引入复杂虚拟列表。先测量实际性能，再决定是否需要优化。

# 14. 版本规划

| 版本 | 核心能力                              | 交付目标     |
| ---- | ------------------------------------- | ------------ |
| v0.1 | 页面识别、Sidebar、展开折叠、打开页面 | 页面树可用   |
| v0.2 | 创建、重命名、移动、删除              | 页面管理可用 |
| v0.3 | subpages 代码块、正文子页面列表       | 正文管理可用 |
| v0.4 | 搜索、拖拽、图标、描述、卡片          | 体验完善     |
| v0.5 | 移动端优化、结构修复、大 Vault 优化   | 稳定版本     |

# 15. 最终技术决策

| 设计项         | 最终决策                                |
| -------------- | --------------------------------------- |
| 页面与目录关系 | paired：同名 Markdown 文件 + 同名目录   |
| 页面根目录     | 用户配置                                |
| 页面父子关系   | 文件系统目录层级                        |
| 页面 ID        | 第一版使用规范化目录路径                |
| 页面元数据     | Markdown Properties                     |
| 页面树         | 运行时 PageIndex                        |
| 页面树 UI      | 独立 ItemView                           |
| 正文子页面     | `subpages` 代码块                       |
| 正文渲染       | Markdown 阅读视图优先                   |
| 页面操作       | PageService 统一管理                    |
| 文件 API       | Vault + FileManager                     |
| 文件变化       | Vault 事件监听                          |
| 插件配置       | data.json 只保存设置和 UI 状态          |
| 排序           | 第一版名称排序                          |
| 拖拽           | 后续版本实现                            |
| 移动端         | 原生 Obsidian API，不依赖 Node/Electron |
| 异常恢复       | 以文件系统为准，重新扫描和人工修复      |

## 结论

这个插件最重要的不是页面树 UI，而是建立一套稳定的页面模型和页面操作服务。

建议严格按照以下顺序开发：

1. 先解决 paired 文件结构的识别和操作。
2. 再构建统一的 PageService。
3. 基于 PageService 开发 Sidebar。
4. 再基于同一个 PageService 开发正文 `subpages` 代码块。
5. 最后才增加拖拽、卡片和移动端交互。

这样可以避免 UI 与文件系统逻辑耦合，也能保证后续扩展时不需要推翻底层设计。