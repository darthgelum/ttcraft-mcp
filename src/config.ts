import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config { baseUrl: string; configDir: string; token?: string; remote?: boolean;
  checkTableAccess?: (tableId: number) => Promise<void>; }
export function safeUrl(value: string, websocket = false): URL {
  const url = new URL(value);
  const secure = websocket ? 'wss:' : 'https:';
  const plain = websocket ? 'ws:' : 'http:';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== secure && !(local && url.protocol === plain))) {
    throw new Error(`Expected ${secure}// URL (plain transport is allowed on loopback only).`);
  }
  return url;
}
export function configFromEnv(): Config {
  const url = safeUrl(process.env.TTCRAFT_URL || 'https://ttcraft.net');
  if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('TTCRAFT_URL must be an origin, e.g. https://ttcraft.net.');
  }
  return {
    baseUrl: url.origin,
    configDir: process.env.TTCRAFT_CONFIG_DIR || join(homedir(), '.ttcraft-mcp'),
    token: process.env.TTCRAFT_TOKEN || undefined,
  };
}
export async function checkedFetch(url: string | URL, init: RequestInit = {}, timeout = 30000): Promise<Response> {
  const response = await fetch(url, { ...init, redirect: 'error', signal: init.signal || AbortSignal.timeout(timeout) });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 1500);
    throw new Error(`HTTP ${response.status}: ${body || response.statusText}`);
  }
  return response;
}
