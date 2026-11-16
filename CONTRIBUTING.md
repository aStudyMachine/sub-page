# 贡献指南

## 项目结构

| 目录 | 职责 | 不要放什么 |
| --- | --- | --- |
| `src/models/` | 领域模型与纯数据（`PageNode`、`PageId`、设置、顺序表） | 任何 IO |
| `src/adapters/` | 与 Obsidian 的唯一接触面。测试里用 `tests/fixtures/fakeVault.ts` 替换 | 业务规则 |
| `src/repository/` | 扫描、索引、顺序文件、元数据缓存 | 界面逻辑 |
| `src/core/` | 应用层：`PageService` 门面 + `PageOperationService` 写操作 | DOM |
| `src/views/` | 侧栏视图与正文代码块 | 直接调 `app.vault` |
| `src/components/` | 可复用的界面零件（行、图标、菜单、拖拽） | 状态 |
| `src/modals/` | 弹窗 | 扫库 |
| `src/utils/` | 无状态的纯函数（路径、名称校验、自然排序、配置解析） | 单例 |

一条硬规则：**界面不碰 Vault**。所有写操作走 `plugin.service.operations`，所有读操作走 `plugin.service`。侧栏与正文块共用同一份索引，这是它们不会显示不一致的原因（见 `docs/adr/0003`）。

## 开发

```bash
npm install
npm run dev        # esbuild watch
npm test           # vitest，全部在 node 里跑内存假库
npm run build      # tsc --noEmit + 打包
npm run perf       # 规模基线（默认跳过）
```

### 部署到本地库

```bash
npm run deploy -- <库名>            # 跑测试 → 构建 → 拷三件套
npm run deploy -- <库名> --no-check # 只拷现有产物
npm run deploy -- <库名> --restart  # 拷完重启 Obsidian（仅 Windows）
```

库名从 Obsidian 自己的注册表解析，所以脚本里不硬编码任何个人路径。仓库里附了一个手工验收库 `test-vault/sandbox/`（被 git 忽略），可以直接打开。

### 测试策略

唯一的测试接缝是适配层接口。`FakeVault` 实现了它，于是扫描、CRUD、排序、事件合并全部可以在 node 里跑，不需要启动 Obsidian，也不需要浏览器自动化。

界面不做自动化测试，改用下面的手动清单。

## 手动验收清单

每次改到界面或写操作，按这条序列走一遍。

准备工作：`npm run deploy -- sandbox`，在 `test-vault/sandbox` 里打开 Obsidian，启用插件，页面根留空（整个库）。

- [ ] 侧栏树显示 `首页`、`笔记规范`、`Java`、`项目A`、`_assets` 之外的条目，层级与文件浏览器一致
- [ ] `项目A` 显示 📁 图标与描述（frontmatter 生效）
- [ ] 点任意页面能打开；切换标签页时高亮跟着走，祖先自动展开
- [ ] 重启 Obsidian，展开状态保持
- [ ] 新建页面（带目录）→ 立刻出现在树里，磁盘上是 `名称/名称.md`
- [ ] 改名带中文与空格的页面 → 目录与笔记一起改名，反链不断
- [ ] 把 `项目A/需求` 拖到 `Java` 上 → 成为子页面；拖到两行之间 → 同层排序；刷新后顺序保持
- [ ] 把 `Java` 拖进它自己的子目录 → 被拒绝，树不变形
- [ ] 删除父页面，取消「连带删除」→ 笔记进回收站，目录降级为分组目录，子页面还在
- [ ] 在 `首页` 的 ```subpages 块里看到全部根级页面；新建后立刻出现
- [ ] 把 `项目A/项目A.md` 切成阅读视图 → 卡片视图两列，带描述
- [ ] 搜索框输入 `java` → 命中并高亮，`Esc` 清空
- [ ] 命令「检查页面结构」→ 列出可升级为父页面的目录，点「全部补齐」后目录变成父页面
- [ ] 在 Obsidian 外用资源管理器新建 `X.md` → 1 秒内出现在树里
- [ ] 移动端：长按行弹出完整菜单；卡片视图在窄屏降为一列

## 发布

`.github/workflows/release.yml` 只能从 `main` 手动触发，默认 `dry_run`。

顺序（不要跳）：

1. `npm run bump -- <x.y.z>`，提交并推送
2. 合并到 `main`
3. 跑一次 `dry_run`，看校验和
4. 关掉 `dry_run` 再跑，产出 Release
5. 社区目录的评审会重新扫描这个版本；**Error 级问题会让插件在目录里搜不到，且同版本重发不会重跑评审 —— 必须再升一个版本号**

## 代码风格

- 注释写「为什么」，不写「做什么」。代码本身说得清的事不要复述。
- 不允许直接改 `.style.xxx = `，用 CSS 类或 `setProperty("--sp-…", …)` 传变量（CI 会挡）。
- 不允许 `document.createElement`（用 `createEl` / `createDiv`）。
- `!important` 最多 3 处，按声明行计数。已经用满时先想清楚是不是选择器写错了。
- 文案一律走 `plugin.t("key")`，中英两份都要补。
- 图标按钮只设 `aria-label`，不要再设 `title` —— 在 Obsidian 里两者都会变成 tooltip。
