import assert from "node:assert/strict";

import { waitFor } from "../lib/dom.mjs";

export const slug = "block-sort";
export const name = "正文块名称、手动与修改时间排序";
export const items = "正文块排序";

export async function run({ page }) {
  await page.ev(`(async () => {
    const { vault, workspace } = app;
    await vault.createFolder('排序');
    await vault.create('排序/第 2 页.md', '# 第二页');
    await vault.create('排序/第 10 页.md', '# 第十页');
    const source = ${JSON.stringify(["manual", "name", "modified"]
      .map((sort) => "\x60\x60\x60subpages\nsort: " + sort + "\n\x60\x60\x60").join("\n\n"))};
    const parent = await vault.create('排序/排序.md', source);
    const { service } = app.plugins.plugins['sub-page'];
    await service.rebuild();
    await service.operations.reorderScope('排序', ['第 10 页.md', '第 2 页.md']);
    const leaf = workspace.getLeaf('tab');
    await leaf.openFile(parent);
    if (leaf.view.getMode?.() !== 'preview') {
      await leaf.view.setState({ ...leaf.view.getState(), mode: 'preview' }, { history: false });
    }
  })()`);
  const orders = () => page.ev(`Array.from(
    app.workspace.activeLeaf.view.containerEl.querySelectorAll('.sp-block-list'),
    (list) => Array.from(list.querySelectorAll('.sp-block-title'), (title) => title.textContent)
  )`);
  try {
    await waitFor(async () => (await orders()).length >= 3, { label: "三个正文块渲染完成" });
  } catch (error) {
    const preview = await page.ev(`app.workspace.activeLeaf.view.containerEl.querySelector('.markdown-preview-view')?.textContent`);
    throw new Error(`${error.message}。预览：${preview?.slice(0, 600)}`, { cause: error });
  }
  assert.deepEqual((await orders()).slice(0, 2), [["第 10 页", "第 2 页"], ["第 2 页", "第 10 页"]]);

  for (const title of ["第 10 页", "第 2 页"]) {
    await page.ev(`app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(`排序/${title}.md`)}), '更新时间')`);
    await waitFor(async () => (await orders())[2]?.[0] === title, { label: `保存后「${title}」排在修改时间列表首位` });
  }
  assert.deepEqual((await orders()).slice(0, 2), [["第 10 页", "第 2 页"], ["第 2 页", "第 10 页"]]);
}
