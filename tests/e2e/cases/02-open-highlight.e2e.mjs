import assert from "node:assert/strict";

import { waitFor } from "../lib/dom.mjs";
import { tree } from "../lib/page.mjs";

export const slug = "open-highlight";
export const name = "打开页面并高亮";
export const items = "清单 4";

export async function run(ctx) {
  const view = tree(ctx.page);

  await view.click("需求");
  await waitFor(
    () => ctx.page.ev(`window.app.workspace.getActiveFile()?.path === '项目A/需求.md'`),
    { label: "需求 打开为活动笔记" },
  );
  await waitFor(async () => (await view.current()).includes("项目A/需求.md"), {
    label: "需求 行变成当前页",
  });
  assert.deepEqual(await view.current(), ["项目A/需求.md"], "高亮应该跟着活动笔记走");

  // sandbox 默认展开 Java，所以 并发 一开始就可见；点它展开自己的子页，再点叶子。
  assert.equal(await view.isExpanded("Java"), true, "夹具里 Java 默认展开");
  await view.click("并发");
  await view.waitCount(12);
  assert.equal(await view.isExpanded("并发"), true);
  assert.deepEqual(await view.current(), ["项目A/需求.md"], "展开分组不应改变高亮");

  await view.click("线程池");
  await waitFor(
    () => ctx.page.ev(`window.app.workspace.getActiveFile()?.path === 'Java/并发/线程池.md'`),
    { label: "线程池 打开为活动笔记" },
  );
  await waitFor(async () => (await view.current()).includes("Java/并发/线程池.md"), {
    label: "线程池 行变成当前页",
  });
  assert.deepEqual(await view.current(), ["Java/并发/线程池.md"]);
  assert.equal(await view.isExpanded("Java"), true, "Java 应保持展开");
  assert.equal(await view.isExpanded("并发"), true, "并发 应保持展开");
}
