import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { menu, modal, tree } from "../lib/page.mjs";

export const slug = "rename-backlink";
export const name = "改名后反链更新";
export const items = "清单 11";

export async function run(ctx) {
  const view = tree(ctx.page);
  const context = menu(ctx.page);
  const dialog = modal(ctx.page);

  // 用真实鼠标点击触发右键菜单：命令触发的弹窗需要窗口焦点，而右键菜单不需要。
  await view.contextMenu("项目A");
  await context.waitOpen();
  await context.click("重命名");

  await dialog.waitOpen();
  await dialog.fill("项目A改");
  await dialog.buttonMatching("/确定|OK/");
  await dialog.waitClosed();

  await view.waitTitle("项目A改");
  assert.equal(fs.existsSync(path.join(ctx.vault, "项目A改")), true, "目录应改名");
  assert.equal(fs.existsSync(path.join(ctx.vault, "项目A")), false, "旧目录名不应残留");

  const backlinks = fs.readFileSync(path.join(ctx.vault, "笔记规范.md"), "utf8");
  assert.ok(backlinks.includes("[[项目A改]]"), `反链没跟着改名：${backlinks.trim()}`);
  assert.ok(!backlinks.includes("[[项目A]]"), "旧反链不应残留");
}
