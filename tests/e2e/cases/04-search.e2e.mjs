import assert from "node:assert/strict";

import { waitFor } from "../lib/dom.mjs";
import { search, tree } from "../lib/page.mjs";

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
  const view = tree(ctx.page);
  const box = search(ctx.page);

  await box.type("内存");
  await waitFor(async () => (await view.rows()).length === 1, { label: "搜索只剩 1 行" });

  const hit = await hitText(ctx.page);
  assert.equal(hit.id, "Java/jvm/堆内存.md");
  assert.equal(hit.mark, "内存", "命中片段应高亮");
  assert.equal(await view.row("Java"), null, "分组目录不应出现在搜索结果里");

  await box.clear();
  await view.waitCount(11);
  assert.equal(await box.value(), "", "Esc 应清空搜索框");

  // 分组目录不参与搜索：路径里带 Java，但标题不含。
  await box.type("java");
  await waitFor(async () => (await view.rows()).length === 0, { label: "搜索 java 无结果" });

  await box.clear();
  await view.waitCount(11);
}
