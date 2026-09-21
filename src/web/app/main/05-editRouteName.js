function editRouteName(r, labelEl){
  inlineRouteEdit = r.id;
  popInlineEdit(labelEl.getBoundingClientRect(), r.name, v => {
    inlineRouteEdit = null;
    if (v && v !== r.name){ pushHistory(); r.name = v; }
    render(); renderPanel();
  });
}
/* 方案名双击行内编辑:在标签位置弹输入框,Enter 保存 */
function editEdgeName(e, textEl){
  const r = textEl.getBoundingClientRect();
  const input = document.createElement('input');
  input.className = 'inline-edit'; input.value = e.name;
  input.style.position = 'fixed';
  input.style.left = (r.left + r.width/2) + 'px'; input.style.top = (r.top + r.height/2) + 'px';
  input.style.transform = 'translate(-50%,-50%)';
  input.style.width = Math.max(120, r.width + 40) + 'px'; input.style.zIndex = 60;
  document.body.appendChild(input); input.focus(); input.select();
  inlineEdgeEdit = e.id;
  let finished = false;
  const commit = () => {
    if (finished) return; finished = true;
    inlineEdgeEdit = null;
    const v = input.value.trim();
    if (input.isConnected) input.remove(); // render() 不清理输入框,必须自己移除
    if (v && v !== e.name){ pushHistory(); e.name = v; e.md ||= mdPath('routes', e.id); }
    render(); renderPanel();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', ev => {
    if (ev.isComposing || ev.keyCode === 229) return; // 中文输入法组词中不拦截按键
    if (ev.key === 'Enter') commit();
    if (ev.key === 'Escape'){ input.value = e.name; commit(); }
  });
}
function inlineEdit(el, initial, done){
  const input = document.createElement('input');
  input.className = 'inline-edit'; input.value = initial;
  input.style.width = Math.max(120, el.offsetWidth + 24) + 'px';
  el.replaceWith(input); input.focus(); input.select();
  let finished = false;
  const commit = () => {
    if (finished) return; finished = true;
    const v = input.value.trim();
    if (input.isConnected) input.replaceWith(el);
    done(v);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', ev => {
    if (ev.isComposing || ev.keyCode === 229) return; // 中文输入法组词中不拦截按键
    if (ev.key === 'Enter') commit();
    if (ev.key === 'Escape'){ input.value = initial; commit(); }
  });
}
/* 便签行内编辑:点击已选中的便签直接在原位置改字 */
function editAnn(a){
  const el = document.querySelector(`.ann[data-ann="${a.id}"]`); if (!el) return;
  const input = document.createElement('input');
  input.className = 'inline-edit'; input.value = a.text;
  input.style.position = 'absolute'; input.style.left = el.style.left; input.style.top = el.style.top;
  input.style.width = Math.max(120, el.offsetWidth + 24) + 'px'; input.style.zIndex = 5;
  el.replaceWith(input); input.focus(); input.select();
  inlineEditing = { annId: a.id, input };
  let finished = false;
  const commit = () => {
    if (finished) return; finished = true;
    inlineEditing = null;
    const v = input.value.trim();
    if (input.isConnected) input.remove(); // render() 不清理输入框,必须自己移除
    if (v && v !== a.text){ pushHistory(); a.text = v; }
    render(); renderPanel();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', ev => {
    if (ev.isComposing || ev.keyCode === 229) return; // 中文输入法组词中不拦截按键
    if (ev.key === 'Enter') commit();
    if (ev.key === 'Escape'){ input.value = a.text; commit(); }
  });
}
/* ---------- 面板事件 ---------- */
$('#panel-close').onclick = () => select(null);
/* ---------- 右侧 dock:宽度记忆 / 左缘拖拽 / 收起为细边条 ---------- */
const dockStore = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v === null ? d : v; }catch{ return d; } },
  set(k, v){ try{ localStorage.setItem(k, v); }catch{ /* 隐私模式 */ } }
};
function clampDockWidths(){
  const el = $('#panel');
  const maxNormal = Math.max(96, window.innerWidth - 48);
  const maxEditing = Math.max(160, window.innerWidth - 56);
  let w = parseInt(dockStore.get('dock-w', ''), 10);
  if (w && w > maxNormal) { w = maxNormal; el.style.setProperty('--dockw', w + 'px'); }
  let we = parseInt(dockStore.get('dock-we', ''), 10);
  if (we && we > maxEditing) { we = maxEditing; el.style.setProperty('--dockwe', we + 'px'); }
}
function applyDockWidth(px){
  const el = $('#panel'); const editing = el.classList.contains('editing');
  // 节点详情面板可砍半缩至 96px; 编辑器面板最小下探至 160px
  const min = editing ? Math.min(160, Math.round(window.innerWidth * 0.4)) : 96;
  // 严格确保左侧至少保留 48px~56px 地图可视区，手柄永不跑出屏幕
  const max = Math.max(min, Math.round(window.innerWidth - (editing ? 56 : 48)));
  const w = Math.max(min, Math.min(max, Math.round(px)));
  el.style.setProperty(editing ? '--dockwe' : '--dockw', w + 'px');
  dockStore.set(editing ? 'dock-we' : 'dock-w', String(w));
  updateDockSpace();
}
function dockCollapse(){ $('#panel').classList.add('rail'); dockStore.set('dock-rail', '1'); updateDockSpace(); }
function dockExpand(){ $('#panel').classList.remove('rail'); dockStore.set('dock-rail', '0'); updateDockSpace(); }
/* dock 显示时顶栏工具条在「地图可见区」居中,避免盖住 dock 顶栏 */
function updateDockSpace(){
  const el = $('#panel');
  clampDockWidths();
  const shown = el.classList.contains('on') && !el.classList.contains('rail');
  const w = shown ? Math.round(el.getBoundingClientRect().width) : 0;
  document.documentElement.style.setProperty('--dockspace', w + 'px');
  const visibleW = window.innerWidth - w;
  document.documentElement.classList.toggle('narrow-dock', visibleW < 560);
  document.documentElement.classList.toggle('tiny-dock', visibleW < 380);
}
window.addEventListener('resize', updateDockSpace);
{
  const el = $('#panel');
  const w = parseInt(dockStore.get('dock-w', ''), 10); if (w) el.style.setProperty('--dockw', Math.min(w, window.innerWidth - 48) + 'px');
  const we = parseInt(dockStore.get('dock-we', ''), 10); if (we) el.style.setProperty('--dockwe', Math.min(we, window.innerWidth - 56) + 'px');
  if (dockStore.get('dock-rail', '0') === '1') el.classList.add('rail');
  $('#panel-collapse')?.addEventListener('click', dockCollapse);
  $('#dock-expand').onclick = dockExpand;
  $('#dock-grip').addEventListener('pointerdown', e => {
    e.preventDefault();
    el.classList.add('dragging');
    const startX = e.clientX, startW = el.getBoundingClientRect().width;
    const move = ev => {
      const targetW = startW + (startX - ev.clientX);
      // 普通详情拖拽小于 65px 吸附折叠，编辑模式小于 90px 折叠
      const snapThreshold = el.classList.contains('editing') ? 90 : 65;
      if (targetW < snapThreshold){
        dockCollapse();
        return;
      }
      if (el.classList.contains('rail')) dockExpand();
      applyDockWidth(targetW);
    };
    const up = () => { el.classList.remove('dragging'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
  $('#dock-grip').addEventListener('dblclick', () => {
    if (el.classList.contains('rail')) dockExpand();
    else dockCollapse();
  });
}
$('#panel-body').addEventListener('click', ev => {
  const edit = ev.target.closest('[data-edit]');
  if (edit && edit.contentEditable !== 'true'){
    if (!S.sel) return; // 无选中对象时不进入行内编辑
    const selKind = S.sel.kind; // 提交时 S.sel 可能已被画布点空白清空，必须在点击时捕获
    const obj = selKind === 'node' ? nodeById(S.sel.id) : edgeById(S.sel.id);
    if (!obj) return;
    const key = edit.dataset.edit === 'type' ? 'type' : 'name'; // 名称与类型均可点击行内编辑
    inlineEdit(edit, obj[key], v => { if (v){ pushHistory(); obj[key] = v;
      if (key === 'name'){
        if (selKind === 'edge') obj.md ||= mdPath('routes', obj.id);
        else obj.md ||= mdPath('nodes', obj.id); } } render(); renderPanel(); });
    return;
  }
  // 所属路线:点击弹出下拉,选择已有路线或"无",或重命名当前路线
  const pk = ev.target.closest('[data-pick="route"]');
  if (pk){
    const obj = S.sel.kind === 'node' ? nodeById(S.sel.id) : edgeById(S.sel.id);
    const rect = pk.getBoundingClientRect();
    openMenu([
      {id:'none', label:'无', checked: !obj.route, fn(){ pushHistory(); obj.route = null; render(); renderPanel(); }},
      ...S.routes.map(r => ({ id:'r:'+r.id, label:r.name, checked: obj.route === r.id, fn(){ pushHistory(); obj.route = r.id; render(); renderPanel(); }})),
      ...(obj.route ? [{sep:true},{id:'ren', label:'重命名当前路线…', fn(){
        const r = routeById(obj.route); if (!r) return;
        const el = document.querySelector('#panel-body [data-pick="route"]');
        if (el) inlineEdit(el, r.name, v => { if (v && v !== r.name){ pushHistory(); r.name = v; } render(); renderPanel(); });
      }}] : [])
    ], rect.left, rect.bottom + 4);
    return;
  }
  const act = ev.target.closest('[data-act]'); if (!act) return;
  const a = act.dataset;
  if (a.act === 'open-md'){ const o = S.sel.kind==='node'?nodeById(S.sel.id):edgeById(S.sel.id); openMd(o); }
  if (a.act === 'promote') promoteToIssueRoute(nodeById(S.sel.id));
  if (a.act === 'add-ann') addAnnotation(a.kind === 'node' ? 'node' : 'edge', a.id);
  if (a.act === 'toggle-ann'){ const an = S.anns.find(x => x.id === act.closest('.annitem').dataset.ann); pushHistory(); an.hidden = !an.hidden; render(); renderPanel(); }
  if (a.act === 'del-ann'){ const item = act.closest('.annitem'); pushHistory(); S.anns = S.anns.filter(x => x.id !== item.dataset.ann); render(); renderPanel(); }
  if (a.act === 'archive-node'){ const no = nodeById(S.sel?.id); if (no) archiveNode(no); }
  if (a.act === 'toggle-archive'){ const eo = edgeById(S.sel.id); if (eo){ pushHistory(); eo.archived = !eo.archived; eo.updatedAt = today(); render(); renderPanel(); } }
});
// 评分输入:change 时落盘,0-100 之外或留空视为未评
$('#panel-body').addEventListener('change', ev => {
  const si = ev.target.closest('[data-score]'); if (!si || !S.sel || S.sel.kind !== 'edge') return;
  const eo = edgeById(S.sel.id); if (!eo) return;
  const v = si.value.trim();
  pushHistory();
  if (v === '') delete eo.score;
  else { const num = Math.round(Number(v)); if (Number.isFinite(num)) eo.score = Math.max(0, Math.min(100, num)); }
  eo.updatedAt = today(); render(); renderPanel();
});
$('#panel-body').addEventListener('click', ev => {
  const sb = ev.target.closest('.seg button'); if (!sb) return;
  const statusGroup = sb.closest('.node-status');
  if (statusGroup && S.sel?.kind === 'node') { setNodeStatus(nodeById(S.sel.id), sb.dataset.val); return; }
  const kindGroup = sb.closest('.node-kind');
  if (kindGroup && S.sel?.kind === 'node') { setNodeKind(nodeById(S.sel.id), sb.dataset.kind); return; }
  const resGroup = sb.closest('.node-resolve');
  if (resGroup && S.sel?.kind === 'node') { setNodeResolved(nodeById(S.sel.id), sb.dataset.val === 'true'); return; }
  setEdgeStatus(edgeById(sb.closest('.seg').dataset.edge), sb.dataset.status);
});
$('#panel-more').onclick = ev => {
  ev.stopPropagation();
  if (!S.sel) return;
  const rect = $('#panel-more').getBoundingClientRect();
  if (S.sel.kind === 'node') nodeMenu(nodeById(S.sel.id), rect.left - 120, rect.top - 280);
  else edgeMenu(edgeById(S.sel.id), rect.left - 120, rect.top - 280);
};

/* ---------- 工具栏 ---------- */
const TOOL_HINTS = {
  hand:'按住拖拽移动画布，或滚轮/中键平移',
  select:'点击选择对象，空白处拖拽框选',
  node:'点击画布新建节点',
  edge:'在节点上按住拖拽拉出方案线 · 空格/中键拖拽平移画布',
  ann:'点击节点或方案线添加标注'
};
function showToolHint(t){
  const h = $('#tool-hint');
  h.textContent = TOOL_HINTS[t] || '';
  if (!h.textContent) return;
  h.classList.add('on');
  clearTimeout(h._timer);
  h._timer = setTimeout(() => h.classList.remove('on'), 2500);
}
function setTool(t){
  S.tool = t; S.drawingEdge = null;
  viewport.classList.toggle('tool-place', t !== 'select' && t !== 'hand');
  viewport.style.cursor = t === 'hand' ? 'grab' : '';
  if (t === 'select' || t === 'hand') crosshairEl.hidden = true; // 切回选择/平移:立即收起自绘准星
  document.querySelectorAll('#toolbar [data-tool]').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === t));
  showToolHint(t);
}
document.querySelectorAll('#toolbar [data-tool]').forEach(b =>
  b.onclick = () => setTool(b.dataset.tool));
$('#more-btn').onclick = ev => {
  ev.stopPropagation();
  const isTiny = document.documentElement.classList.contains('tiny-dock');
  const rect = $('#more-btn').getBoundingClientRect();
  openMenu([
    ...(isTiny ? [
      {id:'t-edge', icon:I.edge, label:'新建方案线 (L)', checked:S.tool==='edge', fn(){ setTool('edge'); }},
      {id:'t-ann', icon:I.ann, label:'添加标注 (M)', checked:S.tool==='ann', fn(){ setTool('ann'); }},
      {sep:true}
    ] : []),
    {id:'anns', icon:I.eye, label:'显示标注', checked:S.showAnns, fn(){ S.showAnns = !S.showAnns; render(); }},
    {id:'routes', icon:I.route, label:'显示路线名称', checked:S.showRoutes, fn(){ S.showRoutes = !S.showRoutes; render(); }},
    {id:'failed', icon:I.eye, label:'显示失败方案', checked:S.showFailed, fn(){ S.showFailed = !S.showFailed; render(); }},
    {id:'nums', icon:I.eye, label:'显示编号', checked:S.showNums, fn(){ S.showNums = !S.showNums; renderPanel(); }},
    {id:'ntime', icon:I.eye, label:'显示节点时间', checked:S.showNodeTime, fn(){ S.showNodeTime = !S.showNodeTime; render(); }},
    {sep:true},
     {id:'tidy', icon:I.tidy, label:'整理地图', fn(){ openCurationDialog(); }},
    {id:'fit', icon:I.fit, label:'适应视图', fn(){ fitView(); }}
  ], Math.min(rect.left, innerWidth - 220), rect.bottom + 6);
};

/* ---------- 产品内更新(检测/红点/提示条; 更新链路走本地桥, 前端不直连外网) ---------- */