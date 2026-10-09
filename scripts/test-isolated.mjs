#!/usr/bin/env node
// 单元测试入口：给整套测试进程（含其派生的桥/MCP/hook 子进程）套一层全局隔离。
// 否则未单独隔离的测试会继承用户真实的 ~/.live-dot-map/current-project.json 与常驻运行态，
// 一边把画布指针改成测试目录，一边顺着指针读写真实项目地图。
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sandbox = await mkdtemp(join(tmpdir(), 'livedot-test-env-'));
const defaults = {
  LIVEDOT_CURRENT_PROJECT_FILE: join(sandbox, 'current-project.json'),
  LIVEDOT_RECENT_PROJECTS_FILE: join(sandbox, 'recent-projects.json'),
  LIVEDOT_RUNTIME_STATE_DIR: join(sandbox, 'runtime'),
  LIVEDOT_LOG_DIR: join(sandbox, 'logs'),
  LIVEDOT_MAP_LEDGER_FILE: join(sandbox, 'known-maps.json'),
};
const env = { ...process.env };
for (const [key, value] of Object.entries(defaults)) env[key] ??= value;
// 桥启动时会按 homedir() 装 Agent 套件（livedot.mjs、各家 SKILL.md、MCP 配置），
// 不换掉 HOME 就会把测试版本装进用户真实的 Agent 目录。
const home = join(sandbox, 'home');
await mkdir(home, { recursive: true });
env.HOME = home;
env.USERPROFILE = home;

const extra = process.argv.slice(2);
const args = ['--test', ...(extra.length ? extra : ['tests/**/*.test.mjs'])];
const child = spawn(process.execPath, args, { stdio: 'inherit', env });
const code = await new Promise((resolve) => {
  child.once('error', () => resolve(1));
  child.once('close', (status, signal) => resolve(signal ? 1 : status ?? 1));
});
await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined);
process.exit(code);
