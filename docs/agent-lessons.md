# Agent 教训

跨会话复用的踩坑记录。每条格式：现象 → 根因 → 对策。

## 1. 从 clean-mermaid 继承的既有结论

- **tooltip 来源**：Obsidian 会沿鼠标所在元素向上查找 `aria-label`，所以文件行可以触发树容器的名称气泡。在带名称的标签和树容器上设置 `--no-tooltip: true` 可保留无障碍名称。此行为已用 Obsidian 1.15.1 的提示判定逻辑在 Chromium 中核对，见 [侧栏样式](../styles.css)。
- **代码块处理器重复注册**：抛 `Code block postprocessor for language … is already registered`，注册必须 try/catch。
- **声明式设置项布局**：`render(setting)` 的容器是横向 flex，块状内容要显式 `flex-direction: column; align-items: stretch`，并覆盖空/非空两种状态。
- **社区评审 Error 级问题**：会让插件在社区目录里搜不到；同版本重发**不会**重跑评审，必须升版本。
- **评审守卫计数**：用声明行正则 `grep -cE '^[[:space:]]*[a-z-]+[[:space:]]*:.*!important'`，普通 grep 会误计。

## 2. 本项目踩到的

### 2.1 `descendantCount` 不能按注册顺序累加

**现象**：父页面的子页面计数偶尔少一两个，重复扫描结果还不一样。
**根因**：扫描时边 DFS 边把计数往父节点上加，但兄弟节点的注册顺序不保证，祖先可能在子孙还没注册时就结算了。
**对策**：扫描结束后用独立递归 `countPages(node)` 从临时树重算，不依赖 `Map` 的插入顺序。

### 2.2 同级同名会让排序不稳定

**现象**：`项目A/` 与 `项目A.md` 并存时，两行的相对位置在两次渲染间会变。
**根因**：`naturalCompare(title, title)` 返回 0，`Array.sort` 在相等时保持原序 —— 而原序来自目录列表的返回顺序，不稳定。
**对策**：排序加第二个比较键 `naturalCompare(title) || naturalCompare(key)`，键本身唯一。

### 2.3 名称校验要用原始串比，不能用 trim 后的

**现象**：名字结尾带空格的页面创建成功，但文件浏览器里看着和「不带空格」的另一个页面一模一样。
**根因**：Windows 会静默吃掉首尾空格，校验用 `rawName.trim()` 就永远看不到差异。
**对策**：`checkName` 里比较的是 `name !== rawName`，发现首尾空白直接拒绝，而不是替用户裁掉。

### 2.4 `EventRef` 没有 `off()`

**现象**：想手动摘事件监听，类型报错。
**根因**：Obsidian 的事件解绑只能通过 `plugin.registerEvent` 的自动清理，或在 `onunload` 里统一处理。
**对策**：适配层把订阅包成 `subscribe(handler) → unsubscribe`，内部持有 `EventRef` 并在 `offref` 时调用。

### 2.5 拖拽指示线不要自己算坐标

**现象**：第一版用绝对定位的 `.sp-drop-line`，滚动、缩进、折叠都会让它错位，代码还得同步 `scrollTop`。
**根因**：DOM 已经知道自己该在哪，再算一遍只会引入第二份真相。
**对策**：只在目标行上加 `.is-drop-before` / `.is-drop-after` 类，线由 CSS 伪元素画。代码减半，也没了同步问题。

### 2.6 卡片/列表的描述是异步来的

**现象**：`show-description: true` 时第一次渲染没有描述，切走再切回来才有。
**根因**：描述在 frontmatter 里，扫描只读目录不读文件内容（读文件贵一个数量级）。
**对策**：先渲染骨架，`metadataFor(id)` 回来再补节点 —— 不要为了这一个字段把 frontmatter 读取塞回扫描。

### 2.7 侧栏图标永远是默认图标

**现象**：`icon: "📁"` 在文件里写了，侧栏一直显示兜底的 📘。
**根因**：`PageTreeView.metadataCache` 声明了但从没被填充，渲染时 `?? node.metadata` 永远落到空的 `EMPTY_METADATA`。
**对策**：`render()` 末尾调 `ensureMetadata(rows)` 补读；只有真的读到自定义值时重画一次，否则不闪。

### 2.8 移动端长按不该有第二套菜单

**现象**：长按只弹「重命名 / 删除」，用户找不到「移动到…」「补齐配对」。
**根因**：`Menu` 需要 `showAtMouseEvent(event)`，长按没有 `MouseEvent`，于是当初另写了两条。
**对策**：把 `openPageMenu` 拆成「算坐标」和「按坐标弹出」，长按传 `getBoundingClientRect()` 算出的点，条目共用一份。

### 2.9 相对路径拼串只能有一处

**现象**：改了几处 `.split("/").pop()` 之后，带空格与中文的页面开始出现「找不到页面」。
**根因**：业务模块各自拼路径，分隔符、`.md` 大小写、首尾斜杠的处理各不相同。
**对策**：`pathUtils` 提供 `joinPath/dirname/basename/stripExtension`，`pageId` 提供相对/绝对换算；业务里只允许调它们。

### 2.10 侧栏留白要同时核对宿主视图和树节点深度

**现象**：缩小树行内边距后，首层仍然比原生文件列表更靠右。
**根因**：Obsidian 的 `.workspace-leaf-content .view-content` 会给视图加横向留白，页面扫描又从深度 1 开始。用深度 0 构造测试行会漏掉首层实际缩进。
**对策**：用检查器核对宿主和树行的计算样式。仅在 Sub Page 视图覆盖宿主横向留白，首层视觉缩进用 `depth - 1`，ARIA 层级沿用 `depth`。

### 2.11 当前笔记所在目录点了也折叠不了

**现象**：目录包含当前笔记时，点击折叠后立刻展开，键盘左键和「全部折叠」也会遇到这个问题。
**根因**：侧栏每次重绘都会自动展开当前笔记的祖先链，覆盖手动折叠状态。
**对策**：重绘按已有状态展示可见行，切换文件或主动定位时再展开祖先链。回归用例同时检查手动折叠后的重绘和切换笔记后的自动展开。见 [侧栏视图测试](../tests/unit/pageTreeView.test.ts)。

### 2.12 建子页面或拖入叶子时传所选页面 ID

**现象**：右键「新建子页面」或拖到叶子行中央，结果落在同级。
**根因**：入口为绕过叶子没有目录的限制，传了选中页面的 `parentId`。这个 ID 对应的是同级操作的目标。
**对策**：子页面操作传所选页面的 ID，让操作层完成按需配对。测试从入口验证产物路径和索引关系，移动后用返回的新 ID 展开目标。见 [页面操作测试](../tests/unit/pageOperationService.test.ts)。

### 2.13 顺序文件存在于磁盘也可能查不到

**现象**：拖拽改序无效，写旧顺序文件时报 `File already exists.`。
**根因**：在 Obsidian 1.15.1 中，点号开头的旧顺序文件存在于磁盘，但不在 Vault 文件索引里。查索引失败后再走新建会撞到旧文件。
**对策**：插件配置和旧顺序文件通过适配层的 `vault.adapter` 访问。验收要覆盖已存在的旧文件和重开后的顺序。迁移、写入和同步刷新规则见 [ADR-0004](adr/0004-order-file.md)。

### 2.14 弹窗留白可能来自宿主组件的空节点

**现象**：新建弹窗的输入框只占一部分横向空间，输入框与按钮之间也有空隙。
**根因**：宿主 `Setting` 渲染的空信息栏仍参与 flex 布局，空校验元素也参与排版。
**对策**：在新建弹窗的作用域内处理空信息栏和空错误元素。用宿主样式分别核对输入宽度、空错误占位和有错误时的显示，见 [弹窗样式](../styles.css)。

### 2.15 修改共用交互时从弹窗和操作服务反查入口

**现象**：侧栏加号允许留空新建，命令面板和正文按钮仍要求名称。
**根因**：默认名称由每个入口传入可选参数。服务测试验证了传入参数后的取名规则，但遗漏参数仍能通过类型检查。
**对策**：先反查弹窗构造、共用入口和最终写入方法的调用方，核对隐蔽入口。统一的交互默认值在共用入口设置，入口测试验证目标作用域，服务测试验证留空、名称冲突和结果路径。见 [新建规范](spec/sub-page-spec.md#新建)。

### 2.16 清理目录前需确认笔记已移出

Obsidian 1.15.1 正在更新链接时，`fileManager.renameFile` 可能先返回，再执行入队的重命名。适配层核对笔记路径，尚未移动时等待这篇笔记的重命名事件。清理配对目录时用磁盘列表检查隐藏文件，再移入库内回收站。见 [Obsidian 适配层测试](../tests/unit/obsidianVaultAdapter.test.ts)。

### 2.17 侧栏单击的反馈在事件返回前验收

为双击改名延迟重绘会让高频的展开和折叠操作产生顿挫。侧栏通过菜单和 `F2` 提供改名。测试在单击回调返回后直接断言子页面行是否可见，轮询最终状态会漏掉这类延迟。见 [侧栏视图测试](../tests/unit/pageTreeView.test.ts)。

### 2.18 系统回收失败可能正常返回

Obsidian 1.15.1 的 FileManager.trashFile() 在系统回收失败时返回 false，已安装的 API 类型仍声明 Promise<void>。把宿主结果作为 unknown 检查，遇到 false 先返回删除失败，保留页面和手动顺序。见 [宿主变更记录](https://obsidian.md/changelog/2026-11-12-desktop-v1.15.1/) 和 [适配层回归测试](../tests/unit/obsidianVaultAdapter.test.ts)。

### 2.19 目录改名也要验证笔记链接

发布验收发现目录改名和跨作用域移动后，子笔记的链接仍指向旧路径。直接调用 `vault.rename` 绕开了宿主的链接维护。目录和笔记统一通过 `fileManager.renameFile`，并在样例库从链接来源打开目标笔记验证。配对目录清理的时序见 §2.16。见 [宿主 API 决策](adr/0005-host-api-only.md) 和 [适配层测试](../tests/unit/obsidianVaultAdapter.test.ts)。

### 2.20 文件移动成功后仍可能保存顺序失败

损坏或不可写的 `order.json` 会使顺序保存抛错，此时物理移动可能已经提交。若调用方只能看到拒绝的 Promise，树也可能没有刷新。移动完成后即刷新索引，保留实际结果并返回持久化警告。核对新路径、原顺序文件以及 UI 提示。见 [页面操作测试](../tests/unit/pageOperationService.test.ts)。

### 2.21 门户自动化先确认浏览器登录态

首发时 Orca 内置浏览器使用独立配置，打开了未登录页。浏览器扩展的本地监听又遇到 Windows `os error 10013`。切换到已有登录态的原生 Chrome 后可继续，独立窗口可避免打断用户当前标签页。在本次会话里，通过可访问的重载按钮刷新成功。门户显示已排队后继续按版本查看正式报告。见 [社区发布手册](obsidian-community-release.md#门户评审)。

### 2.22 正式构建要在公开发布前核对 dry run

原流程打印校验和后直接创建 Release，默认分支推进或重新构建变化都可能使实际资产偏离验收结果。工作流在公开前校验标签指向本次 SHA，并将三个文件的校验和清单与 dry run 比对。下载后逐项核验字节与构建证明。见 [发布工作流](../.github/workflows/release.yml) 和 [校验脚本](../scripts/release-checksums.mjs)。

### 2.23 重开知识库后展开态全折叠：首帧 render 把空集写回设置

**现象**：data.json 里 `expandedIds` 明明有值，关闭知识库再打开后侧栏树全部折叠，且 data.json 被写成 `expandedIds: []`。

**根因（以下描述修复前的实现；构造拷贝与 render 回写现已删除）**：Obsidian 恢复 workspace 时（栈：`setViewState → open → onOpen → render`），视图可能早于插件 `loadSettings()` 完成而构造。构造函数把 `plugin.expandedIds`（此时还是默认空值）拷进 `this.expanded`，首帧 `render()` 无条件 `void setExpandedIds(this.expanded)` 把空集写回 settings——覆盖掉磁盘上已持久化的展开态。事后 `loadSettings()` 再读 data.json，读到的已是空。第一次修复试图用 `PageIndex.isReady` 门槛 + 首帧注水解决，单测全绿但实机仍复现：因为 view 首帧的 `isReady` 已为真，门槛根本没拦住，真正的写盘在 render 里。

**定位手法**：静态推理和 mock 测试都找不到（mock 直接把 expandedIds 注入 plugin，从不走「构造时空设置 → 首帧写回」链路）。在 `saveSettings`/`setExpandedIds` 里临时把调用栈 + 当时的 expandedIds 写进 data.json 的 `_diag` 字段，部署后重启一次读日志，直接看到 `onOpen → render → setExpandedIds([])` 这条链。诊断完即移除 `_diag`。

**对策**：展开态以设置为唯一真相。`render()` 每帧 `this.expanded = new Set(this.plugin.expandedIds)` 重读，prune 仅用于显示（失效 ID 不显示，但**不从设置清除**——清除必须放在非渲染路径，否则又回到渲染期回写），**render 对展开态一律不写盘**；所有变更由交互方法（toggle/键盘/expandAll/collapseAll/revealCurrent/expandPageAncestors）显式 `setExpandedIds` 落盘。这样首帧读到空设置也不会污染磁盘，设置加载完成后下一帧自然重读回来。回归用例见 [侧栏视图测试](../tests/unit/pageTreeView.test.ts)（「重绘只读设置不回写」「重绘每次都重读设置」两条）。

**可复用规则**（遇到同类生命周期/时序 bug 时照做）：
1. **mock 必须建模状态转换，不得以终态充当初态**：本次 mock 把已加载的 expandedIds 直接注入 plugin，saved 永远是「已加载」态，无从表达「构造时设置为空、磁盘有值、随后 loadSettings 才读回」，所以 253 项全绿仍漏 bug。凡涉及「初始化/恢复/生命周期」的改动，mock 要能反转初始状态并断言状态迁移。
2. **验收走原始复现路径**：生命周期/持久化修复不能只凭单测 + 静态评审，必须实机关闭-重开并核对落盘文件（data.json 的 expandedIds），而不是只看界面视觉。
3. **渲染/纯函数不得写持久化状态**：这是一条架构不变量，评审时对 render/纯函数里的写盘调用要直接判为可疑。
4. 定位手法：状态尚未就绪的时序 bug 靠静态推理反复猜很慢；临时把调用栈 + 关键状态写进 data.json 再读回，一次重启就能锁定调用链（用完即移除）。

spec:198「布局就绪后扫描」与 main.ts 在 onload 首扫的偏差仍在，但与本 bug 无关。

### 2.24 门户「检查新版本」的结果不在回执页

**现象**：点 **Check for new releases** 后页面一直显示「A scan has been queued.」，反复刷新或再点按钮都不出结果，看起来像卡住。

**根因**：那一页只是排队回执，评审在服务端异步执行；回执页不会随扫描进度更新，结果写在 dashboard 的 **Reviews** 列表里。

**对策**：按钮点一次就够，之后回 dashboard 看 Reviews 列表，出现目标版本行且状态为 `Completed` 再读报告。重复点不会加速，还可能重复入队。0.1.2 的扫描在排队后约十分钟完成，期间刷新回执页没有任何信息量。

### 2.25 bsk 守护进程的端口可能落在 Windows 保留区间

**现象**：`bsk daemon start` 报 `bind WS server on 127.0.0.1:52800 ... os error 10013`；扩展弹窗显示「已连接」，但 `bsk browsers` 为空。

**根因**：Windows 动态保留区间覆盖了 52800（`netsh int ipv4 show excludedportrange protocol=tcp` 能看到），不是端口被进程占用，`netstat` 里没有监听者。这天上午守护进程还能正常绑定，说明保留区间会随系统服务启停漂移。

**对策**：管理员执行 `net stop winnat` 释放区间，再启动守护进程；收工后 `net start winnat`。已建立的监听不受恢复影响。不要改用 `--port`：扩展固定在 52800，换端口后守护进程能起但扩展连不上。
