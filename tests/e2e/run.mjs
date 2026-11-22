#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { sleep } from "./lib/cdp.mjs";
import {
  cleanupWorkDir,
  createSession,
  locateObsidian,
  prepareProfile,
  prepareVault,
} from "./lib/obsidian.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const sandbox = process.env.SP_E2E_SANDBOX ?? path.join(repo, "test-vault", "sandbox");
// 默认每次用全新 profile：实测预置信任的 profile 会让插件在启动阶段自动加载失败，
// 需要再显式 enable 一次。全新 profile 点一次信任弹窗只要 ~0.3 s，路径更干净。
// 需要离线或想跳过信任点击时，用 SP_E2E_TEMPLATE 指向一个已初始化过的 profile。
const template =
  process.env.SP_E2E_TEMPLATE && process.env.SP_E2E_TEMPLATE !== "none"
    ? process.env.SP_E2E_TEMPLATE
    : null;

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const verbose = args.includes("--verbose");
const only = args.find((arg) => arg.startsWith("--only="))?.slice("--only=".length) ?? null;

function log(message) {
  if (verbose) console.log(`    ${message}`);
}

function preflight() {
  const problems = [];
  if (process.platform !== "win32") {
    problems.push("当前系统不是 Windows，本框架只支持 Windows 上的 Obsidian");
  }

  const exe = locateObsidian();
  if (!exe) {
    problems.push("找不到 Obsidian.exe（可用环境变量 OBSIDIAN_EXE 指定路径）");
  }
  if (!fs.existsSync(sandbox)) {
    problems.push(`样例库不存在：${sandbox}（先按 CONTRIBUTING 准备 test-vault/sandbox）`);
  }
  for (const file of ["main.js", "styles.css", "manifest.json"]) {
    if (!fs.existsSync(path.join(repo, file))) {
      problems.push(`缺少构建产物 ${file}（先执行 npm run build）`);
    }
  }

  return { problems, exe };
}

async function loadCases() {
  const directory = path.join(here, "cases");
  const files = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".e2e.mjs"))
    .sort();

  const cases = [];
  for (const file of files) {
    const module = await import(pathToFileURL(path.join(directory, file)).href);
    if (only && !file.includes(only) && !module.slug?.includes(only)) continue;
    cases.push({ file, ...module });
  }
  return cases;
}

async function diagnose(page) {
  if (!page) return null;
  try {
    return await page.ev(`(() => ({
      active: window.app?.workspace?.getActiveFile?.()?.path ?? null,
      rows: [...document.querySelectorAll('.sp-row')].map((row) => row.dataset.id),
      modal: document.querySelector('.modal .modal-title')?.textContent ?? null,
      menu: [...document.querySelectorAll('.menu .menu-item')].map((item) => item.textContent.trim()),
    }))()`);
  } catch {
    return null;
  }
}

async function runCase(testCase, env) {
  const started = Date.now();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `sp-e2e-${testCase.slug}-`));
  let session = null;
  let page = null;
  let phase = started;

  const mark = (label) => {
    if (!process.env.SP_E2E_TRACE) return;
    const now = Date.now();
    console.error(`    [trace] ${label} ${now - phase}ms（累计 ${now - started}ms）`);
    phase = now;
  };

  try {
    const vault = prepareVault(workDir, sandbox, repo);
    const { profile, templateUsed } = prepareProfile(workDir, vault, template);
    if (!templateUsed) log("没有可复用的 profile 模板，本次首启会下载 asar 并弹信任框");
    mark("准备临时库与 profile");

    session = await createSession({
      exe: env.exe,
      profile,
      vault,
      log,
    });
    page = session.page;
    mark("启动实例");

    const context = {
      vault,
      repo,
      restart: async () => {
        await session.restart();
        page = session.page;
        return session;
      },
    };
    Object.defineProperty(context, "page", { get: () => session.page });
    Object.defineProperty(context, "workDir", { get: () => workDir });

    await testCase.run(context);
    mark("执行用例");
    return { status: "pass", ms: Date.now() - started };
  } catch (error) {
    const snapshot = await diagnose(session?.page ?? page);
    return {
      status: "fail",
      ms: Date.now() - started,
      error,
      snapshot,
    };
  } finally {
    if (session) {
      await session.stop().catch((error) => log(`停止实例失败：${error.message}`));
      mark("停止实例");
    }
    // 给 Obsidian 的退出留一点余量，避免 profile 里的 leveldb 仍被占用。
    await sleep(200);
    cleanupWorkDir(workDir);
    mark("清理临时目录");
  }
}

async function main() {
  const { problems, exe } = preflight();
  if (problems.length > 0) {
    const message = problems.join("；");
    if (strict) {
      console.error(`FAIL: ${message}`);
      process.exit(1);
    }
    console.log(`SKIP: ${message}`);
    process.exit(0);
    return;
  }

  const cases = await loadCases();
  if (cases.length === 0) {
    const message = only ? `没有匹配 --only=${only} 的用例` : "tests/e2e/cases 下没有用例";
    if (strict) {
      console.error(`FAIL: ${message}`);
      process.exit(1);
    }
    console.log(`SKIP: ${message}`);
    process.exit(0);
    return;
  }

  console.log(`Sub Page CDP UI 验收 · ${cases.length} 条用例`);
  console.log(`  Obsidian  ${exe}`);
  console.log(`  样例库    ${sandbox}（每个用例复制到临时目录）`);
  console.log(`  端口      动态分配（串行，一次一个实例）`);
  console.log(`  模式      ${strict ? "strict（不可用即失败）" : "默认（不可用即跳过）"}`);
  console.log("");

  const results = [];
  const env = { exe };

  for (const testCase of cases) {
    process.stdout.write(`▶ ${testCase.slug} ${testCase.name}${testCase.items ? `（${testCase.items}）` : ""}\n`);
    const result = await runCase(testCase, env);
    results.push({ testCase, ...result });

    if (result.status === "pass") {
      console.log(`  ✓ 通过 ${(result.ms / 1000).toFixed(1)}s`);
    } else {
      console.log(`  ✗ 失败 ${(result.ms / 1000).toFixed(1)}s`);
      console.log(`    ${result.error?.message ?? result.error}`);
      if (verbose && result.error?.stack) {
        console.log(result.error.stack.split("\n").slice(1, 4).join("\n"));
      }
      if (result.snapshot) console.log(`    现场：${JSON.stringify(result.snapshot)}`);
    }
  }

  const passed = results.filter((result) => result.status === "pass").length;
  const failed = results.length - passed;
  const total = results.reduce((sum, result) => sum + result.ms, 0);

  console.log("");
  console.log(
    `${passed} 通过，${failed} 失败，共 ${results.length} 条（${(total / 1000).toFixed(1)}s）`,
  );

  process.exit(failed > 0 ? 1 : 0);
}

await main();
