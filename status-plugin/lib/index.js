/**
 * dsh-qwenpaw-bridge-status
 *
 * A host-only web-profile row that reports whether QwenPaw's DSH backend is
 * reachable. Cordis marks the row active on success and failed (with the
 * error) when QwenPaw is down, so the plugin card's status dot is the
 * connection indicator.
 *
 * The bridge plugin itself lives in the `qwenpaw` profile; it is an ACP
 * transport and cannot run inside the `web` profile.
 */

const DEFAULT_BASE = 'http://127.0.0.1:8088';
const RETRY_MS = 1500;
const DEADLINE_MS = 12000;

async function probe(base) {
  const res = await fetch(`${base}/api/harnesses`, {
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) throw new Error(`QwenPaw HTTP ${res.status}`);
  const data = await res.json();
  const dsh = (data.providers || []).find((item) => item.id === 'dsh');
  if (!dsh || !dsh.available || !dsh.installed) {
    throw new Error('QwenPaw 已启动，但 dsh 后端不可用');
  }
  return dsh;
}

export async function apply(ctx) {
  const base = (process.env.QWENPAW_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  const deadline = Date.now() + DEADLINE_MS;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const dsh = await probe(base);
      ctx?.logger?.info?.(`QwenPaw connected: dsh backend available (${base})`);
      return;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
  throw new Error(`QwenPaw 未连接（${base}）：${last?.message || 'unknown error'}`);
}
