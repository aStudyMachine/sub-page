import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { tree } from "../lib/page.mjs";

export const slug = "restart-expanded";
export const name = "重启后展开态保持";
export const items = "清单 27";

const sorted = (values) => [...values].sort();

function readDataExpanded(vault) {
  const data = JSON.parse(
    fs.readFileSync(path.join(vault, ".obsidian", "plugins", "sub-page", "data.json"), "utf8"),
  );
  return sorted(data.expandedIds ?? []);
}

export async function run(ctx) {
  const view = tree(ctx.page);
  await view.waitCount(11);

  const before = sorted(await view.expanded());
  const titlesBefore = await view.titles();
  const dataBefore = readDataExpanded(ctx.vault);
  assert.deepEqual(before, dataBefore, "关闭前 DOM 的展开态应与 data.json 一致");
  assert.ok(before.length > 0, "夹具应至少有一层展开");

  await ctx.restart();

  const viewAfter = tree(ctx.page);
  await viewAfter.waitCount(11);

  const after = sorted(await viewAfter.expanded());
  const dataAfter = readDataExpanded(ctx.vault);

  assert.deepEqual(after, before, "重启后树里展开的节点应与关闭前一致");
  assert.deepEqual(dataAfter, dataBefore, "重启后 data.json 的 expandedIds 不应变化");
  assert.deepEqual(await viewAfter.titles(), titlesBefore, "重启后可见行应与关闭前一致");
}
