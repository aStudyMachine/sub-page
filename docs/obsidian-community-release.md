# Obsidian 社区发布手册

发版步骤见 [Sub Page 发布 Skill](../.agents/skills/sub-page-release/SKILL.md)。这里说明如何定位各阶段的状态和核对证据。

## 门户评审

| 场景 | 入口 | 核对内容 |
| --- | --- | --- |
| 首次上架 | 公开 GitHub Release 后，在开发者门户关联 GitHub，再用 **New plugin** 提交仓库 | 默认分支 manifest、对应的精确 `x.y.z` 标签和三个独立资产。正式报告通过后在门户点击 **Publish** |
| 已有条目预审（发版硬门禁） | 条目管理中的 **Review branch** | 候选分支对应的 SHA，等待报告 `Completed` 且零 Error；未出报告或仍有 Error 不得合 `main` |
| 已有条目发正式版 | 条目管理中的 **Check for new releases** | 目标版本正式报告 `Completed`、零 Error、Build verification Pass |

**Review branch** 扫描候选 SHA 的源代码和依赖。**Build verification** 在正式评审中重建源码并比对 GitHub Release 资产。打标签前，用同一 SHA 的干净构建与 GitHub dry run 核对三个资产的校验和。 [条目管理指南](https://docs.obsidian.md/community-directory/manage-entry)

`Pending` 和 “A scan has been queued” 表示进入队列。刷新门户后按版本或候选 SHA 打开对应报告。Warning 和 Recommendation 可逐项评估。主动删除页面遵循宿主偏好，自动清理空目录固定走库内回收站以便恢复，剪贴板写入由用户操作触发。修复正式版的 Error 需要升版。 [空目录清理决策](adr/0005-host-api-only.md) [首次提交指南](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)

## 构建证明

Release 必须单独提供 `main.js`、`manifest.json`、`styles.css`。每项是独立的证明对象。0.1.0 曾只证明 ZIP，门户因此提示独立资产缺证明。0.1.1 移除 ZIP 并给每项生成证明。

`node scripts/release-checksums.mjs <目录>` 对文件的原始字节计算 SHA-256，再对固定顺序、固定 LF 的校验和清单计算 `checksums_digest`。目录参数只负责定位文件。复用 dry run 的校验和时，在命令最后加预期的 `checksums_digest`，不匹配则以失败退出。干净构建时对齐源码 SHA、锁文件和内嵌 Markdown 的字节（`.gitattributes` 固定 LF）；三件套字节不随 Node 版本变化，本机没有 Node 22 时以 CI 的 `checksums_digest` 为准。构建会内嵌 Markdown，输入文件的换行变化也会影响产物。

下载完 Release 后，分别对三个文件运行下面的命令。替换 `FILE` 和 `RELEASE_SHA` 为实际路径和标签解引用后的完整提交 SHA。

```sh
gh attestation verify "FILE" --repo aStudyMachine/sub-page \
  --source-digest "RELEASE_SHA" --source-ref refs/heads/main \
  --signer-workflow aStudyMachine/sub-page/.github/workflows/release.yml
```

随后看门户中该版本的 **Build verification**。这一项核对的是门户重建结果，GitHub attestation 核对的是下载文件的构建来源。

## 客户端目录

社区网站版本、官方目录镜像和客户端搜索可能在不同时间更新。网站上架后客户端仍搜不到时，先核对镜像里是否有 `id: sub-page` 和 `repo: aStudyMachine/sub-page`。镜像同步后再用隔离库走客户端搜索、安装和启用。 [Sub Page 社区页面](https://community.obsidian.md/plugins/sub-page) [官方目录镜像](https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json)

镜像待同步期间，可通过隔离 Obsidian 实例调用宿主安装器做补充验证。0.1.1 在 Obsidian 1.15.1 通过 `app.plugins.installPlugin(repo, version, entry)` 验证了正常构建下载、启用以及 0.1.0 升级。这是宿主内部方法，先确认实例版本与方法可用性。这次验证中，安装后的 `main.js` 比发布字节多了宿主追加的换行和 `/* nosourcemap */`。Release 原始字节的核验用直接下载的资产。汇报时注明实际走的是搜索还是直接调用宿主安装器。

## 已发布版本的记录

| 版本 | 可复核的证据 |
| --- | --- |
| 0.1.0 | 首次上架，正式评审零 Error，13 Warning、4 Recommendation，Build verification Pass。[GitHub Release](https://github.com/aStudyMachine/sub-page/releases/tag/0.1.0) |
| 0.1.1 | 预审及正式评审零 Error，正式评审保留 2 Warning、1 Recommendation，Build verification Pass。验证三个独立资产及构建证明。镜像待同步时完成宿主直接安装和 0.1.0 升级。[GitHub Release](https://github.com/aStudyMachine/sub-page/releases/tag/0.1.1) |
| 0.1.2 | 正式评审零 Error，保留 2 Warning、1 Recommendation（剪贴板访问），Build verification Pass（main.js 字节级复现）。验证三个独立资产及构建证明。[GitHub Release](https://github.com/aStudyMachine/sub-page/releases/tag/0.1.2) |
| 0.1.3 | `c307fe7` 预审及 `7d7c4e8` 正式评审均零 Error。正式报告有 3 Warning、1 Recommendation，Build verification Pass。第三条 Warning 指向从依赖对象取出的翻译回调，调用方传入箭头函数，保留了插件实例的绑定。三个发布资产的校验和与 dry run 一致，构建证明均通过。Obsidian 1.15.0 隔离库通过社区目录搜索、安装和启用，以及宿主安装器从 0.1.2 升级并保留插件数据。[GitHub Release](https://github.com/aStudyMachine/sub-page/releases/tag/0.1.3) |
