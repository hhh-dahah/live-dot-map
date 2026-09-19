async function newBlankMap(){
  if (IO.readOnly){ warnReadOnly(); return; }
  const bridge = window.LiveDotBridge;
  if (bridge?.active && typeof bridge.createMap === 'function'){
    // 桥模式：服务端建图、写 active-map 指针并返回新图快照，attachProject 自动重载画布
    try{
      await bridge.createMap('未命名地图');
      toast('已新建地图（双击名称可改名）');
    }catch(e){
      toast('新建地图失败：' + (e && e.message ? e.message : String(e)), true);
    }
    return;
  }
  if (IO.dir){
    // FS 模式：maps/<id>/ 下建新图并切换
    try{
      const created = await fsCreateMap(IO.dir, '未命名地图');
      IO.mapFile = created.fh; IO.mapId = created.id;
      currentMapDir = created.mapDir;
      IO.sourceDocument = null; IO.sourceVersion = null;
      resetBlankState();
      await writeMapNow(); syncBadge();
      toast('已新建地图（双击名称可改名）');
    }catch(e){
      toast('新建地图失败：' + (e && e.message ? e.message : String(e)), true);
    }
    return;
  }
  // 演示模式：就地清空画布（可 Ctrl+Z 撤销）
  pushHistory();
  IO.sourceDocument = null; IO.sourceVersion = null;
  resetBlankState(false);
  scheduleSave();
  toast('已新建地图');
}
/* 把当前状态重置为一张空图；clearHistory=false 时保留撤销栈（仅演示模式用） */
function resetBlankState(clearHistory = true){
  S.nodes = []; S.edges = []; S.anns = [];
  S.routes = [{id:'r1', name:'主路线', source:null, main:true, createdAt:today(), updatedAt:today()}];
  S.name = '未命名地图'; applyName();
  S.sel = null; S.selAnn = null; clearMulti();
  S.view = { x:innerWidth/2, y:innerHeight/2, k:1 };
  setTool('select');
  if (clearHistory){ undoStack = []; redoStack = []; }
  render();
}

/* ---------- 文件 IO:map.json ↔ S（正式协同遵守 docs/map-json-v2.md） ---------- */
const IO = { dir:null, mapFile:null, mapId:null, lastMod:0, lastWrite:0, saveTimer:null, watching:false, silent:false, sourceDocument:null, sourceVersion:null, readOnly:false, restorePending:false };
let curationHintLevel = 0;
const hasFS = 'showDirectoryPicker' in window;
const today = () => new Date().toISOString().slice(0, 10);

/* S → map.json 对象;节点半径 r 不存(按文字重算) */
function serialize(){
  const cp = o => JSON.parse(JSON.stringify(o));
  const legacy = {
    version:1, name:S.name || $('#proj-name').textContent, updatedAt:today(),
    mapDir: currentMapDir || '.live-dot-map',
    view:{ x:S.view.x, y:S.view.y, k:S.view.k },
    ui:{ showAnns:S.showAnns, showRoutes:S.showRoutes, showNums:S.showNums, showFailed:S.showFailed },
    counters:{ num:S.nextNum, edge:S.nextEdge, ann:S.nextAnn, nodeName:S.nextNodeName, edgeName:S.nextEdgeName, routeName:S.nextRouteName },
    routes:cp(S.routes),
    nodes:S.nodes.map(n => { const c = cp(n); delete c.r; return c; }),
    edges:cp(S.edges), anns:cp(S.anns)
  };
  return IO.sourceDocument && window.LiveDotFallback
    ? window.LiveDotFallback.composeFallbackDocument(IO.sourceDocument, legacy)
    : legacy;
}
function serializeForSave(){
  const legacy = { ...serialize(), version:IO.sourceDocument?.version ?? 1 };
  if (!window.LiveDotFallback) return legacy;
  if (!IO.sourceDocument){
    const migrated = window.LiveDotFallback.prepareFallbackDocument(legacy);
    IO.sourceDocument = migrated.document; IO.sourceVersion = migrated.sourceVersion;
  }
  return window.LiveDotFallback.composeFallbackDocument(IO.sourceDocument, legacy, { commit:!IO.readOnly });
}
/* map.json 对象 → S;缺失字段补默认值,重置选择与撤销栈 */
/* counters 钳制:保存层可能长时间不同步 counters,盲信旧值会让 id/名称回退撞号;
   一律取「记录值」与「数据推导值」的较大者,保证单调递增(测试见 tests/web/counters-clamp.test.mjs) */
function clampCounters(c, nodes, edges, anns){
  const maxId = arr => Math.max(0, ...arr.map(o => parseInt(String(o.id).slice(1)) || 0));
  const maxNum = Math.max(0, ...nodes.map(n => parseInt(n.num) || 0));
  const maxNodeName = Math.max(0, ...nodes.map(n => {
    const m = /^新节点(\d+)$/.exec(n.name || ''); return m ? parseInt(m[1]) : 0;
  }));
  return {
    nextNum: Math.max(c.num ?? 0, maxNum + 1, maxId(nodes) + 1),
    nextEdge: Math.max(c.edge ?? 0, maxId(edges) + 1),
    nextAnn: Math.max(c.ann ?? 0, maxId(anns) + 1),
    nextNodeName: Math.max(c.nodeName ?? 1, maxNodeName + 1, nodes.length + 1),
    nextEdgeName: Math.max(c.edgeName ?? 1, 1),
    nextRouteName: Math.max(c.routeName ?? 1, 1),
  };
}
function deserialize(d){
  const td = today();
  currentMapDir = typeof d.mapDir === 'string' && d.mapDir ? d.mapDir : '.live-dot-map';
  S.name = d.name || '未命名地图';
  S.view = d.view || { x:0, y:0, k:1 };
  const ui = d.ui || {};
  S.showAnns = ui.showAnns !== false; S.showRoutes = ui.showRoutes !== false;
  S.showNums = !!ui.showNums; S.showFailed = ui.showFailed !== false;
  const c = d.counters || {};
  S.routes = d.routes || [];
  // 保留文档中的原始 kind；“结果”兼容映射只用于 UI 展示，不能把旧值写成
  // schema 不认识的 normal，否则降级导出/重新保存会被校验拒绝。
  S.nodes = (d.nodes || []).map(n => ({ r:34, createdAt:td, updatedAt:td, ...n }));
  S.edges = (d.edges || []).map(e => ({ createdAt:td, updatedAt:td, ...e }));
  S.anns  = (d.anns  || []).map(a => ({ hidden:false, createdAt:td, updatedAt:td, ...a }));
  const cc = clampCounters(c, S.nodes, S.edges, S.anns);
  S.nextNum = cc.nextNum; S.nextEdge = cc.nextEdge; S.nextAnn = cc.nextAnn;
  S.nextNodeName = cc.nextNodeName; S.nextEdgeName = cc.nextEdgeName; S.nextRouteName = cc.nextRouteName;
  S.sel = null; S.selAnn = null; S.multi = [];
  S.hoverEdge = null; S.snapTo = null; S.drawingEdge = null; S.pendingEdgeFrom = null;
  undoStack = []; redoStack = []; // 加载新地图后清空撤销栈
}
/* 项目名同步到标题与左上 pill */
function applyName(){
  $('#proj-name').textContent = S.name;
  document.title = '活点地图 — ' + S.name;
}
function warnReadOnly(){
  toast(`这个文件版本太新，只能看不能改`);
  window.LiveDotApp?.setStatus('fallback', `这个文件版本太新，只能看不能改`);
}
function queueReadOnlyRestore(){
  if (!IO.readOnly || IO.restorePending) return;
  IO.restorePending = true;
  queueMicrotask(() => {
    IO.restorePending = false;
    if (!IO.readOnly || !IO.sourceDocument) return;
    const view = { ...S.view };
    IO.silent = true; deserialize(IO.sourceDocument); IO.silent = false;
    S.view = view; applyName(); render(); renderPanel(); applyView(); syncBadge();
  });
}
function acceptMapDocument(document, source='import'){
  if (!window.LiveDotFallback) throw new Error('地图兼容层尚未就绪');
  const prepared = window.LiveDotFallback.prepareFallbackDocument(document);
  IO.sourceDocument = JSON.parse(JSON.stringify(prepared.document));
  IO.sourceVersion = prepared.sourceVersion;
  IO.readOnly = prepared.readOnly;
  IO.silent = true; deserialize(prepared.document); IO.silent = false;
  applyName(); render(); renderPanel();
  if (prepared.document.view) applyView(); else fitView();
  syncBadge();
  if (prepared.readOnly) queueMicrotask(() => window.LiveDotApp?.setStatus('fallback', `这个文件版本太新，只能看不能改`));
  else if (source !== 'bridge') queueMicrotask(() => window.LiveDotApp?.setStatus('fallback', '改动暂时只存在浏览器里 · 双击桌面上的「活点地图」图标打开，Agent 才能看到'));
  return prepared;
}
/* 同步状态点:灰=演示模式,黄=保存中,绿=已同步 */
/* Agent 最近写回时间(来自桥端 agent-health 记录),拼进状态点 tooltip */
function agentActivityLine(){
  const rec = window.LiveDotBridge?.lastAgentActivity;
  if (!rec?.at) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(rec.at).getTime()) / 60000));
  const when = mins < 1 ? '刚刚' : mins < 60 ? `${mins} 分钟前` : mins < 1440 ? `${Math.round(mins / 60)} 小时前` : `${Math.round(mins / 1440)} 天前`;
  return `\nAgent 最近写回：${when}${rec.name ? `（${rec.name}）` : ''}`;
}
function syncBadge(){
  let dot = $('#sync-dot');
  if (!dot){
    dot = document.createElement('button'); dot.id = 'sync-dot'; dot.type = 'button';
    dot.setAttribute('aria-label', '查看连接状态');
    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;flex:none';
    dot.addEventListener('click', () => { if (!window.LiveDotUI?.openStatus?.()) toast(dot.title || '连接状态'); });
    $('#project-pill').insertBefore(dot, $('#proj-menu-btn'));
  }
  // 桥接模式下灯色与提示由 setStatus 全权管理,这里只兜底无桥(纯文件)模式,
  // 否则 IO 状态会把断线红灯覆盖回绿色。
  if (!window.LiveDotBridge?.active){
    dot.style.background = IO.readOnly ? 'var(--pending)' : (!IO.mapFile ? 'var(--border)' : (IO.saveTimer ? 'var(--note-border)' : 'var(--success)'));
    dot.title = (IO.readOnly ? `未知 schema version ${IO.sourceVersion}，只读浏览` : (!IO.mapFile ? '未选择项目，改动不会保存' : (IO.saveTimer ? '保存中…' : '已保存'))) + agentActivityLine();
  }
  syncProjectPill();
  const activeNodes = S.nodes.filter(n => !n.archived && !n.shelved).length;
  const hintLevel = activeNodes >= 30 ? 30 : activeNodes >= 20 ? 20 : 0;
  if (hintLevel > curationHintLevel && !IO.readOnly){
    curationHintLevel = hintLevel;
    toast(hintLevel === 30 ? '活跃节点已达 30 个，请打开「整理地图」后再继续扩张' : '活跃节点已达 20 个，可打开「整理地图」查看整理建议');
  }
}
/* ---- IndexedDB:记住上次项目文件夹句柄 ---- */
function idbOpen(){ return new Promise((res, rej) => { const r = indexedDB.open('live-dot-map', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbSet(k, v){ const db = await idbOpen(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function idbGet(k){ const db = await idbOpen(); return new Promise((res, rej) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
/* ---- 文件夹连接与读写 ---- */
async function openProjectFolder(){
  if (!hasFS){ toast('当前浏览器不支持连接项目文件夹，请改用导入/导出。'); return; }
  try{
    const dir = await showDirectoryPicker({ mode:'readwrite' });
    await attachDir(dir);
    try{ await idbSet('dotmap-dir', dir); }catch{}
  }catch(e){
    if (e.name === 'AbortError') return;
    // File System Access 句柄失效(InvalidStateError/"state changed since read from disk")
    if (e.name === 'InvalidStateError' || e.name === 'SecurityError' || /state changed|permission|not allowed/i.test(e.message || ''))
      toast('项目文件夹已变化，请重新选择项目。');
    else { window.LiveDotBridge?.logError?.('project.open.failed', e); toast('打不开项目文件夹，请确认它还存在。'); }
  }
}
/* ---- 多地图布局（FS 直连模式，目录结构见 docs/map-json-v2.md） ---- */
const MAP_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;
function slugifyMapId(name){
  const base = String(name || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return base || 'map-' + Date.now().toString(36);
}
async function fsDirHandle(parent, name, create){
  try{ return await parent.getDirectoryHandle(name, { create:!!create }); }
  catch(e){ if (create) throw e; return null; }
}
async function fsFileHandle(dir, name, create){
  if (!dir) return null;
  try{ return await dir.getFileHandle(name, { create:!!create }); }
  catch(e){ if (create) throw e; return null; }
}
async function fsReadJson(fh){
  if (!fh) return null;
  try{ return JSON.parse(await (await fh.getFile()).text()); }catch{ return null; }
}
async function fsWriteJson(fh, value){
  const w = await fh.createWritable();
  await w.write(JSON.stringify(value, null, 2));
  await w.close();
}
/* active-map 指针：缺/非法时回退 default（与桥端 resolveActiveMap 一致） */
async function fsReadActiveMap(dir){
  const v = await fsReadJson(await fsFileHandle(await fsDirHandle(dir, '.live-dot-map'), 'active-map'));
  const id = v && typeof v.activeMap === 'string' ? v.activeMap : '';
  return MAP_ID_RE.test(id) ? id : 'default';
}
async function fsWriteActiveMap(dir, mapId){
  const data = await fsDirHandle(dir, '.live-dot-map', true);
  await fsWriteJson(await fsFileHandle(data, 'active-map', true), { activeMap: mapId, updatedAt: new Date().toISOString() });
}
async function fsMapFileHandle(dir, mapId){
  if (!MAP_ID_RE.test(mapId)) return null;
  const md = await fsDirHandle(await fsDirHandle(await fsDirHandle(dir, '.live-dot-map'), 'maps'), mapId);
  return md ? await fsFileHandle(md, 'map.json') : null;
}
async function fsListMaps(dir){
  const mapsDir = await fsDirHandle(await fsDirHandle(dir, '.live-dot-map'), 'maps');
  if (!mapsDir) return { activeMap: IO.mapId || 'default', maps: [] };
  const active = await fsReadActiveMap(dir);
  const maps = [];
  for await (const [id, handle] of mapsDir.entries()){
    if (handle.kind !== 'directory' || !MAP_ID_RE.test(id)) continue;
    const doc = await fsReadJson(await fsFileHandle(handle, 'map.json'));
    if (!doc) continue;
    maps.push({ id, name: doc.name || id, updatedAt: doc.updatedAt || '', active: id === active });
  }
  return { activeMap: active, maps };
}