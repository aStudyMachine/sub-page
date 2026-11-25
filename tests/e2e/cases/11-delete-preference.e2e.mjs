import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { waitFor } from "../lib/dom.mjs";
import { menu, modal, tree } from "../lib/page.mjs";

export const slug = "delete-preference";
export const name = "删除遵循 Obsidian 设置";
export const items = "清单 24";

export async function run(ctx) {
  const view = tree(ctx.page);
  const context = menu(ctx.page);
  const dialog = modal(ctx.page);

  for (const { title, preference, recoverable } of [
    { title: "首页", preference: "local", recoverable: true },
    { title: "笔记规范", preference: "none", recoverable: false },
  ]) {
    const filename = `${title}.md`;
    const original = path.join(ctx.vault, filename);
    const trashed = path.join(ctx.vault, ".trash", filename);
    const content = fs.readFileSync(original, "utf8");
    assert.ok(!fs.existsSync(trashed), `${filename} 不应预先存在于回收站`);

    await ctx.page.ev(`app.vault.setConfig("trashOption", ${JSON.stringify(preference)})`);
    await view.contextMenu(title);
    await context.waitOpen();
    await context.click("删除");
    await dialog.waitOpen();
    await dialog.buttonMatching("/^删除$|^Delete$/");
    await dialog.waitClosed();
    await waitFor(() => !fs.existsSync(original), { label: `原路径不再存在：${filename}` });

    if (recoverable) {
      await waitFor(() => fs.existsSync(trashed), { label: `库内回收站收到 ${filename}` });
      assert.equal(fs.readFileSync(trashed, "utf8"), content);
    } else {
      assert.ok(!fs.existsSync(trashed), `${filename} 应按宿主设置永久删除`);
    }
  }
}
