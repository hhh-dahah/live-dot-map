import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { installProject } from '../../agent-kit/lib/installer.mjs';
import { createBridgeServer } from '../../src/bridge/server.mjs';
import { loadSharedAdapter } from '../../src/bridge/shared-adapter.mjs';

const root = resolve(import.meta.dirname, '../..');
const clients = {
  codex: { command: process.env.LIVEDOT_CODEX_BIN || 'D:\\桌面\\nodejs\\npm_global\\node_modules\\@openai\\codex\\bin\\codex.js', execPath: process.execPath, args: ['exec', '--cd', '{project}', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust', '--ephemeral', '{prompt}'] },
  kimi: { command: process.env.LIVEDOT_KIMI_BIN || 'C:\\Users\\Thomas\\.kimi-code\\bin\\kimi.exe', args: ['--prompt', '{prompt}'] },
  codebuddy: { command: process.env.LIVEDOT_CODEBUDDY_BIN || 'D:\\workbuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy', execPath: process.execPath, args: ['-p', '-y', '--permission-mode', 'bypassPermissions', '--mcp-config', '{mcp}', '--strict-mcp-config', '{prompt}'] },
};
const agent = process.argv[2];
if (!agent || !clients[agent]) throw new Error('用法：node tests/e2e/real-long-task-smoke.mjs codex|kimi|codebuddy');
const REAL_TEST_ROOT = resolve(process.env.LIVEDOT_REAL_TEST_ROOT || 'D:\\LiveDotMap-Test');
await mkdir(REAL_TEST_ROOT, { recursive: true });
// 隔离最近项目记录，避免受控测试目录写进真实用户环境。
process.env.LIVEDOT_RECENT_PROJECTS_FILE = join(REAL_TEST_ROOT, 'recent-projects-real-long-task.json');

const prompt = [
  '这是一次真实长程活点地图闭环验收，只修改临时项目地图和对应 Markdown，不修改其他项目源文件。必须实际调用工具，不要只描述。',
  '1. 先调用 map_get_context 和 map_list_human_updates，首次摘要逐字引用 a-human-long-task，然后调用 map_ack_human_updates。',
  '2. 从当前节点 n1 开始，用 map_apply_commands 创建一条 pending 方案边 e-failed，name=故意失败方向，from=n1，to=null，route=r1，score=20，dx=180，dy=0。创建后在 .live-dot-map/routes/e-failed.md 写入“关键证据”和“下一步”。',
  '3. 模拟得到失败证据：用 map_apply_commands 把 e-failed 更新为 failed，并创建失败结果节点 n-failed；补全 Markdown 的“结果”“评分”“失败原因”“下一步”。',
  '4. 调用 map_next_candidates，query=故意失败方向，currentNodeId=n1，limit=3，includeHistory=false；不要重复 e-failed，选择或创建一个替代方向 e-alternative，并把它推进为 success，创建结果节点 n-success，写完整 Markdown（关键证据、结果、评分、下一步）。',
  '5. 用 map_apply_commands 更新路线 r1.currentNodeId=n-success；调用 map_validate，确保 attemptIssues 为空。最后用不超过 12 行总结：失败方向、失败原因、替代方向、成功结果、当前节点和下一步。',
].join('\n');

function run(command, args, options = {}) {
  const executable = options.execPath || command;
  const childArgs = options.execPath ? [command, ...args] : args;
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, childArgs, { cwd: options.cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill(), Number(process.env.LIVEDOT_LONG_TIMEOUT_MS || 240_000));
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', (error) => { clearTimeout(timeout); error.clientOutput = `${stdout}\n${stderr}`; rejectRun(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      const output = `${stdout}\n${stderr}`;
      if (code === 0) resolveRun(output);
      else { const error = new Error(`命令退出 ${code ?? signal}`); error.clientOutput = output; rejectRun(error); }
    });
    child.stdin.end(options.input || undefined);
  });
}

function markdownSection(text, heading) {
  const lines = String(text || '').split(/\r?\n/);
  const wanted = String(heading).replace(/\s+/g, '');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*#{1,6}\s*(.*?)\s*$/);
    if (!match || match[1].replace(/[：:]\s*$/, '').replace(/\s+/g, '') !== wanted) continue;
    const body = [];
    for (let next = index + 1; next < lines.length && !/^\s*#{1,6}\s+/.test(lines[next]); next += 1) body.push(lines[next]);
    return body.join('\n').trim();
  }
  return '';
}

function escapedRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function runMcpCalls(projectRoot, agentName, calls) {
  const runtime = join(projectRoot, '.live-dot-map', 'livedot.mjs');
  const input = calls.map((request) => `${JSON.stringify(request)}\n`).join('');
  const output = await run(runtime, ['mcp', '--project', projectRoot, '--agent', agentName], { cwd: projectRoot, execPath: process.execPath, input });
  return output.split(/\r?\n/).filter((line) => line.trim().startsWith('{')).map((line) => JSON.parse(line));
}

async function bridgeSession(server) {
  const exchange = await fetch(`${server.origin}/session`, { method: 'POST', headers: { Origin: 'https://real-long-task.test', Authorization: `Bearer ${server.bootstrapToken}` } });
  assert.equal(exchange.status, 201);
  const body = await exchange.json();
  return { cookie: exchange.headers.get('set-cookie').split(';', 1)[0], csrf: body.csrfToken };
}

function bridgeHeaders(session, extra = {}) { return { Origin: 'https://real-long-task.test', Cookie: session.cookie, 'X-CSRF-Token': session.csrf, ...extra }; }

const project = await mkdtemp(join(REAL_TEST_ROOT, `livedot-real-long-${agent}-`));
try {
  await installProject({ projectRoot: project, createDesktopShortcut: false, register: false, offline: true, discoverAgents: agent === 'codebuddy' ? false : true });
  const mapPath = join(project, '.live-dot-map', 'map.json');
  const map = JSON.parse(await readFile(mapPath, 'utf8'));
  const initialRevision = map.revision;
  const now = new Date().toISOString();
  // Fixture the scale threshold instead of asking a real model to manufacture
  // twenty meaningless nodes.  These are ordinary active context nodes; the
  // model still owns the actual failed -> alternative -> success path.
  for (let index = 0; index < 20; index += 1) {
    const id = `fixture-${String(index + 1).padStart(2, '0')}`;
    map.nodes.push({ id, num: String(index + 2).padStart(2, '0'), name: `背景节点${index + 1}`, type: '阶段', route: 'r1', x: (index + 1) * 40, y: 180, md: `.live-dot-map/nodes/${id}.md`, createdAt: now, updatedAt: now, createdBy: 'fixture', updatedBy: 'fixture', updatedRevision: map.revision });
  }
  map.anns = [{ id: 'a-human-long-task', target: { kind: 'canvas' }, text: '长程验收先看人的上下文', source: 'human', priority: 'high', attention: 'new', acknowledgements: [], createdAt: now, updatedAt: now, updatedBy: 'human', updatedRevision: map.revision }];
  await writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  const mcpPath = agent === 'kimi' ? join(project, '.kimi-code', 'mcp.json') : join(project, '.mcp.json');
  const mcp = JSON.parse(await readFile(mcpPath, 'utf8'));
  const server = Object.values(mcp.mcpServers).find((candidate) => candidate.args?.at(-1) === agent) || mcp.mcpServers['livedot-map'];
  assert.ok(server, `${agent} MCP server was not generated`);
  const mcpConfig = join(project, `.mcp-${agent}.json`);
  await writeFile(mcpConfig, `${JSON.stringify({ mcpServers: { 'livedot-map': server } }, null, 2)}\n`);
  const client = clients[agent];
  const args = client.args.map((value) => value.replace('{project}', project).replace('{mcp}', mcpConfig).replace('{prompt}', prompt));
  const output = await run(client.command, args, { cwd: project, execPath: client.execPath });
  const persisted = JSON.parse(await readFile(mapPath, 'utf8'));
  const failed = persisted.edges.find((edge) => edge.id === 'e-failed');
  const alternative = persisted.edges.find((edge) => edge.id === 'e-alternative');
  assert.ok(persisted.revision > initialRevision, `${agent} did not advance revision`);
  assert.equal(persisted.version, 2);
  for (const collection of ['routes', 'nodes', 'edges', 'anns']) assert.ok(Array.isArray(persisted[collection]), `invalid ${collection} structure`);
  assert.equal(persisted.anns[0].attention, 'acknowledged', `${agent} did not ack human context`);
  assert.equal(failed?.status, 'failed', `${agent} did not persist failed attempt`);
  assert.equal(alternative?.status, 'success', `${agent} did not persist alternative success`);
  assert.equal(persisted.routes.find((route) => route.id === 'r1')?.currentNodeId, 'n-success', `${agent} did not persist current node`);
  const failedMarkdownPath = join(project, '.live-dot-map', 'routes', 'e-failed.md');
  const failedMarkdown = await readFile(failedMarkdownPath, 'utf8').catch(() => '');
  const failureReason = markdownSection(failedMarkdown, '失败原因');
  const nextStep = markdownSection(failedMarkdown, '下一步');
  assert.ok(failureReason, `${agent} failed attempt has no actual failure reason`);
  assert.ok(nextStep, `${agent} failed attempt has no next step`);
  assert.match(failedMarkdown, /关键证据/);
  const walText = await readFile(join(project, '.live-dot-map', '.bridge', 'wal.ndjson'), 'utf8');
  const commits = walText.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((record) => record.type === 'commit' && Number.isInteger(record.revision));
  assert.ok(commits.length > 0, `${agent} produced no durable commit records`);
  for (let index = 1; index < commits.length; index += 1) assert.ok(commits[index].revision > commits[index - 1].revision, `${agent} revisions are not strictly increasing`);
  assert.equal(commits.at(-1).revision, persisted.revision, `${agent} map revision does not match latest commit`);
  // Exercise the real bridge/MCP curation path against the same long-task
  // project.  Preview and cancellation are read-only; approval is one human
  // command, followed by recovery from the checkpoint image.
  const bridge = await createBridgeServer({ allowedProjectRoots: [project], allowedOrigins: ['https://real-long-task.test'], shared: await loadSharedAdapter(), pollIntervalMs: 0 });
  try {
    const session = await bridgeSession(bridge);
    const opened = await fetch(`${bridge.origin}/open`, { method: 'POST', headers: bridgeHeaders(session, { 'Content-Type': 'application/json' }), body: JSON.stringify({ projectRoot: project }) });
    assert.equal(opened.status, 200);
    const beforeCurationText = await readFile(mapPath, 'utf8');
    const beforeCuration = JSON.parse(beforeCurationText);
    const planResponse = await fetch(`${bridge.origin}/api/v1/mcp`, { method: 'POST', headers: bridgeHeaders(session, { 'Content-Type': 'application/json' }), body: JSON.stringify({ name: 'map_plan_consolidation', arguments: { maxSuggestions: 12 } }) });
    assert.equal(planResponse.status, 200);
    const planEnvelope = await planResponse.json();
    const plan = planEnvelope.result || planEnvelope;
    assert.ok(plan.counts.activeNodes >= 20, `${agent} consolidation preview did not see 20+ nodes`);
    assert.equal(JSON.parse(await readFile(mapPath, 'utf8')).revision, beforeCuration.revision, `${agent} preview changed revision`);
    assert.equal(await readFile(mapPath, 'utf8'), beforeCurationText, `${agent} preview changed map bytes`);
    const checkpointResponse = await fetch(`${bridge.origin}/snapshot`, { method: 'POST', headers: bridgeHeaders(session) });
    assert.equal(checkpointResponse.status, 201);
    const checkpoint = await checkpointResponse.json();
    const suggestion = Array.isArray(plan.suggestions) ? plan.suggestions.find((item) => Array.isArray(item.commands) && item.commands.length) : null;
    if (suggestion) {
      const applyResponse = await fetch(`${bridge.origin}/commands`, { method: 'POST', headers: bridgeHeaders(session, { 'Content-Type': 'application/json' }), body: JSON.stringify({ projectId: beforeCuration.mapId, baseRevision: beforeCuration.revision, commandId: `curation-${Date.now()}`, sessionId: 'real-long-task', commands: suggestion.commands }) });
      assert.equal(applyResponse.status, 200);
      const applied = await applyResponse.json();
      assert.equal(applied.revision, beforeCuration.revision + 1, `${agent} curation did not advance exactly one revision`);
      const recoveredResponse = await fetch(`${bridge.origin}/recover`, { method: 'POST', headers: bridgeHeaders(session, { 'Content-Type': 'application/json' }), body: JSON.stringify({ source: 'snapshot', name: basename(checkpoint.path) }) });
      assert.equal(recoveredResponse.status, 200);
      const recovered = await recoveredResponse.json();
      assert.equal(recovered.revision, applied.revision + 1, `${agent} checkpoint recovery revision is not monotonic`);
      assert.notEqual(recovered.document.edges.find((edge) => edge.id === suggestion.objectIds?.[0])?.archived, true, `${agent} checkpoint did not restore selected edge`);
    }
    const health = JSON.parse(await readFile(join(project, '.live-dot-map', '.bridge', 'agent-health.json'), 'utf8'));
    assert.equal(health.records.bridge?.status, 'ok', `${agent} bridge MCP health was not persisted`);
  } finally {
    await bridge.close();
  }
  const contextResponses = await runMcpCalls(project, agent, [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'map_get_context', arguments: { query: '' } } }]);
  const contextResult = contextResponses.find((item) => item.id === 1)?.result?.structuredContent;
  const recoveredEvidence = contextResult?.attemptEvidence?.find((item) => item.id === 'e-failed');
  assert.ok(recoveredEvidence?.path, `${agent} context did not expose failed evidence path`);
  assert.ok(recoveredEvidence?.failureReason, `${agent} context did not expose failed reason`);
  const restartPrompt = `这是同一项目的新 Agent 会话恢复验收。只调用 map_get_context，不修改任何文件；首个摘要必须明确引用 e-failed、e-alternative、n-success，并逐字说明 e-failed 失败原因“${failureReason.replace(/\s+/g, ' ').slice(0, 240)}”、当前路线位置和下一步“${nextStep.replace(/\s+/g, ' ').slice(0, 240)}”。不要只说“已读取”，请输出不超过 12 行摘要。`;
  const restartArgs = client.args.map((value) => value.replace('{project}', project).replace('{mcp}', mcpConfig).replace('{prompt}', restartPrompt));
  const restartOutput = await run(client.command, restartArgs, { cwd: project, execPath: client.execPath });
  assert.match(restartOutput, /e-failed/);
  assert.match(restartOutput, /e-alternative/);
  assert.match(restartOutput, /n-success/);
  assert.match(restartOutput, new RegExp(escapedRegex(failureReason.replace(/\s+/g, ' ').slice(0, 80))));
  const finalPersisted = JSON.parse(await readFile(mapPath, 'utf8'));
  console.log(JSON.stringify({ agent, ok: true, revision: finalPersisted.revision, failed: failed.id, alternative: alternative.id, currentNodeId: finalPersisted.routes.find((route) => route.id === 'r1')?.currentNodeId, restartRecovered: true, evidencePath: recoveredEvidence.path, failureReason: failureReason.slice(0, 240), nextStep: nextStep.slice(0, 240), output: restartOutput.slice(-3000) }, null, 2));
} finally {
  if (process.env.LIVEDOT_KEEP_REAL_CLIENT_TMP !== '1') await rm(project, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }).catch(() => undefined);
  else console.error(`[real-long-task-smoke] 保留临时项目：${project}`);
}
