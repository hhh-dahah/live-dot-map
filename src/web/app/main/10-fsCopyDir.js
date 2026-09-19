async function fsCopyDir(src, dst){
  for await (const [name, handle] of src.entries()){
    if (handle.kind === 'directory'){
      await fsCopyDir(handle, await dst.getDirectoryHandle(name, { create:true }));
    } else {
      const w = await (await dst.getFileHandle(name, { create:true })).createWritable();
      await w.write(await (await handle.getFile()).arrayBuffer());
      await w.close();
    }
  }
}
/* 老布局(.live-dot-map/map.json + nodes/ + routes/)复制式迁移到 maps/default/；
   旧文件原地保留作为现场备份，与桥端 migrateLegacyLayout 的语义对应。 */
async function fsEnsureMapsLayout(dir){
  const data = await fsDirHandle(dir, '.live-dot-map', true);
  if (await fsDirHandle(data, 'maps')) return;
  const legacy = await fsReadJson(await fsFileHandle(data, 'map.json'));
  if (!legacy) return; // 全新项目：由调用方按需创建 maps/<id>/
  const mapDir = '.live-dot-map/maps/default';
  const rewriteMd = (m) => typeof m === 'string' && m.startsWith('.live-dot-map/') ? mapDir + m.slice('.live-dot-map'.length) : m;
  const doc = { ...legacy, mapDir };
  if (Array.isArray(legacy.nodes)) doc.nodes = legacy.nodes.map(n => ({ ...n, md: rewriteMd(n.md) }));
  if (Array.isArray(legacy.edges)) doc.edges = legacy.edges.map(e => ({ ...e, md: rewriteMd(e.md) }));
  const def = await (await data.getDirectoryHandle('maps', { create:true })).getDirectoryHandle('default', { create:true });
  await fsWriteJson(await def.getFileHandle('map.json', { create:true }), doc);
  for (const sub of ['nodes', 'routes']){
    const src = await fsDirHandle(data, sub);
    if (src) await fsCopyDir(src, await def.getDirectoryHandle(sub, { create:true }));
  }
  await fsWriteActiveMap(dir, 'default');
  toast('已把旧版单地图升级为多地图布局（原文件已保留）');
}
/* 新建一张地图：maps/<id>/map.json + 指针切换；id 撞名时追加 -2/-3 */
async function fsCreateMap(dir, name){
  await fsEnsureMapsLayout(dir);
  const mapsDir = await (await dir.getDirectoryHandle('.live-dot-map')).getDirectoryHandle('maps', { create:true });
  const base = slugifyMapId(name);
  let id = base, n = 2;
  while (await fsDirHandle(mapsDir, id)) id = `${base}-${n++}`;
  const md = await mapsDir.getDirectoryHandle(id, { create:true });
  const fh = await md.getFileHandle('map.json', { create:true });
  await fsWriteActiveMap(dir, id);
  return { id, mapDir: `.live-dot-map/maps/${id}`, fh };
}
/* 切换到当前项目里的另一张地图（地图弹层点击） */
async function switchMapById(id){
  const bridge = window.LiveDotBridge;
  if (bridge?.active && typeof bridge.switchMap === 'function'){
    try{ await bridge.switchMap(id); }
    catch(e){ toast('切换地图失败：' + (e && e.message ? e.message : String(e)), true); }
    return;
  }
  if (!IO.dir) return;
  try{
    const fh = await fsMapFileHandle(IO.dir, id);
    if (!fh) throw new Error('找不到这张地图的文件');
    IO.mapFile = fh; IO.mapId = id;
    await fsWriteActiveMap(IO.dir, id);
    await readMap(); syncBadge();
    toast('已切换地图');
  }catch(e){ toast('切换地图失败：' + (e && e.message ? e.message : String(e)), true); }
}
async function attachDir(dir){
  IO.dir = dir;
  let fh = null, mapId = 'default';
  if (await fsDirHandle(dir, '.live-dot-map')){
    // 统一升级为多地图布局（老布局复制式迁移，原文件保留）
    try{ await fsEnsureMapsLayout(dir); }
    catch(e){ window.LiveDotBridge?.logError?.('maps.migrate.failed', e); }
    mapId = await fsReadActiveMap(dir);
    fh = await fsMapFileHandle(dir, mapId);
    if (!fh){
      // 指针指向的地图缺失：回退 default；再没有就现场建一张
      mapId = 'default';
      fh = await fsMapFileHandle(dir, mapId);
      if (!fh){
        const created = await fsCreateMap(dir, '未命名地图');
        mapId = created.id; fh = created.fh;
      }
    }
  } else {
    try{ fh = await dir.getFileHandle('map.json'); }  // 兼容旧版:根目录 map.json
    catch{
      if (confirm(`文件夹「${dir.name}」还不是活点地图项目，要在里面创建地图吗？`)){
        const created = await fsCreateMap(dir, '未命名地图');
        mapId = created.id; fh = created.fh;
        IO.mapId = mapId; IO.mapFile = fh; IO.sourceDocument = null; IO.sourceVersion = null; IO.readOnly = false;
        resetBlankState();
        await writeMapNow(); startWatch(); syncBadge();
        toast('已创建地图并切换到项目：' + dir.name);
      }
      return;
    }
  }
  IO.mapId = mapId; IO.mapFile = fh;
  await readMap(); startWatch(); syncBadge();
  toast('已切换到项目：' + dir.name);
}
async function readMap(){
  const f = await IO.mapFile.getFile();
  const text = await f.text();
  let d; try{ d = JSON.parse(text); }catch(e){ window.LiveDotBridge?.logError?.('map.parse.failed', e); toast('地图文件损坏，无法读取。画布保持原样。'); return; }
  let prepared; try{ prepared = acceptMapDocument(d, 'filesystem'); }catch(e){ window.LiveDotBridge?.logError?.('map.accept.failed', e); toast(/[一-龥]/.test(e?.message || '') ? '地图文件无法安全加载：' + e.message : '地图文件无法安全加载，请检查文件内容。'); return false; }
  IO.lastMod = f.lastModified;
  if (prepared.migrated) toast('旧版地图已兼容读取，保存时会升级为新版格式。');
  else if (prepared.readOnly) toast(`schema version ${prepared.sourceVersion} 已只读打开`);
  return true;
}
/* Chromium 的 createWritable 先写交换文件、close 才替换原文件,天然原子 */
async function writeMapNow(){
  if (!IO.mapFile) return;
  if (IO.readOnly){ warnReadOnly(); return; }
  const document = serializeForSave();
  const w = await IO.mapFile.createWritable();
  await w.write(JSON.stringify(document, null, 2));
  await w.close();
  IO.sourceDocument = JSON.parse(JSON.stringify(document)); IO.sourceVersion = document.version;
  IO.lastWrite = Date.now();
  IO.lastMod = (await IO.mapFile.getFile()).lastModified;
  IO.saveTimer = null; syncBadge();
}
/* 任何编辑后防抖落盘(pushHistory 调用) */
function scheduleSave(){
  if (IO.silent) return;
  if (IO.readOnly){ warnReadOnly(); queueReadOnlyRestore(); return; }
  if (!IO.mapFile){
    // 演示模式:首次编辑提醒改动不落盘,连文件夹或导出才能保存
    if (!IO.demoHinted){ IO.demoHinted = true; toast('未选择项目：改动只留在本页，选择项目后才会保存。'); }
    syncBadge(); return;
  }
  clearTimeout(IO.saveTimer);
  IO.saveTimer = setTimeout(() => { writeMapNow().catch(e => { IO.saveTimer = null; syncBadge(); window.LiveDotBridge?.logError?.('fs.save.failed', e); toast('保存失败：项目文件夹可能被移动或权限被收回，请重试。'); }); }, 800);
  syncBadge();
}
/* 轮询:外部(Agent)改 map.json 后自动重载;有自己未落盘修改时跳过 */
function startWatch(){
  if (IO.watching) return; IO.watching = true;
  setInterval(async () => {
    if (!IO.mapFile || IO.saveTimer) return;
    try{
      const f = await IO.mapFile.getFile();
      if (f.lastModified !== IO.lastMod && Date.now() - IO.lastWrite > 1500){
        if (await readMap()) toast('已同步外部改动');
      }
    }catch{ /* 文件被占用等,下轮再试 */ }
  }, 2000);
}
/* ---- 非 Chromium 降级:导入/导出 map.json ---- */
function exportMap(){
  let mapDocument;
  try{ mapDocument = serializeForSave(); }catch(e){ window.LiveDotBridge?.logError?.('export.failed', e); toast('导出失败，请重试。'); return; }
  const blob = new Blob([JSON.stringify(mapDocument, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'map.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  if (!IO.readOnly){ IO.sourceDocument = JSON.parse(JSON.stringify(mapDocument)); IO.sourceVersion = mapDocument.version; }
  toast(IO.readOnly ? '已原样导出只读 map.json' : '已导出 map.json');
}
function importMap(){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try{
      const d = JSON.parse(await f.text());
      const prepared = acceptMapDocument(d);
      toast(prepared.readOnly ? '已导入，但这个文件版本太新，只能看不能改' : (prepared.migrated ? '已导入旧版地图，已自动升级' : '已导入'));
    }catch(e){ window.LiveDotBridge?.logError?.('import.failed', e); toast('导入失败：文件不是有效的地图 JSON。'); }
  };
  inp.click();
}
/* ---- 记忆包(.zip)：整图导出 / 拖入或选择导入为「新地图」（一期不并入当前图，零覆盖风险） ---- */
function packSafeName(name){ return String(name || '未命名地图').replace(/[\\/:*?"<>|]/g, '-').slice(0, 60); }
function packMimeOf(name){
  const ext = String(name || '').split('.').pop().toLowerCase();
  const map = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', bmp:'image/bmp', svg:'image/svg+xml', mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime', mp3:'audio/mpeg', wav:'audio/wav', pdf:'application/pdf', zip:'application/zip', json:'application/json', txt:'text/plain' };
  return map[ext] || 'application/octet-stream';
}
/* 导出记忆包前的大文件选择：默认不勾(占位导出)，可逐个勾选或一键全量打包；返回 Set<packPath>，取消返回 null */
function pickBigFilesDialog(bigFiles, ownerName){
  return new Promise(resolve => {
    const ov = document.createElement('div'); ov.className = 'ld-dialog-ov';
    const card = document.createElement('div'); card.className = 'ld-dialog';
    card.style.width = 'min(520px, 94vw)';
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', '检测到大文件');
    const h = document.createElement('div'); h.className = 'ld-dialog-title'; h.textContent = `检测到 ${bigFiles.length} 个大文件`;
    const tip = document.createElement('div'); tip.className = 'ld-dialog-body';
    tip.textContent = '勾选的文件会完整打进记忆包；不勾选的以占位说明导出（导入端能看到文件名和大小，但不含内容）。';
    const list = document.createElement('div');
    list.style.cssText = 'margin-top:10px;max-height:40vh;overflow:auto;display:flex;flex-direction:column;gap:6px';
    const boxes = bigFiles.map(item => {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;line-height:1.5;cursor:pointer';
      const cb = document.createElement('input'); cb.type = 'checkbox';
      const text = document.createElement('span');
      const mb = (Number(item.entry.size) / 1048576).toFixed(1);
      text.textContent = `${ownerName(item.ownerKind, item.ownerId)} / ${item.name}（${mb} MB）`;
      label.append(cb, text); list.appendChild(label);
      return { cb, item };
    });
    const actions = document.createElement('div'); actions.className = 'ld-dialog-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'mdv-btn'; cancel.textContent = '取消';
    const all = document.createElement('button'); all.type = 'button'; all.className = 'mdv-btn'; all.textContent = '全部打包导出';
    const pick = document.createElement('button'); pick.type = 'button'; pick.className = 'ld-dialog-primary'; pick.textContent = '按选择导出';
    const done = v => { ov.remove(); resolve(v); };
    cancel.addEventListener('click', () => done(null));
    all.addEventListener('click', () => done(new Set(bigFiles.map(x => x.packPath))));
    pick.addEventListener('click', () => done(new Set(boxes.filter(x => x.cb.checked).map(x => x.item.packPath))));
    ov.addEventListener('pointerdown', e => { if (e.target === ov) done(null); });
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); });
    actions.append(cancel, all, pick); card.append(h, tip, list, actions); ov.appendChild(card);
    document.body.appendChild(ov); pick.focus();
  });
}
async function exportMemoryPack(){
  const bridge = window.LiveDotBridge, packApi = window.LiveDotMemoryPack;
  if (!packApi){ toast('记忆包组件未加载，请刷新页面重试。'); return; }
  if (!bridge?.active){ toast('导出记忆包需要本地桥连接；可改用「仅导出拓扑 (.json)」。'); return; }
  let mapDocument;
  try{ mapDocument = serializeForSave(); }catch(e){ bridge.logError?.('pack.export.failed', e); toast('导出失败，请重试。'); return; }
  const ownerName = (kind, id) => {
    const list = kind === 'node' ? S.nodes : S.routes;
    return String((list.find(x => String(x.id) === id) || {}).name || id);
  };
  // 第一阶段：只读清单扫描（不下载字节），筛出大文件
  const scanned = [], bigFiles = [];
  const owners = [
    ...S.nodes.map(n => ['node', String(n.id)]),
    ...S.routes.map(r => ['route', String(r.id)]),
  ];
  for (const [ownerKind, ownerId] of owners){
    let entries = [];
    try{ entries = await bridge.listBundleFiles(ownerKind, ownerId, false); }catch{ continue; }
    for (const entry of entries){
      const name = String(entry.fileName || entry.name || '');
      if (!name || entry.archived) continue; // 归档冷数据不进共享包
      const item = { ownerKind, ownerId, entry, name, packPath: `${ownerKind === 'node' ? 'nodes' : 'routes'}/${ownerId}/${name}` };
      scanned.push(item);
      if (!/\.md$/i.test(name) && Number(entry.size) > packApi.MAX_PACK_ASSET_BYTES) bigFiles.push(item);
    }
  }
  // 有大文件时逐个选择：勾选=完整打包，不勾=占位 stub；也可一键全量
  let includeBig = new Set();
  if (bigFiles.length){
    const choice = await pickBigFilesDialog(bigFiles, ownerName);
    if (choice === null) return; // 用户取消
    includeBig = choice;
  }
  toast('正在打包记忆包…');
  try{
    const files = [];
    for (const { ownerKind, ownerId, entry, name, packPath } of scanned){
      if (/\.md$/i.test(name)){
        const md = await bridge.readBundleMarkdown(ownerKind, ownerId, name);
        files.push({ path: packPath, data: new TextEncoder().encode(String(md.content ?? '')) });
      } else if (Number(entry.size) > packApi.MAX_PACK_ASSET_BYTES && !includeBig.has(packPath)){
        // 未选中的大文件不读入内存也不进包，只写占位 stub
        files.push({ path: packPath, stub: true, sizeBytes: Number(entry.size) });
      } else {
        const resp = await fetch(bridge.assetReadUrl(ownerKind, ownerId, name), { credentials: 'include' });
        if (!resp.ok) throw new Error(`读取附件失败：${name}`);
        // 用户在导出对话框显式勾选/全量打包的大文件：标记 forceInclude，打包层不再降级为 stub
        files.push({ path: packPath, data: new Uint8Array(await resp.arrayBuffer()), forceInclude: Number(entry.size) > packApi.MAX_PACK_ASSET_BYTES });
      }
    }
    const { zip, manifest } = await packApi.buildMemoryPack({ document: mapDocument, files });
    const blob = new Blob([zip], { type: 'application/zip' });
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.href = URL.createObjectURL(blob);
    a.download = `${packSafeName(S.name)}-记忆包-${stamp}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(manifest.stubs.length ? `已导出记忆包（${manifest.stubs.length} 个大文件以占位形式导出）` : '已导出记忆包');
  }catch(e){ bridge.logError?.('pack.export.failed', e); toast('导出记忆包失败，请重试。'); }
}