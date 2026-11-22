import { sleep } from "./cdp.mjs";

export async function waitFor(probe, { timeout = 8000, interval = 100, label = "条件" } = {}) {
  const started = Date.now();
  const deadline = started + timeout;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) {
        if (process.env.SP_E2E_TRACE && Date.now() - started > 300) {
          console.error(`    [trace] ${label} ${Date.now() - started}ms`);
        }
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }

  throw new Error(
    `等待超时：${label}${lastError ? `（最后一次错误：${lastError.message}）` : ""}`,
  );
}

/** 把表达式求值成元素，再取中心点；不可见或不存在时返回 null。 */
export function elementRect(page, expression) {
  return page.ev(`(() => {
    const element = ${expression};
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
}

export async function clickAt(page, point, button = "left") {
  const buttons = button === "right" ? 2 : 1;
  // 不派发 mouseMoved：Electron 对它的 ack 会卡满 5 s（最小化和屏幕外都一样），
  // 而 pressed/released 本身就带坐标，Obsidian 的点击与右键菜单都正常。
  await page.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button,
    clickCount: 1,
    buttons,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button,
    clickCount: 1,
    buttons: 0,
  });
}

/** 按表达式找到元素后点击。最小化状态下同样生效（截图除外）。 */
export async function clickElement(page, expression, button = "left", label = "元素") {
  const point = await elementRect(page, expression);
  if (!point) throw new Error(`找不到可点击的${label}`);
  await clickAt(page, point, button);
  return point;
}

export async function typeText(page, text) {
  await page.send("Input.insertText", { text });
}

export async function pressKey(page, key, code, keyCode) {
  await page.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode: keyCode,
  });
  await page.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: keyCode,
  });
}
