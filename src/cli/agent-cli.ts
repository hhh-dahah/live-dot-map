// Agent 用的命令行入口：livedot look/read/write/note/analyze/manage。
// 只做参数解析和输出格式，所有规则都在桥里（与 MCP 走同一个 dispatcher）。
import { writeFile } from 'node:fs/promises';

type Json = Record<string, unknown>;
export type CallTool = (name: string, args: Json, globals: CliGlobals) => Promise<unknown>;
export type CliGlobals = { project?: string; agent?: string; session?: string; runtimeStateDir?: string; app?: string };

export const AGENT_COMMANDS = new Set(['look', 'read', 'write', 'note', 'analyze', 'manage']);

const INVOKE = 'node "$HOME/.live-dot-map/livedot.mjs"';

const HELP = `livedot：活点地图记忆空间的命令行，给 Agent 用，输出紧凑 JSON。
调用：${INVOKE} <命令> …（下文简写 livedot）

livedot look [关键词] [--node n3]         看目录：id/名称/类型/路径/理由，不含正文
livedot read <路径|节点id> [--force]       读正文；路径取 look 结果的 path 列
livedot write <路径> "<内容>"              追加到文件末尾（文件不存在就新建）
livedot write <路径> - --etag <etag>       从 stdin 读内容整文替换（etag 取自 read）
livedot write --new "<节点名>" [--kind problem] ["<内容>"]   新建节点
livedot write --ack a1,a2                  确认人类标注（look 结果的 human 字段）
livedot note <节点id> "<一句话>"           给节点追加一条带时间的记录
livedot analyze <数据文件> describe|group|top [--by 字段] [--metric 指标]
livedot manage <动作> [...]                低频管理，见 livedot manage --help

look 结果有 human（待确认的人类标注 id）时：livedot read <标注id> 看全文 → 处理 → livedot write --ack <标注id>

例：
  livedot look "抖音 爆款"
  livedot read nodes/n3/index.md
  livedot note n3 "封面换暖色后播放 +40%，依据 nodes/n3/data.csv"
  livedot analyze nodes/n3/data.csv group --by 音乐 --metric 播放

通用参数：--project <目录>  --map <地图key>  --agent <名字>  --out <文件>（完整结果写文件，只打印摘要）
出错：stderr 输出 {"error":{"code","message"}}，退出码 1；按 message 里的用法改正后重试。`;

const COMMAND_HELP: Record<string, string> = {
  look: `livedot look [关键词] [--node <节点id>] [--limit 5] [--all]
返回 {map,name,rev,goal?,human?,cols,items}。items 每行 [id,名称,类型,路径,理由]；human 是待确认的人类标注 id。
--all 含已归档历史。例：livedot look "数据分析"`,
  read: `livedot read <路径|节点id|标注id> [--force]
路径如 nodes/n3/index.md、nodes/n3/方案.md；只写 n3 读主文档并列出资料包文件；以 / 结尾只列文件；a1 这类标注 id 返回标注全文。
同一 --session 内文件没变时只回 {unchanged:true}，--force 强制重读。例：livedot read n3`,
  write: `livedot write <路径> "<内容>"            追加（默认，不会覆盖已有内容）
livedot write <路径> - --etag <etag>     从 stdin 读内容整文替换，etag 取自 read 结果
livedot write --new "<节点名>" [--kind goal|problem] [--near n3] ["<内容>"]
livedot write --ack a1,a2 [--summary "…"]
例：livedot write nodes/n3/index.md "## 结论\\n钢琴配乐组中位播放 41 万"`,
  note: `livedot note <节点id> "<一句话>"
在节点主文档末尾追加一行 "- 10-05 14:30 · 一句话"。例：livedot note n3 "改用暖色封面，待观察"`,
  analyze: `livedot analyze <数据文件> <describe|group|top> [参数]
数据文件：节点资料包里的 .csv / .json（导入用 livedot manage import --path n3 --source <本机文件>）
  describe                                 各字段概况（数值给分位，类别给前 5）
  group --by 字段[,字段2] [--metric 指标] [--agg median|mean|sum|count]
  top --metric 指标 [--ratio 0.2] [--fields a,b]   前 20% 对比其余
每组带样本数 n，n<5 标"样本不足"。例：livedot analyze nodes/n3/data.csv top --metric 播放`,
  manage: `livedot manage <动作> [参数]
  maps                                     列出地图
  create_map --name <名称>                 新建地图（不切换）
  switch_map --map <地图key>               切换当前地图
  rename_map --map <地图key> --name <名称>
  files --path n3                          列资料包文件
  rename_file --path n3/旧.md --to 新.md
  archive --path n3/草稿.md                归档（可恢复）
  restore --path n3/草稿.md
  import --path n3 --source <本机文件路径>  导入附件/数据
  validate | checkpoint | plan | human     校验 / 检查点 / 整理建议 / 待确认人类更新`,
};

const COMMON_FLAGS = new Set(['project', 'map', 'agent', 'session', 'out', 'runtime-state-dir', 'app', 'help']);
const COMMAND_FLAGS: Record<string, string[]> = {
  look: ['node', 'limit', 'all'],
  read: ['force'],
  write: ['etag', 'new', 'kind', 'near', 'ack', 'summary', 'replace-all'],
  note: [],
  analyze: ['by', 'metric', 'agg', 'ratio', 'fields'],
  manage: ['path', 'name', 'to', 'source', 'include-archived'],
};
const BOOLEAN_FLAGS = new Set(['force', 'all', 'help', 'include-archived', 'replace-all']);

class CliError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

function parse(argv: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--') { positional.push(...argv.slice(index + 1)); break; }
    if (value === '-h') { flags.help = true; continue; }
    if (!value.startsWith('--') || value === '-') { positional.push(value); continue; }
    const [key, inline] = value.slice(2).split(/=(.*)/s, 2);
    if (inline !== undefined) flags[key] = inline;
    else if (BOOLEAN_FLAGS.has(key)) flags[key] = true;
    else if (index + 1 < argv.length && !argv[index + 1].startsWith('--')) { flags[key] = argv[index + 1]; index += 1; }
    else flags[key] = true;
  }
  return { positional, flags };
}

function usageError(command: string, message: string): CliError {
  const usage = COMMAND_HELP[command]?.split('\n')[0] ?? 'livedot --help';
  return new CliError('CLI_USAGE', `${message}。正确用法：${usage}（详见 livedot ${command} --help）`);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function unknownFlagError(command: string, flag: string): CliError {
  const own = COMMAND_FLAGS[command] ?? [];
  const candidates = [...own, ...COMMON_FLAGS];
  const guess = candidates.map((name) => [name, editDistance(flag, name)] as const).sort((a, b) => a[1] - b[1])[0];
  const suggestion = guess && guess[1] <= 2 ? `，是不是 --${guess[0]}？` : '';
  const legal = own.length ? `；${command} 可用参数：${own.map((name) => `--${name}`).join(' ')}` : '';
  return new CliError('CLI_USAGE', `未知参数 --${flag}${suggestion}${legal}（详见 livedot ${command} --help）`);
}

// 桥端报错面向 MCP 工具写法；CLI 用户看到的应是对应命令。
const CLI_REWRITES: Array<[RegExp, string]> = [
  [/ 用法：.*$/s, ''],
  [/map_write（不带 baseEtag 即追加）/g, 'livedot write（不带 --etag 即追加）'],
  [/map_write\(\{ack:\[…\]\}\)/g, 'livedot write --ack <id>'],
  [/map_manage\(\{action:"(\w+)"\}\)/g, 'livedot manage $1'],
  [/map_write\(\{commands:\[…\]\}\)/g, 'MCP map_write 的 commands（CLI 不支持）'],
  [/\bmap_look\b/g, 'livedot look'],
  [/\bmap_read\b/g, 'livedot read'],
  [/\bmap_write\b/g, 'livedot write'],
  [/\banalysis_run\b/g, 'livedot analyze'],
  [/\bmap_manage\b/g, 'livedot manage'],
  [/\bbaseEtag\b/g, '--etag'],
];

function cliMessage(command: string, message: string, fromBridge: boolean): string {
  if (!fromBridge) return message;
  let text = message;
  for (const [pattern, replacement] of CLI_REWRITES) text = text.replace(pattern, replacement);
  const usage = COMMAND_HELP[command]?.split('\n')[0];
  return usage && text !== message && / 用法：/.test(message) ? `${text} 正确用法：${usage}` : text;
}

function str(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === 'string' && value ? value : undefined;
}

function list(value: string | undefined): string[] | undefined {
  return value ? value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) : undefined;
}

async function readStdin(): Promise<string> {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

function unescapeInline(text: string): string {
  // Agent 在一行命令里写多行内容时常用字面 \n。
  return text.replace(/\\n/g, '\n');
}

function stamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

async function build(command: string, positional: string[], flags: Record<string, string | boolean>): Promise<{ tool: string; args: Json }> {
  const map = str(flags, 'map');
  const scope: Json = map ? { mapKey: map } : {};
  if (command === 'look') {
    const limit = str(flags, 'limit');
    return {
      tool: 'map_look',
      args: {
        ...scope,
        ...(positional.length ? { query: positional.join(' ') } : {}),
        ...(str(flags, 'node') ? { nodeId: str(flags, 'node') } : {}),
        ...(limit ? { limit: Number(limit) } : {}),
        ...(flags.all === true ? { includeHistory: true } : {}),
      },
    };
  }
  if (command === 'read') {
    if (!positional[0]) throw usageError(command, '缺少 <路径|节点id>');
    return { tool: 'map_read', args: { ...scope, path: positional[0], ...(flags.force === true ? { force: true } : {}) } };
  }
  if (command === 'write') {
    const args: Json = { ...scope };
    const created = str(flags, 'new');
    const ack = list(str(flags, 'ack'));
    let path: string | undefined;
    let content: string | undefined;
    if (created) {
      args.node = { name: created, ...(str(flags, 'kind') ? { kind: str(flags, 'kind') } : {}), ...(str(flags, 'near') ? { near: str(flags, 'near') } : {}) };
      content = positional[0];
    } else if (!ack) {
      [path, content] = positional;
      if (!path) throw usageError(command, '缺少 <路径>');
      if (content === undefined) throw usageError(command, '缺少 "<内容>"（用 - 表示从 stdin 读）');
    }
    if (content === '-') content = await readStdin();
    else if (content !== undefined) content = unescapeInline(content);
    if (path) args.path = path;
    if (content !== undefined) args.content = content;
    if (str(flags, 'etag')) args.baseEtag = str(flags, 'etag');
    if (flags['replace-all'] === true) args.allowContentRemoval = true;
    if (ack) { args.ack = ack; if (str(flags, 'summary')) args.summary = str(flags, 'summary'); }
    return { tool: 'map_write', args };
  }
  if (command === 'note') {
    const [node, ...words] = positional;
    if (!node || !words.length) throw usageError(command, '缺少 <节点id> 或 "<一句话>"');
    const text = unescapeInline(words.join(' ')).trim();
    return { tool: 'map_write', args: { ...scope, path: node.includes('/') ? node : `nodes/${node}/index.md`, content: `- ${stamp()} · ${text}` } };
  }
  if (command === 'analyze') {
    const [path, op, ...extra] = positional;
    if (!path || !op) throw usageError(command, '缺少 <数据文件> 或 <describe|group|top>');
    // PowerShell 会把不加引号的 a,b 拆成两个参数；静默丢掉会让分组少一个字段。
    if (extra.length) throw usageError(command, `多余参数「${extra.join(' ')}」；多个字段要写成 --by "音乐,封面"（加引号）`);
    const params: Json = {};
    const by = list(str(flags, 'by'));
    if (by) params.by = by.length === 1 ? by[0] : by;
    for (const key of ['metric', 'agg'] as const) if (str(flags, key)) params[key] = str(flags, key);
    if (str(flags, 'ratio')) params.ratio = Number(str(flags, 'ratio'));
    if (list(str(flags, 'fields'))) params.fields = list(str(flags, 'fields'));
    return { tool: 'analysis_run', args: { ...scope, path, op, params } };
  }
  // manage
  const [action] = positional;
  if (!action) throw usageError(command, '缺少 <动作>');
  return {
    tool: 'map_manage',
    args: {
      ...scope,
      action,
      ...(str(flags, 'path') ? { path: str(flags, 'path') } : {}),
      ...(str(flags, 'name') ? { name: str(flags, 'name') } : {}),
      ...(str(flags, 'to') ? { to: str(flags, 'to') } : {}),
      ...(str(flags, 'source') ? { sourcePath: str(flags, 'source') } : {}),
      ...(flags['include-archived'] === true ? { includeArchived: true } : {}),
    },
  };
}

function summarize(tool: string, value: unknown): Json {
  const result = (value && typeof value === 'object' ? value : {}) as Json;
  if (typeof result.summary === 'string') return { summary: result.summary, rows: result.rows };
  if (Array.isArray(result.items)) return { items: result.items.length };
  if (typeof result.content === 'string') return { path: result.path, etag: result.etag, bytes: Buffer.byteLength(result.content) };
  return { tool };
}

/**
 * 写入署名要与该 Agent 的 hook 水位同名，否则 hook 会把它自己的写入当成「别人的变化」推回去。
 * Agent 很少记得传 --agent，所以按宿主注入的环境变量猜。
 */
export function detectAgent(env: NodeJS.ProcessEnv): string {
  if (env.LIVEDOT_AGENT) return env.LIVEDOT_AGENT;
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return 'claude';
  if (env.CODEX_THREAD_ID || env.CODEX_SANDBOX || env.CODEX_MANAGED_BY_NPM) return 'codex';
  if (env.CODEBUDDY || env.CODEBUDDY_PROJECT_DIR) return 'codebuddy';
  if (env.FACTORY_ENV || env.FACTORY_API_BASE_URL) return 'droid';
  return 'cli';
}

export function helpText(command?: string): string {
  return command && COMMAND_HELP[command] ? COMMAND_HELP[command] : HELP;
}

/** 返回进程退出码。 */
export async function runAgentCli(argv: string[], callTool: CallTool): Promise<number> {
  const [command = 'help', ...rest] = argv;
  const { positional, flags } = parse(rest);
  if (!AGENT_COMMANDS.has(command)) {
    process.stdout.write(`${HELP}\n`);
    return command === 'help' || command === '--help' || command === '-h' ? 0 : 1;
  }
  if (flags.help === true) {
    process.stdout.write(`${helpText(command)}\n`);
    return 0;
  }
  try {
    const allowed = new Set([...COMMON_FLAGS, ...(COMMAND_FLAGS[command] ?? [])]);
    const unknown = Object.keys(flags).find((key) => !allowed.has(key));
    if (unknown) throw unknownFlagError(command, unknown);
    const globals: CliGlobals = {
      project: str(flags, 'project') ?? process.env.LIVEDOT_PROJECT_ROOT,
      agent: str(flags, 'agent') ?? detectAgent(process.env),
      session: str(flags, 'session') ?? process.env.LIVEDOT_SESSION,
      runtimeStateDir: str(flags, 'runtime-state-dir') ?? process.env.LIVEDOT_RUNTIME_STATE_DIR,
      app: str(flags, 'app'),
    };
    const { tool, args } = await build(command, positional, flags);
    if (globals.session) args.sessionId = globals.session;
    const value = await callTool(tool, args, globals);
    const out = str(flags, 'out');
    if (out) {
      await writeFile(out, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      process.stdout.write(`${JSON.stringify({ ok: true, out, ...summarize(tool, value) })}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(value)}\n`);
    }
    return 0;
  } catch (error) {
    const value = error as { code?: unknown; message?: unknown };
    const code = typeof value?.code === 'string' ? value.code : 'CLI_FAILED';
    const message = cliMessage(command, String(value?.message ?? error), !(error instanceof CliError));
    process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
    return 1;
  }
}
