---
name: sub-page-release
description: 准备或发布 Sub Page 的 GitHub Release，处理首次上架、已有条目的 Obsidian 社区评审，以及核验产物和客户端安装。只部署本地笔记库时使用 sub-page-vault-deploy。
---

# 发布 Sub Page

用用户授权的范围执行。计划请求交付到计划。明确授权发布后持续跟踪到评审和可执行的安装验收。先检查工作区、远端分支、目标版本和是否已有 Release 或待审条目，从已完成阶段继续。

## 准备与预审

1. 从同步后的 `dev` 准备候选。运行 `npm run bump -- <x.y.z>`，按 [Release 说明格式](../../../CONTRIBUTING.md#release-说明的统一格式) 更新变更记录和版本说明。核对 manifest、兼容表、package 和锁文件。
2. 运行 `npm ci`、`npm test`、`npm run build`、`npm run test:e2e:strict`。e2e 是本地门禁：它需要本机 Obsidian 与 `test-vault/sandbox`，不可用时严格模式会直接失败；确实不具备环境时，改为在报告里记「e2e 未执行，已按手动清单全量验收」，不要静默跳过。校验和比对只需对齐源码 SHA、锁文件与内嵌文件行尾——Node 版本不参与产物生成；本机没有 Node 22 时，以 CI 的 `checksums_digest` 与下载资产字节为准。按 [手动验收清单](../../../CONTRIBUTING.md#手动验收清单) 在样例库验收变更涉及的场景（清单开头标了哪些条目已被 e2e 覆盖），再按影响范围验证全新安装、上版升级、数据保留与独立窗口交互。部署步骤见 [部署 Skill](../sub-page-vault-deploy/SKILL.md)。
3. **预审门禁**。已有社区条目时，把候选推到独立分支，用门户的 **Review branch** 审查候选 SHA。等报告达到 `Completed` 且零 Error，记录报告 SHA 与保留 Warning 的理由，再合入 `main`。有 Error 就修完重新预审。门户或评审不可用时停下来问用户。首发按首次上架流程先完成 GitHub Release。评审范围与状态见 [社区发布手册](../../../docs/obsidian-community-release.md#门户评审)。

## GitHub Release

1. 合入 `main` 前先确认预审门禁已通过（首发为首次上架流程已完成）。将候选合入 `dev`，然后合入并推送 `main`。核对 `main` 中的树与验收候选相同，在 `main` 手动运行 Release 工作流的 `dry_run=true`。记录运行链接、提交 SHA、各资产校验和与 `checksums_digest`。用同一 SHA 的干净源码构建并运行 `node scripts/release-checksums.mjs` 比对。
2. 给该 SHA 创建并推送精确的 `x.y.z` 标签。从同一 SHA 运行 `dry_run=false`，传入上一步的 `expected_checksums_digest`。工作流会核对 tag 指向和资产校验和。若 `main` 或候选已变化，重新核对差异并跑 dry run。
3. 下载三项独立资产，运行 `node scripts/release-checksums.mjs <下载目录> <checksums_digest>`。逐个核验构建证明，命令见 [构建证明](../../../docs/obsidian-community-release.md#构建证明)。

## 社区评审与安装

1. 首次提交时，在已登录的开发者门户关联 GitHub，确认账号和仓库，由用户确认需要其本人同意的声明。提交公开仓库，等正式报告通过后发布条目。已有条目使用 **Check for new releases**，跟踪目标版本的正式报告。登录态或自动刷新异常时，查阅 [门户自动化经验](../../../docs/agent-lessons.md#221-门户自动化先确认浏览器登录态)。
2. 刷新页面，核对目标版本达到 `Completed`、零 Error、Build verification Pass。正式版触发 Error 时，修复后升版并按授权发布。记录 Warning、Recommendation 及其处理结果。
3. 验证公开条目与客户端目录。在隔离库走客户端检索、安装、启用和适用的升级流程。镜像未同步时，按 [客户端目录](../../../docs/obsidian-community-release.md#客户端目录) 验证可执行的路径，并记录待验证项。
4. 汇报版本、GitHub/社区链接、推送目标、正式报告、资产核验、`test:e2e` 的结果（通过条数，或未执行的原因）与实际安装路径。
