import assert from "node:assert/strict";

import { block } from "../lib/page.mjs";

export const slug = "card-view";
export const name = "卡片视图";
export const items = "清单 5";

export async function run(ctx) {
  const rendered = await ctx.page.ev(`(async () => {
    const file = window.app.vault.getAbstractFileByPath('项目A/项目A.md');
    const leaf = window.app.workspace.getLeaf('tab');
    await leaf.openFile(file);
    const view = leaf.view;
    if (view.getMode?.() !== 'preview') {
      await view.setState({ ...view.getState(), mode: 'preview' }, { history: false });
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
    return true;
  })()`);
  assert.equal(rendered, true);

  const content = await block(ctx.page).read();
  assert.ok(content, "活动笔记里没有找到 subpages 块");
  assert.equal(content.isCards, true, "应渲染成卡片视图");
  assert.ok(content.count?.includes("2"), `块计数应包含 2，实际：${content.count}`);
  assert.equal(content.cards.length, 2, "卡片数量应为 2");

  const byTitle = new Map(content.cards.map((card) => [card.title, card]));
  assert.ok(byTitle.has("需求"), "卡片里应有「需求」");
  assert.ok(byTitle.has("设计"), "卡片里应有「设计」");
  assert.equal(byTitle.get("需求").desc, "这个页面有子页面吗");
  assert.equal(byTitle.get("设计").desc ?? "", "", "「设计」没有描述，不应显示描述");
}
