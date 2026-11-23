import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanupWorkDir, createSession, locateObsidian, prepareProfile, prepareVault } from "../e2e/lib/obsidian.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const sandbox = process.env.SP_E2E_SANDBOX ?? path.join(repo, "test-vault", "sandbox");
const exe = locateObsidian();
if (!exe) throw new Error("找不到 Obsidian.exe，请设置 OBSIDIAN_EXE");

async function measure(artifacts) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sp-perf-"));
  let session;
  try {
    const vault = prepareVault(work, sandbox, artifacts);
    for (let index = 0; index < 40; index += 1) {
      const dir = path.join(vault, `压测分组${index}`);
      fs.mkdirSync(dir);
      for (let note = 0; note < 100; note += 1) {
        fs.writeFileSync(path.join(dir, `笔记${note}.md`), "# 性能测试\n");
      }
    }
    const { profile } = prepareProfile(work, vault, null);
    const started = performance.now();
    session = await createSession({ exe, vault, profile });
    const launchToTreeMs = Math.round(performance.now() - started);
    const probe = await session.page.ev(`(async () => {
      const plugins = app.plugins;
      const startup = [];
      for (let i = 0; i < 3; i++) {
        await plugins.disablePlugin('sub-page');
        const start = performance.now();
        await plugins.enablePlugin('sub-page');
        const plugin = plugins.plugins['sub-page'];
        await plugin.activateTree();
        if (!document.querySelector('.sp-row')) throw new Error('页面树未渲染');
        startup.push({ firstRowsMs: performance.now() - start, scanMs: plugin.service.lastScanMs });
      }
      const plugin = plugins.plugins['sub-page'];
      const leaf = app.workspace.getLeaf('tab');
      await leaf.openFile(app.vault.getAbstractFileByPath('项目A/项目A.md'));
      if (leaf.view.getMode?.() !== 'preview') {
        await leaf.view.setState({ ...leaf.view.getState(), mode: 'preview' }, { history: false });
      }
      const previewStart = performance.now();
      while (!leaf.view.containerEl.querySelector('.sp-card')) {
        if (performance.now() - previewStart > 5000) throw new Error('正文块未渲染');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      await new Promise(resolve => setTimeout(resolve, 250));
      const { service } = plugin;
      const tree = app.workspace.getLeavesOfType('sub-page-tree')[0].view;
      const save = [];
      let current;
      const listFolder = service.deps.adapter.listFolder.bind(service.deps.adapter);
      service.deps.adapter.listFolder = (path) => {
        if (current && path === '') current.rootListings++;
        return listFolder(path);
      };
      const render = tree.render.bind(tree);
      tree.render = () => {
        if (current) current.treeRenders++;
        render();
      };
      for (const refresh of Array.from(plugin.blockRefreshers)) {
        plugin.blockRefreshers.delete(refresh);
        plugin.blockRefreshers.add(() => {
          if (current) current.blockRefreshes++;
          refresh();
        });
      }
      const changed = service.deps.onChange;
      service.deps.onChange = (reason) => {
        if (current && reason === 'refresh') current.scans++;
        changed(reason);
        if (current && reason === 'metadata') current.saveToViewsMs = performance.now() - current.start;
      };
      for (let i = 0; i < 3; i++) {
        current = { start: performance.now(), scans: 0, rootListings: 0, treeRenders: 0, blockRefreshes: 0 };
        await app.vault.modify(app.vault.getAbstractFileByPath('首页.md'), '保存探针 ' + i);
        await new Promise(resolve => setTimeout(resolve, 300));
        if (current.saveToViewsMs === undefined) throw new Error('未观察到保存后的视图更新');
        const { start, ...counts } = current;
        save.push(counts);
        current = undefined;
      }
      return { startup, save, nodes: service.nodes.length, rows: tree.contentEl.querySelectorAll('.sp-row').length };
    })()`);
    console.log(JSON.stringify({ artifacts, launchToTreeMs, ...probe }, null, 2));
  } finally {
    if (session) await session.stop();
    cleanupWorkDir(work);
  }
}

for (const artifacts of process.argv.slice(2).length ? process.argv.slice(2) : [repo]) {
  await measure(path.resolve(artifacts));
}
