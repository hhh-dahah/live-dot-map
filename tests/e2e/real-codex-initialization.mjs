import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { detectInstalledAdapters } from '../../agent-kit/lib/installer.mjs';
import { ensureProjectAgentConfig } from '../../src/bridge/server.mjs';

const root = resolve(import.meta.dirname, '../..');
const testRoot = resolve(process.env.LIVEDOT_REAL_TEST_ROOT || 'D:\\LiveDotMap-Test');
const codex = process.env.LIVEDOT_CODEX_BIN || 'D:\\桌面\\nodejs\\npm_global\\node_modules\\@openai\\codex\\bin\\codex.js';
const useGlobalCodex = process.env.LIVEDOT_USE_GLOBAL_CODEX === '1';

await mkdir(testRoot, { recursive: true });
await access(codex);

function runCodex(project, prompt, env = process.env, { bypassHookTrust = true } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const args = [
      codex,
      'exec', '--cd', project,
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
    ];
    if (bypassHookTrust) args.push('--dangerously-bypass-hook-trust');
    args.push('--ephemeral', prompt);
    const child = spawn(process.execPath, args, { cwd: project, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
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
        const error = new Error(`Codex 退出 ${code ?? signal}`);
        error.clientOutput = output;
        rejectRun(error);
      }
    });
    child.stdin.end();
  });
}

const project = await mkdtemp(join(testRoot, 'livedot-real-codex-init-'));
const codexHome = useGlobalCodex ? null : await mkdtemp(join(testRoot, 'livedot-real-codex-home-'));
try {
  // Detection is real (PATH/installation metadata), not a mocked adapter list.
  const detected = await detectInstalledAdapters({ projectRoot: project, platform: process.platform });
  assert.equal(detected.codex?.discovered, true, '未发现 Codex；请设置 LIVEDOT_CODEX_BIN 后重试');
  const setup = await ensureProjectAgentConfig(project, {
    sourceRoot: root,
    runtimeSource: join(root, 'livedot.mjs'),
  });
  assert.equal(setup.ok, true, JSON.stringify(setup));
  assert.ok(['configured', 'ready'].includes(setup.status), JSON.stringify(setup));
  assert.equal(setup.detectedAgents.codex.discovered, true);

  if (!useGlobalCodex) {
    // Codex CLI reads MCP configuration from CODEX_HOME. The project-level
    // .codex/config.toml is intentionally kept for normal interactive clients,
    // but an isolated real-session test must provide the same config explicitly
    // without touching the user's global C:\\Users\\...\\.codex directory.
    const nodeExe = process.execPath;
    const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
    const projectKey = project.toLowerCase();
    const mcpArgs = [
      join(project, '.live-dot-map', 'livedot.mjs'), 'mcp', '--project', project, '--agent', 'codex',
    ];
    const codexConfig = [
      `[mcp_servers."livedot-map"]`,
      `command = ${quote(nodeExe)}`,
      `args = [${mcpArgs.map(quote).join(', ')}]`,
      'required = true',
      '',
      `[projects.${quote(projectKey)}]`,
      `trust_level = ${quote('trusted')}`,
      '',
    ].join('\n');
    await mkdir(join(codexHome, 'skills'), { recursive: true });
    await writeFile(join(codexHome, 'config.toml'), codexConfig, 'utf8');
    await cp(join(project, '.codex', 'skills', 'live-dot-map'), join(codexHome, 'skills', 'live-dot-map'), { recursive: true });
  }

  const mapPath = join(project, '.live-dot-map', 'map.json');
  const before = JSON.parse(await readFile(mapPath, 'utf8'));
  const prompt = [
    '这是一次真实 Codex + 活点地图初始化验收，只能修改临时项目中的地图；不要直接编辑 map.json，不要执行其他文件操作。',
    '1. 先调用 map_get_context，再调用 map_validate；地图是唯一事实源，不要先读取 AGENTS.md 或扫描项目。',
    '2. 使用 map_apply_commands，沿用 map_get_context 返回的 baseRevision；commands 只提交一个固定 reducer 命令 {op:"create", collection:"nodes", value:{id:"real-codex-initialized", name:"真实 Codex 初始化", kind:"goal", type:"目的", route:"r1", x:240, y:0, md:".live-dot-map/nodes/real-codex-initialized.md"}}。',
    '3. 工具成功后报告实际 revision、节点 ID 和 createdBy；如果工具失败，停止并报告错误，不要改用直接文件写入。',
  ].join('\n');
  const codexEnv = useGlobalCodex ? process.env : { ...process.env, CODEX_HOME: codexHome };
  const output = await runCodex(project, prompt, codexEnv, { bypassHookTrust: !useGlobalCodex }).catch((error) => {
    throw new Error(`真实 Codex 会话失败：${error.message}\n--- 输出 ---\n${String(error.clientOutput || '').slice(-6000)}`, { cause: error });
  });
  await writeFile(join(project, 'codex-output.txt'), output, 'utf8');
  const after = JSON.parse(await readFile(mapPath, 'utf8'));
  const node = after.nodes.find((item) => item.id === 'real-codex-initialized');
  assert.ok(after.revision > before.revision, `revision 未推进：${before.revision} -> ${after.revision}；输出：${output.slice(-6000)}`);
  assert.ok(node, `Codex 未通过 MCP 创建初始化节点；输出：${output.slice(-6000)}`);
  assert.equal(node.createdBy, 'agent:codex');
  assert.equal(node.updatedBy, 'agent:codex');
  const health = JSON.parse(await readFile(join(project, '.live-dot-map', '.bridge', 'agent-health.json'), 'utf8'));
  assert.equal(health.records.codex?.status, 'ok', JSON.stringify(health));
  assert.equal(health.records.codex?.event, 'mcp:map_apply_commands');
  assert.match(output, /real-codex-initialized/);
  console.log(JSON.stringify({ ok: true, project, status: setup.status, revision: after.revision, nodeId: node.id, createdBy: node.createdBy, mcpEvent: health.records.codex.event }, null, 2));
} finally {
  if (process.env.LIVEDOT_KEEP_REAL_CLIENT_TMP !== '1') await rm(project, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }).catch(() => undefined);
  else console.error(`[real-codex-initialization] 保留临时项目：${project}`);
  if (codexHome && process.env.LIVEDOT_KEEP_REAL_CLIENT_TMP !== '1') await rm(codexHome, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }).catch(() => undefined);
  else if (codexHome) console.error(`[real-codex-initialization] 保留临时 CODEX_HOME：${codexHome}`);
}
