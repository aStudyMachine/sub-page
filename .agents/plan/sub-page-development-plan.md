# Obsidian 子页面插件 · 详细开发计划

> 依据：`Obsidian 子页面插件技术设计方案.md`（v1.0）+ `clean-mermaid` 的工程实践与可复用代码 + 本机 1.15.1 实测结论。
> 本文是**施工图**：每个里程碑都有可执行的验收命令。设计文档仍然是模型与 API 的权威源，本文只修正它已被实测推翻的部分。

---

## 一、相对设计文档的 6 处修正（先看这一节）

| # | 设计文档原方案 | 实测/决策后的方案 | 理由 |
|---|---|---|---|
| 1 | 目录里没有同名 md 就是「异常目录」，不显示 | 页面分三种：**父页面 / 叶子页面 / 分组目录**（见第二节） | 三个真实库（Knowledge 26 篇 / Marcus-WIKI 24 篇 / My-Resume 329 篇）**零配对目录**，按原规则树是空的 |
| 2 | 排序不进 Properties，v1 按名称排序 | 顺序集中在 `<pageRoot>/.subpage-order.json` 一个文件 | 顺序无法从文件系统推导，必须持久化；分散写多个文件不符合「一处统一记录」 |
| 3 | v0.1–v0.5 版本计划与 M1–M6 里程碑编号错位 | M0–M6 → 0.0.1–0.0.7，M7 → 1.0.0 | 一个里程碑一个可安装版本，对外只发 1.0.0 |
| 4 | subpages 块只承诺阅读视图 | 两种视图都渲染内容，交互（新建/改名/删除）只保证阅读视图 | Live Preview 下内容看得见比整块消失好；交互被编辑器吞掉时降级提示 |
| 5 | v1 删除父页面默认删整个文件夹 | 删除父页面 = **只删它的 md**，目录与子页面保留并降级为分组目录；「连子页面一起删除」单独一个菜单项 | 有分组目录这个概念之后，删文件比删目录安全得多，误删不可逆 |
| 6 | 未定义与原生文件浏览器的关系 | 两个树并存，提供命令「折叠原生文件浏览器」 | 不改 core 插件状态、不写 CSS 片段，社区评审无风险 |

第 1、5 条是**模型级**修正，已写入 `docs/adr/0001-page-model-paired-leaf-group.md`。

---

## 二、页面模型（最终定义）

在 `pageRoot`（默认 vault 根）下递归遍历，每个目录产出三类节点之一：

```
pageRoot/
├── 首页.md                    → 叶子页面（无同名目录）
├── Java/
│   └── jvm/
│       └── 堆内存….md          → 叶子页面（Java/、jvm/ 是分组目录）
├── 项目A.md
└── 项目A/                      → 父页面「项目A」，目录放子页面
    ├── 需求.md                 → 子页面（叶子）
    └── 设计/
        └── 设计.md             → 子页面（父页面）
```

| 节点类型 | 判定 | 可打开 | 有元数据 | 例 |
|---|---|---|---|---|
| **父页面** | 目录 D 内存在 `D/<D名>.md` | 是，打开那个 md | 是 | `项目A.md` |
| **叶子页面** | pageRoot 下任意 `.md`，且无同名目录 | 是 | 是 | `首页.md`、`Java/jvm/堆内存….md` |
| **分组目录** | 目录无同名 md，但**存在 md 后代** | 否 | 否 | `Java/`、`jvm/` |
| 忽略目录 | 目录无同名 md 且**无 md 后代** | 否 | 否 | `_assets/`、`.obsidian/` |

**附件与非 Markdown 文件**：页面目录里除子页面外还可能放附件（设计文档允许）。规则是：扫描时**非 .md 文件一律不进入页面树**，也不报异常；父页面目录里有附件不影响任何判定。唯一需要处理的边界是「目录里有 md 也有同名附件」，例如 `项目A/` 下有 `项目A.md` 与 `项目A.png` —— 二者无关，各按各的规则处理。若用户想给页面挂附件，插件不负责归档，交给 Obsidian 的 `attachmentFolderPath` 设置。

规则细则：
- 分组目录**默认显示**（否则现有库的 `Java/` 下面的笔记根本走不到），样式为普通文件夹图标 + 中性色，不参与拖拽排序以外的页面操作。
- 忽略目录默认隐藏；设置项 `showEmptyFolders` 打开后以灰色行出现，可右键「创建同名页面」把它升级成父页面。
- 「补齐配对」= 给分组目录创建 `<目录名>.md`，该目录瞬间从分组目录变成父页面，子节点一个都不动。**这是唯一的迁移入口，也是唯一的页面模型升级路径。**
- 叶子上右键「创建同名目录」= 把叶子升级成父页面（建空目录 + 刷新）。反方向「解除配对」= 把父页面降级为叶子（目录必须为空才允许，否则先要求移动子页面）。
- 递归深度不设限；`maxDepth` 仅作渲染保护（默认 32），超深时该层显示「层级过深」而不是静默截断。
- 忽略目录清单：`.obsidian`、`.trash`、`.git`、任意以 `.` 开头的目录、以及用户在设置里自定义的排除名（默认 `_assets`、`attachments`、`assets`、`images`、`node_modules`）。

---

## 三、持久化

### 3.1 顺序文件 `<pageRoot>/.subpage-order.json`

单个文件记录所有层级的顺序。键是**父作用域的 PageId**（`""` = pageRoot），值是子项**名称数组**。

```json
{
  "version": 1,
  "updatedAt": 1763300000000,
  "orders": {
    "": ["首页", "Java", "Java 基础 MOC", "项目A"],
    "Java": ["jvm", "concurrency", "java-basics"],
    "项目A": ["需求", "设计"]
  }
}
```

- 存**名称**不存路径：同一作用域内文件名唯一（文件系统保证），改名只需替换一个数组元素，移动只需从旧数组 splice 出来 push 到新数组。**没有索引值，不需要间隙策略，一次拖拽只写一个文件。**
- 数组里没列出的子项排在后面，按 `Intl.Collator("zh", { numeric: true })` 自然排序；这样手工建的文件不会因为没进顺序表而消失。
- 写：`vault.adapter.write` 防抖 300ms 写盘；读：`vault.adapter.read`。文件名带 `.` 前缀，Obsidian 文件浏览器不显示，但仍随 git / 百度网盘同步。
- 自写抑制：写顺序文件会触发 `vault` 的 create/modify 事件，用 `selfWritePaths` 集合 + 时间窗跳过。
- 损坏（JSON 解析失败）时：备份成 `.subpage-order.json.bak`，按名称排序继续工作，设置页报一条可点击的警告。**永不因为顺序文件坏了而拒绝显示树。**

### 3.2 `data.json`（插件自身）

只存偏好与 UI 状态：`pageRoot`、`defaultView`、`defaultSort`、`showEmptyFolders`、`confirmDelete`、`templatePath`、`language`、`expandedIds: string[]`、`excludedFolderNames: string[]`。**绝不存树结构。**

### 3.3 页面元数据

`icon`、`description` 写在页面 md 的 frontmatter（`icon: 🚀` 或 `icon: lucide:rocket`）。用 `fileManager.processFrontMatter` 写，不手工拼 YAML。

---

## 四、架构与目录

```
src/
├── main.ts                      # 生命周期、注册视图/命令/代码块/设置
├── i18n.ts                      # 从 clean-mermaid 直接搬
├── models/
│   ├── pageId.ts                # PageId 品牌类型 + pathToId/idToPath/isDescendant/scopeOf
│   ├── pageNode.ts              # PageNode / NodeKind = "parent"|"leaf"|"group"
│   ├── pageMetadata.ts
│   └── settings.ts
├── adapters/
│   ├── vaultAdapter.ts          # interface（唯一与 Obsidian 的写侧边界）
│   └── obsidianVaultAdapter.ts  # 实现
├── repository/
│   ├── pageScanner.ts           # 纯函数式遍历，只依赖 VaultAdapter
│   ├── pageIndex.ts             # Map<PageId, PageNode> + roots + 作用域顺序
│   └── pageOrderStore.ts        # .subpage-order.json 读写 + 自写抑制
├── core/
│   ├── pageService.ts           # 对 UI 暴露的唯一门面
│   ├── pageOperationService.ts  # create/rename/move/delete/pair/unpair + 补偿
│   ├── pageEventService.ts      # vault 事件 → 脏标记 → 防抖重扫
│   └── pageStructureService.ts  # 结构检查与批量修复
├── views/
│   ├── pageTreeView.ts          # ItemView（type = "sub-page-tree"）
│   ├── pageTreeRenderer.ts
│   └── subPageRenderer.ts       # ```subpages 块
├── components/                  # PageTreeItem / PageRow / PageCard / ContextMenu / Toolbar / SearchBox
├── modals/                      # Create / Rename / Move / Delete / Repair
├── settings/                    # settings.ts + settingsTab.ts（declarative）
└── utils/                       # pathUtils / nameValidator / subPageConfigParser / naturalSort
tests/
├── unit/**/*.test.ts
└── fixtures/fakeVault.ts        # 内存假库，实现 VaultAdapter
test-vault/                      # 真实观察用库（gitignore，Obsidian 手动「打开文件夹作为库」）
```

**铁律**：`views/` 与 `components/` 里不出现 `app.vault`、`app.fileManager`。所有读写经 `PageService` → `VaultAdapter`。唯一的例外是 `main.ts` 的注册代码。

---

## 五、里程碑

> 每个里程碑收尾动作固定为：`npm test` 全绿 → `npm run build` 无 warning → `npm run deploy -- <库名>` → 手动验收表勾完 → `git tag vX.Y.Z` → 推送。

### M0 · 脚手架与文档（0.0.1）

任务：
0. **初始化 Git 仓库**（在写任何代码之前，先让 `.gitignore` 生效，避免 `node_modules` 被误入库）：
   - `git init -b main`
   - 先落 `.gitignore`（从 clean-mermaid 搬，追加 `test-vault/`、`.subpage-order.json`、`main.js`、`*.js.map`、`data.json`）与 `.gitattributes`，**先提交规则再提交内容**
   - 首次提交：`chore: 初始化 Sub Page 插件仓库`（含设计文档、GLOSSARY、ADR、计划）
   - 建 `dev` 分支并从 `main` 切出，日常在 `dev` 或 `feature/*` 上干活，里程碑合并回 `main`
   - 远端仓库的创建与是否公开，见下方「待确认」
1. `npm init`，装 `obsidian@^1.13`（devDep 用 1.13 的 d.ts，运行时要求 1.15）、esbuild ^0.25、typescript ^5.7、vitest ^3.2、@types/node ^22。
2. 搬 clean-mermaid 的 `esbuild.config.mjs`（改 entry、去掉 `import-meta-shim`）、`tsconfig.json`、`vitest.config.ts`、`.gitignore`、`scripts/resolve-vault.mjs`、`scripts/deploy.mjs`、`src/i18n.ts`。
3. `manifest.json`：`id: sub-page`、`name: Sub Page`、`version: 0.0.1`、`minAppVersion: 1.15.0`、`isDesktopOnly: false`。
4. `versions.json`、`LICENSE`（MIT）、`README.md` 骨架。
5. `GLOSSARY.md` + 4 篇 ADR + `docs/agent-lessons.md` 空壳 + `.agents/plan/`（本文放这里）。
6. `main.ts` 只有一个命令「Sub Page: 诊断信息」，弹窗输出版本、pageRoot、索引节点数。
7. `src/hints.ts`：从 clean-mermaid 搬 localStorage 一次性标记模式，先放一个 `hintSeen(key)` / `markHintSeen(key)` 通用实现。
8. `.github/workflows/ci.yml` 照抄（push main/dev + PR → `npm ci && npm test && npm run build`）；`release.yml` 先只写 `workflow_dispatch` + 构建 + 守卫 + 版本三处校验，`publish` 分支留到 M7。
9. `scripts/bump-version.mjs`：一次改 `package.json` / `manifest.json` / `versions.json` 三处并同步 lock（10.7）；`src/settings.ts` 里放 `migrateSettings` 骨架（10.6）；`src/i18n.ts` 改用键值表而非两参数（10.10）。
10. `AGENTS.md` 写完「文档地图」一节 + 两条硬约束（workflow_dispatch 前置、Error 级审阅只能升版本）。

验收：
```bash
git status             # 干净；node_modules / main.js 不出现在 untracked 里
npm run build          # 产出 main.js / manifest.json / styles.css
npm test               # 1 个冒烟测试通过
npm run deploy -- sub-page-test
```
Obsidian 里启用插件 → 命令面板出现「Sub Page: 诊断信息」→ 输出正常。
Git：`main` 有初始提交，`dev` 分支存在，`git tag v0.0.1` 打在 M0 收尾提交上。

**已定**：M0 只做本地 `git init`，**不建远端**。时机推到「准备跑 release workflow」或「需要备份/多机」时，再用 `gh repo create` 一次建好并 `git remote add`。届时要先确认仓库名与可见性（社区的 `release.yml` 与 `attest` 依赖 GitHub，所以最终一定要有远端，只是不阻塞 M0–M6）。

### M1 · 扫描与索引（0.0.2）

任务：
1. `models/pageId.ts`：`type PageId = string & { readonly __brand: "PageId" }`；`pathToId`（去 `pageRoot` 前缀、去 `.md`、统一 `/`）、`idToFile`、`idToFolder`、`scopeOf`、`isDescendant`、`isSameOrDescendant`。所有路径拼接只在这里发生。
2. `adapters/vaultAdapter.ts` 接口：`listFolder(path) → {folders, files}`、`exists`、`read`、`write`、`createFolder`、`createFile`、`rename`、`trash`、`readFrontMatter`、`writeFrontMatter`、`onVaultEvent`。
3. `repository/pageScanner.ts`：纯函数 `scan(adapter, pageRoot, options) → PageTreeSnapshot`。一次 DFS，产出 `Map<PageId, PageNode>` + `roots` + `warnings: ScanWarning[]`（忽略目录、超深、大小写冲突）。**不做任何 IO 优化前置**，先用简单实现测出基线。
4. `repository/pageIndex.ts`：持有 snapshot，提供 `getNode`、`getChildren`、`getAncestors`、`search(titleFragment)`、`stats()`。
5. `utils/naturalSort.ts`：`Intl.Collator("zh", { numeric: true, sensitivity: "base" })`。
6. 单测：`tests/unit/pageId.test.ts`、`pageScanner.test.ts`（父/叶/分组/忽略 4 类 × 空格、中文、大小写、深层嵌套）、`fakeVault.ts`。
7. 首扫分片（10.1）：每 200 个目录让出一次主线程；>2000 目录时侧栏显示「正在建立索引…」；排除目录清单生效。
8. 性能基线脚本 `scripts/gen-vault.mjs`：生成 100 / 1000 / 5000 / 10000 个页面的假库，测扫描耗时与内存，结果写 `docs/perf-baseline.md`。

验收：
```bash
npm test -- pageScanner
node scripts/gen-vault.mjs 1000 && npm run perf
```
命令「Sub Page: 重建索引」在 Knowledge 库输出：`pages=26 groups=3 (Java, jvm, ...) warnings=0`，与 `find` 实测一致。

### M2 · 侧栏树（0.0.3）

任务：
1. `views/pageTreeView.ts`：`registerView("sub-page-tree")`；`getIcon()` 用 `lucide:list-tree`；单例逻辑（`getLeavesOfType` → reveal / `getRightLeaf(false).setViewState`）。
2. 行渲染：缩进（每层 16px）、箭头、图标（页面 / 分组目录 / 展开态）、标题、子页面数量徽标（仅父页面）。
3. 交互：单击打开（`getLeaf` 尊重用户设置用 `workspace.openLinkText`）、箭头展开/折叠、当前文件高亮 + 祖先自动展开。
4. 展开态持久化到 `data.json.expandedIds`（PageId 数组），索引重建后按 ID 恢复；ID 不存在则丢弃。
5. 空状态：pageRoot 不存在 → 引导卡片（新建 Pages / 选择目录 / 稍后）；pageRoot 为空 → 「新建第一个页面」。
6. 命令：打开侧栏、在侧栏中定位当前文件、全部折叠、全部展开。
7. 顶栏：搜索框（占位，M6 接逻辑）、刷新按钮、新建按钮。
8. 键盘与无障碍（10.2）：`role="tree"`/`treeitem`、roving tabindex、↑↓→← Enter F2 Delete、图标按钮必有 `aria-label`。
9. `styles.css`：`sp-` 前缀；明暗用 `body.theme-dark`；缩进用 CSS 变量。

验收（手动清单写进 `CONTRIBUTING.md`）：Knowledge 库侧栏出现 26 个页面 + 3 个分组目录，层级与文件浏览器一致；点击任意页面正确打开；切换文件时高亮跟随；重启 Obsidian 展开态保持。

### M3 · CRUD（0.0.4）

任务：
1. `core/pageOperationService.ts`，每个操作都是「校验 → 执行 → 刷新子树 → 失败补偿」四段式：
   - `createPage(parentId, title, { withFolder })`：`createFolder` → `createFile`；失败时删掉已建空目录并抛出可读错误。父页面不存在时先补父 md。
   - `renamePage(id, newTitle)`：先 `fileManager.renameFile(md)`（保住反链）→ 再 `vault.rename(folder)`；文件夹改名失败时把 md 改回原名并报错。
   - `movePage(id, newParentId, index?)`：校验目标存在、不是自己、不是自己后代、目标作用域内无同名、在 pageRoot 内、不是忽略目录；`vault.rename(folder)` + `fileManager.renameFile(md)`；顺序文件同步迁移键。
   - `deletePage(id, { withChildren })`：默认只 `fileManager.trashFile(md)`，目录留着降级为分组；`withChildren` 才 `trashFile(folder)`。确认弹窗显示「直接子页面 N 个 / 全部后代 M 个」。
   - `pairFolder(id)` / `unpairPage(id)`：见第二节。
2. `utils/nameValidator.ts`：Windows 非法字符 `\\ / : * ? " < > |`、首尾空格与点、保留名 `CON/PRN/AUX/NUL/COM1-9/LPT1-9`、长度 1–120、与同级冲突（大小写不敏感比较）。
3. `core/pageService.ts` 门面：UI 只依赖它，返回 `Result<T, PageError>` 而不是抛异常。
4. 右键菜单（`Menu`）：新建子页面、新建同级页面、重命名、移动到…、补齐配对 / 解除配对、复制页面链接、在新标签页打开、在系统资源管理器中显示（桌面）、删除。
5. 弹窗：`CreatePageModal`（标题 + 「同时创建子页面目录」勾选）、`RenamePageModal`（实时校验）、`MovePageModal`（只列合法目标）、`DeletePageModal`（带计数与「连子页面一起删除」）。
6. 新建内容：默认 `# <标题>\n`；设置 `templatePath` 指向一个 md 时用其内容替换 `{{title}}` / `{{date}}` / `{{time}}`。
7. 附件边界：`createPage` 只在目标目录已存在时复用，绝不因目录里有附件而报错；`deletePage` 的默认行为只删 md，附件原样留在目录里（连带删除时才随目录进回收站）。重命名页面时**不**改附件名，也不改正文里的 `![[...]]` 引用。
8. 集成测试：在 `test-vault` 的临时副本上跑完整 CRUD 序列，断言磁盘状态与索引状态一致；覆盖失败补偿（mock `rename` 抛错）。

验收：
```bash
npm test -- operations   # 覆盖 18 条用例（见第六节）
```
手动：在 test-vault 上建 A/B/C 三层、改名带中文和空格、移动 A 到 C 下、把 B 移动到自己的子目录（应被拒绝）、删除父页面（子页面应保留）。

### M4 · subpages 块（0.0.5）

任务：
1. `utils/subPageConfigParser.ts`：解析 ```subpages 块的 YAML/键值行，未知键收集为 warning 不报错。`DEFAULT_CONFIG = { view: "list", sort: "name", showIcon: true, showDescription: false, columns: 2 }`。
2. `views/subPageRenderer.ts`：`registerMarkdownCodeBlockProcessor("subpages", handler, -100)`，**try/catch 包住**（重复注册会抛 `Code block postprocessor for language … is already registered`）。
3. 父页面定位：一律用 `ctx.sourcePath`，绝不读 active editor。
4. 列表视图：图标、标题、描述、子页面数；点击打开。
5. 空状态：无子页面 → 「新建子页面」按钮；块所在文件不是页面（无同名目录）→ 提示「当前笔记还不是父页面」+「创建子页面目录」按钮；块外置（嵌套引用）→ 提示不支持。
6. 交互按钮（新建/改名/删除）只在阅读视图渲染；Live Preview 下渲染只读列表 + 一行「切换到阅读视图可在此新建子页面」。
7. 设置项 `defaultView` / `defaultSort` 作为块的默认值，块内配置优先。

验收：在 test-vault 的父页面正文插入 ```subpages 块，阅读视图与 Live Preview 都显示子页面列表；新建后立即出现在块内；从块里改名后文件系统同步。

### M5 · 事件与增量（0.0.6）

任务：
1. `core/pageEventService.ts`：监听 `vault.on("create"|"delete"|"rename"|"modify")`，换算成受影响的最深作用域集合。
2. 防抖 200ms 合并；一次批量里 create 目录 + create 文件只重扫一次。
3. 增量策略：受影响作用域的公共祖先子树重扫；超过阈值（脏作用域 > 30 或跨 3 层以上）直接全量重扫。
4. 自写抑制：`renamePage`/`createPage` 期间把目标路径加入 `suppressed` 集合，事件到达后丢弃并从集合移除（带 5s 超时清理）。
5. 外部改动兜底：`modify` 命中页面 md 时**只**刷新该节点的 frontmatter（图标/描述），不重扫树。
6. 顺序文件被外部改写（同步冲突）：检测 mtime 变化 → 重读 → 若 JSON 非法则按备份策略处理。
7. 命令「检查页面结构」：列出未配对目录、孤儿目录、大小写冲突、顺序文件缺失条目（只报告，不自动改）。

验收：在 Obsidian 外（资源管理器）新建一个 `X.md` → 侧栏 1 秒内出现；外部改名 → 树跟随；批量粘贴 50 个文件 → 侧栏不卡、只重扫一次（日志计数验证）。

### M6 · 搜索 / 排序 / 拖拽 / 图标 / 卡片（0.0.7）

任务：
1. 搜索：标题子串、大小写不敏感、防抖 120ms、命中自动展开祖先并高亮匹配片段；`Esc` 清空。
2. 拖拽（仅 `Platform.isDesktop`）：HTML5 DnD，占位线提示；放节点上 = 成为子页面，放两行之间 = 同层排序，放空白区 = 移到根；`isDescendant` 拒绝；拖拽时禁用右键菜单。
3. 排序落盘：拖拽结束 → 重新计算该作用域数组 → 写 `.subpage-order.json`（防抖合并连续拖拽）。
4. 移动端：长按（500ms）弹同一套菜单，排序用「上移 / 下移 / 移到最前 / 移到最后」。
5. 图标：`🚀` 直接文本渲染；`lucide:xxx` 用 `setIcon`；未知前缀原样显示。
6. 卡片视图：`view: card` + `columns`，CSS grid；行高自适应；`showDescription` 控制副标题。
7. 命令「折叠原生文件浏览器」：折叠左侧 `nav-files` 窗格（`workspace.leftSplit.collapse()` 或按 leaf 类型折叠文件浏览器 leaf）。
8. 排序菜单：右键 → 上移/下移/移到最前/移到最后（桌面与移动端共用）。

验收：拖动 5 个页面重排 → 顺序文件内容正确 → 重启保持；把父页面拖进自己的子目录 → 拒绝且树不变形。

### M7 · 结构修复 / 性能 / 发布（1.0.0）

任务：
1. `core/pageStructureService.ts`：批量补齐配对（多选，>50 二次确认）、清理解除配对后的空目录（默认只建议不执行）、顺序文件条目清理。
2. 性能：用 `scripts/gen-vault.mjs` 生成 1k/5k/10k 库，实测首扫、首屏渲染、展开、新建、移动、重扫耗时；**先测再决定**是否加虚拟列表（阈值：首屏 > 300ms 或展开 > 50ms 才做）。
3. 移动端实测：Android 上打开库、长按菜单、新建/改名/删除、卡片视图。
4. 文档：README 中英双语（功能、截图、配置说明、与原生树的分工）、CHANGELOG、CONTRIBUTING（架构表 + 手动验收清单）。
5. 发布前自查（照抄 clean-mermaid 的 `obsidian-plugin-release` 流程）：`!important` 计数用声明行正则、`any` 计数、`console.log` 清理、`isDesktopOnly` 与 `Platform` 用法一致、`versions.json` 同步、三件套产物 sha256。
6. 首次社区评审：`community.obsidian.md/account/plugins/sub-page/review-branch` 预览到 0 个 Error 才提审。

验收：
```bash
npm test && npm run build
npm run deploy -- Knowledge --no-check     # 只读冒烟
```
1 万页库：首屏 ≤ 500ms，展开 ≤ 80ms，内存增量 ≤ 60MB。

---

## 六、测试矩阵

单测（vitest + fakeVault，node 环境）：

| 模块 | 用例 |
|---|---|
| `pageId` | 根 / 一层 / 深层、中文、空格、`#`、大小写、`isDescendant`（自反、兄弟、父子、跨根）、`scopeOf` |
| `pageScanner` | 父页面、叶子、分组、忽略 4 类；同名 md 与目录并存；`.md` 大小写；空目录；深 40 层；同一目录内 md 与目录同名冲突 |
| `nameValidator` | 9 个 Windows 非法字符、保留名、首尾点、长度、同级大小写冲突、全角冒号允许 |
| `pageOrderStore` | 读写、缺省排序、未知条目忽略、损坏文件降级、自写抑制、改名迁移、移动迁移 |
| `pageOperationService` | 建/改/移/删 × 成功/失败补偿；移动进自己后代被拒；目标重名被拒；删除父页面保留子页面；`withChildren` 走 trash |
| `subPageConfigParser` | 空块、未知键、非法枚举、部分配置合并默认值 |

集成（在 `test-vault` 的 `fs.cp` 临时副本上）：完整 18 步场景序列——建三层 → 改名 → 移动 → 补配对 → 解除配对 → 删除 → 事件后索引一致性。

手动验收：每个里程碑一张清单，写进 `CONTRIBUTING.md`，勾完才算完成。

不做的测试：不做 Playwright 浏览器自动化（Obsidian 内部 API 无稳定测试入口，成本远超收益）。

---

## 七、clean-mermaid 复用清单

### 7.1 直接搬的文件（只改标识符）

| 文件 | 移植动作 |
|---|---|
| `scripts/deploy.mjs` + `scripts/resolve-vault.mjs` | 改 `PLUGIN_ID = "sub-page"`；其余不动。保留三条设计：**先把所有目标解析完再构建**（库名写错时不该已经跑完一遍构建）、`--no-check` 跳测试、`VAULT=` 逃生口 |
| `esbuild.config.mjs` | 改 entry 与许可证 banner 列表；**去掉 `importMetaUrlShim` 的 `define`/`inject`**（本项目无 `import.meta.url` 消费者） |
| `tsconfig.json` | 原样（strict、noImplicitAny、ES2018、bundler、noEmit、include src+tests） |
| `vitest.config.ts` | 原样（`tests/**/*.test.ts`、node 环境） |
| `src/i18n.ts` | 原样 23 行（`LanguageSetting`、`detectObsidianLanguage`、`resolveLanguage`、`pick`） |
| `.gitignore` | 原样，追加 `test-vault/`、`.subpage-order.json` |
| `.gitattributes` | 原样（`* text=auto eol=lf` + 图片 binary + bat/cmd CRLF） |
| `LICENSE`（MIT）、`versions.json` 结构 | 原样 |

### 7.2 代码模式（照写法，不照内容）

1. **`src/hints.ts` —— 一次性教学标记走 `app.loadLocalStorage`/`saveLocalStorage`，不进 data.json**。原仓库的注释给了完整理由：那是教学状态不是用户配置，混进 settings 会被「恢复默认设置」清掉，也会在设置面板多出不属于设置的条目；读写全部吞异常，存储不可用时退化成「每次都提示」也照常能用。
   → 本项目落点：首次启用引导是否已显示、拖拽操作提示是否已显示、「折叠原生文件浏览器」提示是否已显示。
2. **声明式设置 `getSettingDefinitions()`**（clean-mermaid 的 `src/settings.ts:180`）：`{ name, desc, control: { type, key, options } }`，分组用 `{ type: "group", heading, items: [...] }`。设置是数据不是 DOM，比 `display()` 少一半代码，且能被设置搜索索引到。
   ⚠️ 已知坑：`render(setting)` 的容器是横向 flex，块状内容必须 `setting.setClass("sp-…")` + 显式 `flex-direction: column; align-items: stretch`，且空/非空两种状态都要看。
3. **命令重新注册**（clean-mermaid 的 `src/main.ts` `registerCommands()`）：命令面板标签只在注册时定一次，所以语言切换时先 `removeCommand(id)` 再 `addCommand`。
4. **`registerMarkdownCodeBlockProcessor(lang, handler, -100)` + try/catch**：`-100` 抢占顺序；重复注册抛 `Code block postprocessor for language … is already registered`。
5. **全量登记销毁**：`this.register(...)` / `this.registerEvent(...)` / `this.registerDomEvent(...)`，包括 `document.fonts` 那类全局监听也要有对应摘除。本项目有 4 个 vault 事件 + `window` 上的拖拽监听，必须同款。
6. **注释只写「为什么」**：clean-mermaid 每个非显然决策都有一句「因为官方会…，所以这里…」。本项目保持同一标准，尤其 `pageScanner` 的三类节点判定和 `pageOperationService` 的补偿逻辑。

### 7.3 发布流水线（必须借鉴，返工代价最高）

从 `clean-mermaid/.github/workflows/release.yml` 抄三段：

- **代码侧守卫（创建 Release 之前就失败）**，对齐已知的审阅 Error 级规则：
  - `grep -rnE '\.style\.[a-zA-Z]+ = "[^$]'` → 静态字面量样式赋值，判 Error，改用 CSS 类或 `setCssStyles`
  - `grep -rn 'document\.createElement'` → 改用 `createEl`/`createDiv`
  - `grep -cE '^[[:space:]]*[a-z-]+[[:space:]]*:.*!important' styles.css` → 超过核准阈值即失败（普通 grep 会误计，必须用声明行正则）
- **版本三处一致校验**：`manifest.json` / `package.json` / `versions.json` 三者都必须等于 `workflow_dispatch` 输入的版本。
- **只能从 `main` 发布**（社区目录读默认分支 HEAD）；`gh release create` 三个产物 + `actions/attest` 签名；dry-run 只打印 `sha256sum main.js manifest.json styles.css`。

`ci.yml` 照抄：`push` 到 main/dev 与 PR 时跑 `npm ci` → `npm test` → `npm run build`（Node 22 + npm cache）。

⚠️ 两条硬约束必须写进 AGENTS.md：
- **`workflow_dispatch` 只有 workflow 文件已存在于默认分支时才能触发** —— 先合到 main 是跑 dry-run 的前置条件，不是可选项。
- **Error 级审阅结论会让插件在社区目录搜不到，且同版本重发不重算，必须升版本**。所以宁可前置到 Release 之前就变红。

### 7.4 文档骨架（结构照抄，内容重写）

`README.md`/`README.zh-CN.md`（功能 + 截图 + 配置 + 与原生树的分工）、`CONTRIBUTING.md`/`CONTRIBUTING.zh-CN.md`（环境、目录结构表、实现约定、**手动验收清单**）、`GLOSSARY.md`（含「不要用哪个词」）、`docs/adr/`、`docs/agent-lessons.md`（现象 → 根因 → 对策，两段式）、`docs/obsidian-internals.md`（本项目特殊项：树渲染与 DnD 的宿主行为实测）、`CHANGELOG.md`（面向用户，双语 Release 说明）、`TODO.md`（滚动，完成即删）、`AGENTS.md` 里一节「文档地图」、`env.example` + `.local/.env`（只记路径与版本，**绝不记凭据**）。

### 7.5 明确不借鉴

| 项 | 原因 |
|---|---|
| `scripts/obsidian-asar.mjs` / `scan-asar.mjs` | 用于定位并反编译 Obsidian 自身 asar，服务于 Pele 逆向；本项目只读官方 `.d.ts` |
| `tests/browser/*` 整套（20 个文件 + Playwright） | 为图表渲染快照而建，对「树 + 文件操作」成本远超收益 |
| `pele-*`、`mermaid-shapes*`、`viewer.ts`、`export.ts` | 与图表渲染强绑定，零重叠 |
| `javascript` 包依赖（mermaid/mathjax/json5/yaml） | 本项目运行时零第三方依赖，产物预计 < 200 KB |
| `THIRD-PARTY-LICENSES.md` 内容 | 只留空壳；运行时无第三方时无需列 |
| `main.js` 超 5 MiB 的「不修项」 | 那是自带 mermaid 运行时的必然结果，不适用于本项目 |
| `overrides: { katex }` | 仅为 mermaid 的 katex 版本冲突存在 |

### 7.6 已固化为本项目第 1 条教训（写进 `docs/agent-lessons.md`）

- `aria-label` 就是 Obsidian 的 tooltip 来源（`setTooltip`），**不要**同时设 `title`，否则双气泡。
- `registerMarkdownCodeBlockProcessor` 重复注册抛异常，必须 try/catch。
- 声明式设置项容器是横向 flex，块内容必须显式改成 column。
- 静态样式赋值、`document.createElement`、`!important` 超标是审阅 Error 级；同版本重发不重算，只能升版本。

## 八、风险表

| 风险 | 影响 | 对策 |
|---|---|---|
| 顺序文件与文件系统不一致（外部改名后排序漂移） | 中 | 未列出的子项按名称排在后面，永不报错；「检查页面结构」报告孤立条目 |
| 百度网盘同步冲突产生 `xxx (1).md` | 中 | 扫描时不特殊处理；「检查页面结构」把它们列为可疑页面供人工处理 |
| 1 万页时侧栏卡顿 | 中 | M1 就有生成脚本与基线；M7 按实测决定是否虚拟列表 |
| 拖拽在 Live Preview 侧栏与编辑器间误触 | 低 | 只在侧栏容器内 `preventDefault`，不全局监听 |
| 移动端长按与 Obsidian 自带长按菜单冲突 | 低 | 长按后 `preventDefault` + `stopPropagation`，M7 实测确认 |
| 用户把 pageRoot 设成 `.obsidian` 或忽略目录 | 低 | 设置页校验，拒绝并说明 |

---

## 九、命令清单（最终形态）

命令面板：
- `Sub Page: 打开侧栏`
- `Sub Page: 在侧栏中定位当前文件`
- `Sub Page: 新建页面`
- `Sub Page: 重建索引`
- `Sub Page: 检查页面结构`
- `Sub Page: 折叠原生文件浏览器`
- `Sub Page: 诊断信息`

设置页：页面根目录、默认视图、默认排序、显示空目录、删除前确认、新建模板路径、语言、排除目录名。

---

## 十、补遗：第一版遗漏的工程细节

这些不是「可以以后再说」的愿望项，每一项目前在计划里都是空白，必须在对应里程碑前定下来。

### 10.1 默认页面根 = 库根，首扫要有上限保护 ⚠️

My-Resume 库有 981 个目录。默认 `pageRoot` 设为库根时，M1 的全量扫描要遍历全部目录。对策：

- 扫描过程**分片让出主线程**（每 200 个目录 `await` 一次微任务），避免封面卡顿。
- 超过 2000 个目录时，侧栏顶部显示「正在建立索引…」而不是空白。
- 设置页给出「排除目录」输入，默认已填 `_assets`、`attachments`、`assets`、`images`、`node_modules`。
- **不做**「首次只扫 3 层、展开时懒加载」——那会让搜索功能失效，增加一整套状态机。实测优先。

### 10.2 键盘可达性与无障碍

侧栏是 `nav` 区域的一部分，无障碍会被审阅方关注。

- 容器 `role="tree"`，行 `role="treeitem"` + `aria-expanded`（仅父页面）+ `aria-level`。
- ↑/↓ 移动焦点、→ 展开或进入子层、← 折叠或回到父层、Enter 打开、F2 重命名、Delete 删除。
- 焦点用 `tabindex` 漫游（roving tabindex），不是给每行都加 `tabindex=0`。
- 所有图标按钮必须有 `aria-label`（**不要**同时设 `title`）。

### 10.3 多选与批量操作：v1 不做

Ctrl/Shift 多选会牵动：批量删除确认文案、批量移动的目标校验（可能一半合法一半不合法）、批量失败的部分成功报错。收益与成本不匹配。**v1 明确只支持单选**，写进第十节。

### 10.4 撤销：不自己做 undo 栈

- 删除走系统回收站（`trashFile`），恢复交给用户在回收站里操作。
- 重命名/移动的「撤销」= 再反向操作一次，不提供一键回滚。
- **不做**操作历史栈：它与外部改动、同步冲突、批量事件的交互复杂度远超收益。

### 10.5 lockfile 与截图入库策略

| 文件 | 入库 | 理由 |
|---|---|---|
| `package-lock.json` | **是** | CI 用 `npm ci`，必须锁定；`npm install` 后要及时提交 |
| `images/*.png`（README 截图） | 是 | GitHub Release 说明与 README 引用 |
| `main.js` / `*.js.map` | 否 | 产物，社区目录读 Release 资产 |
| `test-vault/` | 否 | 本地观察库，含测试噪音 |

### 10.6 设置迁移函数

M0 就建 `migrateSettings(raw)` 骨架（返回 `{ settings, changed }`）。哪怕 v0.0.1 只有两个字段，也要有这层——否则第一次改字段名时用户配置会被静默重置。clean-mermaid 的 `src/settings.ts:120` 就是这个模式。

### 10.7 版本号同步脚本

`npm version` 不会改 `manifest.json` 与 `versions.json`。写 `scripts/bump-version.mjs`：一次改 `package.json` / `manifest.json` / `versions.json`（新增 `version → minAppVersion` 映射）三处，并跑 `npm install --package-lock-only` 同步 lock。**不要手改三处**。

### 10.8 与 Folder Note 类插件的互操作

社区已有 Folder Note / Waypoint 等插件做「目录 + 同名笔记」。同时启用会**双写同一个 md**，可能出现重复打开或结构闪烁。

- README 明确声明重叠关系。
- 「诊断信息」命令列出已启用插件里是否存在 `folder-note*`、`waypoint`，有则给一条提示。
- **不主动禁用、不弹窗阻拦**。

### 10.9 不做正文注入（面包屑）

父页面正文顶部自动插入「子页面面包屑」需要写用户笔记，与「插件不改正文」的原则冲突。v1 只在侧栏与正文的 `subpages` 块里体现层级；面包屑放第十节不做清单。

### 10.10 i18n 从「两参数」升级为「键值表」

clean-mermaid 的 `pick(lang, en, zh)` 是两参数直传，句子长了以后到处是巨型字符串。本项目文案量大（菜单 10+ 项、弹窗 5 个、错误 15+ 条），改用：

```ts
t("menu.rename")                    // 查表
t("error.nameIllegal", { char: ":" }) // 带插值
```

字典分 `zh` / `en` 两个对象，键名点分。**缺键时回退到键名本身并 warn 一次**，方便发现遗漏。

### 10.11 错误提示分级

| 级别 | 场景 | 形式 |
|---|---|---|
| 静默 | 后台重扫失败、事件抑制超时、顺序文件读失败后降级 | `console.debug` + 结构检查里可查 |
| Notice | 单次操作失败（重名、非法字符、目标不存在） | 3 秒 Notice，文案含「为什么」+「怎么办」 |
| Modal | 需要用户决策（批量失败需人工修、结构冲突、删除计数超阈值） | 弹窗，必须给「取消」 |

**铁律**：任何失败都不能只 `console.error` 了事，用户必须能在界面上看到发生了什么。

### 10.12 诊断信息的内容清单

命令「Sub Page: 诊断信息」输出（可复制）：插件版本、minAppVersion、Obsidian 版本、平台、`pageRoot`、扫描耗时、页面数/分组数/忽略数、顺序文件可读性、已启用冲突插件、最近 20 条 `console.debug`。这是用户报障时唯一需要的东西。

### 10.13 日志规范

统一 `console.debug("[sub-page]", ...)`，由设置项 `debugLog` 控制；生产默认关闭。**禁止** `console.log` 留在提交里（审阅会看）。

### 10.14 CHANGELOG 与 tag 时机

每个里程碑：打 `v0.0.x` tag + CHANGELOG 写一条**内部**条目（简短）。1.0.0 时把 7 条整理成面向用户的双语发布说明。**不要**每个里程碑都写用户能看懂的详细说明，那是浪费。

## 十一、明确不做

- 不做 UUID 页面 ID（ADR-0002）。
- 不做页面正文全文搜索（Obsidian 全局搜索已覆盖）。
- 不做拼音/模糊搜索。
- 不做多页面同时编辑、不做页面版本历史。
- 不做 Live Preview 下的内联新建输入框（M4 只渲染只读）。
- 不做多选与批量操作（10.3）。
- 不做撤销栈（10.4），删除靠回收站恢复。
- 不做正文注入的面包屑（10.9），层级只在侧栏与 subpages 块体现。
- 不做云同步自己的冲突解决逻辑，交给用户与同步工具。
- 不自动删除任何用户文件（修复命令只建议、需确认）。