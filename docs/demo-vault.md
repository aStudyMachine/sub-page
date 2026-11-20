# Studio Atlas 展示与验收库

[示例库](../demo-vault/)包含一组虚构项目笔记、可移植设置和手动排序。准备脚本每次复制到一个新的 `test-vault/demo-*`，并补齐 Git 无法保存的空目录。对副本做移动、改名和删除，源库可继续用于复现截图。

## 准备副本

1. 运行 `npm run demo:prepare`，记下输出的目录。
2. 运行 `npm run deploy -- <输出的目录>`。
3. 在 Obsidian 里将这个目录作为独立库打开，信任该副本并启用 Sub Page。
4. 打开 `Studio Atlas/Studio Atlas.md` 的阅读视图，再从左侧功能区打开子页面面板。

如果只想浏览，可以直接打开 `demo-vault/` 目录，再在其中安装 Sub Page。创建、移动和删除验收使用副本。

## 功能验收

| 功能 | 示例与检查 |
| --- | --- |
| 页面树、导航和搜索 | 展开 Studio Atlas 与 Research，观察嵌套层级、后代计数和选中态。点击标题切换层级并打开笔记，点击图标单独切换。搜索 `interview`，检查高亮和路径，按 Esc 清除。用命令面板定位当前页、全部展开与折叠，重开库检查展开状态。 |
| 新建与模板 | 用侧栏的加号、空白区菜单和命令新建顶层页。用右键、命令、正文按钮在 Practice 下新建子页。留空确认应避开已有的 `Untitled` 并生成编号，另测新建同级页和非法名称。把模板设为 `_assets/Page template.md`，检查标题、日期与时间。 |
| 移动和排序 | 拖动 `Move me` 至 `Reuse folder` 的笔记行中央，检查复用同名空目录。拖至行边缘、另一层行边缘及空白区，分别检查同级排序、跨层插入、移至根层。通过菜单测试移到指定位置、上移、下移、置顶、置底。尝试把 Studio Atlas 拖到 Research 下，检查拒绝提示。重开库确认排序保存。 |
| 重命名、链接与菜单 | 通过 F2 或菜单重命名 Design，检查其子树与 `Reference/Design principles.md` 的链接。另测复制链接、在新标签打开、在文件浏览器显示。 |
| 配对与还原 | Reference 是分组目录，可从菜单升级。打开 `Leaf page`，用正文按钮创建首个子页。关闭自动还原时也可先创建配对目录。打开自动还原并重建索引，`Empty parent` 应还原，带附件的 `Attachment parent` 应保持原路径。给上一级加入同名笔记可验证冲突保护。 |
| 删除 | 在两份副本上分别对 `Delete me` 执行仅删除父笔记和删除整支，核对 `Keep me` 的结果。另用临时页检查确认和回收站选项。 |
| 正文展示与属性 | Studio Atlas 展示双列卡片、手动顺序和说明，Research 展示列表和 emoji 图标，Design 展示单列、隐藏图标及条数限制。把 Research 的排序依次切到 `name`、`created`、`modified` 和 `manual`，先新建一篇子页，再修改另一篇子页，比较顺序变化。分别检查阅读视图和实时预览。改子页的 `icon` 或 `description`，检查正文列表刷新。把某个块的配置写错，确认其余设置仍可渲染。 |
| 设置与空状态 | 启用显示空目录，检查 Practice 下的 `Empty collection`。更改默认列表和排序，用 `Empty parent` 的无配置块验收空内容。把页面根设为 `Studio Atlas`，打开 `Reference/Reading list.md`，查看树外笔记提示。再切回全库，验证排除目录、语言和命令更新。 |
| 检查结构和故障恢复 | 在命令面板运行结构检查、诊断和重建索引。用副本加入不存在的顺序条目，检查孤立提醒。开启显示空目录后可选中 Reference 与 Practice 下的空目录，测试批量配对。大小写冲突在允许同名大小写并存的文件系统上构造。损坏顺序文件、旧格式导入和重开后持久化也可在单独副本测试，参考 [ADR-0004](adr/0004-order-file.md)。 |
| 宿主交互与边界 | 用键盘的方向键、Home、End、Enter、F2 和 Delete 操作树，以屏幕阅读器检查层级和展开状态。比较深浅主题、原生文件浏览器和侧栏。用文件管理器批量添加、改名和删除笔记，检查树刷新。用移动端长按菜单并检查窄屏卡片。 |

宿主异常注入、并发和万篇规模分别由自动化测试与 [性能基线](perf-baseline.md)覆盖。移动端、屏幕阅读器和插件冲突提示需要对应环境。测试插件冲突时，在隔离副本启用一个已知冲突插件。

## 验收 Agent Skill 安装

安装 Agent Skill 的验收也使用副本。在 Sub Page 设置打开安装预览并取消，确认库内没有新文件。再安装到默认位置，编辑入口指令后重新打开，检查已保存的文字正确回填。用自定义目录和关闭 `AGENTS.md` 写入的选项再测一次。

## 更新 README 截图

- [页面树和卡片](screenshots/demo-overview.png)。打开 Studio Atlas 的阅读视图，展开 Studio Atlas 与 Research，留出足够宽度以显示两列卡片。
- [列表与搜索](screenshots/demo-list-and-search.png)。打开 Research 的阅读视图，在侧栏搜索 `interview`。

两张图使用 Obsidian 1.15.1 的浅色外观，取自新建的隔离副本。截图放在 `docs/screenshots/`，中英文 README 共用。
