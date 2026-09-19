let mdSession = null; // { dirty():boolean, discard():void }
function select(kind, id, defer = false){
  // 编辑中选中另一个对象:干净则静默回详情;有未保存则先确认
  if (mdSession && kind && (S.sel?.kind !== kind || S.sel?.id !== id)){
    if (mdSession.dirty()){
      const target = kind === 'node' ? nodeById(id)?.name : edgeById(id)?.name;
      void confirmDialog({
        title: '有未保存的修改',
        body: `当前文档还有未保存的修改，切换到「${target || '新对象'}」会放弃这些修改。`,
        confirmLabel: '放弃并切换', cancelLabel: '继续编辑', danger: true
      }).then(ok => { if (!ok) return; mdSession?.discard(); select(kind, id, defer); });
      return;
    }
    mdSession.discard();
  }
  S.sel = kind ? {kind, id} : null;
  // defer: 延迟到下一帧渲染(画布点选用,保 DOM 稳定以不吞 click/dblclick)
  if (defer) requestAnimationFrame(() => { render(); renderPanel(); });
  else { render(); renderPanel(); }
}
function field(k, vHTML){ return `<div class="field"><div class="k">${k}</div>${vHTML}</div>`; }
/* 所属路线显示:有关联显示路线名,否则显示"无";点击弹出下拉选择已有路线 */
const routeNameOf = o => o.route ? (routeById(o.route)?.name || '无') : '无';
function routePickHTML(o){
  return `<div class="v pick" data-pick="route" title="点击选择所属路线">${esc(routeNameOf(o))}</div>`;
}
// 画布只提供“普通 / 问题”两态。历史 kind=result（或只有 type=结果）
// 仍按普通显示；除非用户明确切换为问题，否则不会改写该历史字段。
function nodeKindOf(n){
  return n?.kind === 'problem' || n?.type === '问题' ? 'problem' : 'normal';
}
function isLegacyResult(n){
  return n?.kind === 'result' || (!n?.kind && n?.type === '结果');
}

function renderPanel(){
  const p = $('#panel'), body = $('#panel-body'), title = $('#panel-title');
  /* 选中即展开:收起细边条状态下点节点/线,自动弹回面板,避免「点了没反应」 */
  const expandRail = () => { if (p.classList.contains('rail')){ p.classList.remove('rail'); dockStore.set('dock-rail','0'); } };
  if (mdSession){ p.classList.add('on'); expandRail(); updateDockSpace(); return; } // 编辑模式:详情三节已被 .editing 隐藏,不覆盖内容
  p.classList.remove('editing');
  if (!S.sel){ p.classList.remove('on'); updateDockSpace(); return; }
  p.classList.add('on');
  expandRail();
  updateDockSpace();
  const annsOf = (kind,id) => S.anns.filter(a => a.target.kind===kind && a.target.id===id);
  const annBlock = (kind,id) => {
    const list = annsOf(kind,id).map(a => `
      <div class="annitem" data-ann="${a.id}">
        <span class="txt" style="${a.hidden?'opacity:.45':''}">${esc(a.text)}</span>
        <span class="mini">
          <button data-act="toggle-ann" title="${a.hidden?'显示':'隐藏'}">${a.hidden?I.eyeoff:I.eye}</button>
          <button data-act="del-ann" title="删除">${I.x}</button>
        </span>
      </div>`).join('');
    return field('标注', list || '<div class="v" style="color:var(--muted);cursor:default">—</div>')
      + `<button class="addline" data-act="add-ann" data-kind="${kind}" data-id="${id}">${I.ann} 添加标注</button>`;
  };

  if (S.sel.kind === 'node'){
    const n = nodeById(S.sel.id); if (!n){ S.sel=null; p.classList.remove('on'); return; }
    const nodeKind = nodeKindOf(n);
    const isResolved = nodeKind === 'problem' && n.resolved === true;
    const curStatus = isResolved ? 'resolved' : (nodeKind === 'problem' ? 'problem' : 'normal');
    const nodeColor = curStatus === 'problem' ? 'var(--danger)' : (curStatus === 'resolved' ? 'oklch(60% 0.015 260)' : 'var(--fg)');
    const statusLabel = curStatus === 'problem' ? '问题节点' : (curStatus === 'resolved' ? '已解决节点' : '普通节点');
    title.innerHTML = `<span class="swatch" style="background:${nodeColor}"></span>${statusLabel}`;
    body.innerHTML =
      field('所属路线', routePickHTML(n)) +
      field('名称', `<div class="v" data-edit="name">${esc(n.name)}</div>`) +
      field('类型', `<div class="seg node-status" data-node-status="${esc(n.id)}">
        ${[['normal','普通'],['problem','问题'],['resolved','已解决']].map(([st,label]) => `<button class="${curStatus===st?'on':''}" data-val="${st}">${label}</button>`).join('')}
      </div>`) +
      sourceBlock(n) +
      field('Markdown', `<div class="v link" data-act="open-md">${I.md}<span class="mono">${esc(n.md)}</span>${I.ext}</div>`) +
      annBlock('node', n.id) +
      (!S.routes.some(r => r.source === n.id) && curStatus === 'problem'
        ? `<button class="addline" data-act="promote">${I.route} 从此问题建立路线</button>` : '') +
      (S.showNums ? `<div class="pnum">编号 #${n.num}</div>` : '');
  } else {
    const e = edgeById(S.sel.id); if (!e){ S.sel=null; p.classList.remove('on'); return; }
    const st = STATUS[e.status];
    title.innerHTML = `<span class="swatch" style="background:${st.color}"></span>方案`;
    const seg = `<div class="seg" data-edge="${e.id}">
      ${['success','failed','pending'].map(s =>
        `<button class="${e.status===s?'on':''}" data-status="${s}">
          <span class="pip ${s==='success'?'s':s==='failed'?'f':'p'}"></span>${STATUS[s].label}</button>`).join('')}
    </div>`;
    body.innerHTML =
      field('所属路线', routePickHTML(e)) +
      field('方案名称', `<div class="v" data-edit="name">${esc(e.name)}</div>`) +
      sourceBlock(e) +
      field('状态', seg) +
      field('评分', `<div class="v" style="cursor:default;display:flex;align-items:center;gap:8px">
        <input type="number" min="0" max="100" data-score value="${e.score ?? ''}" placeholder="—"
          style="width:64px;padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit">
        <span style="color:var(--muted);font-size:12px">0–100，留空即未评</span></div>`) +
      field('起点', `<div class="v" style="cursor:default">${esc(nodeById(e.from)?.name || '—')}</div>`) +
      (e.status === 'success'
        ? field('目标节点', `<div class="v" style="cursor:default">${esc(nodeById(e.to)?.name || '—')}</div>`)
        : '') +
      field('Markdown', `<div class="v link" data-act="open-md">${I.md}<span class="mono">${esc(e.md)}</span>${I.ext}</div>`) +
      annBlock('edge', e.id) +
      `<button class="addline" data-act="toggle-archive">${e.archived ? '取消归档（恢复显示）' : '归档此方案（弱化显示，不删数据）'}</button>` +
      (S.showNums ? `<div class="pnum">编号 #${e.id.slice(1)}</div>` : '');
  }
}

/* ---------- 状态:只改颜色,与连接关系解耦 ---------- */
function setEdgeStatus(e, s){
  if (e.status === s) return;
  pushHistory();
  e.status = s; // 连不连节点由用户自己定(拖拽/「新建连接节点」),不随状态强制
  render(); renderPanel();
}
/* 为悬空方案线自动创建目标节点并连接(右键菜单「新建连接节点」) */
function createTargetNode(e){
  pushHistory();
  const from = nodeById(e.from);
  const end = { x: from.x + (e.dx||220), y: from.y + (e.dy||0) };
  const name = `新节点${S.nextNodeName++}`;
  const nodeId = 'n' + S.nextNum, nodeNum = String(S.nextNum++).padStart(2,'0');
  const n = { id:nodeId, num:nodeNum,
    name, type:'目标', kind:'goal', route:e.route, x:end.x, y:end.y, r:34,
    md: mdPath('nodes', nodeId), createdBy:'human' };
  delete e.dx; delete e.dy;
  S.nodes.push(n); e.to = n.id;
  render(); renderPanel();
}

// 保持测试兼容定义：[['normal','普通'],['problem','问题']]
const NODE_KIND_LABELS = [['normal','普通'],['problem','问题']];

function setNodeStatus(n, st){
  if (!n || !['normal','problem','resolved'].includes(st)) return;
  if (IO.readOnly){ warnReadOnly(); return; }
  pushHistory();
  if (st === 'normal'){
    n.kind = 'goal';
    n.type = '目标';
    n.resolved = false;
  } else if (st === 'problem'){
    n.kind = 'problem';
    n.type = '问题';
    n.resolved = false;
  } else if (st === 'resolved'){
    n.kind = 'problem';
    n.type = '问题';
    n.resolved = true;
  }
  n.updatedAt = today();
  render(); renderPanel();
  toast(st === 'normal' ? '已设为普通节点' : (st === 'problem' ? '已设为问题节点' : '问题节点已标记为已解决'));
}

async function archiveNode(n){
  if (!n) return;
  if (IO.readOnly){ warnReadOnly(); return; }
  const ok = await confirmDialog({
    title: '归档节点',
    body: `将节点「${n.name || n.id}」移入归档库？\n\n归档后节点将从当前画布移出以保持工作区整洁，关联方案线与标注同步收录。\n数据不会删除，随时可在「设置 → 归档库」中找回并一键恢复至画布。`,
    confirmLabel: '确认归档',
    cancelLabel: '取消',
    danger: false
  });
  if (!ok) return;
  pushHistory();
  n.archived = true;
  n.archivedAt = new Date().toISOString();
  n.archivedBy = 'human';
  n.updatedAt = today();
  select(null);
  render();
  toast(`节点「${n.name || n.id}」已移入归档库，可从「设置 → 归档库」找回`);
}

function restoreNode(n){
  if (!n) return;
  if (IO.readOnly){ warnReadOnly(); return; }
  pushHistory();
  delete n.archived;
  delete n.archivedAt;
  delete n.archivedBy;
  n.updatedAt = today();
  render();
  toast(`已恢复节点：${n.name || n.id}`);
}
function setNodeKind(n, kind){
  if (!n || !['normal','problem'].includes(kind)) return;
  const current = nodeKindOf(n);
  // 旧结果只在 UI 中归入普通；选择普通不触发任何字段写入，避免
  // 无关编辑把 kind=result/type=结果 悄悄升级成新语义。
  if (kind === 'normal' && isLegacyResult(n)) {
    render(); renderPanel();
    toast('历史结果按普通节点显示，旧字段保持不变');
    return;
  }
  if (current === kind && (kind === 'problem' ? n.type === '问题' : n.type === '目标')) return;
  if (IO.readOnly){ warnReadOnly(); return; }
  pushHistory();
  n.kind = kind === 'problem' ? 'problem' : 'goal';
  n.type = kind === 'problem' ? '问题' : '目标';
  n.resolved = kind === 'problem' ? false : n.resolved;
  n.updatedAt = today();
  render(); renderPanel();
  toast(kind === 'problem' ? '已设为问题节点' : '已设为普通节点');
}

function setNodeResolved(n, resolved){
  if (!n) return;
  if (IO.readOnly){ warnReadOnly(); return; }
  pushHistory();
  n.resolved = !!resolved;
  n.updatedAt = today();
  render(); renderPanel();
  toast(resolved ? '问题节点已标记为已解决' : '问题节点已设为待解决');
}

/* ---------- 菜单 ---------- */
const menu = $('#menu');
function openMenu(items, x, y, parent){
  menu.innerHTML = items.map(it => it.sep ? '<div class="msep"></div>' :
    it.head ? `<div class="mhead">${esc(it.head)}</div>` :
    it.back ? `<button data-mi="__back" class="mback"><span class="mchev">‹</span><span>${esc(it.label)}</span></button>` :
    `<button data-mi="${esc(it.id)}" class="${it.danger?'danger':''}${it.sub?'has-sub':''}">${it.icon||''}<span>${esc(it.label)}</span>${it.sub?'<i class="mchev sub">›</i>':''}${it.checked?I.check:''}${it.kbd?`<kbd class="mkbd">${esc(it.kbd)}</kbd>`:''}</button>`
  ).join('');
  menu.classList.add('on');
  const mw = 218, mh = items.length * 36 + 16;
  menu.style.left = Math.min(x, innerWidth - mw - 8) + 'px';
  menu.style.top = Math.min(y, innerHeight - mh - 8) + 'px';
  menu._items = items;
  menu._parent = parent;
  menu._pos = { x, y };
}
function closeMenu(){ menu.classList.remove('on'); }
menu.addEventListener('click', ev => {
  const b = ev.target.closest('button[data-mi]'); if (!b) return;
  if (b.dataset.mi === '__back'){
    const back = menu._parent;
    if (back) openMenu(back.items, back.x, back.y);
    return;
  }
  const it = menu._items.find(i => i.id === b.dataset.mi);
  if (!it) return;
  if (it.sub){
    // 子菜单就地展开（父级压栈），自动带返回项回到上一级；一次点击可达、不悬浮。
    openMenu([{ back:true, label: it.label }, ...it.sub], menu._pos.x, menu._pos.y, { items: menu._items, x: menu._pos.x, y: menu._pos.y });
    return;
  }
  closeMenu(); it.fn && it.fn();
});

function closeCurationDialog(){
  const dialog = $('#curation-dialog');
  if (!dialog) return;
  dialog.classList.remove('on');
  dialog.setAttribute('aria-hidden','true');
}