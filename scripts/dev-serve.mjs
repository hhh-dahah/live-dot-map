#!/usr/bin/env node
// 工位测试实例：npm run dev —— 起一个隔离的活点地图桥（独立端口/单例锁/会话），打印测试地址。
// 无论在哪个工位运行都与常驻画布完全隔离；Ctrl+C 退出，不动用户桌面体验。
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = join(ROOT, '.live-dot-map-dev');

const child = spawn(process.execPath, [
  'livedot.mjs', 'serve',
  '--project', ROOT,
  '--app', join(ROOT, 'app.html'),
  '--runtime-state-dir', stateDir,
], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });

const rl = createInterface({ input: child.stdout });
let announced = false;
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) { console.log(trimmed); return; }
  try {
    const info = JSON.parse(trimmed);
    if (typeof info.url === 'string') {
      announced = true;
      console.log(`\n✔ 测试实例已就绪（运行时状态目录: ${stateDir}）`);
      console.log(`  打开: ${info.url}`);
      console.log('  本实例运行当前目录的代码，与常驻画布完全隔离；Ctrl+C 退出。\n');
      return;
    }
  } catch { /* 非 JSON 行原样透传 */ }
  console.log(trimmed);
});
child.on('exit', (code, signal) => {
  if (!announced) console.error(`✖ 测试实例未能启动（exit=${code ?? signal}，详见上方输出）`);
  process.exit(code ?? 0);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { try { child.kill(signal); } catch { /* 已退出 */ } });
}
