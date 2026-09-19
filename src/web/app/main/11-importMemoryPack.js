async function importMemoryPack(file){
  const bridge = window.LiveDotBridge, packApi = window.LiveDotMemoryPack;
  if (!packApi){ toast('记忆包组件未加载，请刷新页面重试。'); return; }
  if (!bridge?.active){ toast('导入记忆包需要本地桥连接。'); return; }
  let parsed;
  try{ parsed = await packApi.parseMemoryPack(new Uint8Array(await file.arrayBuffer())); }
  catch(e){ bridge.logError?.('pack.import.parse.failed', e); toast('导入失败：' + (e?.message || '不是有效的记忆包')); return; }
  let prepared;
  try{ prepared = window.LiveDotFallback.prepareFallbackDocument(parsed.document); }
  catch(e){ bridge.logError?.('pack.import.document.failed', e); toast('导入失败：' + (e?.message || '记忆包地图数据无效')); return; }
  if (prepared.readOnly){ toast('记忆包由更新版本导出，当前版本无法导入。'); return; }
  const doc = prepared.document;
  // 旧图的 md 指向旧 mapKey 目录，带过去会串图：剥掉后由序列化层按新图目录回填；名称加「（导入）」避免与原图重名。
  for (const item of [...(doc.nodes || []), ...(doc.edges || [])]) delete item.md;
  doc.name = String(doc.name || '未命名地图').replace(/（导入）$/, '') + '（导入）';
  const mapName = packSafeName(doc.name || String(file.name || '').replace(/\.zip$/i, ''));
  toast('正在导入记忆包…');
  try{
    await bridge.createMap(`${mapName} (导入)`); // 建成独立新图并切换，绝不触碰现有地图
    acceptMapDocument(doc, 'bridge');           // 复用既有校验/装载链
    // acceptMapDocument 会用旧图 mapDir 覆盖画布目录；必须立刻切到新图目录，
    // 否则 serialize 包装层(canonicalizeMarkdownFields)会把缺失的 md 回填成指向旧图的串图路径。
    currentMapDir = `.live-dot-map/maps/${bridge.mapKey}`;
    IO.sourceDocument.mapDir = currentMapDir; // compose 序列化层以 sourceDocument.mapDir 为准回填 md，不改会串图
    // 直接同步调度到桥：集成层包装的 scheduleSave 是 setTimeout(0) 异步触发，
    // 紧跟着 flushPending 会因 pending 尚未建立而提前返回，资料包写入会跑到建图命令前面。
    bridge.schedule(serialize());
    try{ await bridge.flushPending(); }
      catch(e){
        bridge.logError?.('pack.import.flush.failed', e);
        toast(`导入中止：${e?.message || '地图内容未能保存到本地桥'}，未写入资料包文件。`);
        return;
      }
    // 资料包文件落盘：md 走 bundles API，附件走 assets/import（服务端仍做类型/魔数校验）
    const decoder = new TextDecoder();
    const skipped = [];
    for (const f of parsed.files){
      const segs = f.path.split('/');
      const ownerKind = segs[0] === 'routes' ? 'route' : 'node';
      const ownerId = segs[1];
      const fileName = segs.slice(2).join('/');
      if (!ownerId || !fileName) continue;
      try{
        if (/\.md$/i.test(fileName)){
          const content = decoder.decode(f.data);
          if (fileName === 'index.md'){
            // 节点 index.md 由桥端 ensureIndex 预建，create API 会拒绝（BUNDLE_INDEX_CREATE_USE_ENSURE），
            // 只能 read→replace；读不到说明建图命令尚未完全落盘，短退避重试，再试 create 兜底（路线不预建）。
            let lastIdxErr = null;
            for (let attempt = 0; attempt < 4; attempt++){
              try{
                const current = await bridge.readBundleMarkdown(ownerKind, ownerId, 'index.md');
                await bridge.replaceBundleMarkdown(ownerKind, ownerId, 'index.md', content, String(current.etag || ''));
                lastIdxErr = null;
                break;
              }catch(readErr){
                lastIdxErr = readErr;
                if (Number(readErr?.status) !== 404) throw readErr;
                try{ await bridge.createBundleMarkdown(ownerKind, ownerId, 'index.md', content); lastIdxErr = null; break; }
                catch(createErr){
                  lastIdxErr = createErr;
                  if (![404, 409].includes(Number(createErr?.status))) throw createErr;
                  await new Promise(r => setTimeout(r, 400));
                }
              }
            }
            if (lastIdxErr) throw lastIdxErr;
          } else {
            await bridge.createBundleMarkdown(ownerKind, ownerId, fileName, content);
          }
        } else {
          // 裸字节缺少 MIME 会被服务端 415 拒绝；按扩展名补声明，服务端仍做魔数校验
          await bridge.importAsset(ownerKind, ownerId, new Blob([f.data], { type: packMimeOf(fileName) }), fileName);
        }
      }catch(e){ skipped.push(fileName); bridge.logError?.('pack.import.file.failed', e, { path: f.path }); }
    }
    toast(skipped.length ? `已导入为新地图（${skipped.length} 个文件被跳过）` : '已导入为新地图');
  }catch(e){ bridge.logError?.('pack.import.failed', e); toast('导入记忆包失败，请重试。'); }
}
function importMapAny(){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.zip,.json,application/zip,application/json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    if (/\.zip$/i.test(f.name)) return void importMemoryPack(f);
    try{
      const d = JSON.parse(await f.text());
      const prepared = acceptMapDocument(d);
      toast(prepared.readOnly ? '已导入，但这个文件版本太新，只能看不能改' : (prepared.migrated ? '已导入旧版地图，已自动升级' : '已导入'));
    }catch(e){ window.LiveDotBridge?.logError?.('import.failed', e); toast('导入失败：文件不是有效的地图 JSON。'); }
  };
  inp.click();
}
/* ---- 拖拽导入:把 map.json / 记忆包 .zip 拖进画布即加载(对齐 ComfyUI 拖 workflow 的体验) ---- */
function setupDrop(){
  const vp = $('#viewport');
  let depth = 0;  // dragenter/dragleave 在子元素间会成对触发,用计数防高亮闪烁
  vp.addEventListener('dragenter', e => { e.preventDefault(); depth++; vp.classList.add('drop-hint'); });
  vp.addEventListener('dragover', e => { e.preventDefault(); });
  vp.addEventListener('dragleave', e => { e.preventDefault(); if (--depth <= 0){ depth = 0; vp.classList.remove('drop-hint'); } });
  vp.addEventListener('drop', async e => {
    e.preventDefault(); depth = 0; vp.classList.remove('drop-hint');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (/\.zip$/i.test(f.name)) return void importMemoryPack(f);
    if (!/\.json$/i.test(f.name)){ toast('请拖入 .zip 记忆包或 .json 地图文件。'); return; }
    try{
      const d = JSON.parse(await f.text());
      const prepared = acceptMapDocument(d);
      toast(prepared.readOnly ? `已只读导入 ${f.name}（文件版本太新，不能改）` : `已导入:${f.name}${prepared.migrated ? '（旧版已自动升级）' : ''}`);
    }catch(err){ window.LiveDotBridge?.logError?.('import.failed', err); toast('导入失败：文件不是有效的地图 JSON。'); }
  });
}
setupDrop();
/* ---- Markdown 查看/创建(直连文件夹时) ---- */
async function openMd(o){
  if (!o.md){ toast('暂无关联 Markdown'); return; }
  // 强协作模式统一通过本地桥读写，不依赖浏览器文件夹授权。
  if (window.LiveDotBridge?.active && typeof window.LiveDotBridge.readMarkdown === 'function'){
    try{
      const result = await window.LiveDotBridge.readMarkdown(o.md, { create:true, title:o.name || '节点详情' });
      const isNode = S.nodes.some(item => item.id === o.id);
      const ownerKind = isNode ? 'node' : 'route';
      let files = [];
      try { files = await window.LiveDotBridge.listBundleFiles(ownerKind, String(o.id), true); } catch (error) {
        // 资料包清单失败不阻断 index.md 编辑；编辑器会保留当前内容并给出轻提示。
        window.LiveDotBridge.logError?.('bundle.list.failed', error, { ownerKind, ownerId: o.id });
        toast('资料包清单暂不可用，主文档仍可编辑。');
      }
      showMdEditor(o, String(result.path || o.md), String(result.content || ''), String(result.etag || ''), async (value, etag) => {
        return window.LiveDotBridge.writeMarkdown(o.md, value, etag || undefined);
      }, { bridge: window.LiveDotBridge, ownerKind, ownerId: String(o.id), files });
    }catch(e){
      window.LiveDotBridge?.logError?.('markdown.open.failed', e);
      // 断线/未连接是独立故障：明确提示重连，而不是笼统的“打开失败”。
      const disconnected = !window.LiveDotBridge?.active || /未连接|桥未连接|断线/i.test(String(e?.message || ''));
      if (disconnected){ window.LiveDotApp?.setStatus?.('offline', '未连接'); toast('本地桥未连接：请连接/重连后再打开文档。'); }
      else toast('Markdown 打开失败，请稍后重试。');
    }
    return;
  }
  if (window.LiveDotBridge && !window.LiveDotBridge.active){
    // 桥未连接时不掉进直连文件夹的旧逻辑（那会误报“项目未保存”）。
    window.LiveDotApp?.setStatus?.('offline', '未连接');
    toast('本地桥未连接：请连接/重连后再打开文档。');
    return;
  }
  if (!IO.dir){ toast('当前项目未保存此详情：' + o.md); return; }
  const parts = o.md.split('/');
  try{
    let dir = IO.dir;
    for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
    const fh = await dir.getFileHandle(parts[parts.length - 1]);
    showMdEditor(o, o.md, await (await fh.getFile()).text(), '', async value => {
      const w = await fh.createWritable(); await w.write(value); await w.close(); return { etag:'' };
    });
  }catch{
    if (IO.readOnly){ warnReadOnly(); return; }
    if (!confirm(`还没有 ${o.md}，要创建吗？`)) return;
    try{
      let dir = IO.dir;
      for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i], { create:true });
      const fh = await dir.getFileHandle(parts[parts.length - 1], { create:true });
      const w = await fh.createWritable();
      const initial = `# ${o.name || ''}\n\n`;
      await w.write(initial); await w.close();
      showMdEditor(o, o.md, initial, '', async value => {
        const writer = await fh.createWritable(); await writer.write(value); await writer.close(); return { etag:'' };
      });
    }catch(e){ window.LiveDotBridge?.logError?.('markdown.create.failed', e); toast('创建失败，请重试。'); }
  }
}
/* 面板级确认框(未保存守卫):复用 ld-dialog 视觉,返回 Promise<boolean> */
function confirmDialog({ title, body, confirmLabel = '确定', cancelLabel = '取消', danger = false }){
  return new Promise(resolve => {
    const ov = document.createElement('div'); ov.className = 'ld-dialog-ov';
    const card = document.createElement('div'); card.className = 'ld-dialog';
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', title);
    const h = document.createElement('div'); h.className = 'ld-dialog-title'; h.textContent = title;
    const p = document.createElement('div'); p.className = 'ld-dialog-body'; p.textContent = body;
    const actions = document.createElement('div'); actions.className = 'ld-dialog-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'mdv-btn'; cancel.textContent = cancelLabel;
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = `ld-dialog-primary${danger ? ' danger' : ''}`; ok.textContent = confirmLabel;
    const done = v => { ov.remove(); resolve(v); };
    cancel.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    ov.addEventListener('pointerdown', e => { if (e.target === ov) done(false); });
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') done(false); });
    actions.append(cancel, ok); card.append(h, p, actions); ov.appendChild(card);
    document.body.appendChild(ov); ok.focus();
  });
}
/* ---------- 人写高亮:<mark> 解析/生成 + 会话 diff(决策 8) ---------- */
/* 文本模型:文件里的 <mark>…</mark> = 人写/人标记(跨会话留痕);编辑中实时 diff 段 = 本次未保存的人写改动。 */
function mdParseMarks(raw){
  // 返回 logical(去标签文本)、spans(逻辑坐标的标记区间)、tagRanges(原文里标签字符区间,供镜像层淡化)
  let logical = ''; const spans = []; const tagRanges = []; let depth = 0; let start = -1; let i = 0;
  while (i < raw.length){
    if (raw.startsWith('<mark>', i)){ tagRanges.push([i, i + 6]); if (depth++ === 0) start = logical.length; i += 6; continue; }
    if (raw.startsWith('</mark>', i)){ tagRanges.push([i, i + 7]); i += 7; if (depth > 0 && --depth === 0 && start >= 0){ spans.push([start, logical.length]); start = -1; } continue; }
    logical += raw[i++];
  }
  if (depth > 0 && start >= 0) spans.push([start, logical.length]); // 未闭合容错:标到文末
  return { logical, spans, tagRanges };
}
function mdMergeSpans(spans){
  const sorted = spans.filter(s => s[1] > s[0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const s of sorted){ const last = out[out.length - 1]; if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else out.push([s[0], s[1]]); }
  return out;
}
function mdSubtractSpans(spans, s, e){
  const out = [];
  for (const [a, b] of spans){
    if (b <= s || a >= e){ out.push([a, b]); continue; }
    if (a < s) out.push([a, s]);
    if (b > e) out.push([e, b]);
  }
  return out;
}
function mdEmitMarks(logical, spans){
  const merged = mdMergeSpans(spans);
  if (!merged.length) return logical;
  let out = '', pos = 0;
  for (const [s, e] of merged){ out += logical.slice(pos, s) + '<mark>' + logical.slice(s, e) + '</mark>'; pos = e; }
  return out + logical.slice(pos);
}
function mdDiffSpan(base, cur){
  // 最长公共前后缀之外的中段,返回 cur(逻辑文本)里的区间
  let s = 0; const minLen = Math.min(base.length, cur.length);
  while (s < minLen && base[s] === cur[s]) s++;
  let ea = base.length, eb = cur.length;
  while (ea > s && eb > s && base[ea - 1] === cur[eb - 1]){ ea--; eb--; }
  return [s, eb];
}
function mdRawIndexForLogical(raw, li){
  // 逻辑坐标 → 含标签原文坐标(光标映射用)
  let l = 0, i = 0;
  while (i < raw.length && l < li){
    if (raw.startsWith('<mark>', i)){ i += 6; continue; }
    if (raw.startsWith('</mark>', i)){ i += 7; continue; }
    i++; l++;
  }
  return i;
}
function showMdEditor(object, path, text, initialEtag, save, bundleOptions = null){
  // 编辑器不再是全局遮罩卡片,而是右侧 dock 的扩宽模式:内容挂进 #panel
  const panel = $('#panel');
  mdSession?.discard?.(); // 兜底:同一时刻只允许一个编辑器会话
  const root = document.createElement('div'); root.className = 'mdv-root';
  const header = document.createElement('header'); header.className = 'mdv-head';
  const back = document.createElement('button'); back.className = 'mdv-back-btn'; back.type = 'button'; back.title = '返回节点详情'; back.setAttribute('aria-label', '返回节点详情');
  back.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="m10 3.5-4.5 4.5L10 12.5"/></svg><span>详情</span>`;
  const title = document.createElement('span'); title.className = 'mdv-title'; title.textContent = path.split('/').pop(); title.title = path;
  const seg = document.createElement('div'); seg.className = 'mdv-seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', '编辑或预览');
  const segEdit = document.createElement('button'); segEdit.type = 'button'; segEdit.textContent = '编辑'; segEdit.className = 'on';
  const segPrev = document.createElement('button'); segPrev.type = 'button'; segPrev.textContent = '预览';
  seg.append(segEdit, segPrev);
  const openWrap = document.createElement('div'); openWrap.className = 'mdv-openwrap'; openWrap.hidden = true;
  const splitBtn = document.createElement('div'); splitBtn.className = 'mdv-split-btn';
  const openAction = document.createElement('button'); openAction.type = 'button'; openAction.className = 'mdv-btn-action'; openAction.title = '打开文档';
  openAction.innerHTML = `${I.ext}<span>打开方式</span>`;
  const openCaret = document.createElement('button'); openCaret.type = 'button'; openCaret.className = 'mdv-btn-caret'; openCaret.setAttribute('aria-haspopup', 'menu'); openCaret.title = '更多打开方式与选项';
  openCaret.innerHTML = `<svg class="chev" viewBox="0 0 12 12"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  splitBtn.append(openAction, openCaret);
  const menu = document.createElement('div'); menu.className = 'mdv-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
  openWrap.append(splitBtn, menu);
  const bundleToggle = document.createElement('button'); bundleToggle.className = 'mdv-bundle-toggle'; bundleToggle.type = 'button'; bundleToggle.title = '展开/折叠资料包列表';
  bundleToggle.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h9A1.5 1.5 0 0 1 14 4.5v7A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z"/><path d="M6 3v10"/></svg><span>资料包</span>`;
  if (!bundleOptions?.bridge) bundleToggle.hidden = true;
  const close = document.createElement('button'); close.className = 'mdv-close'; close.type = 'button'; close.title = '关闭侧栏'; close.setAttribute('aria-label', '关闭侧栏'); close.innerHTML = I.x;
  header.append(back, title, seg, openWrap, bundleToggle, close);
  const bundle = bundleOptions?.bridge && bundleOptions.ownerKind && bundleOptions.ownerId ? bundleOptions : null;
  const body = document.createElement('div'); body.className = 'mdv-body';
  const editWrap = document.createElement('div'); editWrap.className = 'mdv-editwrap';
  const gutter = document.createElement('div'); gutter.className = 'mdv-gutter'; gutter.setAttribute('aria-hidden', 'true');
  const gutterIn = document.createElement('div'); gutter.appendChild(gutterIn);
  const stack = document.createElement('div'); stack.className = 'mdv-editstack';
  const mirror = document.createElement('div'); mirror.className = 'mdv-mirror'; mirror.setAttribute('aria-hidden', 'true');
  const editor = document.createElement('textarea'); editor.className = 'mdv-edit'; editor.value = text; editor.setAttribute('aria-label', `${object?.name || '节点'} Markdown 详情`);
  editor.setAttribute('wrap', 'soft'); editor.spellcheck = false;
  stack.append(mirror, editor); editWrap.append(gutter, stack);
  const preview = document.createElement('div'); preview.className = 'mdv-preview'; preview.hidden = true;
  const side = document.createElement('aside'); side.className = 'mdv-side';
  const sideHead = document.createElement('div'); sideHead.className = 'mdv-sidehead';
  const sideTitle = document.createElement('span'); sideTitle.textContent = '资料包';
  const newFile = document.createElement('button'); newFile.className = 'mdv-add'; newFile.type = 'button'; newFile.textContent = '+'; newFile.title = '新建补充 Markdown'; newFile.setAttribute('aria-label', '新建补充 Markdown');
  sideHead.append(sideTitle, newFile); side.appendChild(sideHead);
  const fileList = document.createElement('div'); fileList.className = 'mdv-files'; side.appendChild(fileList);
  const resizer = document.createElement('div'); resizer.className = 'mdv-resizer'; resizer.title = '拖拽调整资料包宽度，双击折叠/展开';
  body.append(editWrap, preview, resizer, side);
  const footer = document.createElement('footer'); footer.className = 'mdv-foot';
  const status = document.createElement('span'); status.className = 'mdv-status'; status.textContent = '已打开';
  const footActions = document.createElement('div'); footActions.className = 'mdv-foot-actions';
  /* 底部右侧「标记」高级感微面板 */
  const paletteWrap = document.createElement('div'); paletteWrap.className = 'mdv-palette-wrap';
  paletteWrap.addEventListener('pointerdown', ev => ev.preventDefault()); // 锁死焦点在编辑区，防 blur 丢原生撤销栈
  const paletteBtn = document.createElement('button'); paletteBtn.type = 'button'; paletteBtn.className = 'mdv-btn-palette'; paletteBtn.title = '内容标记（点击展开面板）';
  paletteBtn.innerHTML = `<span class="mark-icon">✦</span><span>标记</span><svg class="chev" viewBox="0 0 12 12"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  const palettePop = document.createElement('div'); palettePop.className = 'mdv-palette-pop'; palettePop.hidden = true;
  palettePop.innerHTML = `
    <div class="mdv-palette-head"><span class="scope-dot"></span><span class="scope-txt">段落模式：当前光标段落</span></div>
    <div class="psep"></div>
    <button type="button" data-palette="agent"><span class="pdot agent">✦</span><span>标为 Agent 块</span></button>
    <button type="button" data-palette="important"><span class="pdot important">⭐</span><span>设为重点（高权重）</span></button>
    <div class="psep"></div>
    <button type="button" data-palette="clear"><span class="pdot clear">✕</span><span>清除标记</span></button>
  `;
  paletteWrap.append(paletteBtn, palettePop);

  const togglePalette = show => {
    const next = typeof show === 'boolean' ? show : palettePop.hidden;
    palettePop.hidden = !next;
    paletteBtn.classList.toggle('on', next);
    if (next){
      const headTxt = palettePop.querySelector('.scope-txt');
      if (headTxt){
        const s = editor.selectionStart, e = editor.selectionEnd;
        if (s !== e){
          headTxt.textContent = `选区模式：作用于选中的 ${Math.abs(e - s)} 字`;
        } else {
          headTxt.textContent = '段落模式：作用于当前光标段落';
        }
      }
    }
  };
  paletteBtn.onclick = e => { e.stopPropagation(); togglePalette(); };
  root.addEventListener('pointerdown', e => {
    if (!paletteWrap.contains(e.target)) togglePalette(false);
  });

  const getMarkRangeAt = (val, pos) => {
    const before = val.slice(0, pos);
    const lastOpen = before.lastIndexOf('<mark>');
    if (lastOpen === -1) return null;
    const lastClose = before.lastIndexOf('</mark>');
    if (lastClose > lastOpen) return null;
    const after = val.slice(pos);
    const nextClose = after.indexOf('</mark>');
    if (nextClose === -1) return null;
    const end = pos + nextClose + 7;
    return { start: lastOpen, end, innerText: val.slice(lastOpen + 6, pos + nextClose) };
  };

  const getWordRangeAt = (val, pos) => {
    if (!val || val.length === 0) return null;
    let s = pos, e = pos;
    while (s > 0 && !/[\s\n\r,，。！？；：、"'`()[\]{}]/.test(val[s - 1])) s--;
    while (e < val.length && !/[\s\n\r,，。！？；：、"'`()[\]{}]/.test(val[e])) e++;
    return { start: s, end: e, text: val.slice(s, e) };
  };

  const getAgentBlockRangeAt = (val, pos) => {
    const before = val.slice(0, pos);
    const startMatches = [...before.matchAll(/<!--\s*@author:\s*agent[^\s>]*\s*-->/gi)];
    if (startMatches.length === 0) return null;
    const lastStart = startMatches[startMatches.length - 1];
    const startIdx = lastStart.index;
    const between = before.slice(startIdx);
    if (/<!--\s*\/@author\s*-->/i.test(between)) return null;
    const after = val.slice(pos);
    const endMatch = after.match(/<!--\s*\/@author\s*-->/i);
    let endIdx = endMatch ? pos + endMatch.index + endMatch[0].length : val.length;
    if (endIdx < val.length && val[endIdx] === '\n') endIdx++;
    return { start: startIdx, end: endIdx };
  };

  const getParaRangeAt = (val, pos) => {
    let start = pos === 0 ? 0 : val.lastIndexOf('\n', pos - 1) + 1;
    while (start > 0){
      const prevNl = val.lastIndexOf('\n', start - 2);
      const line = val.slice(prevNl === -1 ? 0 : prevNl + 1, start - 1);
      if (line.trim() === '' || /^<!--\s*@author:/i.test(line) || /^<!--\s*\/@author/i.test(line) || /^#{1,6}\s/.test(line)) break;
      start = prevNl === -1 ? 0 : prevNl + 1;
    }
    let end = val.indexOf('\n', pos);
    if (end === -1) end = val.length;
    while (end < val.length){
      const nextNlPos = val.indexOf('\n', end + 1);
      const line = val.slice(end + 1, nextNlPos === -1 ? val.length : nextNlPos);
      if (line.trim() === '' || /^<!--\s*@author:/i.test(line) || /^<!--\s*\/@author/i.test(line) || /^#{1,6}\s/.test(line)) break;
      end = nextNlPos === -1 ? val.length : nextNlPos;
    }
    if (end < val.length && val[end] === '\n') end++;
    return { start, end };
  };

  const applyAuthorTag = type => {
    editor.focus();
    const s = editor.selectionStart, e = editor.selectionEnd;
    const val = editor.value;

    if (type === 'important'){
      if (s !== e){
        const sel = val.slice(s, e);
        let replacement = '';
        if (/^<mark>.*<\/mark>$/s.test(sel.trim())){
          replacement = sel.replace(/^(\s*)<mark>/i, '$1').replace(/<\/mark>(\s*)$/i, '$1');
          toast('已取消重点标记');
        } else {
          const clean = sel.replace(/<\/?mark>/gi, '');
          replacement = `<mark>${clean}</mark>`;
          toast('已设为重点（高权重）');
        }
        editor.setSelectionRange(s, e);
        let ok = false;
        try { ok = document.execCommand('insertText', false, replacement); } catch (_) {}
        if (!ok){ editor.value = val.slice(0, s) + replacement + val.slice(e); }
        editor.dispatchEvent(new Event('input'));
        editor.focus();
        return;
      } else {
        const markInfo = getMarkRangeAt(val, s);
        if (markInfo){
          editor.setSelectionRange(markInfo.start, markInfo.end);
          let ok = false;
          try { ok = document.execCommand('insertText', false, markInfo.innerText); } catch (_) {}
          if (!ok){ editor.value = val.slice(0, markInfo.start) + markInfo.innerText + val.slice(markInfo.end); }
          toast('已取消重点标记');
        } else {
          const word = getWordRangeAt(val, s);
          if (word && word.text.trim().length > 0){
            const rep = `<mark>${word.text}</mark>`;
            editor.setSelectionRange(word.start, word.end);
            let ok = false;
            try { ok = document.execCommand('insertText', false, rep); } catch (_) {}
            if (!ok){ editor.value = val.slice(0, word.start) + rep + val.slice(word.end); }
            toast('已设为重点（高权重）');
          } else {
            const rep = `<mark></mark>`;
            try { document.execCommand('insertText', false, rep); } catch (_) {}
            editor.setSelectionRange(s + 6, s + 6);
            toast('已插入重点标记');
          }
        }
        editor.dispatchEvent(new Event('input'));
        editor.focus();
        return;
      }
    }

    if (type === 'agent'){
      if (s !== e){
        const lineStart = s === 0 ? 0 : val.lastIndexOf('\n', s - 1) + 1;
        let lineEnd = e >= val.length ? val.length : (val[e - 1] === '\n' ? e : val.indexOf('\n', e));
        if (lineEnd === -1) lineEnd = val.length;
        else if (lineEnd < val.length && val[lineEnd] === '\n') lineEnd++;

        const chunk = val.slice(lineStart, lineEnd);
        let clean = chunk.replace(/<!--\s*@author:[^\n]*-->\n?/gi, '').replace(/<!--\s*\/@author\s*-->\n?/gi, '').trimEnd();
        const replacement = `<!-- @author: agent:antigravity -->\n${clean}\n<!-- /@author -->\n`;

        editor.setSelectionRange(lineStart, lineEnd);
        let ok = false;
        try { ok = document.execCommand('insertText', false, replacement); } catch (_) {}
        if (!ok){ editor.value = val.slice(0, lineStart) + replacement + val.slice(lineEnd); }
        toast('已标记为 Agent 块');
        editor.dispatchEvent(new Event('input'));
        editor.focus();
        return;
      } else {
        const para = getParaRangeAt(val, s);
        const chunk = val.slice(para.start, para.end);
        let clean = chunk.replace(/<!--\s*@author:[^\n]*-->\n?/gi, '').replace(/<!--\s*\/@author\s*-->\n?/gi, '').trimEnd();
        const replacement = `<!-- @author: agent:antigravity -->\n${clean}\n<!-- /@author -->\n`;

        editor.setSelectionRange(para.start, para.end);
        let ok = false;
        try { ok = document.execCommand('insertText', false, replacement); } catch (_) {}
        if (!ok){ editor.value = val.slice(0, para.start) + replacement + val.slice(para.end); }
        toast('已将当前段标记为 Agent 块');
        editor.dispatchEvent(new Event('input'));
        editor.focus();
        return;
      }
    }

    if (type === 'clear'){
      if (s !== e){
        const sel = val.slice(s, e);
        let clean = sel.replace(/<\/?mark>/gi, '')
          .replace(/<!--\s*@author:[^\n]*-->\n?/gi, '')
          .replace(/<!--\s*\/@author\s*-->\n?/gi, '');
        editor.setSelectionRange(s, e);
        let ok = false;
        try { ok = document.execCommand('insertText', false, clean); } catch (_) {}
        if (!ok){ editor.value = val.slice(0, s) + clean + val.slice(e); }
        toast('已清除选区标记');
        editor.dispatchEvent(new Event('input'));
        editor.focus();
        return;
      } else {
        const markInfo = getMarkRangeAt(val, s);
        if (markInfo){
          editor.setSelectionRange(markInfo.start, markInfo.end);
          let ok = false;
          try { ok = document.execCommand('insertText', false, markInfo.innerText); } catch (_) {}
          if (!ok){ editor.value = val.slice(0, markInfo.start) + markInfo.innerText + val.slice(markInfo.end); }
          toast('已清除重点标记');
          editor.dispatchEvent(new Event('input'));
          editor.focus();
          return;
        }
        const agentBlock = getAgentBlockRangeAt(val, s);
        if (agentBlock){
          const blockText = val.slice(agentBlock.start, agentBlock.end);
          let clean = blockText.replace(/<!--\s*@author:[^\n]*-->\n?/gi, '')
            .replace(/<!--\s*\/@author\s*-->\n?/gi, '');
          editor.setSelectionRange(agentBlock.start, agentBlock.end);
          let ok = false;
          try { ok = document.execCommand('insertText', false, clean); } catch (_) {}
          if (!ok){ editor.value = val.slice(0, agentBlock.start) + clean + val.slice(agentBlock.end); }
          toast('已清除 Agent 块标记');
          editor.dispatchEvent(new Event('input'));
          editor.focus();
          return;
        }
        const curLineStart = s === 0 ? 0 : val.lastIndexOf('\n', s - 1) + 1;
        const nextNl = val.indexOf('\n', s);
        const curLineEnd = nextNl === -1 ? val.length : nextNl + 1;
        const curLine = val.slice(curLineStart, curLineEnd);
        if (/^<!--\s*@author:|^<!--\s*\/@author/i.test(curLine.trim())){
          editor.setSelectionRange(curLineStart, curLineEnd);
          let ok = false;
          try { ok = document.execCommand('insertText', false, ''); } catch (_) {}
          if (!ok){ editor.value = val.slice(0, curLineStart) + val.slice(curLineEnd); }
          toast('已清除标记行');
          editor.dispatchEvent(new Event('input'));
          editor.focus();
          return;
        }
        toast('当前位置无标记可清除');
      }
    }
  };

  palettePop.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    togglePalette(false);
    applyAuthorTag(b.dataset.palette);
  });

  const saveBtn = document.createElement('button'); saveBtn.type = 'button'; saveBtn.className = 'mdv-btn-save'; saveBtn.textContent = '保存'; saveBtn.title = '快捷键 Ctrl+S';
  const footHint = document.createElement('span'); footHint.className = 'mdv-foot-hint'; footHint.textContent = 'Esc 收起 · Ctrl+S 保存';
  footActions.append(paletteWrap, saveBtn, footHint);
  footer.append(status, footActions); root.append(header, body, footer);
  let files = Array.isArray(bundle?.files) ? bundle.files : [];
  let currentName = String(path).split(/[\\/]/).pop() || 'index.md';
  let etag = initialEtag || ''; let savedText = text; let saving = false;

  /* 资料包无级自由拉伸 + 磁吸贴边收起 */
  let sideWidth = Number(dockStore.get('mdv-side-w', 220)) || 220;
  // 资料包默认展开；仅当在超窄移动端视口(<480px)且用户主动记录折叠时才折叠
  let isSideCollapsed = window.innerWidth < 480 && dockStore.get('mdv-side-collapsed', '0') === '1';
  const applySideWidth = (w, collapsed) => {
    if (collapsed || w <= 0){
      side.style.setProperty('--side-w', '0px');
      side.classList.add('collapsed');
      resizer.classList.add('collapsed');
      bundleToggle.classList.remove('on');
      bundleToggle.title = '展开资料包列表';
      dockStore.set('mdv-side-collapsed', '1');
    } else {
      side.style.setProperty('--side-w', `${w}px`);
      side.classList.remove('collapsed');
      resizer.classList.remove('collapsed');
      bundleToggle.classList.add('on');
      bundleToggle.title = '折叠资料包列表';
      dockStore.set('mdv-side-w', w);
      dockStore.set('mdv-side-collapsed', '0');
    }
  };
  applySideWidth(sideWidth, isSideCollapsed);
  bundleToggle.onclick = () => {
    const nextCollapsed = !side.classList.contains('collapsed');
    applySideWidth(nextCollapsed ? 0 : (Number(dockStore.get('mdv-side-w', 220)) || 220), nextCollapsed);
  };

  let startX = 0, startW = 0, draggingResizer = false;
  resizer.addEventListener('pointerdown', ev => {
    ev.preventDefault(); draggingResizer = true;
    startX = ev.clientX;
    startW = side.classList.contains('collapsed') ? 0 : side.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    resizer.setPointerCapture(ev.pointerId);
  });
  resizer.addEventListener('pointermove', ev => {
    if (!draggingResizer) return;
    const delta = startX - ev.clientX;
    const newW = startW + delta;
    if (newW < 60) applySideWidth(0, true);
    else applySideWidth(Math.min(520, newW), false);
  });
  const stopResize = () => {
    if (!draggingResizer) return;
    draggingResizer = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
  };
  resizer.addEventListener('pointerup', stopResize);
  resizer.addEventListener('pointercancel', stopResize);
  resizer.addEventListener('dblclick', () => {
    if (side.classList.contains('collapsed')){
      applySideWidth(Number(dockStore.get('mdv-side-w', 220)) || 220, false);
    } else {
      applySideWidth(0, true);
    }
  });

  /* 人机笔迹发丝呈现：Scheme C Notion 闭合 Agent 块 + 默认纯净正文 + 高权重重点 mark */
  const escHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const renderMirror = raw => {
    const lines = String(raw).replace(/\r\n/g, '\n').split('\n');
    const parsed = [];
    let inAgent = false;

    for (let i = 0; i < lines.length; i++){
      const line = lines[i];
      if (/^\s*<!--\s*@author:\s*agent[^\s>]*\s*-->/i.test(line)){
        inAgent = true;
        parsed.push({ isTag: true, tagType: 'tag-agent-start', text: line });
        continue;
      }
      if (/^\s*<!--\s*\/@author\s*-->/i.test(line)){
        inAgent = false;
        parsed.push({ isTag: true, tagType: 'tag-agent-end', text: line });
        continue;
      }
      if (/^\s*<!--\s*@author:\s*(human|none|clear)\s*-->/i.test(line)){
        inAgent = false;
        parsed.push({ isTag: true, tagType: 'tag-legacy', text: line });
        continue;
      }
      parsed.push({ isTag: false, author: inAgent ? 'agent' : null, text: line });
    }

    const renderLineTextWithMarks = (lineText, inMarkState) => {
      let inMark = inMarkState;
      let out = inMark ? '<mark class="mdv-mark">' : '';
      let i = 0;
      while (i < lineText.length) {
        if (lineText.startsWith('<mark>', i)) {
          if (!inMark) {
            inMark = true;
            out += '<mark class="mdv-mark"><span class="mdv-mark-tag">&lt;mark&gt;</span>';
          } else {
            out += '<span class="mdv-mark-tag">&lt;mark&gt;</span>';
          }
          i += 6;
        } else if (lineText.startsWith('</mark>', i)) {
          if (inMark) {
            inMark = false;
            out += '<span class="mdv-mark-tag">&lt;/mark&gt;</span></mark>';
          } else {
            out += '<span class="mdv-mark-tag">&lt;/mark&gt;</span>';
          }
          i += 7;
        } else {
          out += escHtml(lineText[i++]);
        }
      }
      if (inMark) out += '</mark>';
      return { html: out, inMark };
    };

    const lineHtml = [];
    let markState = false;
    for (let i = 0; i < lines.length; i++){
      const line = lines[i];
      const p = parsed[i];
      if (p.isTag){
        if (p.tagType === 'tag-agent-start') {
          lineHtml.push(`<div class="ml tag tag-agent tag-agent-start"><span class="agent-badge">✦ Agent</span><span class="tag">${escHtml(line)}</span></div>`);
        } else if (p.tagType === 'tag-agent-end') {
          lineHtml.push(`<div class="ml tag tag-agent tag-agent-end"><span class="agent-badge end">✦ /Agent</span><span class="tag">${escHtml(line)}</span></div>`);
        } else {
          lineHtml.push(`<div class="ml tag"><span class="tag">${escHtml(line)}</span></div>`);
        }
      } else {
        const cls = p.author ? 'ml author-agent' : 'ml';
        if (!line){
          lineHtml.push(`<div class="${cls}">&#x200B;</div>`);
        } else {
          const res = renderLineTextWithMarks(line, markState);
          markState = res.inMark;
          lineHtml.push(`<div class="${cls}">${res.html}</div>`);
        }
      }
    }
    mirror.innerHTML = lineHtml.join('');
    mirror.scrollTop = editor.scrollTop; mirror.scrollLeft = editor.scrollLeft;
  };
  let hlRaf = 0;
  const refreshHighlight = () => { if (hlRaf) return; hlRaf = requestAnimationFrame(() => { hlRaf = 0; renderMirror(editor.value); }); };
  editor.addEventListener('scroll', () => { mirror.scrollTop = editor.scrollTop; mirror.scrollLeft = editor.scrollLeft; });


  let editorCatalog = [];
  const externalRelativePath = () => {
    const base = String(object?.md || path || '');
    if (!bundle || currentName === 'index.md') return base;
    return base.replace(/index\.md$/i, currentName);
  };
  const editorById = id => editorCatalog.find(item => String(item?.id || '') === String(id));
  const externalError = (event, error, message) => {
    bundle?.bridge?.logError?.(event, error);
    status.textContent = message;
    toast(message);
  };
  /* 预览只做最小排版:先整体 HTML 转义再做变换,任何原始标签都不会被渲染。 */
  /* <mark> 可能跨行:预览前按行重平衡,保证每行标签闭合;空行不进标记,保持段落分隔语义 */
  const rebalanceMarks = src => {
    let inMark = false;
    return String(src).replace(/\r\n/g, '\n').split('\n').map(line => {
      if (!line.trim()) return line;
      let out = inMark ? '<mark>' : '';
      for (let i = 0; i < line.length;){
        if (line.startsWith('<mark>', i)){ if (!inMark){ inMark = true; out += '<mark>'; } i += 6; }
        else if (line.startsWith('</mark>', i)){ if (inMark){ inMark = false; out += '</mark>'; } i += 7; }
        else { out += line[i++]; }
      }
      if (inMark) out += '</mark>';
      return out;
    }).join('\n');
  };
  /* 图片渲染:桥接模式走同源 /api/v1/assets/read;http(s) 直链原样;非桥接显示占位卡 */
  const mdImgHtml = (alt, raw) => {
    let name = raw.replace(/&amp;/g, '&');
    if (/^https?:\/\//i.test(name)) return `<img src="${name.replace(/"/g, '&quot;')}" alt="${alt}">`;
    if (!bundle) return `<span class="mdv-imgph">图片仅本地桥模式可预览（${alt || name}）</span>`;
    try { name = decodeURIComponent(name); } catch { /* 非编码名原样用 */ }
    const src = bundle.bridge.assetReadUrl(bundle.ownerKind, bundle.ownerId, name).replace(/&/g, '&amp;');
    return `<img src="${src}" alt="${alt}" loading="lazy">`;
  };
  const mdMini = src => {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = s => esc(s)
      .replace(/&lt;mark&gt;/g, '<mark>').replace(/&lt;\/mark&gt;/g, '</mark>') // 放行 <mark>:重点标记渲染为高亮色
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, name) => mdImgHtml(alt, name))
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1');
    const out = []; let list = null; let para = []; let code = null;
    let currentAuthor = null;
    const closeAuthor = () => { if (currentAuthor) { out.push('</div>'); currentAuthor = null; } };
    const flushPara = () => { if (para.length){ out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
    const flushList = () => { if (list){ out.push(`<ul>${list.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`); list = null; } };
    for (const line of String(src).replace(/\r\n/g, '\n').split('\n')){
      const agentStartMatch = line.match(/^<!--\s*@author:\s*(agent[^\s>]*)\s*-->/i);
      if (agentStartMatch) {
        flushPara(); flushList(); closeAuthor();
        currentAuthor = 'agent';
        out.push(`<div class="author-block agent"><div class="author-badge">✦ ${agentStartMatch[1]}</div>`);
        continue;
      }
      if (/^<!--\s*\/@author\s*-->/i.test(line) || /^<!--\s*@author:\s*(human|none|clear)\s*-->/i.test(line)){
        flushPara(); flushList(); closeAuthor();
        continue;
      }
      if (/^\s*```/.test(line)){
        if (code){ out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; }
        else { flushPara(); flushList(); code = []; }
        continue;
      }
      if (code){ code.push(line); continue; }
      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h){ flushPara(); flushList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
      const li = line.match(/^\s*[-*]\s+(.*)$/);
      if (li){ flushPara(); list = list || []; list.push(li[1]); continue; }
      if (!line.trim()){ flushPara(); flushList(); continue; }
      flushList(); para.push(line);
    }
    if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    flushPara(); flushList(); closeAuthor();
    return out.join('');
  };
  const setMode = mode => {
    const showPreview = mode === 'preview';
    segEdit.classList.toggle('on', !showPreview); segPrev.classList.toggle('on', showPreview);
    editWrap.hidden = showPreview; preview.hidden = !showPreview;
    if (showPreview) preview.innerHTML = mdMini(rebalanceMarks(editor.value));
  };
  segEdit.addEventListener('click', () => setMode('edit'));
  segPrev.addEventListener('click', () => setMode('preview'));
  const closeMenu = () => { menu.hidden = true; openCaret.classList.remove('on'); };
  const toggleMenu = () => { menu.hidden = !menu.hidden; openCaret.classList.toggle('on', !menu.hidden); };
  openCaret.addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
  root.addEventListener('pointerdown', e => { if (!openWrap.contains(e.target)) closeMenu(); });
  root.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.key === 'Enter')){
      // 快捷保存：拦在编辑器层并阻止冒泡，避免触发画布全局 Ctrl+S（导出地图）。
      e.preventDefault(); e.stopPropagation(); void doSave(); return;
    }
    // Escape 不再关闭编辑器，而是把整个 dock 收成细边条（编辑内容保留，展开即回）
    if (e.key === 'Escape'){ if (!menu.hidden) closeMenu(); else dockCollapse(); }
  });
  const menuIcon = item => {
    const id = String(item?.id || '').toLowerCase();
    const label = String(item?.label || '').toLowerCase();
    const kind = String(item?.kind || '').toLowerCase();
    if (id === 'vscode' || label.includes('vs code') || label.includes('vscode')) return I.vscode;
    if (id === 'antigravity' || label.includes('antigravity')) return I.antigravity;
    if (id === 'pycharm' || label.includes('pycharm')) return I.pycharm;
    if (id === 'gitbash' || id === 'git' || label.includes('git bash')) return I.gitBash;
    if (id === 'terminal' || /terminal|powershell|cmd|shell/i.test(id) || /terminal|终端/i.test(label)) return I.terminal;
    if (kind === 'folder' || id === 'folder' || label.includes('文件夹')) return I.folderOfficial;
    if (kind === 'system' || id === 'system' || /default/i.test(id) || label.includes('默认应用')) return I.defaultApp;
    if (kind === 'manual' || id === 'manual') return I.gear;
    return I.app;
  };
  const renderEditorCatalog = listing => {
    editorCatalog = Array.isArray(listing?.editors) ? listing.editors.filter(item => item && typeof item === 'object') : [];
    menu.textContent = '';
    if (!editorCatalog.length) {
      const empty = document.createElement('button'); empty.type = 'button'; empty.disabled = true; empty.textContent = '暂无可用编辑器';
      menu.appendChild(empty); return;
    }
    const preferred = String(listing?.preferredEditorId || '');
    const prefItem = editorCatalog.find(item => String(item.id) === preferred && item.available);
    if (prefItem) {
      openAction.innerHTML = `${menuIcon(prefItem)}<span>${esc(prefItem.label || '打开')}</span>`;
      openAction.title = `直接用 ${prefItem.label || prefItem.id} 打开`;
      openAction.onclick = () => { closeMenu(); void openWith(prefItem); };
      openCaret.title = '更多打开方式与选项';
    } else {
      openAction.innerHTML = `${I.ext}<span>打开方式</span>`;
      openAction.title = '选择打开方式';
      openAction.onclick = () => { toggleMenu(); };
      openCaret.title = '选择打开方式';
    }
    const addItem = (item, handler) => {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem');
      b.innerHTML = `${menuIcon(item)}<span></span>`;
      b.querySelector('span').textContent = String(item.label || item.id || '未命名编辑器');
      b.disabled = item.available !== true && item.needsPicker !== true;
      if (String(item.id) === preferred && !b.disabled) {
        const tick = document.createElement('span'); tick.className = 'tick'; tick.title = '首选'; tick.innerHTML = I.check; b.appendChild(tick);
      }
      b.addEventListener('click', () => { closeMenu(); void handler(item); });
      menu.appendChild(b);
    };
    for (const item of editorCatalog) {
      if (item.kind === 'folder' || item.id === 'folder') continue; // 文件夹入口固定放分隔线下方
      addItem(item, openWith);
    }
    const folder = editorCatalog.find(item => item.kind === 'folder' || item.id === 'folder');
    const sep = document.createElement('div'); sep.className = 'mdv-msep'; menu.appendChild(sep);
    if (folder) addItem(folder, openWith);
    const saveAs = document.createElement('button'); saveAs.type = 'button'; saveAs.setAttribute('role', 'menuitem');
    saveAs.innerHTML = `${I.save}<span>另存副本…</span>`;
    saveAs.addEventListener('click', () => { closeMenu(); void saveCopyAs(); });
    menu.appendChild(saveAs);
    const remember = document.createElement('label'); remember.className = 'mdv-remember';
    const rememberEditor = document.createElement('input'); rememberEditor.type = 'checkbox';
    remember.append(rememberEditor, document.createTextNode('下次直接用首选打开'));
    menu.appendChild(remember);
  };
  const loadEditorCatalog = async () => {
    if (!bundle?.bridge || typeof bundle.bridge.listEditors !== 'function') return;
    openWrap.hidden = false;
    try {
      const listing = await bundle.bridge.listEditors();
      renderEditorCatalog(listing);
    } catch (error) {
      renderEditorCatalog({ editors: [] });
      externalError('editor.list.failed', error, '外部编辑器服务暂不可用，当前内容仍可编辑。');
    }
  };
  const pickManualEditor = async () => {
    if (!bundle?.bridge || typeof bundle.bridge.pickManualEditor !== 'function') return;
    try {
      const result = await bundle.bridge.pickManualEditor();
      if (result?.cancelled) { status.textContent = '已取消手动选择程序'; return; }
      const listing = await bundle.bridge.listEditors();
      renderEditorCatalog(listing);
      status.textContent = '已登记手动选择的程序，当前编辑内容未改变';
    } catch (error) {
      externalError('editor.pick.failed', error, '手动选择程序失败，当前编辑内容仍保留。');
    }
  };
  const openWith = async item => {
    if (!item) { toast('当前没有可用的外部编辑器。'); return; }
    if (item.needsPicker === true && item.available !== true) { await pickManualEditor(); return; }
    if (item.available !== true || typeof bundle?.bridge?.openEditor !== 'function') { toast('该编辑器当前不可用。'); return; }
    const isFolder = item.kind === 'folder' || item.id === 'folder';
    try {
      if (!isFolder && menu.querySelector('.mdv-remember input')?.checked && typeof bundle.bridge.setPreferredEditor === 'function') await bundle.bridge.setPreferredEditor(String(item.id));
      await bundle.bridge.openEditor(String(item.id), externalRelativePath(), 'file');
      status.textContent = isFolder ? '已打开所在文件夹，当前编辑内容未改变' : `已用${String(item.label || '首选编辑器')}打开，当前编辑内容未改变`;
      if (!isFolder) toast(`已用${String(item.label || '外部编辑器')}打开 Markdown`);
    } catch (error) {
      externalError(isFolder ? 'editor.folder.failed' : 'editor.open.failed', error, isFolder ? '打开所在文件夹失败，当前编辑内容仍保留。' : '外部编辑器打开失败，当前编辑内容仍保留。');
    }
  };
  const saveCopyAs = async () => {
    if (typeof bundle?.bridge?.saveMarkdownAsCopy !== 'function') { toast('另存副本暂不可用。'); return; }
    try {
      const result = await bundle.bridge.saveMarkdownAsCopy(externalRelativePath());
      status.textContent = result?.cancelled ? '已取消另存副本' : '已导出 Markdown 副本，当前编辑内容未改变';
      if (!result?.cancelled) toast('已导出 Markdown 副本');
    } catch (error) {
      externalError('editor.save-as.failed', error, '另存副本失败，当前编辑内容仍保留。');
    }
  };
  const refreshFiles = async () => {
    if (!bundle) { side.hidden = true; return; }
    try { files = await bundle.bridge.listBundleFiles(bundle.ownerKind, bundle.ownerId, true); } catch (error) {
      bundle.bridge.logError?.('bundle.list.failed', error, { ownerKind: bundle.ownerKind, ownerId: bundle.ownerId });
      status.textContent = '资料包清单读取失败，当前编辑仍保留';
      return;
    }
    fileList.textContent = '';
    if (!files.length) { const empty = document.createElement('div'); empty.className = 'mdv-empty'; empty.textContent = '暂无补充资料'; fileList.appendChild(empty); return; }
    for (const file of files) {
      const name = String(file.name || file.fileName || '');
      const row = document.createElement('div'); row.className = 'mdv-file';
      const button = document.createElement('button'); button.type = 'button'; button.title = name;
      button.className = `mdv-name${name === currentName && !file.archived ? ' on' : ''}${file.archived ? ' archived' : ''}`;
      const icon = /\.(png|jpe?g|gif|webp|svg)$/i.test(name) ? I.img : /\.md$/i.test(name) ? I.md : I.app;
      button.innerHTML = `${icon}<span></span>`;
      button.querySelector('span').textContent = `${name}${file.isIndex ? ' · 主文档' : file.archived ? ' · 已归档' : ''}`;
      button.addEventListener('click', () => void selectBundleFile(file));
      /* 右键:复制文件名 / 相对路径 / Markdown 引用(图片用 ![] 语法) */
      row.addEventListener('contextmenu', ev => {
        ev.preventDefault(); ev.stopPropagation();
        const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
        const rel = String(file.path || name);
        const ref = isImg ? `![${name.replace(/\.[^.]+$/, '')}](${encodeURI(name)})` : `[${name}](${encodeURI(name)})`;
        const copy = (text, label) => () => {
          if (!navigator.clipboard?.writeText) { toast('剪贴板不可用，请手动复制'); return; }
          navigator.clipboard.writeText(text).then(() => toast(`已复制${label}`)).catch(() => toast('复制失败，请手动复制'));
        };
        openMenu([
          { id: 'cpy-name', label: '复制文件名', fn: copy(name, '文件名') },
          { id: 'cpy-path', label: '复制相对路径', fn: copy(rel, '相对路径') },
          { id: 'cpy-ref', label: '复制 Markdown 引用', fn: copy(ref, 'Markdown 引用') },
        ], ev.clientX, ev.clientY);
      });
      row.appendChild(button);
      if (!file.isIndex) {
        const action = document.createElement('button'); action.className = 'mdv-act'; action.type = 'button'; action.textContent = file.archived ? '恢复' : '…'; action.title = file.archived ? '恢复文件' : '管理文件';
        action.addEventListener('click', () => void manageBundleFile(file));
        row.appendChild(action);
      }
      fileList.appendChild(row);
    }
  };
  const selectBundleFile = async file => {
    if (!bundle || file.archived) return;
    if (editor.value !== savedText && !confirm('当前 Markdown 还有未保存内容，切换文件会保留它但不会自动保存。继续吗？')) return;
    try {
      const result = await bundle.bridge.readBundleMarkdown(bundle.ownerKind, bundle.ownerId, String(file.name || file.fileName));
      currentName = String(result.fileName || result.name || file.name || file.fileName);
      editor.value = String(result.content || ''); savedText = editor.value; etag = String(result.etag || '');
      baseRaw = editor.value; baseLogical = mdParseMarks(editor.value).logical; renderMirror(editor.value); // 换文件重置高亮基线
      title.textContent = `${bundle.ownerKind === 'node' ? '节点' : '方案'}资料包 / ${currentName}`;
      status.textContent = '已打开'; await refreshFiles(); editor.focus();
    } catch (error) {
      bundle.bridge.logError?.('bundle.read.failed', error, { fileName: file.name || file.fileName });
      status.textContent = `读取失败：${error?.message || '请重试'}`;
      toast('资料包文件读取失败，当前编辑内容未改变。');
    }
  };
  const manageBundleFile = async file => {
    if (!bundle) return;
    const name = String(file.name || file.fileName || '');
    try {
      if (file.archived) {
        await bundle.bridge.restoreBundleFile(bundle.ownerKind, bundle.ownerId, name);
        toast(`已恢复 ${name}`);
      } else {
        const action = prompt(`输入 ${name} 的操作：重命名=输入新文件名；归档=输入“归档”`, '');
        if (action === null) return;
        if (action.trim() === '归档') { await bundle.bridge.archiveBundleFile(bundle.ownerKind, bundle.ownerId, name); toast(`已归档 ${name}`); }
        else if (action.trim() && action.trim() !== name) { await bundle.bridge.renameBundleFile(bundle.ownerKind, bundle.ownerId, name, action.trim()); toast(`已重命名为 ${action.trim()}`); }
      }
      await refreshFiles();
    } catch (error) {
      bundle.bridge.logError?.('bundle.manage.failed', error, { fileName: name });
      status.textContent = `资料包操作失败：${error?.message || '请重试'}`;
      toast('资料包操作失败，编辑内容仍保留。');
    }
  };
  newFile.onclick = () => {
    if (!bundle) return;
    const requested = prompt('补充 Markdown 文件名（例如 notes.md）', 'notes.md');
    if (!requested) return;
    void bundle.bridge.createBundleMarkdown(bundle.ownerKind, bundle.ownerId, requested, `# ${requested.replace(/\.md$/i, '')}\n\n`)
      .then(async result => { await refreshFiles(); const created = files.find(file => String(file.name || file.fileName) === String(result.name || result.fileName)); if (created) await selectBundleFile(created); })
      .catch(error => { bundle.bridge.logError?.('bundle.create.failed', error); status.textContent = `创建失败：${error?.message || '请重试'}`; toast('补充 Markdown 创建失败，当前编辑内容仍保留。'); });
  };
  /* 退出编辑模式:摘掉 .mdv-root、退回详情面板;有未保存时先弹确认 */
  const destroyEditor = () => { if (autoSaveTimer) clearTimeout(autoSaveTimer); document.body.classList.remove('is-editing'); root.remove(); panel.classList.remove('editing'); mdSession = null; renderPanel(); };
  const backToDetails = () => {
    if (editor.value !== savedText){
      void confirmDialog({ title: '返回详情', body: '还有未保存的修改，返回详情会放弃这些修改。', confirmLabel: '放弃并返回', cancelLabel: '继续编辑', danger: true })
        .then(ok => { if (ok) destroyEditor(); });
      return;
    }
    destroyEditor();
  };
  const closeEntirePanel = () => {
    if (editor.value !== savedText){
      void confirmDialog({ title: '关闭侧栏', body: '还有未保存的修改，关闭侧栏会放弃这些修改。', confirmLabel: '放弃并关闭', cancelLabel: '继续编辑', danger: true })
        .then(ok => { if (ok){ destroyEditor(); select(null); } });
      return;
    }
    destroyEditor();
    select(null);
  };
  back.onclick = backToDetails;
  close.onclick = closeEntirePanel;
  let autoSaveTimer = null;
  const doSave = async () => {
    if (saving) return;
    saving = true;
    saveBtn.disabled = true;
    status.textContent = '保存中…';
    try{
      const finalText = editor.value;
      const result = bundle && currentName !== 'index.md'
        ? await bundle.bridge.replaceBundleMarkdown(bundle.ownerKind, bundle.ownerId, currentName, finalText, etag)
        : await save(finalText, etag);
      etag = String(result?.etag || etag);
      savedText = finalText;
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      status.textContent = `✓ 已保存 (${timeStr})`;
      baseRaw = finalText;
      baseLogical = finalText;
      renderMirror(editor.value);
    }catch(error){
      status.textContent = `保存失败：${error?.message || '请重试'}`;
      toast(Number(error?.status) === 409 ? '资料包有并发修改，请重新读取后合并；你的编辑内容已保留。' : '保存失败，编辑内容已保留。');
    }finally{
      saving = false;
      saveBtn.disabled = false;
    }
  };
  saveBtn.onclick = () => void doSave();
  const scheduleAutoSave = () => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      if (editor.value !== savedText) void doSave();
    }, 1200);
  };
  /* 编辑器内的未保存提示：只动本面板状态栏，不碰全局同步灯（未保存≠冲突）。 */
  editor.addEventListener('input', () => {
    if (!saving) status.textContent = editor.value === savedText ? '✓ 已保存' : '● 未保存（Ctrl+S 保存）';
    refreshHighlight();
    scheduleAutoSave();
  });
  editor.addEventListener('paste', async event => {
    const item = [...(event.clipboardData?.items || [])].find(candidate => candidate.kind === 'file' && /^image\//i.test(candidate.type));
    const before = editor.value; const start = editor.selectionStart; const end = editor.selectionEnd;
    if (!item){
      /* 本地图片绝对路径粘贴:浏览器读不到路径字节,交给本地桥读取入库 */
      const text = (event.clipboardData?.getData('text/plain') || '').trim().replace(/^"|"$/g, '');
      if (!text || /[\r\n]/.test(text)) return;
      if (!/^(?:[a-zA-Z]:[\\/]|\\\\|\/).+\.(?:png|jpe?g|gif|webp)$/i.test(text)) return;
      event.preventDefault();
      if (!bundle) { status.textContent = '当前模式不能导入图片'; toast('请先通过本地桥打开项目后再粘贴图片路径。'); return; }
      status.textContent = '正在导入图片…';
      try {
        const result = await bundle.bridge.importAssetFromPath(bundle.ownerKind, bundle.ownerId, text);
        const name = String(result.name || result.fileName || text.split(/[\\/]/).pop());
        const alt = name.replace(/\.[^.]+$/, '');
        editor.setRangeText(`![${alt}](${encodeURI(name)})`, start, end, 'end');
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        status.textContent = '图片已导入，保存 Markdown 后生效';
        await refreshFiles();
      } catch (error) {
        editor.value = before; editor.setSelectionRange(start, end);
        bundle.bridge.logError?.('asset.import-path.failed', error, { ownerKind: bundle.ownerKind, ownerId: bundle.ownerId });
        status.textContent = `图片导入失败：${error?.message || '请重试'}`;
        toast('图片导入失败，编辑内容已保留。');
      }
      return;
    }
    event.preventDefault();
    if (!bundle) { status.textContent = '当前模式不能导入图片'; toast('请先通过本地桥打开项目后再粘贴图片。'); return; }
    const file = item.getAsFile(); if (!file) { status.textContent = '剪贴板图片读取失败'; toast('图片读取失败，编辑内容未改变。'); return; }
    status.textContent = '正在导入图片…';
    try {
      const result = await bundle.bridge.importAsset(bundle.ownerKind, bundle.ownerId, file, file.name || `pasted-${Date.now()}.png`);
      const name = String(result.name || result.fileName || file.name || 'image.png');
      const alt = String(file.name || '图片').replace(/\.[^.]+$/, '');
      editor.setRangeText(`![${alt}](${encodeURI(name)})`, start, end, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      status.textContent = '图片已导入，保存 Markdown 后生效';
      await refreshFiles();
    } catch (error) {
      editor.value = before; editor.setSelectionRange(start, end);
      bundle.bridge.logError?.('asset.import.failed', error, { ownerKind: bundle.ownerKind, ownerId: bundle.ownerId });
      status.textContent = `图片导入失败：${error?.message || '请重试'}`;
      toast('图片导入失败，编辑内容已保留。');
    }
  });
  // 挂进 dock:面板进入编辑模式(详情三节被 .editing 隐藏),注册会话供 select() 守卫
  mdSession = { dirty: () => editor.value !== savedText, discard: () => { if (mdSession) destroyEditor(); } };
  // 关键保证：严格钳制编辑器宽度，绝不允许吞没左侧地图，至少露出 56px 地图且让手柄触手可及
  const maxEditorW = Math.max(160, window.innerWidth - 56);
  let initialEditorW = parseInt(dockStore.get('dock-we', ''), 10) || Math.round(window.innerWidth * 0.55);
  if (initialEditorW > maxEditorW) initialEditorW = maxEditorW;
  if (initialEditorW < 160) initialEditorW = Math.min(maxEditorW, 260);
  panel.style.setProperty('--dockwe', initialEditorW + 'px');
  panel.classList.add('on', 'editing');
  document.body.classList.add('is-editing');
  panel.appendChild(root);
  updateDockSpace(); // dock 扩宽后重算工具条居中偏移,避免压住编辑器顶栏
  renderMirror(text);
  void refreshFiles();
  void loadEditorCatalog();
  editor.focus();
}
/* 启动时尝试恢复上次项目文件夹(requestPermission 需用户手势,只探测已授权的) */