function setCurationBusy(busy){
  const apply = $('#curation-apply');
  if (apply) apply.disabled = busy || !document.querySelector('#curation-list input:checked:not(:disabled)');
  const cancel = $('#curation-cancel');
  if (cancel) cancel.disabled = busy;
}
function curationObject(id){
  return [...S.routes,...S.nodes,...S.edges].find(item => String(item.id) === String(id));
}
function updateCurationMeta(){
  const dialog=$('#curation-dialog'), plan=dialog?._curationPlan, meta=$('#curation-meta');
  if (!plan || !meta) return;
  const selected=new Set([...document.querySelectorAll('#curation-list input:checked')].map(input=>input.dataset.suggestionId));
  const chosen=(plan.suggestions||[]).filter(s=>selected.has(String(s.id)));
  const archivedEdges=new Set(), archivedRoutes=new Set();
  for (const suggestion of chosen) for (const command of (suggestion.commands||[])){
    if (command.op==='update' && command.patch?.archived===true){
      if (command.collection==='edges') archivedEdges.add(String(command.id));
      if (command.collection==='routes') archivedRoutes.add(String(command.id));
    }
  }
  const counts=plan.counts||{}, current=plan.projection?.current||{};
  const position=current.nodeName ? ` · 当前位置 ${current.nodeName}（${current.source==='stored'?'已保存':current.source==='inferred'?'推测':'未知'}）` : '';
  meta.dataset.currentSource=String(current.source||'none');
  meta.textContent=`revision ${plan.revision??'—'} · 路线 ${counts.routes??0}→${Math.max(0,(counts.routes??0)-archivedRoutes.size)} · 节点 ${counts.activeNodes??0}→${counts.activeNodes??0} · 方案 ${counts.activeEdges??0}→${Math.max(0,(counts.activeEdges??0)-archivedEdges.size)}${position}`;
}
async function openCurationDialog(){
  const dialog = $('#curation-dialog');
  const list = $('#curation-list');
  const empty = $('#curation-empty');
  const meta = $('#curation-meta');
  if (!dialog || !list || !empty || !meta) return;
  if (!window.LiveDotBridge?.active || typeof window.LiveDotBridge.planConsolidation !== 'function'){
    toast('请先打开一张已保存的地图');
    return;
  }
  dialog.classList.add('on'); dialog.setAttribute('aria-hidden','false');
  list.textContent = ''; empty.textContent = '正在读取整理建议…'; empty.style.display = 'block';
  meta.textContent = '';
  const recover=$('#curation-recover'); if (recover) recover.hidden=!window.LiveDotBridge.latestCheckpoint;
  $('#curation-apply').disabled = true;
  try{
    const plan = await window.LiveDotBridge.planConsolidation({ maxSuggestions: 12 });
    const suggestions = Array.isArray(plan.suggestions) ? plan.suggestions : [];
    dialog._curationPlan = plan; updateCurationMeta();
    if (!suggestions.length){ empty.textContent = '没有需要整理的内容'; return; }
    empty.style.display = 'none';
    for (const suggestion of suggestions){
      const label = document.createElement('label'); label.className = 'curation-item';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.suggestionId = String(suggestion.id || '');
      const applyable = suggestion.applyable !== false && Array.isArray(suggestion.commands) && suggestion.commands.length > 0;
      checkbox.disabled = !applyable;
      checkbox.addEventListener('change', () => { setCurationBusy(false); updateCurationMeta(); });
      const body = document.createElement('span');
      const title = document.createElement('span'); title.className = 'ctitle'; title.textContent = `${String(suggestion.title || suggestion.id || '整理建议')}${applyable?'':'（仅预览）'}`;
      const reason = document.createElement('span'); reason.className = 'creason'; reason.textContent = String(suggestion.reason || '');
      const objectIds=Array.isArray(suggestion.objectIds)?suggestion.objectIds.map(String):[];
      const sources=[...new Set(objectIds.map(id=>curationObject(id)).filter(Boolean).map(item=>actorLabel(item.createdBy||item.updatedBy)))];
      const context=document.createElement('div'); context.className='ccontext'; context.textContent=`对象 ${objectIds.join('、')||'—'} · 来源 ${sources.join('、')||'未知'}`;
      body.append(title, document.createElement('br'), reason, context); label.append(checkbox, body); list.append(label);
    }
    dialog._curationPlan = plan;
  }catch(error){
    window.LiveDotBridge?.logError?.('curation.preview.failed', error);
    empty.textContent = '整理预览读取失败，请稍后重试。';
  }
}
$('#curation-close')?.addEventListener('click', closeCurationDialog);
$('#curation-cancel')?.addEventListener('click', closeCurationDialog);
$('#curation-dialog')?.addEventListener('click', ev => { if (ev.target === $('#curation-dialog')) closeCurationDialog(); });
$('#curation-apply')?.addEventListener('click', async () => {
  const dialog = $('#curation-dialog'); const plan = dialog?._curationPlan;
  const selected = [...document.querySelectorAll('#curation-list input:checked')].map(input => input.dataset.suggestionId);
  if (!plan || !selected.length || !window.LiveDotBridge?.active) return;
  const commands = (plan.suggestions || []).filter(s => selected.includes(String(s.id))).flatMap(s => Array.isArray(s.commands) ? s.commands : []);
  if (!commands.length) return;
  setCurationBusy(true);
  try{
    await window.LiveDotBridge.createCheckpoint();
    const recover=$('#curation-recover'); if (recover) recover.hidden=false;
    await window.LiveDotBridge.applyCommands(commands);
    closeCurationDialog();
    render(); renderPanel();
    toast('整理已应用，历史方案已保留');
  }catch(error){
    setCurationBusy(false);
    window.LiveDotBridge?.logError?.('curation.apply.failed', error);
    toast('整理未应用：发生冲突，请重新预览。');
  }
});
$('#curation-recover')?.addEventListener('click', async () => {
  if (!window.LiveDotBridge?.latestCheckpoint || !confirm('恢复到整理前的地图？整理后的改动会保留，之后仍可恢复。')) return;
  setCurationBusy(true);
  try{
    await window.LiveDotBridge.recoverCheckpoint();
    closeCurationDialog(); render(); renderPanel(); toast('已恢复到整理前状态');
  }catch(error){ setCurationBusy(false); window.LiveDotBridge?.logError?.('curation.recover.failed', error); toast('恢复失败：检查点不可用。'); }
});
document.addEventListener('pointerdown', ev => {
  if (!menu.contains(ev.target) && !ev.target.closest('[data-menu-src]')) closeMenu();
  if (!popover.contains(ev.target) && !ev.target.closest('#project-pill')) closePopover();
}, true);

function nodeMenu(n, x, y){
  const kind = nodeKindOf(n);
  const isResolved = kind === 'problem' && n.resolved === true;
  const curStatus = isResolved ? 'resolved' : (kind === 'problem' ? 'problem' : 'normal');
  openMenu([
    {id:'st-normal', icon:'<span style="width:9px;height:9px;border-radius:50%;background:var(--fg);display:inline-block"></span>', label:'设为普通节点', checked:curStatus==='normal', fn(){ setNodeStatus(n, 'normal'); }},
    {id:'st-problem', icon:'<span style="width:9px;height:9px;border-radius:50%;background:var(--danger);display:inline-block"></span>', label:'设为问题节点', checked:curStatus==='problem', fn(){ setNodeStatus(n, 'problem'); }},
    {id:'st-resolved', icon:'<span style="width:9px;height:9px;border-radius:50%;background:oklch(60% 0.015 260);display:inline-block"></span>', label:'标记为已解决', checked:curStatus==='resolved', fn(){ setNodeStatus(n, 'resolved'); }},
    {sep:true},
    ...(curStatus === 'problem' ? [{id:'issue', icon:I.route, label:'从问题建立路线', fn(){ promoteToIssueRoute(n); }}] : []),
    {id:'archive-node', icon:'📦', label:'归档节点…', fn(){ void archiveNode(n); }},
    {id:'ann', icon:I.ann, label:'添加标注', fn(){ addAnnotation('node', n.id); }},
    {id:'md', icon:I.md, label:'打开 Markdown', fn(){ openMd(n); }},
    {id:'ref', icon:I.ext, label:'复制引用给 Agent', fn(){ copyObjectRef('node', n); }},
    {sep:true},
    {id:'del', icon:I.trash, label:'删除', danger:true, fn(){ pushHistory();
      // 删除节点时保留方案线:目标节点边变灰色悬空,起点边删除
      for (const e of S.edges){
        if (e.to === n.id){ e.to = null; e.status = 'pending';
          const a = nodeById(e.from), d = Math.hypot(n.x-a.x, n.y-a.y)||1;
          e.dx = (n.x-a.x)/d*(d+50); e.dy = (n.y-a.y)/d*(d+50);
        }
      }
      S.edges = S.edges.filter(e => e.from !== n.id);
      S.nodes = S.nodes.filter(m => m.id!==n.id); select(null); render(); }}
  ], x, y);
}
function edgeMenu(e, x, y){
  openMenu([
    {id:'s', label:'标记成功', icon:'<span class="pip s" style="width:9px;height:9px;border-radius:50%;background:var(--success)"></span>', fn(){ setEdgeStatus(e,'success'); }},
    {id:'f', label:'标记失败', icon:'<span class="pip f" style="width:9px;height:9px;border-radius:50%;background:var(--danger)"></span>', fn(){ setEdgeStatus(e,'failed'); }},
    {id:'p', label:'标记待验证', icon:'<span class="pip p" style="width:9px;height:9px;border-radius:50%;background:var(--pending)"></span>', fn(){ setEdgeStatus(e,'pending'); }},
    ...(e.to ? [] : [{id:'link', icon:I.node, label:'新建连接节点', fn(){ createTargetNode(e); }}]),
    {sep:true},
    {id:'ann', icon:I.ann, label:'添加标注', fn(){ addAnnotation('edge', e.id); }},
    {id:'md', icon:I.md, label:'打开 Markdown', fn(){ openMd(e); }},
    {id:'ref', icon:I.ext, label:'复制引用给 Agent', fn(){ copyObjectRef('edge', e); }},
    {sep:true},
    {id:'del', icon:I.trash, label:'删除', danger:true, fn(){ pushHistory();
      S.edges = S.edges.filter(m => m.id!==e.id); select(null); render(); }}
  ], x, y);
}
function canvasMenu(x, y){
  const w = toWorld(x, y);
  openMenu([
    {id:'new', icon:I.node, label:'新建节点', fn(){ pushHistory(); addNodeAt(w.x, w.y); }},
    {id:'paste', icon:I.paste, label:'粘贴', fn(){ toast('剪贴板为空'); }}
  ], x, y);
}
/* 复制对象引用给 Agent:格式对齐 agent-kit SKILL.md「画布引用寻址」 */
function objectRefText(kind, item){
  if (kind === 'node'){
    const routeName = item.route ? (S.routes.find(r => r.id === item.route)?.name || item.route) : '无';
    const md = item.md || mdPath('nodes', item.id);
    return `[活点地图] 节点「${item.name || item.num}」${item.id}（${nodeKindOf(item) === 'problem' ? '问题' : '普通'}，路线 ${routeName}）→ ${md}`;
  }
  if (kind === 'edge'){
    const statusLabel = item.status === 'success' ? '成功' : item.status === 'failed' ? '失败' : '待验证';
    const routeName = item.route ? (S.routes.find(r => r.id === item.route)?.name || item.route) : '无';
    const md = item.md || mdPath('routes', item.id);
    return `[活点地图] 方案「${item.name || item.id}」${item.id}（${statusLabel}，路线 ${routeName}）→ ${md}`;
  }
  return `[活点地图] 标注「${item.text || ''}」${item.id} → map.json#anns/${item.id}`;
}
function copyObjectRef(kind, item){
  const text = objectRefText(kind, item);
  const done = () => toast('引用已复制，可直接粘贴给 Agent');
  if (navigator.clipboard?.writeText){
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done){
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove(); done();
  } catch { toast('复制失败，请手动复制引用文本'); }
}
/* 普通节点就地升级为问题路线起点:直连方案线与对端节点并入新路线 */
function promoteToIssueRoute(n){
  if (S.routes.some(r => r.source === n.id)){ toast('这个节点已经是路线起点。'); return; }
  pushHistory();
  const rid = 'r' + Date.now();
  S.routes.push({ id:rid, name:`分支路线${S.nextRouteName++}`, source:n.id });
  n.type = '问题'; n.kind = 'problem'; n.route = rid;
  for (const e of S.edges){
    if (e.from === n.id || e.to === n.id){
      e.route = rid;
      const other = nodeById(e.from === n.id ? e.to : e.from);
      if (other) other.route = rid;
    }
  }
  render(); renderPanel();
  toast('已升级为问题路线');
}
function addNodeAt(x, y){
  const name = `新节点${S.nextNodeName++}`;
  const nodeId = 'n' + S.nextNum, nodeNum = String(S.nextNum++).padStart(2,'0');
  const n = { id:nodeId, num:nodeNum,
    name, type:'目标', kind:'goal', route:null, x, y, r:34, // 新建节点默认不属于任何路线(显示"无")
    md: mdPath('nodes', nodeId), createdBy:'human' };
  S.nodes.push(n); select('node', n.id); render();
}

/* ---------- 标注 ---------- */
function addAnnotation(kind, id, point){
  const a = { id:'a'+(S.nextAnn++), target:kind==='canvas'?{kind}:{kind, id}, text:'新标注', hidden:false };
  if (kind === 'canvas' && point){ a.x = point.x; a.y = point.y; }
  pushHistory(); S.anns.push(a); render(); renderPanel();
  // 行内编辑面板里的新标注
  requestAnimationFrame(() => {
    const el = document.querySelector(`.annitem[data-ann="${a.id}"] .txt`);
    if (el) inlineEdit(el, a.text, v => { a.text = v || a.text; render(); renderPanel(); });
  });
}
let inlineEditing = null; // 正在行内编辑的便签 {annId, input}
let inlineEdgeEdit = null; // 正在行内编辑方案名的边 id
let inlineNodeEdit = null; // 正在行内编辑名称的节点 id
let inlineRouteEdit = null; // 正在行内编辑名称的路线 id
/* 在目标元素位置弹固定定位行内输入框:Enter 提交、Escape 取消、blur 提交 */
function popInlineEdit(rect, initial, onCommit, cls){
  const input = document.createElement('input');
  input.className = 'inline-edit' + (cls ? ' ' + cls : ''); input.value = initial;
  input.style.position = 'fixed';
  input.style.left = (rect.left + rect.width/2) + 'px'; input.style.top = (rect.top + rect.height/2) + 'px';
  input.style.transform = 'translate(-50%,-50%)';
  input.style.width = Math.max(120, rect.width + 40) + 'px'; input.style.zIndex = 60;
  document.body.appendChild(input); input.focus(); input.select();
  let finished = false;
  const commit = () => {
    if (finished) return; finished = true;
    const v = input.value.trim();
    if (input.isConnected) input.remove(); // render() 不清理输入框,必须自己移除
    onCommit(v);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', ev => {
    if (ev.isComposing || ev.keyCode === 229) return; // 中文输入法组词中不拦截按键
    if (ev.key === 'Enter') commit();
    if (ev.key === 'Escape'){ input.value = initial; commit(); }
  });
}
/* 节点名双击行内编辑:保存后同步 Markdown 文件名,半径随文字自动重算 */
function editNodeName(n, nodeEl){
  inlineNodeEdit = n.id;
  const rect = nodeEl.getBoundingClientRect();
  render(); // 应用 editing 类:圆圈保留、圆内文字隐藏,输入框叠在圆心
  popInlineEdit(rect, n.name, v => {
    inlineNodeEdit = null;
    if (v && v !== n.name){ pushHistory(); n.name = v; n.md ||= mdPath('nodes', n.id); }
    render(); renderPanel();
  }, 'node-edit');
}
/* 路线名双击行内编辑 */