function staggerParallel(e, group){
  if (!e.to) return;
  if (group.length < 2) return; // 无平行线时不动,保留用户手动弯折
  const n = group.length;
  const off = (group.indexOf(e) - (n - 1) / 2) * 46;
  const a = nodeById(e.from), b = nodeById(e.to);
  const dx = b.x-a.x, dy = b.y-a.y, d = Math.hypot(dx,dy)||1;
  e.cx = -dy/d*off; e.cy = dx/d*off;
}

/* 节点圆内文字:每行最多 4 字,按文字量自动计算半径(离屏 canvas 测宽) */
const measCtx = document.createElement('canvas').getContext('2d');
let measFont = '', measFont12 = '', measFamily = '';
function canvasFontFamily(){
  if (!measFamily) measFamily = getComputedStyle(document.body).fontFamily;
  return measFamily;
}
function nodeTextLayout(name){
  const fs = 12.5, lh = 16;
  const chars = [...String(name)];
  const lines = [];
  for (let i = 0; i < chars.length; i += 4) lines.push(chars.slice(i, i+4).join(''));
  if (!lines.length) lines.push('');
  if (!measFont) measFont = `500 ${fs}px ${canvasFontFamily()}`;
  if (measCtx.font !== measFont) measCtx.font = measFont;
  let maxW = 0;
  for (const l of lines) maxW = Math.max(maxW, measCtx.measureText(l).width);
  const r = Math.max(34, maxW/2 + 14, lines.length*lh/2 + 14);
  return { lines, r };
}
/* 标注便签文本测宽(12px) */
function measureText12(t){
  if (!measFont12) measFont12 = `400 12px ${canvasFontFamily()}`;
  if (measCtx.font !== measFont12) measCtx.font = measFont12;
  return measCtx.measureText(t).width;
}

/* ---------- 渲染 ---------- */
let renderCache = null;
function updateOverviewCanvas(){
  let canvas=document.querySelector('#overview-canvas');
  if (S.nodes.length < 500){ canvas?.remove(); return; }
  if (!canvas){ canvas=document.createElement('canvas');canvas.id='overview-canvas';world.appendChild(canvas); }
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const n of S.nodes){ minX=Math.min(minX,n.x-n.r);minY=Math.min(minY,n.y-n.r);maxX=Math.max(maxX,n.x+n.r);maxY=Math.max(maxY,n.y+n.r); }
  for (const e of S.edges) if (!e.to){ const p=dangleEnd(e);minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y); }
  const pad=60,w=Math.max(1,maxX-minX+pad*2),h=Math.max(1,maxY-minY+pad*2),scale=Math.min(1,1600/Math.max(w,h));
  canvas.width=Math.max(1,Math.ceil(w*scale));canvas.height=Math.max(1,Math.ceil(h*scale));
  canvas.style.left=(minX-pad)+'px';canvas.style.top=(minY-pad)+'px';canvas.style.width=w+'px';canvas.style.height=h+'px';
  const c=canvas.getContext('2d');c.setTransform(scale,0,0,scale,(-minX+pad)*scale,(-minY+pad)*scale);c.lineWidth=2/Math.max(scale,.1);c.globalAlpha=.72;
  const colors={success:getComputedStyle(document.documentElement).getPropertyValue('--success'),failed:getComputedStyle(document.documentElement).getPropertyValue('--danger'),pending:getComputedStyle(document.documentElement).getPropertyValue('--pending')};
  for (const e of S.edges){ if (!S.showFailed&&e.status==='failed')continue;const g=edgeCurve(e);c.beginPath();c.moveTo(g.x1,g.y1);c.quadraticCurveTo(g.cpx,g.cpy,g.x2,g.y2);c.strokeStyle=colors[e.status]||colors.pending;c.stroke(); }
  c.globalAlpha=.9;c.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--fg');
  for (const n of S.nodes){ c.beginPath();c.arc(n.x,n.y,Math.max(12,n.r*.55),0,Math.PI*2);c.fill(); }
}
function renderStructureKey(){
  return JSON.stringify({
    nodes:S.nodes.map(n => [n.id,n.name,n.kind,n.type,n.route,n.r,n.md,n.num,n.createdBy,n.updatedBy]),
    edges:S.edges, anns:S.anns, routes:S.routes,
    flags:[S.showFailed,S.showRoutes,S.showAnns,S.showNums,S.showNodeTime,S.hoverEdge,S.drawingEdge,inlineEdgeEdit,inlineNodeEdit,inlineRouteEdit],
    sel:S.sel, multi:S.multi, snapTo:S.snapTo
  });
}
function rememberRender(structure){
  renderCache = { structure, positions:new Map(S.nodes.map(n => [n.id,{x:n.x,y:n.y}])) };
}
function tryFastPositionRender(structure){
  if (!renderCache || renderCache.structure !== structure || renderCache.positions.size !== S.nodes.length) return false;
  const moved = [];
  for (const n of S.nodes){
    const old = renderCache.positions.get(n.id);
    if (!old) return false;
    if (old.x !== n.x || old.y !== n.y) moved.push(n);
  }
  if (!moved.length || moved.length > 12) return false;
  const movedIds = new Set(moved.map(n => n.id));
  const touchedEdges = S.edges.filter(e => movedIds.has(e.from) || movedIds.has(e.to));
  if (touchedEdges.some(e => S.hoverEdge===e.id || S.drawingEdge===e.id || (S.sel?.kind==='edge' && S.sel.id===e.id))) return false;
  if (S.anns.some(a => movedIds.has(a.target?.id) || (a.target?.kind==='edge' && touchedEdges.some(e=>e.id===a.target.id)))) return false;
  for (const n of moved){
    const el = world.querySelector(`.node[data-id="${CSS.escape(n.id)}"]`); if (!el) return false;
    el.style.left=n.x+'px'; el.style.top=n.y+'px';
    for (const r of S.routes){
      if (S.nodes.find(x=>x.route===r.id)?.id !== n.id) continue;
      const label=world.querySelector(`.route-label[data-route="${CSS.escape(r.id)}"]`);
      if (label){ label.style.left=n.x+'px'; label.style.top=(n.y-n.r-30)+'px'; }
    }
  }
  const fromCnt={}, signOf={};
  for (const e of (S.showFailed?S.edges:S.edges.filter(e=>e.status!=='failed'))){ const i=fromCnt[e.from]||0;fromCnt[e.from]=i+1;signOf[e.id]=i%2===0?1:-1; }
  for (const e of touchedEdges){
    const g=edgeCurve(e); let dv=g.d;
    if (!e.to){ let tx=g.x2-g.cpx,ty=g.y2-g.cpy;const tl=Math.hypot(tx,ty)||1;tx/=tl;ty/=tl;dv=`M ${g.x1} ${g.y1} Q ${g.cpx} ${g.cpy} ${g.x2-tx*6} ${g.y2-ty*6}`; }
    const selector=`[data-edge="${CSS.escape(e.id)}"]`;
    for (const path of svg.querySelectorAll(`path${selector}`)) path.setAttribute('d',path.hasAttribute('marker-end')?dv:g.d);
    for (const circle of svg.querySelectorAll(`circle${selector}`)){
      if (circle.dataset.handle==='bend'){ circle.setAttribute('cx',g.bx);circle.setAttribute('cy',g.by); }
      else if (!e.to){ circle.setAttribute('cx',g.x2);circle.setAttribute('cy',g.y2); }
      else { const b=nodeById(e.to),dx=g.x2-b.x,dy=g.y2-b.y,dl=Math.hypot(dx,dy)||1;circle.setAttribute('cx',b.x+dx/dl*(b.r+16));circle.setAttribute('cy',b.y+dy/dl*(b.r+16)); }
    }
    const group=svg.querySelector(`g${selector}`), sign=signOf[e.id]||1;
    if (group){ const x=g.bx+g.nx*sign*15,y=g.by+g.ny*sign*15+4,lw=measureText12(e.name),texts=group.querySelectorAll('text');if(texts[0]){texts[0].setAttribute('x',x);texts[0].setAttribute('y',y);}if(texts[1]){texts[1].setAttribute('x',x+lw/2+11);texts[1].setAttribute('y',y);} }
  }
  for (const n of moved) renderCache.positions.set(n.id,{x:n.x,y:n.y});
  return true;
}
function render(){
  document.body.classList.toggle('show-ntime', S.showNodeTime === true);
  document.body.classList.toggle('show-nums-badge', S.showNums === true);
  rebuildObjectIndexes();
  const structure = renderStructureKey();
  if (tryFastPositionRender(structure)) return;
  // 先重算所有节点半径(文字进圆圈,edgeEnds 依赖 n.r,必须在画边之前)
  const layout = new Map();
  for (const n of S.nodes){ const L = nodeTextLayout(n.name); n.r = L.r; layout.set(n.id, L); }
  // 同一 from 节点的多条方案线:标签法向偏移方向交替,天然错开
  const visEdges = (S.showFailed ? S.edges : S.edges.filter(e => e.status !== 'failed')).filter(e => !nodeById(e.from)?.archived && (!e.to || !nodeById(e.to)?.archived)); // 隐藏失败方案时仅渲染其余
  const parallel = new Map();
  for (const e of visEdges){
    if (!e.to) continue;
    const key = `${e.from}\u0000${e.to}`;
    if (!parallel.has(key)) parallel.set(key, []);
    parallel.get(key).push(e);
  }
  const signOf = {}, fromCnt = {};
  for (const e of visEdges){ const i = fromCnt[e.from]||0; fromCnt[e.from] = i+1; signOf[e.id] = i%2===0 ? 1 : -1; }

  // 三种状态各一个箭头 marker,用各自状态色填充
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v);
  const defs = `<defs>${[['ar-s','--success'],['ar-f','--danger'],['ar-p','--pending']].map(([id, c]) =>
    `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10z" fill="${css(c)}"/></marker>`).join('')}</defs>`;
  const markerOf = { success:'ar-s', failed:'ar-f', pending:'ar-p' };

  // 边:透明宽命中 path + 选中高亮 path + 可见 path(二次贝塞尔)
  let lines = '', labels = '', leaders = '';
  const labelBoxes = []; // 方案名标签包围盒,供标注避让
  for (const e of visEdges){
    staggerParallel(e, e.to ? parallel.get(`${e.from}\u0000${e.to}`) : []); // 同 from→to 的平行线自动错开
    const st = STATUS[e.status] || STATUS.pending, g = edgeCurve(e);
    const arch = isEdgeArchived(e); // 归档线弱化渲染
    const isSel = isSelObj('edge', e.id);
    const singleSel = S.sel && S.sel.kind==='edge' && S.sel.id===e.id;
    const drawing = S.drawingEdge === e.id; // 正在从节点拉出:隐藏标签与端点手柄
    const sign = signOf[e.id];
    lines += `<path class="hit" data-edge="${e.id}" d="${g.d}" fill="none" stroke="transparent" stroke-width="16"/>`;
    // 悬停发光 / 选中高亮
    if (isSel) lines += `<path data-edge="${e.id}" d="${g.d}" fill="none" stroke="var(--accent)" stroke-width="5" opacity=".28" stroke-linecap="round" ${e.status!=='success'?`stroke-dasharray="${st.dash}"`:''}/>`;
    else if (S.hoverEdge === e.id) lines += `<path data-edge="${e.id}" d="${g.d}" fill="none" stroke="var(--accent)" stroke-width="6" opacity=".16" stroke-linecap="round"/>`;
    // 悬空线的可见端缩短 6px,给末端手柄让位,箭头画在悬空末端
    let dv = g.d;
    if (!e.to){
      let tx = g.x2-g.cpx, ty = g.y2-g.cpy;
      const tl = Math.hypot(tx,ty)||1; tx/=tl; ty/=tl;
      dv = `M ${g.x1} ${g.y1} Q ${g.cpx} ${g.cpy} ${g.x2-tx*6} ${g.y2-ty*6}`;
    }
    lines += `<path data-edge="${e.id}" class="hit" d="${dv}" fill="none"
      stroke="${st.color}" stroke-width="2" ${st.dash?`stroke-dasharray="${st.dash}"`:''} ${arch?'opacity=".28"':''}
      marker-end="url(#${markerOf[e.status]})" stroke-linecap="round"/>`;
    // 悬空端点手柄:常显,视觉轻(select 工具下可拖动)
    if (!e.to && !drawing) lines += `<circle class="handle" data-handle="end" data-edge="${e.id}" cx="${g.x2}" cy="${g.y2}" r="4.5"
      fill="var(--bg)" stroke="${st.color}" stroke-width="1.5"/>`;
    // 已连接线:选中或悬停时显示末端手柄(可拖下脱钩重新布线),位置向外偏移便于抓取
    if (e.to && (singleSel || S.hoverEdge === e.id)){
      const b = nodeById(e.to);
      const hdx = g.x2-b.x, hdy = g.y2-b.y, hl = Math.hypot(hdx,hdy)||1;
      const hx = b.x + hdx/hl*(b.r+16), hy = b.y + hdy/hl*(b.r+16);
      lines += `<circle class="handle" data-handle="end" data-edge="${e.id}" cx="${hx}" cy="${hy}" r="6"
        fill="var(--bg)" stroke="${st.color}" stroke-width="1.5"/>`;
    }
    // 弯曲手柄:仅单选该边时显示在曲线中点(Excalidraw 式:抓取点固定弯折)
    if (singleSel) lines += `<circle class="handle" data-handle="bend" data-edge="${e.id}" cx="${g.bx}" cy="${g.by}" r="4.5"
      fill="var(--accent)" stroke="var(--bg)" stroke-width="1.5"/>`;
    if (drawing) continue; // 拉出中的临时线不画标签
    if (inlineEdgeEdit === e.id) continue; // 方案名行内编辑中,不重建标签避免重影
    // 方案名:贝塞尔 t=0.5 的实际点,沿法线偏移约 14px 避免压线
    const lcx = g.bx + g.nx*sign*15, lcy = g.by + g.ny*sign*15 + 4;
    const lw = measureText12(e.name);
    const hasScore = e.score != null && e.score !== ''; // 评分徽标(0-100,人打/Agent建议)
    const bw = hasScore ? 20 : 0;
    labelBoxes.push({ x: lcx - lw/2 - 3, y: lcy - 13, w: lw + 6 + bw, h: 17 });
    labels += `<g class="hit" data-edge="${e.id}" style="pointer-events:all;cursor:pointer" ${arch?'opacity=".45"':''}>
      <text x="${lcx}" y="${lcy}" text-anchor="middle" font-size="12.5" font-weight="500"
        fill="var(--fg)" stroke="var(--bg)" stroke-width="5" paint-order="stroke">${esc(e.name)}</text>${
      hasScore ? `<text x="${lcx + lw/2 + 11}" y="${lcy}" text-anchor="middle" font-size="10" font-weight="600"
        fill="var(--muted)" stroke="var(--bg)" stroke-width="4" paint-order="stroke">${esc(String(e.score))}</text>` : ''}</g>`;
  }

  /* ---- 标注避让布局:便签位置候选打分,引导线表明归属 ---- */
  const ANN_H = 24;
  // 障碍物:方案线曲线采样点 + 方案名/路线名标签包围盒 + 节点圆
  const obsPts = [], obsBoxes = [...labelBoxes];
  for (const e of visEdges){
    const g = edgeCurve(e);
    for (let t = 0; t <= 1.001; t += .05){
      const it = 1 - t;
      obsPts.push({ x: it*it*g.x1 + 2*it*t*g.cpx + t*t*g.x2, y: it*it*g.y1 + 2*it*t*g.cpy + t*t*g.y2 });
    }
  }
  if (S.showRoutes) for (const r of S.routes){
    const first = S.nodes.find(n => n.route === r.id); if (!first) continue;
    const w = measureText12(r.name);
    obsBoxes.push({ x: first.x - w/2, y: first.y - first.r - 30, w, h: 16 });
  }
  // 罚分:压方案线最重,其次标签与节点,已摆放的便签重叠最重
  const annScore = (ax, ay, w, placed) => {
    let s = 0;
    for (const p of obsPts)
      if (p.x > ax-5 && p.x < ax+w+5 && p.y > ay-5 && p.y < ay+ANN_H+5) s += 10;
    for (const b of obsBoxes)
      if (!(ax > b.x+b.w+4 || b.x > ax+w+4 || ay > b.y+b.h+4 || b.y > ay+ANN_H+4)) s += 8;
    for (const c of S.nodes){
      const nx = Math.min(Math.max(c.x, ax), ax+w), ny = Math.min(Math.max(c.y, ay), ay+ANN_H);
      if (Math.hypot(c.x-nx, c.y-ny) < c.r + 6) s += 8;
    }
    for (const b of placed)
      if (!(ax > b.x+b.w+6 || b.x > ax+w+6 || ay > b.y+b.h+8 || b.y > ay+ANN_H+8)) s += 20;
    return s;
  };
  // 手绘感:按 id 哈希取固定微旋转(确定性,不随机抖动)
  const rotOf = id => { let h = 0; for (const c of id) h = (h*31 + c.charCodeAt(0))|0;
    return (Math.abs(h) % 25) / 10 * 2.4 - 1.2; };
  const annPos = [], placed = [], edgeAnnIdx = {};
  if (S.showAnns) for (const a of S.anns){
    if (a.hidden) continue;
    const w = measureText12(a.text);
    let ax, ay, tx, ty, noLeader = false;
    if (a.target.kind === 'node'){
      const n = nodeById(a.target.id); if (!n || n.archived) continue;
      // 8 方向候选(右侧优先),取罚分最小
      const d = n.r + 26, o = n.r*0.71 + 18;
      const cand = [
        { x: n.x + d,         y: n.y - ANN_H/2 },          // 右
        { x: n.x + o,         y: n.y - o - ANN_H },        // 右上
        { x: n.x + o,         y: n.y + o },                // 右下
        { x: n.x - d - w,     y: n.y - ANN_H/2 },          // 左
        { x: n.x - o - w,     y: n.y - o - ANN_H },        // 左上
        { x: n.x - o - w,     y: n.y + o },                // 左下
        { x: n.x - w/2,       y: n.y - d - ANN_H },        // 上
        { x: n.x - w/2,       y: n.y + d }                 // 下
      ];
      let best = cand[0], bs = 1e9;
      for (const c of cand){ const s = annScore(c.x, c.y, w, placed); if (s < bs){ bs = s; best = c; } }
      ax = best.x; ay = best.y; tx = n.x; ty = n.y;
    } else if (a.target.kind === 'canvas') {
      ax = Number.isFinite(a.x) ? a.x : 0;
      ay = Number.isFinite(a.y) ? a.y : 0;
      tx = ax; ty = ay; noLeader = true;
    } else {
      const e = edgeById(a.target.id); if (!e || nodeById(e.from)?.archived || (e.to && nodeById(e.to)?.archived)) continue;
      const g = edgeCurve(e), sign = signOf[e.id];
      const idx = edgeAnnIdx[e.id] = (edgeAnnIdx[e.id]||0) + 1;
      // 锚点曲线 t=0.5、方案名另一侧;压线则沿法向外移(最多两步)
      let best = null, bs = 1e9;
      for (let step = 0; step < 3; step++){
        const dist = 28 + (idx-1)*20 + step*20;
        const cx0 = g.bx - g.nx*sign*dist, cy0 = g.by - g.ny*sign*dist;
        const s = annScore(cx0 - w/2, cy0 - ANN_H/2, w, placed);
        if (s < bs){ bs = s; best = { x: cx0 - w/2, y: cy0 - ANN_H/2 }; }
        if (s === 0) break;
      }
      ax = best.x; ay = best.y; tx = g.bx; ty = g.by;
    }
    ax += a.dx||0; ay += a.dy||0; // 手动微调偏移
    // 尾巴式连接:取便签距锚点最近的一角,小角拉伸连向所属对象(替代细引导线)
    if (a.target.kind === 'node'){
      const n = nodeById(a.target.id);
      let c0 = [ax,ay], cd0 = 1e9;
      for (const c of [[ax,ay],[ax+w,ay],[ax,ay+ANN_H],[ax+w,ay+ANN_H]]){
        const dd = Math.hypot(c[0]-n.x, c[1]-n.y); if (dd < cd0){ cd0 = dd; c0 = c; }
      }
      const ddx = c0[0]-n.x, ddy = c0[1]-n.y, dl = Math.hypot(ddx,ddy)||1;
      tx = n.x + ddx/dl*(n.r+2); ty = n.y + ddy/dl*(n.r+2);
    }
    let C = [ax,ay], cd = 1e9;
    for (const c of [[ax,ay],[ax+w,ay],[ax,ay+ANN_H],[ax+w,ay+ANN_H]]){
      const dd = Math.hypot(c[0]-tx, c[1]-ty); if (dd < cd){ cd = dd; C = c; }
    }
    if (!noLeader && cd > 8){
      const ex = C[0] === ax ? 9 : -9, ey = C[1] === ay ? 9 : -9;
      leaders += `<path d="M ${C[0]+ex} ${C[1]} L ${tx} ${ty} L ${C[0]} ${C[1]+ey} Z" fill="var(--note)" stroke="var(--note-border)" stroke-width="1" stroke-linejoin="round"/>`;
    }
    annPos.push({ a, ax, ay, rot: rotOf(a.id) });
    placed.push({ x: ax, y: ay, w, h: ANN_H });
  }
  svg.innerHTML = defs + lines + leaders + labels;

  // 节点 / 路线名 / 标注
  world.querySelectorAll('.node,.route-label,.ann,#selbox').forEach(el => el.remove());
  if (S.showRoutes) for (const r of S.routes){
    if (inlineRouteEdit === r.id) continue; // 路线名行内编辑中,不重建标签避免重影
    const first = S.nodes.find(n => n.route === r.id); if (!first) continue;
    const el = document.createElement('div');
    el.className = 'route-label'; el.dataset.route = r.id;
    el.style.left = first.x + 'px'; el.style.top = (first.y - first.r - 30) + 'px';
    el.textContent = r.name;
    world.appendChild(el);
  }
  for (const n of S.nodes){
    if (n.archived) continue;
    // 节点名行内编辑中:照常渲染圆圈(editing 类隐藏圆内文字),避免"圆圈消失只剩输入框"
    const L = layout.get(n.id);
    const el = document.createElement('div');
    const nodeKind = nodeKindOf(n);
    const isResolved = nodeKind === 'problem' && n.resolved === true;
    el.className = 'node' + (isSelObj('node', n.id) ? ' sel':'') + (S.snapTo === n.id ? ' snap':'') + (inlineNodeEdit === n.id ? ' editing':'') + (isResolved ? ' resolved':'');
    el.dataset.type = n.type; el.dataset.kind = nodeKind; el.dataset.id = n.id;
    if (isResolved) el.dataset.resolved = 'true';
    el.setAttribute('role', 'button'); el.setAttribute('aria-label', `${el.dataset.kind === 'problem' ? (isResolved ? '已解决问题节点' : '问题节点') : '节点'}：${n.name}`);
    el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
    // 编号/时间徽标顺时针环绕（问题徽章保持原版 ::before 右上，不经此处）：编号右侧、时间右下
    const showTime = S.showNodeTime && n.updatedAt;
    const timeText = showTime ? fmtNodeTime(n.updatedAt, S.nodeTimeMode || 'auto') : '';
    const timeFull = showTime ? fmtNodeTimeFull(n.updatedAt) : '';
    const badges = [];
    if (S.showNums && n.num) badges.push(`<span class="nbadge num">${esc(n.num)}</span>`);
    if (showTime) badges.push(`<span class="nbadge time" title="${esc(timeFull)}">${esc(timeText)}</span>`);
    const badgeRing = badges.length ? `<div class="bring">${badges.join('')}</div>` : '';
    el.innerHTML = `<div class="dot" style="width:${n.r*2}px;height:${n.r*2}px"><span>${L.lines.map(esc).join('<br>')}</span></div>${badgeRing}`;
    world.appendChild(el);
  }
  for (const { a, ax, ay, rot } of annPos){
    if (inlineEditing && inlineEditing.annId === a.id) continue; // 编辑中的便签由输入框占位,不重建(避免重影)
    const el = document.createElement('div');
    el.className = 'ann' + (S.selAnn === a.id ? ' sel':''); el.dataset.ann = a.id;
    el.style.left = ax + 'px'; el.style.top = ay + 'px';
    el.style.transform = `rotate(${rot}deg)`;
    el.textContent = a.text;
    world.appendChild(el);
  }
  // 多选包围框:紫蓝实线 + 四角手柄(Excalidraw 式)
  if (S.multi.length){
    let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
    const grow = (x,y) => { minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y); };
    for (const m of S.multi){
      if (m.kind==='node'){ const n=nodeById(m.id); if (n){ grow(n.x-n.r,n.y-n.r); grow(n.x+n.r,n.y+n.r); } }
      else { const e=edgeById(m.id); if (e){ const g=edgeCurve(e); grow(g.x1,g.y1); grow(g.x2,g.y2); grow(g.cpx,g.cpy); } }
    }
    const pad=14, box=document.createElement('div');
    box.id='selbox';
    box.style.left=(minX-pad)+'px'; box.style.top=(minY-pad)+'px';
    box.style.width=(maxX-minX+pad*2)+'px'; box.style.height=(maxY-minY+pad*2)+'px';
    for (const [hx,hy] of [[0,0],[100,0],[0,100],[100,100]]){
      const h=document.createElement('div'); h.className='h';
      h.style.left=`calc(${hx}% - 5px)`; h.style.top=`calc(${hy}% - 5px)`;
      box.appendChild(h);
    }
    world.appendChild(box);
  }
  updateOverviewCanvas();
  applyView();
  rememberRender(renderStructureKey());
}

/* ---------- 选择 + 属性面板 ---------- */
/* dock 编辑器会话(编辑模式);切换选中对象前用它做未保存守卫 */