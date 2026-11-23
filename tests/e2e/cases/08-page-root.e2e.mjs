import assert from "node:assert/strict";

import { clickElement, waitFor } from "../lib/dom.mjs";
import { modal, tree } from "../lib/page.mjs";

export const slug = "page-root";
export const name = "空页面根与缺失页面根";
export const items = "页面根";

export async function run({ page }) {
  const view = tree(page);
  await page.ev(`(async () => {
    await app.vault.createFolder('空根');
    await app.plugins.plugins['sub-page'].applyPageRoot('空根');
  })()`);
  const emptyState = () => page.ev(`(() => {
    const empty = document.querySelector('.sp-empty');
    return { text: empty.textContent, button: empty.querySelector('button')?.textContent };
  })()`);
  assert.deepEqual(await emptyState(), { text: "还没有页面，点下面的按钮开始新建页面", button: "新建页面" });
  await clickElement(page, "document.querySelector('.sp-empty button')", "left", "空根的新建按钮");
  const dialog = modal(page);
  await dialog.waitOpen();
  await dialog.fill("第一篇");
  await dialog.buttonMatching("/确定|新建|Create|OK/");
  await dialog.waitClosed();
  await view.waitTitle("第一篇");
  assert.equal(await page.ev("!!app.vault.getAbstractFileByPath('空根/第一篇.md')"), true);

  await page.ev("app.plugins.plugins['sub-page'].applyPageRoot('缺失根')");
  await waitFor(async () => (await view.rows()).length === 0, { label: "缺失根没有可操作的页面行" });
  assert.deepEqual(await emptyState(), { text: "页面根目录不存在：缺失根选择页面根目录", button: "选择页面根目录" });
}
