import assert from "node:assert/strict";

import { tree } from "../lib/page.mjs";

export const slug = "tree";
export const name = "树结构与计数";
export const items = "清单 1–3";

// sandbox 的 data.json 预置展开 手册 / 项目A / Java，因此默认可见 11 行。
const EXPECTED = [
  { title: "笔记规范", depth: 0, kind: "leaf" },
  { title: "手册", depth: 0, kind: "parent", badge: "2" },
  { title: "常见问题", depth: 1, kind: "leaf" },
  { title: "快速开始", depth: 1, kind: "leaf" },
  { title: "首页", depth: 0, kind: "leaf" },
  { title: "项目A", depth: 0, kind: "parent", badge: "2" },
  { title: "设计", depth: 1, kind: "parent" },
  { title: "需求", depth: 1, kind: "leaf" },
  { title: "Java", depth: 0, kind: "group", badge: "3" },
  { title: "并发", depth: 1, kind: "group", badge: "1" },
  { title: "jvm", depth: 1, kind: "group", badge: "2" },
];

export async function run(ctx) {
  const view = tree(ctx.page);
  await view.waitCount(EXPECTED.length);

  const rows = await view.rows();
  assert.deepEqual(
    rows.map((row) => row.title),
    EXPECTED.map((row) => row.title),
    "树的可见行顺序与「期望的树」不一致",
  );

  for (const [index, expected] of EXPECTED.entries()) {
    const row = rows[index];
    assert.equal(row.depth, expected.depth, `「${expected.title}」的缩进层级不对`);
    assert.equal(row.badge, expected.badge ?? null, `「${expected.title}」的计数不对`);
    assert.equal(row.parent, expected.kind === "parent", `「${expected.title}」的父页面判定不对`);
    assert.equal(row.group, expected.kind === "group", `「${expected.title}」的分组目录判定不对`);
  }

  assert.ok(
    !rows.some((row) => row.title === "_assets"),
    "_assets 不应该出现在页面树里",
  );

  assert.equal(await view.row("项目A"), "项目A");
  assert.equal(await view.row("需求"), "项目A/需求.md");
  assert.equal(await view.row("Java"), "Java");
}
