#!/usr/bin/env node
// 单元测试入口：给整套测试进程（含其派生的桥/MCP/hook 子进程）套一层全局隔离。
// 否则未单独隔离的测试会继承用户真实的 ~/.live-dot-map/current-project.json 与常驻运行态，
// 一边把画布指针改成测试目录，一边顺着指针读写真实项目地图。
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sandbox = await mkdtemp(join(tmpdir(), 'livedot-test-env-'));
const defaults = {
  LIVEDOT_CURRENT_PROJECT_FILE: join(sandbox, 'current-project.json'),
  LIVEDOT_RECENT_PROJECTS_FILE: join(sandbox, 'recent-projects.json'),
  LIVEDOT_RUNTIME_STATE_DIR: join(sandbox, 'runtime'),
  LIVEDOT_LOG_DIR: join(sandbox, 'logs'),
};
const env = { ...process.env };
for (const [key, value] of Object.entries(defaults)) env[key] ??= value;

const extra = process.argv.slice(2);
const args = ['--test', ...(extra.length ? extra : ['tests/**/*.test.mjs'])];
const child = spawn(process.execPath, args, { stdio: 'inherit', env });
const code = await new Promise((resolve) => {
  child.once('error', () => resolve(1));
  child.once('close', (status, signal) => resolve(signal ? 1 : status ?? 1));
});
await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined);
process.exit(code);
