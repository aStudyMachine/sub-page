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
