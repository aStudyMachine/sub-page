import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { clickElement, waitFor } from "../lib/dom.mjs";
import { modal, tree } from "../lib/page.mjs";

export const slug = "create-page";
export const name = "新建页面";
export const items = "清单 10";

export async function run(ctx) {
  const view = tree(ctx.page);
  const dialog = modal(ctx.page);

  await clickElement(
    ctx.page,
    `document.querySelector('.sp-toolbar .sp-icon-button')`,
    "left",
    "工具栏新建按钮",
  );
  await dialog.waitOpen();
  await dialog.fill("最终测试页");
  await dialog.buttonMatching("/确定|OK/");
  await dialog.waitClosed();

  const file = path.join(ctx.vault, "最终测试页.md");
  await waitFor(() => fs.existsSync(file), { timeout: 8000, label: "磁盘上出现 最终测试页.md" });

  assert.equal(fs.readFileSync(file, "utf8").trim(), "# 最终测试页", "正文应只有一级标题");
  await view.waitTitle("最终测试页");

  const rows = await view.rows();
  const row = rows.find((item) => item.title === "最终测试页");
  assert.equal(row.id, "最终测试页.md");
  assert.equal(row.group, false);
  assert.equal(row.parent, false);
}
