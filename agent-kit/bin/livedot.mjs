#!/usr/bin/env node
import { installProject, doctorProject, uninstallProject } from '../lib/installer.mjs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { runSelfTest } from '../lib/self-test.mjs';
import { downloadPortableNode, portableManifestFor } from '../lib/portable-node.mjs';

function argsFrom(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith('--')) {
      result._.push(value);
      continue;
    }
    const [key, inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) result[key] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) result[key] = argv[++i];
    else result[key] = true;
  }
  return result;
}

function print(value) {
  process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  print(`活点地图 Agent Kit（本地桥客户端）\n\n用法：\n  node agent-kit/bin/livedot.mjs install [--project-root <dir>] [--no-shortcut]\n  node agent-kit/bin/livedot.mjs doctor [--project-root <dir>] [--check-bridge]\n  node agent-kit/bin/livedot.mjs uninstall [--project-root <dir>]\n  node agent-kit/bin/livedot.mjs self-test\n  node agent-kit/bin/livedot.mjs hook session-start|user-prompt-submit|stop\n  node agent-kit/bin/livedot.mjs mcp\n  node agent-kit/bin/livedot.mjs portable-node [--allow-download] [--destination <file>]`);
}

async function proxyRuntime(runtime, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runtime, ...args], { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code) reject(new Error(`统一运行时退出码 ${code}`));
      else resolve({ ok: true, command: args[0] });
    });
  });
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const parsed = argsFrom(argv);
  const command = parsed._[0];
  if (!command || command === 'help' || command === '--help') {
    usage();
    return { ok: true, command: 'help' };
  }
  const projectRoot = parsed['project-root'] || env.LIVEDOT_PROJECT_ROOT || process.cwd();
  if (command === 'install') {
    const result = await installProject({
      projectRoot,
      bridgeUrl: parsed['bridge-url'] || env.LIVEDOT_BRIDGE_URL || '',
      register: parsed['no-register'] !== true,
      createDesktopShortcut: parsed['no-shortcut'] !== true,
      offline: parsed['allow-download'] !== true,
      platform: process.platform,
      env,
    });
    print(result);
    return result;
  }
  if (command === 'doctor') {
    const result = await doctorProject({ projectRoot, checkBridge: parsed['check-bridge'] === true, offline: parsed['allow-download'] !== true });
    print(result);
    if (!result.ok) process.exitCode = 1;
    return result;
  }
  if (command === 'uninstall') {
    const result = await uninstallProject({ projectRoot });
    print(result);
    if (!result.ok && result.reason !== 'not-installed') process.exitCode = 1;
    return result;
  }
  if (command === 'self-test') {
    const result = await runSelfTest();
    print(result);
    if (!result.ok) process.exitCode = 1;
    return result;
  }
  if (command === 'hook') {
    const hook = parsed.event || parsed._[1];
    if (!['session-start', 'user-prompt', 'user-prompt-submit', 'stop'].includes(hook)) throw new Error('hook 事件无效');
    const agent = parsed.agent || env.LIVEDOT_AGENT || 'codex';
    const runtime = join(projectRoot, '.live-dot-map', 'livedot.mjs');
    return proxyRuntime(runtime, ['hook', '--event', hook === 'user-prompt-submit' ? 'user-prompt' : hook, '--project', projectRoot, '--agent', agent]);
  }
  if (command === 'mcp') {
    return proxyRuntime(join(projectRoot, '.live-dot-map', 'livedot.mjs'), ['mcp', '--project', projectRoot, '--agent', parsed.agent || env.LIVEDOT_AGENT || 'generic']);
  }
  if (command === 'portable-node') {
    const entry = portableManifestFor();
    if (!entry) throw new Error('当前平台没有便携 Node 清单');
    const result = await downloadPortableNode({
      destination: parsed.destination || `${projectRoot}/.live-dot-map/runtime/${entry.archive}`,
      allowDownload: parsed['allow-download'] === true,
    });
    print(result);
    return result;
  }
  usage();
  throw new Error(`未知命令: ${command}`);
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('livedot.mjs')) {
  main().catch((error) => {
    process.stderr.write(`[活点地图] ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
