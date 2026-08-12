#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function asPath(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (value instanceof URL) return fileURLToPath(value);
  return resolve(String(value));
}

function parseArgs(argv) {
  const args = { input: resolve(ROOT, 'app.html'), output: resolve(ROOT, 'dist', 'app.v2.html'), bridgeOrigin: null, nonce: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') args.input = asPath(argv[++index], args.input);
    else if (arg === '--output') args.output = asPath(argv[++index], args.output);
    else if (arg === '--bridge-origin') args.bridgeOrigin = argv[++index];
    else if (arg === '--nonce') args.nonce = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      console.log('用法: node scripts/build-app.mjs [--input app.html] [--output dist/app.v2.html] [--bridge-origin http://127.0.0.1:8787] [--nonce value]');
      process.exit(0);
    } else throw new Error(`未知参数: ${arg}`);
  }
  return args;
}

function transformLegacyPaths(source) {
  // 新建对象的路径只依赖稳定 ID，不随名称编辑改变。
  let output = source
    .replace(/md:`nodes\/\$\{String\(S\.nextNum\)\.padStart\(2,'0'\)\}-\$\{name\}\.md`/g, 'md:`.live-dot-map/nodes/n${S.nextNum}.md`')
    .replace(/md:`routes\/e\$\{S\.nextEdge-1\}-\$\{eName\}\.md`/g, 'md:`.live-dot-map/routes/e${S.nextEdge-1}.md`')
    .replace(/md:\s*'nodes\//g, "md:'.live-dot-map/nodes/")
    .replace(/md:\s*'routes\//g, "md:'.live-dot-map/routes/")
    .replace(/md:\s*`nodes\//g, 'md:`.live-dot-map/nodes/')
    .replace(/md:\s*`routes\//g, 'md:`.live-dot-map/routes/');
  // 旧版行内重命名逻辑曾按名称重写 md；禁止它覆盖已存在的稳定路径。
  output = output
    .replace(/n\.md\s*=\s*`nodes\/\$\{n\.num\}-\$\{v\}\.md`;?/g, '')
    .replace(/e\.md\s*=\s*`routes\/\$\{e\.id\}-\$\{v\}\.md`;?/g, '')
    .replace(/obj\.md\s*=\s*`routes\/\$\{obj\.id\}-\$\{v\}\.md`;/g, 'obj.md = obj.md || `.live-dot-map/routes/${obj.id}.md`;')
    .replace(/obj\.md\s*=\s*`nodes\/\$\{obj\.num\}-\$\{v\}\.md`;/g, 'obj.md = obj.md || `.live-dot-map/nodes/${obj.id}.md`;');
  return output;
}

function transformExternalDataSinks(source) {
  // 菜单字符串最终写入 innerHTML；来自 map.json 的文本必须先转义。
  return source
    .replaceAll('${it.label}', '${esc(it.label)}')
    .replaceAll('${it.head}', '${esc(it.head)}')
    .replaceAll('data-mi="${it.id}"', 'data-mi="${esc(it.id)}"')
    .replace(/const esc = t =>[^\r\n]*/, "const esc = t => String(t).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));");
}

function removeExistingCsp(source) {
  return source
    .replace(/\s*<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '')
    .replace(/\s*<!-- v2 状态：Agent 自动读取和并发保护未启用时降级；本地草稿可恢复 -->/g, '')
    .replace(/\s*<script\b[^>]*data-dotmap-(?:fallback|bridge|runtime)=["']v2["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s*\/\* live-dot-map-v2:integration:start \*\/[\s\S]*?\/\* live-dot-map-v2:integration:end \*\//g, '');
}

function addNonceToInlineScripts(source, nonce) {
  return source.replace(/<script(?![^>]*\bsrc\s*=)([^>]*)>/gi, (full, attributes) => {
    const clean = attributes.replace(/\s+nonce\s*=\s*["'][^"']*["']/gi, '');
    return `<script nonce="${nonce}"${clean}>`;
  });
}

function cspFor(options, nonce) {
  const connect = ["'self'", 'http://localhost:*', 'http://127.0.0.1:*'];
  if (options.bridgeOrigin) {
    try { connect.push(new URL(options.bridgeOrigin).origin); } catch { throw new Error('--bridge-origin 必须是 http(s) URL'); }
  }
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "worker-src 'self'",
  ].join('; ');
}

async function bundle(entryPoint) {
  const result = await esbuild({
    entryPoints: [resolve(ROOT, entryPoint)],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100', 'firefox100', 'safari16'],
    legalComments: 'none',
    sourcemap: false,
    minify: true,
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error(`没有生成 ${entryPoint} bundle`);
  return output;
}

function appIntegration() {
  return `
/* live-dot-map-v2:integration:start */
/* v2 本地桥集成：强模式的保存统一走命令处理器。 */
const __legacyScheduleSave = scheduleSave;
let __bridgeSaveTimer = 0;
scheduleSave = function(){
  if (window.LiveDotBridge?.active){
    clearTimeout(__bridgeSaveTimer);
    __bridgeSaveTimer = setTimeout(() => window.LiveDotBridge.schedule(serialize()), 0);
    return;
  }
  return __legacyScheduleSave();
};
window.LiveDotApp = {
  serialize,
  load(document){
    acceptMapDocument(document, 'bridge');
    // 桥接加载是异步的；如果空白引导先出现，已有项目地图到达后必须自动让位。
    if (Array.isArray(document?.nodes) && document.nodes.length > 0){
      globalThis.document?.querySelector('#first-map-guide')?.classList.remove('on');
    }
    if (document.ui?.collaboration?.status === 'incomplete') queueMicrotask(() => window.LiveDotApp.setStatus('error', document.ui.collaboration.reason || '本次协作未闭环'));
  },
  setStatus(state, detail=''){
    let dot = document.querySelector('#sync-dot');
    if (!dot){ syncBadge(); dot = document.querySelector('#sync-dot'); }
    let label = document.querySelector('#sync-label');
    if (!label){ label = document.createElement('span'); label.id='sync-label'; label.style.cssText='font-size:11px;color:var(--muted);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; document.querySelector('#project-pill').insertBefore(label, document.querySelector('#proj-menu-btn')); }
    const states = {draft:['var(--note-border)','本地草稿'],saving:['var(--note-border)','保存中'],saved:['var(--success)','已保存'],offline:['var(--pending)','离线'],conflict:['var(--danger)','冲突'],error:['var(--danger)','错误'],fallback:['var(--pending)','降级模式']};
    const current = states[state] || states.error; dot.style.background=current[0]; dot.title=detail || current[1]; label.textContent=current[1];
  }
};
/* live-dot-map-v2:integration:end */
`;
}

export async function buildApp(options = {}) {
  const input = asPath(options.input, resolve(ROOT, 'app.html'));
  const output = asPath(options.output, resolve(ROOT, 'app.html'));
  const original = await readFile(input, 'utf8');
  let html = transformExternalDataSinks(transformLegacyPaths(removeExistingCsp(original)));
  html = html.replace(/(<script\b[^>]*?)\s+nonce\s*=\s*["'][^"']*["']/gi, '$1');
  const nonce = options.nonce ?? createHash('sha256').update(html).digest('base64url').slice(0, 24);
  const integration = appIntegration();
  const closingScript = html.indexOf('</script>');
  if (closingScript >= 0) html = `${html.slice(0, closingScript)}${integration}\n${html.slice(closingScript)}`;
  const csp = cspFor(options, nonce);
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  const modeMarker = '<!-- v2 状态：Agent 自动读取和并发保护未启用时降级；本地草稿可恢复 -->';
  const headMarker = /<meta\s+charset=[^>]*>/i;
  html = headMarker.test(html)
    ? html.replace(headMarker, (match) => `${match}\n${cspMeta}\n${modeMarker}`)
    : html.replace(/<head[^>]*>/i, (match) => `${match}\n${cspMeta}`);
  const fallback = (await bundle('src/web/fallback-document.mjs')).replace(/<\/script/gi, '<\\/script');
  const fallbackScript = `<script nonce="${nonce}" data-dotmap-fallback="v2">${fallback}</script>`;
  html = html.replace(/<script\b/i, `${fallbackScript}\n<script`);
  const bridge = (await bundle('src/web/bridge-client.ts')).replace(/<\/script/gi, '<\\/script');
  const runtime = (await bundle('src/web/runtime.mjs')).replace(/<\/script/gi, '<\\/script');
  const scripts = `<script nonce="${nonce}" data-dotmap-bridge="v2">${bridge}</script>\n<script nonce="${nonce}" data-dotmap-runtime="v2">${runtime}</script>`;
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${scripts}\n</body>`) : `${html}\n${scripts}`;
  html = addNonceToInlineScripts(html, nonce);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html, 'utf8');
  return { input, output, bytes: Buffer.byteLength(html), nonce, csp };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildApp(parseArgs(process.argv.slice(2)));
    console.log(`已生成 ${result.output} (${result.bytes} bytes)`);
  } catch (error) {
    console.error(`构建失败: ${error.message}`);
    process.exitCode = 1;
  }
}
