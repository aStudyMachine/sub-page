# ADR-0005：只用宿主公开 API，不碰 Node 与 Electron 私有能力

- 状态：已采纳
- 日期：2026-11-16

## 背景

插件的核心动作是扫描目录、建目录、改名、移动、删除。Obsidian 跑在 Electron 上，渲染进程能拿到 Node 的 `fs`、`path`，直接操作磁盘看起来更顺手：递归删除一个 `fs.rm(recursive)` 就够，原子改名也只要一次 `rename`。

另一条路是全部走 `vault` 与 `fileManager` 的公开 API。

## 决策

- 文件系统操作一律走宿主 API：`vault.getAbstractFileByPath` / `TFolder.children` / `vault.createFolder` / `vault.create` / `fileManager.renameFile` / `vault.rename` / `vault.trash` / `vault.process` / `fileManager.processFrontMatter`，以及四个 `vault.on` 事件。
- 插件配置目录与点号开头的旧文件不进 Vault 文件索引。顺序文件通过公开的 `vault.adapter` 读写。回归测试见 [Obsidian 适配层测试](../../tests/unit/obsidianVaultAdapter.test.ts)。
- 配对清理通过 `vault.adapter.list` 检查实际目录内容，包含宿主索引隐藏的文件。内容检查和移入回收站是两个宿主操作，外部写入可能发生在两者之间，因此自动清理使用可恢复的库内回收站。
- `src/` 下不得出现 `node:*`、`fs`、`path`、`electron` 的 import。构建把 `electron` 与 Node 内置模块列为 external，是为了让误引入在打包时才暴露，不是许可。
- 只有 `tests/`（真实库只读冒烟）与 `scripts/`（部署、生成测试库）可以用 Node —— 它们不随插件发布。
- 这条约束落在适配层：`src/adapters/obsidianVaultAdapter.ts` 是全项目唯一接触宿主文件 API 的地方（ADR-0003）。

## 后果

- 移动端可用。Android 与 iOS 没有 Node 运行时，一旦引入 `fs`，`isDesktopOnly` 就必须改成 `true`，插件的支持范围直接砍掉一半。
- 改名与移动会自动维护双链。`fileManager.renameFile` 会改写库里指向该笔记的全部链接；直接改磁盘只会留下断链，而断链不会报错，只会慢慢烂掉。
- 绕过宿主 API 的写入不进 `metadataCache`、也不发 `vault` 事件。插件自己感知不到自己的改动，其他插件（含原生搜索与反链面板）同样感知不到，用户看到的是「文件变了但界面没变」。
- 代价：没有 `fs` 的递归与原子能力。整目录改名走 `vault.rename`，宿主不维护目录内笔记的链接——这是配对模型（ADR-0001）已知的代价。删除只能进回收站，中途失败要靠操作层补偿（ADR-0003 的四段式）。
- 代价：目录遍历只能逐层 `listFolder`，拿不到 `fs.readdir(recursive)` 那种一次性结果。实测 671 个目录 29ms，仍在可接受范围（`docs/perf-baseline.md`）。

## 验证

```bash
grep -rn 'from "node:\|from "fs"\|from "electron"' src/   # 必须无输出
```
