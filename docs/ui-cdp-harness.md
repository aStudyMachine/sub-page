# CDP UI 验收框架

用 Chrome DevTools Protocol 驱动真实 Obsidian（Electron），把 `CONTRIBUTING.md` 的手动验收清单变成可重复执行的断言。

状态：Phase A（可行性验证）与 Phase B（`tests/e2e/` 框架 + `npm run test:e2e`）均已完成。Phase B 当前覆盖 7 条用例，对应手动清单的 9 个条目，见 §8。

## 1. 可行性结论

能。实测在 Windows 11 + Obsidian 1.15.0（运行时自更新到 asar 1.15.1）+ Node v24.22.1 下：

| 问题 | 结论 |
| --- | --- |
| `--remote-debugging-port` 能否启动并暴露 `/json` | 能，`/json/version` 返回 Chromium 150 / Electron 43.8.4，`/json/list` 里有 `app://obsidian.md/index.html` 页面目标 |
| 单实例锁是否挡住第二次启动 | 挡。不带 `--user-data-dir` 时新进程立刻以退出码 0 结束、端口不起来（转到已有实例）。用独立 `--user-data-dir` 可完整隔离，与用户已开的窗口互不影响 |
| 能否拿到渲染进程 DOM | 能。树、行、右键菜单、弹窗、正文块全部是普通 DOM，无原生菜单、无 canvas、无 shadow DOM |
| 能否在后台点行 / 右键 / 点菜单项 / 填输入框 | 全部能，窗口最小化后仍然有效（例外：由命令触发的弹窗需要窗口有焦点，见 §2） |
| 能否读 `data.json` 与磁盘 | 能，`fs` 直接读即可；也可以走 `app.vault.adapter.read()` |

### 对用户现有窗口的影响

- 独立 `--user-data-dir` 的实例不会读也不会写 `%APPDATA%\obsidian\obsidian.json`（已逐字节核对，未被改写），用户的库列表、插件启用状态、设置都不受影响。
- 不影响用户正在打开的观察窗口：实测探测实例启动、操作、退出的全过程里，用户实例的进程一直在，窗口标题不变。
- **唯一副作用**：新实例启动时窗口会短暂出现在前台约 0.4–0.5 秒，之后才能用 CDP 把它最小化。`--window-position=-32000,-32000`、`--hidden`、预置窗口状态文件三种办法都无法阻止这次抢焦点（Obsidian 会把越界坐标夹回屏幕内）。

## 2. 启动与清理

### 启动

```bash
# 1) 准备独立的 profile 目录，并把库登记进去（Obsidian 不会把命令行里的库路径当成"打开这个库"）
#    <profile>/obsidian.json:
#    {"vaults":{"<任意 16 位 id>":{"path":"<库绝对路径，正斜杠>","ts":<毫秒时间戳>,"open":true}}}

# 2) 启动（Obsidian 的安装目录不一定在默认位置，先按需定位 Obsidian.exe）
"<Obsidian 安装目录>/Obsidian.exe" \
  --remote-debugging-port=9223 \
  --user-data-dir="<profile 绝对路径>"
```

要点：

- **必须预置 `obsidian.json`**。只把库路径作为位置参数传进去，Obsidian 会停在 `starter.html` 欢迎页，不会打开库。
- 端口从 9223 起挑一个空闲的即可；同一 `--user-data-dir` 的第二个实例会被单实例锁挡掉，所以并行跑多个用例必须各用各的 profile。
- 连上后先等 `typeof require('electron').remote?.getCurrentWindow === 'function' && window.app?.plugins` 为真，约 370–530 ms。之后 `.sp-row` 出现约在 740 ms（profile 已初始化过）。
- `/json/list` 里不只有应用页面：过滤条件是 `type === 'page' && url.includes('index.html')`。刚启动时会先出现 `starter.html`，还有几个 `url` 为空的内部目标，别拿 `list[0]`。
- **首启信任弹窗**：新库第一次打开会弹「你是否信任这个仓库的作者？」（`.modal.mod-trust-folder`），按钮「信任仓库作者并启用插件」。不点它插件不加载、`app.plugins.plugins` 为空，而且这个 modal 的 `.modal-bg` 会拦掉所有指针事件（`document.elementFromPoint()` 返回 `modal-bg`）——此时任何 CDP 点击都打不到下面的行和按钮。**这个弹窗在的时候最小化不彻底**：`isMinimized()` 为 true 但 `isFocused()` 仍是 true（`document.hasFocus()` 为 false），要等它关掉再最小化才干净。所以启动顺序是「先处理信任弹窗，再最小化」。
- `app.plugins.setEnable(true)` 能直接把插件加载起来（实测在一个有插件但 `loaded` 为空的 profile 上立即生效，并把 `enable-plugin-<vaultId>` 写进 localStorage），可以作为「跳过信任点击」的备选；但它不清理已经打开的信任弹窗遮罩，所以要么先点「信任」，要么在没有任何弹窗时再调它。
- 信任状态存在 profile 的 `Local Storage/leveldb` 里，键名 `enable-plugin-<vaultId>`。**复用同一个 profile 与同一个 vault id、只换 vault 路径时不会再弹信任框**（实测换库路径后插件 492 ms 自动加载）。

### 后台化

```js
const w = require('electron').remote.getCurrentWindow();
w.setSkipTaskbar(true);
w.minimize();
```

最小化后 `isMinimized() === true`、`isFocused() === false`、`document.hasFocus() === false`，并且在 3 秒内保持稳定（不会自己弹回来）。此时：

- `Input.dispatchMouseEvent` / `Input.insertText` / `Input.dispatchKeyEvent` 全部照常生效；
- 树的 DOM、`data.json`、磁盘读写的断言不受影响；
- 外部文件改动照样在 500 ms 内刷新到树里（实测 250–500 ms）；
- **由真实鼠标点击触发的弹窗**（工具栏 `+`、右键 → 重命名 / 删除 / 移动到）正常挂载，可以继续点；
- **`Page.captureScreenshot` 会挂起**（8 秒超时），`clip`、`fromSurface:false` 都救不回来（后者返回一张几乎全空的图）；
- **由命令触发的弹窗不会挂载**。`executeCommandById('sub-page:check-structure')` / `new-root` 返回成功，但 `.modal` 一个都不出现。这是 Obsidian 的 `Modal.open()` 依赖窗口焦点，不是插件的问题；只调 `focus()` 对一个已最小化的窗口无效。

需要命令弹窗或截图时，先把窗口恢复并挪出屏幕（两次调用放在同一个 `Runtime.evaluate` 里，实测 21 ms 完成）：

```js
const w = require('electron').remote.getCurrentWindow();
w.restore();
w.setBounds({ x: -32000, y: -32000, width: 1280, height: 900 });
w.focus();                     // 命令弹窗与截图都需要这一步
// 等约 600 ms，然后 executeCommandById / Page.captureScreenshot
w.minimize();                  // 做完立刻收回后台；已打开的弹窗不受影响
```

实测要点：

- 屏幕外 `restore()` 之后再截图，稳定返回 38–50 KB PNG（连续 3 轮字节数一致），界面完整（侧栏树、正文、状态栏都在）。
- 弹窗在最小化之前打开、在最小化之后依然存在，勾选框依然可点。
- 顺序很关键：**先 `restore()` 再 `setBounds()`**。窗口已最小化时单独 `setBounds()` 不生效，`restore()` 会回到上次的屏幕内坐标。两次调用在同一帧内完成，中间状态不会被绘制成可见窗口，但这一条只能从时序上判断，无法用程序证明「用户没看到一帧」。**给 Phase B 的建议：跑截图类用例前先确认用户不在赶时间的工作里**，或者干脆把这类用例留给人看。

### 清理

```js
await app.commands...;                      // 用例结束
setTimeout(() => require('electron').remote.app.quit(), 50);
```

退出耗时 150–255 ms，端口随即关闭。临时目录的 `rm -rf` 在进程完全退出前会报 `EPERM`，需重试 1–2 次（约 400 ms）才能删干净。

一个坑：profile 里那份 `obsidian-1.15.1.asar`（24 MB）在退出后仍会被系统缓存一段时间，`rm` 报 `EBUSY` / `Device or resource busy`，重试也删不掉。`tmp/` 已被 git 忽略，不影响提交；要么接受这一点，要么在下次清理时才删。

## 3. DOM 契约（实测）

| 用途 | 选择器 |
| --- | --- |
| 树容器 | `.sp-tree`（`role="tree"`） |
| 行 | `.sp-row`（`role="treeitem"`），`data-id` 是页面 id（如 `项目A/需求.md`、`Java/并发`） |
| 行标题 / 计数 | `.sp-title` / `.sp-badge` |
| 行种类 | `.sp-row.is-parent`（父页面）、`.sp-row.is-group`（分组目录） |
| 展开态 | `aria-expanded="true"` / `aria-level` / `style="--sp-depth: N"` |
| 当前页高亮 | `.sp-row.is-current` |
| 键盘焦点框 | `.sp-row.is-focused` |
| 行内图标 | `.sp-icon`（父页面是 📁 之类文本，叶子是 lucide svg） |
| 搜索框 | `input.sp-search`（在 `.sp-toolbar` 里） |
| 新建按钮 | `.sp-toolbar .sp-icon-button` |
| 右键菜单 | `.menu` + `.menu-item`（**DOM 实现，不是原生菜单**） |
| 弹窗 | `.modal`、`.modal-title`、`input`、`button` |
| 设置类开关（删除弹窗） | `.checkbox-container`，选中态是 `is-enabled` 类（`input.checked` 恒为 false） |
| 结构检查弹窗 | `.modal` + `input.sp-check`（原生 checkbox，读 `checked`）+ `.sp-structure-row` |
| 正文块（列表） | `.block-language-subpages` → `.sp-block-count` / `.sp-block-list` / `.sp-block-row` / `.sp-block-title` |
| 正文块（卡片） | `.sp-block-cards` → `.sp-card` / `.sp-card-title` / `.sp-card-desc` |
| 信任弹窗 | `.modal.mod-trust-folder` |

页面里可用 `window.app`（`workspace` / `vault` / `plugins` / `commands` / `hotkeyManager`）和 `require('electron').remote`。命令用 `app.commands.executeCommandById('sub-page:xxx')` 触发，可用的有 `open` / `new-root` / `new-child` / `reveal-current` / `expand-all` / `collapse-all` / `rebuild-index` / `check-structure` / `diagnostics`。

## 4. 交互能力实测

| 操作 | 方式 | 结果 |
| --- | --- | --- |
| 点行打开笔记并高亮 | `Input.dispatchMouseEvent` 按下+抬起 | 生效，`.sp-row.is-current` 跟着走，祖先自动展开 |
| 右键弹菜单 | 同上，`button:'right'` | 生效，`.menu .menu-item` 可读可点 |
| 点菜单项 / 弹窗按钮 | 计算 `getBoundingClientRect()` 中心后点击 | 生效（重命名、删除、新建、移动都试过） |
| 填输入框 | 先 `input.select()` 再 `Input.insertText` | 生效；用 `Input.insertText` 比逐字 `dispatchKeyEvent` 稳 |
| 勾选复选框 | 点 `.checkbox-container` | 生效，`is-enabled` 类正确切换 |
| 拖拽（真实鼠标） | `mousePressed` → 多次带 `buttons:1` 的 `mouseMoved` → `mouseReleased` | 生效，`设计` 变成 `Java/设计.md` 并落盘 |
| 拖拽（合成事件） | `new DragEvent(..., {dataTransfer})` + `dragstart/dragover/drop` | 同样生效；比真实鼠标快，但绕过了命中测试 |
| 键盘 Enter / 方向键 / Esc | `Input.dispatchKeyEvent` | 生效（Enter 打开页面、ArrowDown 移动焦点框、Esc 清空搜索/关弹窗） |
| 键盘 F2 改名 | 同上 | **不生效**。Obsidian 把 F2 绑给了 `workspace:edit-file-title`，按键到不了渲染进程（F3 能到，F2 不能）。改名只能走右键菜单 |
| 命令触发弹窗 | `executeCommandById` | 窗口有焦点时才挂载；无焦点时命令返回成功但弹窗不出现，见 §2 |
| 截图 | 窗口最小化时挂起；恢复并挪到屏幕外后正常 | 见 §2 |

## 5. 覆盖的手动清单条目

下表是 Phase A 逐条核对的结果。「已验证」表示这条的操作链路在本轮实测中走通过；「可自动化」表示机制相同、只是没逐条跑。

| 清单条目 | 结论 | 依据 |
| --- | --- | --- |
| 1–3 树结构与计数、图标、分组判定 | 已验证 | 一次读取 11 行的 `data-id` / `badge` / `is-parent` / `is-group` / `--sp-depth`，结果与「期望的树」逐项吻合；`_assets` 不出现 |
| 4 打开页面、高亮跟随 | 已验证 | 点 `需求` 后 `getActiveFile()` 为 `项目A/需求.md`，`.sp-row.is-current` 同步 |
| 5 卡片视图 | 已验证 | 切阅读视图后读到 `.sp-block-cards`、「2 个子页面」、`设计` 无描述 / `需求` 带描述 |
| 6 列表视图与顺序 | 已验证 | `.sp-block-list` 下 `常见问题` 在 `快速开始` 之前 |
| 7–8 空状态块 | 可自动化 | 选择器与 5/6 相同，断言 `.sp-empty` 文案 |
| 9 搜索命中 | 已验证 | 输入 `内存` 后只剩 `Java/jvm/堆内存.md`，`mark` 内容为 `内存`；Esc 后恢复 11 行 |
| 10 新建页面 | 已验证 | 工具栏 `+` → 填 `最终测试页` → 磁盘出现文件、正文 `# 最终测试页`、树里出现 |
| 11 改名 + 反链 | 已验证 | 右键 `项目A` → 改名 `项目A改` → 目录改名、`笔记规范.md` 变成 `[[项目A改]]` |
| 12–13 含空格 / 只改大小写 | 可自动化 | 与 11 同一条链路，断言换成文件名 |
| 14 移动到… | 可自动化 | 弹窗已实测可开可填（标题「移动页面」，输入框 placeholder 明确） |
| 15 补齐配对 | 可自动化 | 右键菜单项已实测可点（`项目A` 上出现「解除配对」说明它在父页面态） |
| 16 检查页面结构 | 已验证 | 命令 → 弹窗 → 3 个 `input.sp-check` 全默认勾选、按钮「补齐选中的 3 个」；取消一个后按钮变「补齐选中的 2 个」。**注意：命令触发需窗口有焦点，见 §2** |
| 17 定位当前页面 | 已验证 | `reveal-current` 后 `.sp-row.is-focused` 与 `.is-current` 都是 `Java/jvm/堆内存.md`，`Java`/`jvm` 自动展开 |
| 18–21 拖拽 | 18 已验证 | 真实鼠标拖拽把 `设计` 变成 `Java/设计.md` 并落盘；19–21 机制相同，19 断言 `order.json`、20 断言树不变、21 拖到空白区 |
| 22–23 删除父页面 | 已验证 | 弹窗文本含「直接子页面 2 个，全部后代 2 个」；取消 `同时删除` 后目录还在、只剩两个叶子，行降级为 `.is-group` |
| 24 删除不进回收站 | 可自动化 | 删除弹窗第二个开关即「移到回收站」，断言 `.trash` 里没有同名文件 |
| 25–26 外部改动 | 已验证 | 外部新建 250–500 ms 内出现、外部改名 500 ms 内跟上 |
| 27 重启后展开态 | 已验证 | 退出前 `.sp-row[aria-expanded="true"]` 与 `data.json` 的 `expandedIds` 都是 `["手册","项目A改","Java"]`，重启后两者一致 |

一条完整的串跑（信任 → 最小化 → 树 → 打开高亮 → 卡片 → 搜索 → 新建 → 改名 → 结构检查 → 外部改动 → 截图 → 重启）总耗时 67 s，其中重启占了约 3 s。

## 6. 仍然只能人工的部分

- **F2 快捷改名**：按键到不了渲染进程（宿主绑走了），CDP 无法验证。改名本身可用右键菜单覆盖，但「F2 也能改名」这一条只能人工。
- **拖拽的视觉反馈**：插入位置指示线、拖到后代时的拒绝提示属于渲染样式，断言能验结果（树/磁盘不变），验不了过程中画了什么。
- **窗口抢焦点**：无法完全避免，见 §1。

## 7. 性能参考

| 阶段 | 耗时 |
| --- | --- |
| 复制 `test-vault/sandbox`（149 KB） | 12 ms |
| 启动到 `remote` 可用 | 370–530 ms |
| 启动到 `.sp-row` 出现（profile 已初始化） | 约 740 ms |
| 串跑 7 个读场景 | 约 12.2 s |
| 完整串跑（信任 + 9 条 + 重启） | 约 67 s |
| 退出到端口关闭 | 150–260 ms |

首启新 profile 时 Obsidian 会自己下载一次 `obsidian-1.15.1.asar`（24 MB）到 profile 目录，有网络请求和额外耗时。**复用预置好的 profile 模板**可以避开这一步，也顺带避开信任弹窗。

## 8. Phase B 实现（`tests/e2e/`）

### 怎么跑

```bash
npm run test:e2e          # 不可用时打印 SKIP 原因并以 0 退出
npm run test:e2e:strict   # 不可用时以 1 退出；发版前用这个
```

可选参数与环境变量：

| 用法 | 作用 |
| --- | --- |
| `--only=tree` | 只跑 slug 或文件名匹配的用例 |
| `--verbose` | 打印启动、信任、端口等步骤 |
| `SP_E2E_TRACE=1` | 打印超过 300 ms 的 CDP 调用与等待，用来定位慢在哪 |
| `SP_E2E_SANDBOX=<dir>` | 换一份样例库（默认 `test-vault/sandbox`） |
| `SP_E2E_TEMPLATE=<dir>` | 使用已初始化的 profile 模板（默认每次新建） |

不通过 `npm test` 触发：vitest 的 `include` 是 `tests/**/*.test.ts`，e2e 用 `.mjs`，两套互不影响，`npm run build` 的 `tsc` 也不会收它们。

### 覆盖范围

| 用例 | 清单条目 | 断言落点 |
| --- | --- | --- |
| `01-tree` 树结构与计数 | 1–3 | 11 行的顺序、缩进、计数、父页面/分组判定，`_assets` 不出现 |
| `02-open-highlight` 打开并高亮 | 4 | `getActiveFile()`、`.is-current`、展开分组不抢高亮 |
| `03-card-view` 卡片视图 | 5 | `.sp-block-cards`、2 张卡片、描述有无 |
| `04-search` 搜索命中 | 9 | 只剩 `Java/jvm/堆内存.md`、`mark` 文本、Esc 清空、`java` 无结果 |
| `05-create-page` 新建页面 | 10 | 磁盘 `最终测试页.md`、正文 `# 最终测试页`、树里出现 |
| `06-rename-backlink` 改名反链 | 11 | 目录改名、`笔记规范.md` 里的 `[[项目A改]]` |
| `07-restart-expanded` 重启展开态 | 27 | 重启前后 DOM 的 `expandedIds` 与 `data.json` 三方一致 |

`07` 会在自己的临时库里退出再重启，不需要额外准备。

### 实现要点

- **每个用例一份临时库 + 独立实例**，跑完 `app.quit()` 并删除目录。库从 `test-vault/sandbox` 复制，复制后把根目录的 `main.js` / `styles.css` / `manifest.json` 覆盖进插件目录，确保测的是当前构建而不是 sandbox 里可能过期的产物。
- **默认每次新建 profile**，靠点一次信任弹窗放行（约 0.3 s）。实测复用预置信任的 profile 时，Obsidian 会在启动阶段自动加载失败并弹「插件加载失败」，需要再显式 `enablePlugin` 一次；全新 profile 走的是首启路径，更干净。
- 信任弹窗的出现时机随库加载速度变化，代码里轮询到它再点，并且间隔 400 ms 重试（淡入动画期间点中心可能落空）。
- **清理按主进程 pid**：`spawn` 返回的启动器 pid 可能立刻退出，真正的主进程从 `require('electron').remote.process.pid` 取。端口 4 s 内没关才 `taskkill /T /F`，避免误杀。
- 最小化判据是 `isMinimized() && !isVisible() && !document.hasFocus()`。Windows 上最小化后 `isFocused()` 仍可能为 `true`，不能拿它当失败条件。

### 已知限制与踩坑

- **`Input.dispatchMouseEvent` 的 `mouseMoved` 会卡 5 s**（最小化和屏幕外都一样，像是等一个永远不来的 ack）。点击只发 `mousePressed` + `mouseReleased` 即可，Obsidian 的点击和右键菜单都正常。拖拽仍然需要带 `buttons:1` 的 `mouseMoved`，所以 19–21 条暂未自动化。
- **截图没有进用例**。恢复窗口挪到屏幕外那一步无法证明用户没看到一帧，视觉项继续人工（见 §6）。需要证据时按 §2 的「后台化」手动跑一次。
- 仍未覆盖：7–8、12–15、19–21、24。机制都在 §5 标了「可自动化」，属于第二批。
- 插件在**复用预置信任 profile** 时的启动加载失败，是宿主加载时序问题，不改 `src/` 的前提下用「显式 enable 一次」绕开；全新 profile 不触发。

### 排查顺序

1. 先看 `SKIP:` / 失败信息里的原始句子，别猜。
2. `--only=<slug> --verbose` 单独复跑一条。
3. 慢或超时加 `SP_E2E_TRACE=1`，看是哪个 CDP 调用/等待卡住。
4. 确认没有遗留实例：`Get-CimInstance Win32_Process -Filter "name='Obsidian.exe'"` 里命令行含 `sp-e2e-` 的都该是 0 条。

## 9. 复现方式

Phase A 的探测脚本留在 `tmp/cdp-probe/`（`tmp/` 已被 git 忽略），可直接复跑：

- `launch.mjs` — 按 §2 启动并等页面目标；
- `cdp.mjs` — 极简 CDP 客户端（`/json/list` + `Runtime.evaluate`）；
- `scenarios.mjs` — 串跑 7 个读场景；
- `final.mjs` — 完整串跑：信任 → 最小化 → 9 条清单 → 结构检查 → 截图 → 重启并核对 `expandedIds`。

目录里还有一份 `vault/`（sandbox 的干净副本）和 `userdata/`（已预置好库登记的 profile）。`userdata/obsidian-1.15.1.asar` 因为系统缓存无法删除，属正常现象，不影响复跑。

**日常验收请用 `npm run test:e2e`**，不要直接跑这些探测脚本：它们没有断言、会把每次点击拖慢 5 s（带了 `mouseMoved`），也不保证清理实例。Phase A 脚本只作为调试素材保留。
