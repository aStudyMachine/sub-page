# Sub Page — 给 agent 的项目说明

Obsidian 插件：把已有笔记库变成一棵 Notion 式页面树。侧栏树 + 正文里的 ```subpages 代码块，共用一份索引。

## 文档地图

| 文件 | 内容 | 什么时候读 |
| --- | --- | --- |
| `GLOSSARY.md` | 术语定义（页面、父页面、叶子页面、分组目录、配对、作用域、顺序文件…） | 动手前先对齐用词 |
| `docs/spec/sub-page-spec.md` | 需求与实现决策，98 条 user story | 判断「这个行为算不算需求」 |
| `.agents/plan/sub-page-development-plan.md` | 里程碑 M0–M7 与验收口径 | 决定下一步做什么 |
| `docs/adr/` | 5 篇架构决策（页面模型、路径 ID、分层边界、顺序文件、只用宿主 API） | 想改这几件事之前 |
| `CONTRIBUTING.md` | 目录职责表、测试策略、手动验收清单、发布顺序 | 提 PR 之前 |
| `docs/agent-lessons.md` | 跨会话的踩坑记录 | 踩到坑时先查，解决后补一条 |
| `.agents/skills/sub-page-vault-deploy/SKILL.md` | 本地部署和验收流程 | 部署到 Obsidian 库或验证部署时读 |
| `docs/perf-baseline.md` | 扫描耗时实测 | 讨论性能优化之前 |

## 两条硬约束

1. **`release.yml` 用 `workflow_dispatch` 触发，而 `workflow_dispatch` 只有在 workflow 文件已存在于默认分支时才可用**。所以「先合 main」是发版的前置条件，不是可选项。
2. **社区评审的 Error 级问题会让插件在社区目录里搜不到，而且同版本重发不会重跑评审**。修完必须再升一个版本号，不能靠重发原版本。

## 分支约定

- `dev` 是公共开发分支。开工前同步 `origin/dev`，小调整默认直接在 `dev` 提交并推送。
- 较大的改动从 `dev` 建工作分支，验收后合回 `dev`。发布时将验收通过的内容从 `dev` 合入 `main`。

## 代码约定

- 界面不碰 Vault：读走 `plugin.service`，写走 `plugin.service.operations`。这条是 `docs/adr/0003` 的核心，破了就会出现侧栏与正文块不一致。
- 路径换算只在 `src/utils/pathUtils.ts` 与 `src/models/pageId.ts` 里做，别处不要拼路径。
- `src/` 里不许出现 `node:*` / `fs` / `path` / `electron`（ADR-0005）：一旦引入，移动端立刻不可用，改名也不再维护双链。
- 注释写「为什么」。
- 文案走 `plugin.t("key")`，中英两份都要补；`npm test` 里的 i18n 用例会比对两张表的键集合。
