import assert from "node:assert/strict";

import { waitFor } from "../lib/dom.mjs";

export const slug = "drag-between";
export const name = "跨目录拖放与顺序写入";
export const items = "跨目录拖放";

export async function run({ page }) {
  // 使用 DOM DragEvent，避免最小化的测试窗口等待 Windows 拖动会话。
  await page.ev(`(() => {
    const source = document.querySelector('.sp-row[data-id="首页.md"]');
    const anchor = document.querySelector('.sp-row[data-id="项目A/需求.md"]');
    const dataTransfer = new DataTransfer();
    const clientY = anchor.getBoundingClientRect().top + 1;
    source.dispatchEvent(new DragEvent('dragstart', { dataTransfer, bubbles: true }));
    anchor.dispatchEvent(new DragEvent('dragover', { dataTransfer, clientY, bubbles: true, cancelable: true }));
    if (!anchor.classList.contains('is-drop-before')) throw new Error('未标记前插落点');
    anchor.dispatchEvent(new DragEvent('drop', { dataTransfer, clientY, bubbles: true, cancelable: true }));
  })()`);
  const rowIds = () => page.ev("Array.from(document.querySelectorAll('.sp-row'), (row) => row.dataset.id)");
  const moved = "项目A/首页.md";
  await waitFor(async () => (await rowIds()).includes(moved), { label: "首页移动到项目A" });
  const rows = await rowIds();
  assert.equal(rows[rows.indexOf(moved) + 1], "项目A/需求.md");
  assert.ok(!rows.includes("首页.md"));
  const saved = await page.ev(`(async () => {
    const { service } = app.plugins.plugins['sub-page'];
    const order = JSON.parse(await app.vault.adapter.read(service.order.path));
    return order.roots[""]["项目A"];
  })()`);
  assert.equal(saved[saved.indexOf("首页.md") + 1], "需求.md");
}
