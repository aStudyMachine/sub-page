import { setTimeout as delay } from "node:timers/promises";

export const sleep = (ms) => delay(ms);

const DEFAULT_TIMEOUT = 15000;

/**
 * 连接渲染进程。
 *
 * `/json/list` 里不只有应用页面：刚启动时先出现 starter.html，还有 url 为空的
 * 内部目标，所以必须按 `index.html` 过滤，不能取 list[0]。
 */
export async function connect(port, { timeoutMs = 45000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(
          (item) => item.type === "page" && typeof item.url === "string" && item.url.includes("index.html"),
        );
        if (target) return await open(target.webSocketDebuggerUrl);
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }

  throw new Error(
    `连接 CDP 超时（端口 ${port}）：${lastError?.message ?? "没有出现 index.html 页面目标"}`,
  );
}

async function open(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  let closed = false;

  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error(`WebSocket 连接失败：${url}`));
  });

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    entry.resolve(message);
  };

  socket.onclose = () => {
    closed = true;
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`CDP 连接已关闭（等待 ${entry.method}）`));
      pending.delete(id);
    }
  };

  const send = (method, params = {}, { timeoutMs = DEFAULT_TIMEOUT } = {}) => {
    const started = Date.now();
    if (closed) return Promise.reject(new Error(`CDP 连接已关闭（${method}）`));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, method });
      socket.send(JSON.stringify({ id, method, params }));
    }).then((message) => {
      const elapsed = Date.now() - started;
      if (process.env.SP_E2E_TRACE && elapsed > 300) {
        console.error(`    [trace] ${method}${params.type ? `:${params.type}` : ""} ${elapsed}ms`);
      }
      return message;
    });
  };

  const evaluate = async (expression, options) => {
    const started = Date.now();
    const message = await send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      options,
    );
    const elapsed = Date.now() - started;
    if (process.env.SP_E2E_TRACE && elapsed > 300) {
      console.error(`    [trace] evaluate ${elapsed}ms :: ${expression.replace(/\s+/g, " ").slice(0, 100)}`);
    }
    if (message.error) throw new Error(`CDP 错误：${JSON.stringify(message.error)}`);
    const details = message.result?.exceptionDetails;
    if (details) {
      const text = details.exception?.description ?? details.text ?? JSON.stringify(details);
      throw new Error(`页面脚本异常：${String(text).slice(0, 600)}`);
    }
    return message.result?.result?.value;
  };

  return { send, ev: evaluate, close: () => socket.close() };
}
