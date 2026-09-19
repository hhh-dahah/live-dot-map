function openArchiveDialog(){
  return openSettingsSpace('archive');
}
/* ---------- 项目 / 地图 弹层(带搜索) ---------- */
const popover = $('#popover');
let popoverKind = '';
function closePopover(){ popover.classList.remove('on'); popoverKind = ''; }
function placePopover(anchor, heightGuess){
  const r = anchor.getBoundingClientRect();
  popover.style.left = Math.max(8, Math.min(r.left, innerWidth - 296)) + 'px';
  popover.style.top = Math.min(r.bottom + 6, innerHeight - heightGuess - 8) + 'px';
}
/* 当前项目根路径(桥模式)或文件夹句柄名(直连模式) */
function currentProjectRoot(){
  if (window.LiveDotBridge?.active){
    return new URLSearchParams(location.search).get('project') || sessionStorage.getItem('live-dot-map-project') || '';
  }
  return IO.dir?.name || '';
}
function currentProjectName(){
  const root = currentProjectRoot();
  return root ? (root.split(/[\\/]/).filter(Boolean).pop() || root) : '';
}
function syncProjectPill(){
  const el = $('#proj-folder-name'); if (!el) return;
  const name = currentProjectName();
  el.textContent = name || '未选择项目';
  el.classList.toggle('empty', !name);
  el.title = currentProjectRoot() || '未选择项目';
}
function popoverItem(label, sub, fn){
  const b = document.createElement('button'); b.className = 'pitem';
  const a = document.createElement('span'); a.className = 'pa'; a.textContent = label; b.appendChild(a);
  if (sub){ const p = document.createElement('span'); p.className = 'pb'; p.textContent = sub; b.appendChild(p); }
  if (fn) b.onclick = () => { closePopover(); fn(); };
  return b;
}
function openCompactNavMenu(x, y){
  const folderName = $('#proj-folder-name')?.textContent || '项目文件夹';
  const mapName = $('#proj-name')?.textContent || '地图';
  openMenu([
    {head:'项目与导航'},
    {id:'nav-proj', icon:I.folder || '📁', label:`项目: ${folderName}`, fn(){ void openProjectPopover(); }},
    {id:'nav-map', icon:I.route || '🗺️', label:`地图: ${mapName}`, fn(){ void openMapPopover(); }},
    {sep:true},
    {id:'nav-settings', icon:I.gear || '⚙️', label:'设置中心', fn(){ void openSettingsSpace('archive'); }},
    {id:'nav-tidy', icon:I.tidy || '🧹', label:'整理地图', fn(){ openCurationDialog(); }},
    {id:'nav-guide', icon:'？', label:'新手引导', fn(){ showGuide(true); }}
  ], x, y);
}
$('#proj-btn').onclick = ev => {
  ev.stopPropagation();
  closeMenu();
  if (document.documentElement.classList.contains('narrow-dock') || window.innerWidth < 680){
    const rect = $('#project-pill').getBoundingClientRect();
    openCompactNavMenu(rect.left, rect.bottom + 6);
    return;
  }
  void openProjectPopover();
};
async function openProjectPopover(){
  if (popover.classList.contains('on') && popoverKind === 'project'){ closePopover(); return; }
  popoverKind = 'project';
  popover.innerHTML = '<input class="pop-search" id="pop-search" placeholder="搜索项目" autocomplete="off"><div class="plist" id="pop-list"></div>';
  popover.classList.add('on');
  placePopover($('#proj-btn'), 340);
  $('#pop-search').focus();
  const bridge = window.LiveDotBridge;
  let recent = [];
  if (bridge?.active && typeof bridge.recentProjects === 'function'){
    try { recent = await bridge.recentProjects(); } catch { recent = []; }
  }
  const currentRoot = currentProjectRoot();
  const listEl = $('#pop-list');
  const renderList = (filter) => {
    const q = filter.trim().toLowerCase();
    const items = q ? recent.filter(r => r.toLowerCase().includes(q)) : recent;
    listEl.textContent = '';
    if (items.length){
      const head = document.createElement('div'); head.className = 'phead'; head.textContent = '最近项目';
      listEl.appendChild(head);
      for (const root of items){
        const b = popoverItem(root.split(/[\\/]/).filter(Boolean).pop() || root, root, null);
        if (root === currentRoot) b.classList.add('cur');
        b.onclick = () => { closePopover(); if (root !== currentRoot) void switchProjectFlow(root); };
        listEl.appendChild(b);
      }
    } else if (q){
      const em = document.createElement('div'); em.className = 'pempty'; em.textContent = '没有匹配的项目';
      listEl.appendChild(em);
    }
    const sep = document.createElement('div'); sep.className = 'psep'; listEl.appendChild(sep);
    listEl.appendChild(popoverItem(
      bridge?.active ? '选择其他项目…' : '选择项目文件夹…', '',
      () => {
        if (bridge?.active) void pickProjectFlow();
        else if (hasFS) openProjectFolder();
        else toast('连接项目需要 Chrome 或 Edge；也可以导出 map.json 交给 Agent。');
      }));
  };
  renderList('');
  $('#pop-search').oninput = ev => renderList(ev.target.value);
}
$('#map-btn').onclick = ev => { ev.stopPropagation(); closeMenu(); void openMapPopover(); };
/* 地图弹层：当前项目的地图列表（名称+更新时间+当前标记）+ 新建/重命名/导入/导出 */
async function openMapPopover(){
  if (popover.classList.contains('on') && popoverKind === 'map'){ closePopover(); return; }
  popoverKind = 'map';
  popover.innerHTML = '';
  const list = document.createElement('div'); list.className = 'plist';
  const head = document.createElement('div'); head.className = 'phead'; head.textContent = '当前项目的地图';
  list.appendChild(head);
  popover.appendChild(list);
  popover.classList.add('on');
  placePopover($('#map-btn'), 320);
  const bridge = window.LiveDotBridge;
  let maps = [], activeMap = '';
  try{
    if (bridge?.active && typeof bridge.listMaps === 'function'){
      ({ maps, activeMap } = await bridge.listMaps());
    } else if (IO.dir){
      ({ maps, activeMap } = await fsListMaps(IO.dir));
    }
  }catch{ maps = []; }
  if (popoverKind !== 'map') return; // 等待期间弹层已被关闭/替换
  if (maps.length){
    for (const m of maps){
      const b = popoverItem(m.name || m.id, m.updatedAt ? `更新于 ${String(m.updatedAt).slice(0, 10)}` : '', null);
      if (m.id === activeMap) b.classList.add('cur');
      b.onclick = () => { closePopover(); if (m.id !== activeMap) void switchMapById(m.id); };
      list.appendChild(b);
    }
  } else {
    const cur = popoverItem(S.name || '未命名地图', '', null);
    cur.classList.add('cur'); cur.style.cursor = 'default';
    list.appendChild(cur);
  }
  const sep = document.createElement('div'); sep.className = 'psep'; list.appendChild(sep);
  list.appendChild(popoverItem('新建地图', '', () => void newBlankMap()));
  list.appendChild(popoverItem('重命名地图…', '', () => renameMap()));
  list.appendChild(popoverItem('导出记忆包 (.zip)', '含文档与附件', () => void exportMemoryPack()));
  list.appendChild(popoverItem('仅导出拓扑 (.json)', 'Ctrl+S', () => exportMap()));
  list.appendChild(popoverItem('导入地图 (.zip / .json)…', '', () => importMapAny()));
}
async function pickProjectFlow(){
  if (!window.LiveDotBridge?.active) return;
  try {
    const result = await window.LiveDotBridge.pickProject();
    toast(result ? '已切换到所选项目' : '已取消');
    if (result) syncProjectPill();
  } catch (error) {
    toast('切换失败：' + projectSwitchErrorText(error));
  }
}
async function switchProjectFlow(root){
  try {
    await window.LiveDotBridge.switchProject(root);
    toast('已切换到 ' + (root.split(/[\\/]/).filter(Boolean).pop() || root));
    syncProjectPill();
  } catch (error) {
    toast('切换失败：' + projectSwitchErrorText(error));
  }
}
/* 项目切换报错展开桥的 details（原因 + 隔离路径），便于排错 */
function projectSwitchErrorText(error){
  const base = error?.message || '未知错误';
  const details = error?.details;
  const extra = [];
  if (details?.causeMessage) extra.push('原因：' + details.causeMessage);
  if (details?.quarantinePath) extra.push('损坏文件已隔离：' + details.quarantinePath);
  return extra.length ? `${base}（${extra.join('；')}）` : base;
}

/* ---------- 画布交互:平移 / 缩放 / 拖拽 / 框选 / 拉出方案线 ---------- */
let drag = null, spaceDown = false;
const marqueeEl = $('#marquee'), delFloat = $('#del-float'), crosshairEl = $('#crosshair');
/* 指针移出窗口时隐藏自绘准星 */
addEventListener('pointerout', ev => { if (!ev.relatedTarget) crosshairEl.hidden = true; });
delFloat.innerHTML = I.trash;
/* 二次贝塞尔取点:弯折命中检测用 */
function bezPt(t, g){ const it = 1-t;
  return { x: it*it*g.x1 + 2*it*t*g.cpx + t*t*g.x2, y: it*it*g.y1 + 2*it*t*g.cpy + t*t*g.y2 }; }
function clearMulti(){ S.multi = []; delFloat.classList.remove('on'); }
viewport.addEventListener('pointerdown', ev => {
  closeMenu();
  if (ev.button !== 0 && ev.button !== 1) return;
  if (ev.target.closest('.chrome,#panel,#popover,.menu')) return;
  if (ev.target.closest('.inline-edit')) return; // 点击行内输入框不触发画布交互
  // 手掌工具:拖任何位置都是平移(Excalidraw 式),对象不可拖
  if (S.tool === 'hand'){
    drag = { type:'pan', sx:ev.clientX, sy:ev.clientY, ox:S.view.x, oy:S.view.y };
    viewport.classList.add('panning');
    return;
  }
  // 空格/中键:任何工具模式下都优先平移
  if (spaceDown || ev.button === 1){
    drag = { type:'pan', sx:ev.clientX, sy:ev.clientY, ox:S.view.x, oy:S.view.y };
    viewport.classList.add('panning');
    return;
  }
  const nodeEl = ev.target.closest('.node');
  const edgeEl = ev.target.closest('[data-edge]');
  const annEl = ev.target.closest('.ann');
  const w = toWorld(ev.clientX, ev.clientY);

  if (S.tool === 'node' && !nodeEl){ pushHistory(); addNodeAt(w.x, w.y); setTool('select'); return; }
  // 方案线工具:在节点上按住直接拉出,起点自动吸附该节点;终点松手时命中节点则吸附并变绿
  if (S.tool === 'edge'){
    if (nodeEl){
      pushHistory();
      const fromId = nodeEl.dataset.id, from = nodeById(fromId);
      // 方案名从起点节点自己的 1 开始数,区分靠内部编号
      const eName = `方案${S.edges.filter(o => o.from === fromId).length + 1}`;
      const e = { id:'e'+(S.nextEdge++), from:fromId, to:null, name:eName,
        status:'pending', route:from.route, md: mdPath('routes', `e${S.nextEdge-1}`) };
      S.edges.push(e);
      e.dx = w.x - from.x; e.dy = w.y - from.y; // 方向跟随指针:拖拽时自由自定义
      S.drawingEdge = e.id; S.sel = {kind:'edge', id:e.id}; S.selAnn = null; clearMulti();
      // 新建边拉出中保持直线,不用前段锚点算法(锚点仅用于已存在边重布线)
      drag = { type:'end', e, moved:false, sx:ev.clientX, sy:ev.clientY };
      render(); renderPanel();
    }
    return;
  }
  if (S.tool === 'ann'){
    if (nodeEl) addAnnotation('node', nodeEl.dataset.id);
    else if (edgeEl) addAnnotation('edge', edgeEl.dataset.edge);
    else addAnnotation('canvas', null, w);
    setTool('select'); return;
  }

  // 方案线手柄优先:悬空端点 / 弯曲控制点(手柄本身也带 data-edge,必须先判断)
  const handleEl = ev.target.closest('[data-handle]');
  if (handleEl){
    const e = edgeById(handleEl.dataset.edge);
    if (e){
      const t = handleEl.dataset.handle === 'bend' ? .5 : 0; // 弯曲手柄在曲线中点
      // 拖动已连接端点即重新布线:先脱钩悬空变灰,拖到别的节点松手则吸附变绿
      if (handleEl.dataset.handle === 'end' && e.to){
        const a = nodeById(e.from), b = nodeById(e.to);
        e.dx = b.x - a.x; e.dy = b.y - a.y; e.to = null;
        e.status = 'pending';
        drag = { type:'end', e, t, moved:false, sx:ev.clientX, sy:ev.clientY, wasConnected:true, anchor: bezPt(.25, edgeCurve(e)) };
      } else {
        drag = { type:handleEl.dataset.handle, e, t, moved:false, sx:ev.clientX, sy:ev.clientY };
        if (handleEl.dataset.handle === 'end') drag.anchor = bezPt(.25, edgeCurve(e));
      }
    }
    return;
  }
  // 便签:选中态紫色;已选中再点直接行内编辑;拖动微调位置
  if (annEl){
    const a = S.anns.find(x => x.id === annEl.dataset.ann);
    if (a){
      drag = { type:'ann', a, moved:false, sx:ev.clientX, sy:ev.clientY, odx:a.dx||0, ody:a.dy||0,
        wasSel: S.selAnn === a.id };
      return;
    }
  }
  if (nodeEl){
    const n = nodeById(nodeEl.dataset.id);
    drag = { type:'node', n, moved:false, sx:ev.clientX, sy:ev.clientY, ox:n.x, oy:n.y };
  } else if (edgeEl){
    // 选中后可直接按住线身弯折:抓取点固定在指针下,其余部分随之变形(Excalidraw 式)
    const eid = edgeEl.dataset.edge, e = edgeById(eid);
    if (!(S.sel && S.sel.kind === 'edge' && S.sel.id === eid)) select('edge', eid);
    if (e){
      let t = .5, bd = 1e9; const g = edgeCurve(e);
      for (let tt = .05; tt < .951; tt += .05){
        const p = bezPt(tt, g), dd = Math.hypot(p.x-w.x, p.y-w.y);
        if (dd < bd){ bd = dd; t = tt; }
      }
      drag = { type:'bend', e, t, moved:false, sx:ev.clientX, sy:ev.clientY };
    }
  } else if (ev.button === 1 || spaceDown){
    drag = { type:'pan', sx:ev.clientX, sy:ev.clientY, ox:S.view.x, oy:S.view.y };
    viewport.classList.add('panning');
  } else {
    // 空白处拖拽 = 紫色框选(Excalidraw 式);平移用滚轮/中键/空格
    S.sel = null; S.selAnn = null; clearMulti(); renderPanel(); render();
    drag = { type:'marquee', sx:ev.clientX, sy:ev.clientY };
    marqueeEl.style.display = 'block';
  }
});