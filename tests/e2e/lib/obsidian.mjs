import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { connect, sleep } from "./cdp.mjs";
import { clickElement, waitFor } from "./dom.mjs";

/** 固定的 vault id：profile 里的信任标记按 id 存，换路径不该丢信任。 */
export const VAULT_ID = "cdpprobe00000001";

export const PLUGIN_FILES = ["main.js", "styles.css", "manifest.json"];

export function locateObsidian() {
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const candidates = [
    process.env.OBSIDIAN_EXE,
    "D:/Obsidian/Obsidian.exe",
    localAppData && path.join(localAppData, "Obsidian", "Obsidian.exe"),
    localAppData && path.join(localAppData, "Programs", "Obsidian", "Obsidian.exe"),
    programFiles && path.join(programFiles, "Obsidian", "Obsidian.exe"),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function findFreePort(start = 9223, attempts = 50) {
  return new Promise((resolve, reject) => {
    const tryPort = (port, remaining) => {
      const server = net.createServer();
      server.once("error", () => {
        if (remaining <= 0) reject(new Error(`从 ${start} 起找不到空闲端口`));
        else tryPort(port + 1, remaining - 1);
      });
      server.once("listening", () => server.close(() => resolve(port)));
      server.listen(port, "127.0.0.1");
    };
    tryPort(start, attempts);
  });
}

export function prepareVault(workDir, sandboxDir, repoDir) {
  const vault = path.join(workDir, "vault");
  fs.cpSync(sandboxDir, vault, { recursive: true });

  // sandbox 里的产物未必等于当前源码构建，显式覆盖，避免测到上一版。
  const pluginDir = path.join(vault, ".obsidian", "plugins", "sub-page");
  fs.mkdirSync(pluginDir, { recursive: true });
  for (const file of PLUGIN_FILES) {
    fs.copyFileSync(path.join(repoDir, file), path.join(pluginDir, file));
  }
  return vault;
}

export function prepareProfile(workDir, vaultDir, templateDir) {
  const profile = path.join(workDir, "profile");
  let templateUsed = false;

  if (templateDir && fs.existsSync(templateDir)) {
    try {
      fs.cpSync(templateDir, profile, { recursive: true });
      templateUsed = true;
    } catch {
      // 模板被占用时退回全新 profile：会多一次 24 MB 下载和信任弹窗，但还能跑。
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
  fs.mkdirSync(profile, { recursive: true });

  // 上次运行留下的端口记录对本次没有意义。
  fs.rmSync(path.join(profile, "DevToolsActivePort"), { force: true });

  fs.writeFileSync(
    path.join(profile, "obsidian.json"),
    JSON.stringify({
      vaults: {
        [VAULT_ID]: {
          path: vaultDir.split(path.sep).join("/"),
          ts: Date.now(),
          open: true,
        },
      },
    }),
  );

  return { profile, templateUsed };
}

export function launch(exe, port, profile) {
  const child = spawn(
    exe,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profile.split(path.sep).join("/")}`],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  return child.pid ?? null;
}

export function killTree(pid) {
  if (!pid || process.platform !== "win32") return;
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
}

export async function ensurePlugin(page, log = () => {}) {
  const loaded = () => page.ev(`!!window.app?.plugins?.plugins?.['sub-page']`);
  const trustOpen = () => page.ev(`!!document.querySelector('.modal.mod-trust-folder')`);
  const enable = async () => {
    const result = await page.ev(`(async () => {
      try {
        await window.app.plugins.enablePlugin('sub-page');
        return 'ok';
      } catch (error) {
        return String(error?.message ?? error);
      }
    })()`);
    if (result !== "ok") log(`enablePlugin 返回：${result}`);
    return result;
  };

  const started = Date.now();
  let trustedAt = 0;
  let enableTriedAt = 0;
  let lastError = null;

  while (Date.now() - started < 25000) {
    if (await loaded()) return;

    // 信任弹窗何时出现取决于库的加载速度，不能只查一次。
    if (await trustOpen()) {
      log("处理信任弹窗");
      let closed = false;
      for (let attempt = 0; attempt < 3 && !closed; attempt += 1) {
        // 弹窗有淡入动画，元素刚出现时点中心可能落在动画帧上，稳一下再点。
        await sleep(400);
        await clickElement(
          page,
          `[...document.querySelectorAll('.modal.mod-trust-folder button')].find((button) => button.textContent.includes('信任'))`,
          "left",
          "信任按钮",
        );
        closed = await waitFor(() => page.ev(`!document.querySelector('.modal.mod-trust-folder')`), {
          timeout: 2500,
        })
          .then(() => true)
          .catch(() => false);
      }
      if (!closed) throw new Error("信任弹窗点击 3 次仍未关闭");
      trustedAt = Date.now();
      continue;
    }

    // 点过信任后先等 Obsidian 自己加载（实测约 500 ms）；这段时间里调 enablePlugin
    // 反而会把加载打断。只有迟迟不加载、或压根没有信任弹窗（预置信任的旧 profile）
    // 时，才显式启用一次。
    const waitAfterTrust = 8000;
    const waitWithoutTrust = 3000;
    const shouldEnable =
      !enableTriedAt &&
      (trustedAt ? Date.now() - trustedAt > waitAfterTrust : Date.now() - started > waitWithoutTrust);
    if (shouldEnable) {
      enableTriedAt = Date.now();
      log("显式启用插件 sub-page");
      lastError = await enable();
    }

    await sleep(300);
  }

  throw new Error(`插件 sub-page 没有加载${lastError ? `（enablePlugin：${lastError}）` : ""}`);
}

export async function openTree(page) {
  await page.ev(`(async () => {
    await window.app.commands.executeCommandById('sub-page:open');
    return true;
  })()`);
  await waitFor(() => page.ev(`document.querySelectorAll('.sp-row').length > 0`), {
    timeout: 15000,
    label: "页面树出现",
  });
}

export async function minimize(page) {
  await page.ev(`(() => {
    const win = require('electron').remote.getCurrentWindow();
    win.setSkipTaskbar(true);
    win.minimize();
    return true;
  })()`);

  // 实测 Windows 上最小化后 isFocused() 仍可能为 true，但窗口已不可见、DOM 也失去焦点，
  // 这已经足够证明没占用户的键鼠。判据用 visible + minimized + hasFocus。
  const state = await waitFor(
    () =>
      page
        .ev(`(() => {
          const win = require('electron').remote.getCurrentWindow();
          return { minimized: win.isMinimized(), visible: win.isVisible(), focused: win.isFocused(), domFocus: document.hasFocus() };
        })()`)
        .then((value) => (value.minimized && !value.visible && !value.domFocus ? value : null)),
    { timeout: 5000, label: "窗口进入后台" },
  );

  return state;
}

export async function quit(page) {
  await page
    .ev(
      `(() => {
        setTimeout(() => require('electron').remote.app.quit(), 50);
        return true;
      })()`,
      // 退出过程中执行上下文可能被销毁，别在这里等满默认超时。
      { timeoutMs: 3000 },
    )
    .catch(() => {});
}

export async function waitPortClosed(port, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(300) });
    } catch {
      return true;
    }
    await sleep(100);
  }
  return false;
}

export async function createSession({ exe, profile, vault, log = () => {} }) {
  let page = null;
  let pid = null;
  let mainPid = null;
  let port = null;

  const session = {
    get page() {
      return page;
    },
    get pid() {
      return pid;
    },
    get port() {
      return port;
    },
    async start() {
      // 每次启动换一个端口：退出与重新监听之间有竞态，沿用同一端口可能连到半死的旧目标。
      port = await findFreePort();
      pid = launch(exe, port, profile);
      page = await connect(port);
      await waitFor(() => page.ev(`!!window.app?.plugins`), {
        timeout: 30000,
        label: "Obsidian 应用就绪",
      });
      // 启动器可能很快退出，真正的主进程 pid 从渲染进程里取，清理时才杀得掉。
      mainPid = await page
        .ev(`require('electron').remote?.process?.pid ?? null`)
        .catch(() => null);
      await ensurePlugin(page, log);
      await openTree(page);
      await minimize(page);
      log(`实例就绪（pid ${pid}，端口 ${port}）`);
    },
    async stop() {
      const closing = port;
      if (page) {
        await quit(page);
        page.close();
        page = null;
      }
      const closed = closing ? await waitPortClosed(closing, 4000) : true;
      if (!closed) {
        killTree(mainPid);
        if (!(await waitPortClosed(closing, 2000))) killTree(pid);
      }
      pid = null;
      mainPid = null;
    },
    async restart() {
      await session.stop();
      await sleep(300);
      await session.start();
      return session;
    },
  };

  await session.start();
  return session;
}

export function cleanupWorkDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
  } catch {
    // 系统缓存着 profile 里的 asar（EBUSY）时删不干净，留着不影响下次运行。
  }
}
