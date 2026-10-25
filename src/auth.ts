import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { checkedFetch, safeUrl, type Config } from './config.js';

interface DeviceCode { device_code: string; user_code: string; verification_uri: string; verification_uri_complete?: string; expires_in: number; interval: number; }
interface TokenResponse { access_token: string; user: { id: number; username: string }; }
interface Credential { token: string; user?: TokenResponse['user']; }

// Tokens enter PowerShell over stdin, never process arguments or logs.
async function dpapi(value: string, decrypt: boolean): Promise<string> {
  const expression = decrypt
    ? "[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))"
    : "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))";
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); [Console]::Out.Write(${expression})`],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    child.stderr.resume();
    child.on('error', () => reject(new Error('Windows credential protection could not start.')));
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error('Windows credential protection failed.')));
    child.stdin.on('error', () => {});
    child.stdin.end(value);
  });
}

export class Auth {
  private pending?: { code: DeviceCode; deadline: number; interval: number; nextPoll: number };
  private credential?: Credential;
  private loaded = false;
  private polling?: Promise<unknown>;
  constructor(readonly config: Config) {}
  private get file(): string { return join(this.config.configDir, createHash('sha256').update(this.config.baseUrl).digest('hex').slice(0, 20) + '.json'); }

  async token(): Promise<string> {
    if (this.config.token) return this.config.token;
    if (!this.loaded) {
      try {
        const stored = JSON.parse(await readFile(this.file, 'utf8'));
        if (stored.origin !== this.config.baseUrl) throw new Error('Credential origin mismatch.');
        this.credential = stored.protection === 'dpapi'
          ? JSON.parse(await dpapi(stored.data, true)) : stored.credential;
        if (typeof this.credential?.token !== 'string') throw new Error('Invalid credential file.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      this.loaded = true;
    }
    if (!this.credential?.token) throw new Error('Not signed in. Use auth_begin, approve the code in your browser, then auth_poll.');
    return this.credential.token;
  }

  async begin(openBrowser = false): Promise<unknown> {
    if (this.config.token) throw new Error('TTCRAFT_TOKEN overrides stored credentials. Remove it before interactive sign-in.');
    this.pending = undefined;
    await this.polling?.catch(() => {});
    const res = await checkedFetch(`${this.config.baseUrl}/api/devices/code`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_name: `TTCraft MCP (${hostname()})` }),
    });
    const code = await res.json() as DeviceCode;
    if (!code.device_code || !code.user_code) throw new Error('Invalid device authorization response.');
    const approval = safeUrl(code.verification_uri_complete || code.verification_uri);
    if (approval.origin !== this.config.baseUrl) throw new Error('Approval URL must belong to TTCraft.');
    const expires = Math.min(Math.max(Number(code.expires_in) || 900, 1), 900);
    const interval = Math.max(Number(code.interval) || 5, 2) * 1000;
    this.pending = { code, deadline: Date.now() + expires * 1000, interval, nextPoll: Date.now() + interval };
    let launched = false;
    if (openBrowser) {
      launched = await new Promise<boolean>(resolve => {
        const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', approval.href] : [approval.href];
        const child = spawn(command, args, { shell: false, windowsHide: true, detached: true, stdio: 'ignore' });
        child.once('error', () => resolve(false));
        child.once('spawn', () => { child.unref(); resolve(true); });
      });
    }
    return { status: 'authorization_pending', verification_url: approval.href, user_code: code.user_code, expires_in: expires,
      browser_launch_requested: launched, poll_after_seconds: interval / 1000, instruction: 'Open verification_url and approve. Then call auth_poll. Never ask the user for a password or token.' };
  }

  async poll(): Promise<unknown> {
    this.polling ??= this.doPoll().finally(() => { this.polling = undefined; });
    return this.polling;
  }
  private async doPoll(): Promise<unknown> {
    const pending = this.pending;
    if (!pending) return this.status();
    if (Date.now() >= pending.deadline) { this.pending = undefined; return { status: 'expired', instruction: 'Call auth_begin again.' }; }
    const wait = pending.nextPoll - Date.now();
    if (wait > 0) return { status: 'authorization_pending', poll_after_seconds: Math.ceil(wait / 1000) };
    pending.nextPoll = Date.now() + pending.interval;
    const res = await fetch(`${this.config.baseUrl}/api/devices/token`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ device_code: pending.code.device_code }),
    });
    const data = await res.json() as TokenResponse & { error?: string };
    if (res.ok) {
      if (!data.access_token || !data.user?.username) throw new Error('Invalid token response.');
      // A sign-out or a new authorization invalidates any in-flight poll.
      if (this.pending !== pending) return { status: 'cancelled' };
      await this.save({ token: data.access_token, user: data.user });
      this.pending = undefined;
      return { status: 'signed_in', user: data.user };
    }
    if (data.error === 'slow_down') pending.interval += 5000;
    if (data.error === 'authorization_pending' || data.error === 'slow_down') {
      pending.nextPoll = Date.now() + pending.interval;
      return { status: 'authorization_pending', poll_after_seconds: pending.interval / 1000 };
    }
    this.pending = undefined;
    throw new Error(`Authorization failed: ${data.error || res.status}`);
  }
  private async save(credential: Credential): Promise<void> {
    await mkdir(this.config.configDir, { recursive: true, mode: 0o700 });
    const stored = process.platform === 'win32'
      ? { origin: this.config.baseUrl, protection: 'dpapi', data: await dpapi(JSON.stringify(credential), false) }
      : { origin: this.config.baseUrl, protection: 'permissions', credential };
    const tmp = this.file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(tmp, JSON.stringify(stored), { mode: 0o600, flag: 'wx' });
      await rename(tmp, this.file);
      if (process.platform !== 'win32') await chmod(this.file, 0o600);
    } finally { await rm(tmp, { force: true }); }
    this.credential = credential;
    this.loaded = true;
  }
  async status(): Promise<unknown> {
    try {
      const token = await this.token();
      const res = await checkedFetch(`${this.config.baseUrl}/api/dev/me`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
      return { status: 'signed_in', ...await res.json(), origin: this.config.baseUrl };
    } catch (e) {
      if ((e as Error).message.startsWith('Not signed in.')) return { status: this.pending ? 'authorization_pending' : 'signed_out', origin: this.config.baseUrl };
      throw e;
    }
  }
  async logout(): Promise<unknown> {
    this.pending = undefined;
    await this.polling?.catch(() => {});
    this.credential = undefined;
    this.loaded = true;
    await rm(this.file, { force: true });
    return { status: this.config.token ? 'environment_token_active' : 'signed_out',
      instruction: this.config.token ? 'Remove TTCRAFT_TOKEN from the MCP client environment to sign out.' : 'Local credential removed. Revoke TTCraft MCP in Settings → Security to revoke the server token.' };
  }
  async api<T = Record<string, unknown>>(path: string, init: RequestInit = {}, timeout = 30000): Promise<T> {
    const token = await this.token();
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    headers.set('accept', 'application/json');
    const res = await checkedFetch(`${this.config.baseUrl}${path}`, { ...init, headers }, timeout);
    return await res.json() as T;
  }
  async loginCli(): Promise<void> {
    const start = await this.begin(true);
    process.stderr.write(JSON.stringify(start, null, 2) + '\n');
    while (this.pending) {
      await delay(Math.max(1000, this.pending.nextPoll - Date.now()));
      const result = await this.poll() as { status: string };
      if (result.status !== 'authorization_pending') process.stderr.write(JSON.stringify(result) + '\n');
    }
  }
}
