import assert from "node:assert/strict";

import { pressKey, waitFor } from "../lib/dom.mjs";
import { modal, search, tree } from "../lib/page.mjs";

export const slug = "search";
export const name = "搜索命中";
export const items = "清单 9";

const hitText = (page) =>
  page.ev(`(() => {
    const row = document.querySelector('.sp-row');
    if (!row) return null;
    return { id: row.dataset.id, mark: row.querySelector('mark')?.textContent ?? null };
  })()`);

export async function run(ctx) {
  const { page } = ctx;
  const view = tree(page);
  const box = search(page);
  const dialog = modal(page);
  const focused = () => page.ev("document.activeElement?.dataset.id ?? null");
  const hitId = "Java/jvm/堆内存.md";

  await view.click("首页");
  await box.type("内存");
  await waitFor(async () => (await view.rows()).length === 1, { label: "搜索只剩 1 行" });

  const hit = await hitText(ctx.page);
  assert.equal(hit.id, hitId);
  assert.equal(hit.mark, "内存", "命中片段应高亮");
  assert.equal(await view.row("Java"), null, "分组目录不应出现在搜索结果里");

  await pressKey(page, "Tab", "Tab", 9);
  await pressKey(page, "Tab", "Tab", 9);
  assert.equal(await focused(), hitId);
  await pressKey(page, "ArrowDown", "ArrowDown", 40);
  await pressKey(page, "ArrowUp", "ArrowUp", 38);
  assert.equal(await focused(), hitId);
  await pressKey(page, "Enter", "Enter", 13);
  await waitFor(() => page.ev(`app.workspace.getActiveFile()?.path === ${JSON.stringify(hitId)}`), {
    label: "Enter 打开命中的页面",
  });

  const focusHit = () => page.ev("document.querySelector('.sp-row[tabindex=\"0\"]').focus()");
  await focusHit();
  assert.equal(await focused(), hitId, "F2 前应仍聚焦命中项");
  await pressKey(page, "F2", "F2", 113);
  await waitFor(() => dialog.exists(), { label: "F2 打开重命名弹窗" });
  assert.equal(await page.ev("document.querySelector('.modal input')?.value"), "堆内存");
  await pressKey(page, "Escape", "Escape", 27);
  await dialog.waitClosed();
  await focusHit();
  assert.equal(await focused(), hitId, "Delete 前应仍聚焦命中项");
  await pressKey(page, "Delete", "Delete", 46);
  await waitFor(() => dialog.exists(), { label: "Delete 打开删除弹窗" });
  assert.equal(await page.ev("document.querySelector('.modal .sp-modal-body p')?.textContent"), "堆内存");
  await pressKey(page, "Escape", "Escape", 27);
  await dialog.waitClosed();

  await page.ev("document.querySelector('.sp-search').focus()");
  await box.clear();
  await view.waitCount(11);
  assert.equal(await box.value(), "", "Esc 应清空搜索框");

  // 分组目录不参与搜索：路径里带 Java，但标题不含。
  await box.type("java");
  await waitFor(async () => (await view.rows()).length === 0, { label: "搜索 java 无结果" });
  await pressKey(page, "Delete", "Delete", 46);
  assert.equal(await dialog.exists(), false);
  assert.equal(await page.ev("!!document.querySelector('.sp-tree [tabindex=\"0\"]')"), false);

  await box.clear();
  await view.waitCount(11);
}
