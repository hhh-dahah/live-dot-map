import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installProject } from '../../agent-kit/lib/installer.mjs';

const root = resolve(import.meta.dirname, '../..');
const clients = {
  codex: process.env.LIVEDOT_CODEX_BIN || 'D:\\桌面\\nodejs\\npm_global\\node_modules\\@openai\\codex\\bin\\codex.js',
  claude: process.env.LIVEDOT_CLAUDE_BIN || 'D:\\桌面\\nodejs\\npm_global\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe',
  kimi: process.env.LIVEDOT_KIMI_BIN || 'C:\\Users\\Thomas\\.kimi-code\\bin\\kimi.exe',
  codebuddy: process.env.LIVEDOT_CODEBUDDY_BIN || 'D:\\workbuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy',
};
const selected = process.argv.slice(2).filter((value) => value in clients);
if (!selected.length) throw new Error('用法：node tests/e2e/real-client-smoke.mjs codex|claude|kimi|codebuddy');

async function run(command, args, options = {}) {
  const executable = options.execPath || command;
  const childArgs = options.execPath ? [command, ...args] : args;
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, childArgs, { cwd: options.cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill(), 180_000);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', (error) => { clearTimeout(timeout); error.clientOutput = `${stdout}\n${stderr}`; rejectRun(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      const output = `${stdout}\n${stderr}`;
      if (code === 0) resolveRun(output);
      else {
        const error = new Error(`命令退出 ${code ?? signal}: ${command} ${args.join(' ')}`);
        error.code = code;
        error.signal = signal;
        error.clientOutput = output;
        rejectRun(error);
      }
    });
    child.stdin.end();
  });
}

async function runClient(agent, project) {
  const prompt = [
    '这是一次活点地图真实客户端接入验收。只做以下事情，不要修改其他文件：',
    '1. 先读取活点地图 MCP 上下文并找到人类标注 a-human-real-client。',
    '2. 立即调用 map_apply_commands，baseRevision 使用 map_get_context 返回的 revision（首次应为 0）：commands 只包含一个 create，collection=nodes，value 使用 id=real-client-check、num=02、name=真实客户端验收、type=结果、route=r1、x=240、y=0、md=.live-dot-map/nodes/real-client-check.md。必须拿到工具成功响应，不要只描述计划。',
    '3. 再调用 map_ack_human_updates，ids 只填 a-human-real-client，summary 必须逐字包含 a-human-real-client 和“真实客户端先验证新用户接入”。',
    '4. 最后报告两个工具都成功的结果；如果任一工具失败，继续修正调用，不要提前结束。',
  ].join('\n');
  if (agent === 'codex') return run(clients.codex, ['exec', '--cd', project, '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust', '--ephemeral', prompt], { cwd: project, execPath: process.execPath });
  if (agent === 'claude') return run(clients.claude, ['-p', '--dangerously-skip-permissions', '--permission-mode', 'bypassPermissions', '--mcp-config', join(project, '.mcp.json'), '--strict-mcp-config', prompt], { cwd: project });
  if (agent === 'codebuddy') return run(clients.codebuddy, ['-p', '-y', '--permission-mode', 'bypassPermissions', '--mcp-config', join(project, '.mcp.json'), '--strict-mcp-config', prompt], { cwd: project, execPath: process.execPath });
  return run(clients.kimi, ['--prompt', prompt], { cwd: project });
}

const results = [];
for (const agent of selected) {
  const project = await mkdtemp(join(tmpdir(), `livedot-real-${agent}-`));
  try {
    // CodeBuddy is embedded in WorkBuddy on this machine and is not on PATH;
    // force the optional adapter into this isolated fixture so the real CLI
    // receives its own --agent codebuddy MCP server instead of Claude's server.
    await installProject({ projectRoot: project, createDesktopShortcut: false, register: false, offline: true, discoverAgents: agent === 'codebuddy' ? false : true });
    const mapPath = join(project, '.live-dot-map', 'map.json');
    const map = JSON.parse(await readFile(mapPath, 'utf8'));
    const now = new Date().toISOString();
    map.anns = [{ id: 'a-human-real-client', target: { kind: 'canvas' }, text: '真实客户端先验证新用户接入', source: 'human', priority: 'high', attention: 'new', acknowledgements: [], createdAt: now, updatedAt: now, updatedBy: 'human', updatedRevision: map.revision }];
    await writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`);
    let output = '';
    try {
      output = await runClient(agent, project);
    } catch (error) {
      output = error?.clientOutput || '';
      throw new Error(`${agent} 客户端进程失败：${error?.message || error}\n--- client output ---\n${output.slice(-4000)}`, { cause: error });
    }
    const persisted = JSON.parse(await readFile(mapPath, 'utf8'));
    const node = persisted.nodes.find((item) => item.name === '真实客户端验收');
    assert.equal(persisted.anns[0].attention, 'acknowledged', `${agent} did not acknowledge human update. Output: ${output.slice(-2000)}`);
    assert.ok(node && node.updatedBy === `agent:${agent}`, `${agent} did not write back a node. Output: ${output.slice(-2000)}`);
    assert.match(output, /a-human-real-client/, `${agent} output did not cite the human annotation. Output: ${output.slice(-2000)}`);
    results.push({ agent, acknowledged: true, wroteBack: true, revision: persisted.revision });
  } finally {
    if (process.env.LIVEDOT_KEEP_REAL_CLIENT_TMP !== '1') {
      await rm(project, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }).catch(() => undefined);
    } else {
      console.error(`[real-client-smoke] 保留临时项目：${project}`);
    }
  }
}
console.log(JSON.stringify(results, null, 2));
