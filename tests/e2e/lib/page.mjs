import { clickElement, pressKey, typeText, waitFor } from "./dom.mjs";

const rowExpression = (title) =>
  `[...document.querySelectorAll('.sp-row')].find((row) => row.querySelector('.sp-title')?.textContent === ${JSON.stringify(title)})`;

const rowsExpression = `[...document.querySelectorAll('.sp-row')].map((row) => ({
  id: row.dataset.id ?? null,
  title: row.querySelector('.sp-title')?.textContent ?? null,
  badge: row.querySelector('.sp-badge')?.textContent ?? null,
  parent: row.classList.contains('is-parent'),
  group: row.classList.contains('is-group'),
  depth: Number(row.style.getPropertyValue('--sp-depth')),
  expanded: row.getAttribute('aria-expanded'),
}))`;

export function tree(page) {
  const api = {
    rows: () => page.ev(rowsExpression),
    titles: async () => (await page.ev(rowsExpression)).map((row) => row.title),
    row: (title) =>
      page.ev(`(() => { const row = ${rowExpression(title)}; return row ? row.dataset.id ?? null : null; })()`),
    click: (title) => clickElement(page, rowExpression(title), "left", `树行「${title}」`),
    contextMenu: (title) => clickElement(page, rowExpression(title), "right", `树行「${title}」`),
    expanded: () =>
      page.ev(`[...document.querySelectorAll('.sp-row[aria-expanded="true"]')].map((row) => row.dataset.id)`),
    current: () => page.ev(`[...document.querySelectorAll('.sp-row.is-current')].map((row) => row.dataset.id)`),
    focused: () => page.ev(`[...document.querySelectorAll('.sp-row.is-focused')].map((row) => row.dataset.id)`),
    isExpanded: (title) =>
      page.ev(`(() => {
        const row = ${rowExpression(title)};
        return row ? row.getAttribute('aria-expanded') === 'true' : null;
      })()`),
    waitCount: (count, timeout = 8000) =>
      waitFor(async () => ((await page.ev(rowsExpression)).length === count ? true : null), {
        timeout,
        label: `树行数变为 ${count}`,
      }),
    waitTitle: (title, timeout = 8000) =>
      waitFor(async () => ((await page.ev(rowExpression(title))) ? true : null), {
        timeout,
        label: `树中出现「${title}」`,
      }),
  };
  return api;
}

export function search(page) {
  const input = `document.querySelector('input.sp-search')`;

  return {
    type: async (text) => {
      await clickElement(page, input, "left", "搜索框");
      await page.ev(`(() => { const element = ${input}; element.focus(); element.select(); return true; })()`);
      await typeText(page, text);
    },
    value: () => page.ev(`(() => { const element = ${input}; return element ? element.value : null; })()`),
    clear: () => pressKey(page, "Escape", "Escape", 27),
  };
}

export function modal(page) {
  return {
    exists: () => page.ev(`!!document.querySelector('.modal')`),
    title: () => page.ev(`document.querySelector('.modal .modal-title')?.textContent ?? null`),
    waitOpen: (timeout = 8000) =>
      waitFor(() => page.ev(`!!document.querySelector('.modal')`), { timeout, label: "弹窗出现" }),
    waitClosed: (timeout = 8000) =>
      waitFor(() => page.ev(`!document.querySelector('.modal')`), { timeout, label: "弹窗关闭" }),
    fill: async (text) => {
      await page.ev(`(() => {
        const input = document.querySelector('.modal input');
        if (!input) return false;
        input.focus();
        input.select();
        return true;
      })()`);
      await typeText(page, text);
    },
    button: (text) =>
      clickElement(
        page,
        `[...document.querySelectorAll('.modal button')].find((button) => button.textContent.trim() === ${JSON.stringify(text)})`,
        "left",
        `弹窗按钮「${text}」`,
      ),
    buttonMatching: (pattern) =>
      clickElement(
        page,
        `[...document.querySelectorAll('.modal button')].find((button) => ${pattern}.test(button.textContent.trim()))`,
        "left",
        `匹配 ${pattern} 的弹窗按钮`,
      ),
    checkboxes: () =>
      page.ev(`[...document.querySelectorAll('.modal input.sp-check')].map((input) => input.checked)`),
  };
}

export function menu(page) {
  return {
    waitOpen: (timeout = 8000) =>
      waitFor(() => page.ev(`document.querySelectorAll('.menu .menu-item').length > 0`), {
        timeout,
        label: "右键菜单出现",
      }),
    items: () => page.ev(`[...document.querySelectorAll('.menu .menu-item')].map((item) => item.textContent.trim())`),
    click: (text) =>
      clickElement(
        page,
        `[...document.querySelectorAll('.menu .menu-item')].find((item) => item.textContent.includes(${JSON.stringify(text)}))`,
        "left",
        `菜单项「${text}」`,
      ),
  };
}

/** 当前活动笔记里的 subpages 块。 */
export function block(page) {
  return {
    read: () =>
      page.ev(`(() => {
        const leaf = window.app.workspace.activeLeaf;
        const root = leaf?.view?.containerEl;
        const element = root?.querySelector('.block-language-subpages');
        if (!element) return null;
        return {
          count: element.querySelector('.sp-block-count')?.textContent ?? null,
          isCards: !!element.querySelector('.sp-block-cards'),
          isList: !!element.querySelector('.sp-block-list'),
          cards: [...element.querySelectorAll('.sp-card')].map((card) => ({
            title: card.querySelector('.sp-card-title')?.textContent ?? null,
            desc: card.querySelector('.sp-card-desc')?.textContent ?? null,
          })),
          list: [...element.querySelectorAll('.sp-block-row')].map((row) => row.querySelector('.sp-block-title')?.textContent ?? null),
          empty: element.querySelector('.sp-empty')?.textContent ?? null,
        };
      })()`),
  };
}
