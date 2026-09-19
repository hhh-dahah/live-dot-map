function addEdge(fromId, toId, w){
  const from = nodeById(fromId);
  const eName = `方案${S.edges.filter(o => o.from === fromId).length + 1}`;
  const e = { id:'e'+(S.nextEdge++), from:fromId, to:toId, name:eName,
    status: toId ? 'success' : 'pending', route:from.route,
    md: mdPath('routes', `e${S.nextEdge-1}`) };
  if (!toId){ e.dx = w.x - from.x; e.dy = w.y - from.y; }
  S.edges.push(e); select('edge', e.id); render();
}
let renderFrame = 0;
function scheduleRender(){
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => { renderFrame = 0; render(); });
}
addEventListener('pointermove', ev => {
  // 自绘十字准星跟随:工具模式下显示,悬停 UI(工具栏/面板/菜单/输入框)时隐藏
  crosshairEl.style.setProperty('--cx', ev.clientX + 'px');
  crosshairEl.style.setProperty('--cy', ev.clientY + 'px');
  crosshairEl.hidden = !viewport.classList.contains('tool-place')
    || !!(ev.target.closest && ev.target.closest('.chrome,#panel,#popover,.menu,.inline-edit'));
  // 无拖拽时:方案线悬停紫色发光
  if (!drag){
    if (S.tool !== 'select') { if (S.hoverEdge){ S.hoverEdge = null; render(); } return; }
    const w = toWorld(ev.clientX, ev.clientY);
    let hov = null;
    for (const e of S.edges){
      if (isEdgeArchived(e)) continue; // 归档线不参与悬停命中
      const g = edgeCurve(e);
      for (let t = 0; t <= 1.001; t += .04){
        const p = bezPt(t, g);
        if (Math.hypot(p.x-w.x, p.y-w.y) < 8/S.view.k){ hov = e.id; break; }
      }
      if (hov) break;
    }
    if (hov !== S.hoverEdge){ S.hoverEdge = hov; scheduleRender(); }
    return;
  }
  if (drag.type === 'pan'){
    S.view.x = drag.ox + ev.clientX - drag.sx;
    S.view.y = drag.oy + ev.clientY - drag.sy;
    applyView();
  } else if (drag.type === 'marquee'){
    const x = Math.min(drag.sx, ev.clientX), y = Math.min(drag.sy, ev.clientY);
    marqueeEl.style.left = x+'px'; marqueeEl.style.top = y+'px';
    marqueeEl.style.width = Math.abs(ev.clientX-drag.sx)+'px';
    marqueeEl.style.height = Math.abs(ev.clientY-drag.sy)+'px';
    drag.ex = ev.clientX; drag.ey = ev.clientY;
  } else if (drag.type === 'end' || drag.type === 'bend'){
    // 4px 死区:按下后的轻微抖动不算拖拽(与节点/便签一致),否则单击被误判拖拽、箭头终点卡进圆圈内
    if (!drag.moved){
      if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) <= 4) return;
      drag.moved = true;
    }
    const w = toWorld(ev.clientX, ev.clientY);
    if (drag.type === 'end'){
      // 端点吸附:命中节点时高亮并吸到其边缘,松手未命中则保持悬空灰色
      // 已连接边拖拽时使用更小吸附半径,便于脱离
      const snapRadius = drag.wasConnected ? (n) => n.r * 0.6 : (n) => n.r + 12;
      const snap = S.nodes.find(n => n.id !== drag.e.from && Math.hypot(n.x-w.x, n.y-w.y) < snapRadius(n)) || null;
      const a = nodeById(drag.e.from);
      let px = w.x, py = w.y;
      if (snap !== null){
        if (S.snapTo !== snap.id){ S.snapTo = snap.id; }
        const dx = snap.x-a.x, dy = snap.y-a.y, d = Math.hypot(dx,dy)||1;
        const len = Math.max(10, d - snap.r);
        px = a.x + dx/d*len; py = a.y + dy/d*len;
      } else {
        if (S.snapTo){ S.snapTo = null; }
      }
      drag.e.dx = px - a.x; drag.e.dy = py - a.y; // 拖拽完全跟随指针:方向自由自定义
      // 钉住前段锚点 B(0.25):曲线前半段基本固定,后半段自由弯折,保持平滑
      if (drag.anchor){
        const g = edgeEnds(drag.e), t = .25, it = .75;
        drag.e.cx = (drag.anchor.x - it*it*g.x1 - t*t*g.x2) / (2*it*t) - (g.x1+g.x2)/2;
        drag.e.cy = (drag.anchor.y - it*it*g.y1 - t*t*g.y2) / (2*it*t) - (g.y1+g.y2)/2;
      }
    } else {
      // 弯折:抓取点(参数 t 处)固定在指针下,反推控制点,其余部分随之变形
      const g = edgeEnds(drag.e), t = drag.t || .5, it = 1-t;
      drag.e.cx = (w.x - it*it*g.x1 - t*t*g.x2) / (2*it*t) - (g.x1+g.x2)/2;
      drag.e.cy = (w.y - it*it*g.y1 - t*t*g.y2) / (2*it*t) - (g.y1+g.y2)/2;
    }
    scheduleRender();
  } else if (drag.type === 'ann'){
    if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 4) drag.moved = true;
    if (drag.moved){
      drag.a.dx = drag.odx + (ev.clientX - drag.sx) / S.view.k;
      drag.a.dy = drag.ody + (ev.clientY - drag.sy) / S.view.k;
      scheduleRender();
    }
  } else {
    if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 4) drag.moved = true;
    if (drag.moved){
      drag.n.x = drag.ox + (ev.clientX - drag.sx) / S.view.k;
      drag.n.y = drag.oy + (ev.clientY - drag.sy) / S.view.k;
      scheduleRender();
    }
  }
});
addEventListener('pointerup', ev => {
  if (drag && drag.type === 'marquee'){
    marqueeEl.style.display = 'none';
    const x1 = Math.min(drag.sx, drag.ex ?? drag.sx), y1 = Math.min(drag.sy, drag.ey ?? drag.sy);
    const x2 = Math.max(drag.sx, drag.ex ?? drag.sx), y2 = Math.max(drag.sy, drag.ey ?? drag.sy);
    if (x2 - x1 > 6 || y2 - y1 > 6){
      const p1 = toWorld(x1, y1), p2 = toWorld(x2, y2);
      const inRect = (x, y) => x >= p1.x && x <= p2.x && y >= p1.y && y <= p2.y;
      for (const n of S.nodes) if (inRect(n.x, n.y)) S.multi.push({kind:'node', id:n.id});
      for (const e of S.edges){
        if (!S.showFailed && e.status === 'failed') continue; // 隐藏的失败线不参与框选
        const g = edgeCurve(e); let hit = inRect(g.x1, g.y1) && inRect(g.x2, g.y2);
        if (!hit) for (let t = 0; t <= 1.001 && !hit; t += .1) hit = inRect(bezPt(t, g).x, bezPt(t, g).y);
        if (hit) S.multi.push({kind:'edge', id:e.id});
      }
      render();
      if (S.multi.length){
        // 一键删除按钮:悬浮在选区右上角
        let mX = -1e9, mY = 1e9;
        for (const m of S.multi){
          if (m.kind==='node'){ const n=nodeById(m.id); if (n){ mX=Math.max(mX,n.x+n.r); mY=Math.min(mY,n.y-n.r); } }
          else { const e2=edgeById(m.id); if (e2){ const g=edgeCurve(e2); mX=Math.max(mX,g.x1,g.x2); mY=Math.min(mY,g.y1,g.y2); } }
        }
        delFloat.style.left = (mX*S.view.k + S.view.x + 12) + 'px';
        delFloat.style.top = (mY*S.view.k + S.view.y - 44) + 'px';
        delFloat.classList.add('on');
      }
    } else {
      // 框选距离太小视为点击:清空选择(延迟渲染)
      S.selAnn = null; clearMulti(); S.sel = null;
      // 路线名/方案名标签双击行内编辑:浏览器 dblclick 会因渲染重建 DOM 而丢失,这里手动识别(按对象 key,元素实例会随渲染重建)
      const dblTarget = ev.target.closest('.route-label') || ev.target.closest('#edges text');
      if (dblTarget){
        const isRoute = dblTarget.classList.contains('route-label');
        const key = isRoute ? 'r:' + dblTarget.dataset.route : 'e:' + (dblTarget.closest('[data-edge]')?.dataset.edge || '');
        const now = Date.now();
        if (lastClick && lastClick.key === key && now - lastClick.t < 400){
          lastClick = null;
          if (isRoute){
            const r = S.routes.find(x => x.id === dblTarget.dataset.route);
            if (r) editRouteName(r, dblTarget);
          } else {
            const g = dblTarget.closest('[data-edge]');
            if (g){ const e = edgeById(g.dataset.edge); if (e) editEdgeName(e, dblTarget); }
          }
        } else {
          lastClick = { key, t: now };
        }
      }
      requestAnimationFrame(() => { render(); renderPanel(); });
    }
  }
  if (drag && drag.type === 'node' && !drag.moved){
    S.selAnn = null;
    // 走 select() 统一入口:编辑器未保存守卫对画布点选同样生效;
    // defer=true 延迟渲染保持 DOM 稳定(同步重建会销毁事件目标,浏览器不再派发 click/dblclick,双击编辑依赖它)
    select('node', drag.n.id, true);
  }
  if (drag && drag.type === 'node' && drag.moved) pushHistory();
  // 手柄拖拽结束:端点命中节点则吸附连接并标为成功(变绿);未命中保持悬空灰色
  if (drag && drag.type === 'end'){
    if (drag.moved){
      if (S.snapTo){
        const snap = nodeById(S.snapTo);
        if (snap && snap.id !== drag.e.from){
          delete drag.e.dx; delete drag.e.dy;
          drag.e.to = snap.id; drag.e.status = 'success';
        }
        S.snapTo = null;
      }
      pushHistory();
    } else if (S.drawingEdge === drag.e.id){
      // 点击节点未拖动:自动生成一条默认长度悬空线,方向与同节点已有线 ≥30° 自动错开
      const len = Math.hypot(150, 40);
      const ang = avoidAngleDeg(Math.atan2(40, 150) * 180 / Math.PI, drag.e) * Math.PI / 180;
      drag.e.dx = len * Math.cos(ang); drag.e.dy = len * Math.sin(ang);
    }
    if (S.drawingEdge === drag.e.id) S.drawingEdge = null; // 保持箭头工具,可连续拉线
    render(); renderPanel();
  }
  if (drag && drag.type === 'bend'){
    if (drag.moved) pushHistory();
    else {
      // 双击方案线任意位置(线身/中点手柄/标签)行内重命名:选中会重建 DOM、原生 dblclick 常丢失,这里手动识别
      const gEl = ev.target.closest('[data-edge]');
      const eid = gEl ? gEl.dataset.edge : null;
      const now = Date.now();
      if (eid && lastClick && lastClick.key === 'e:'+eid && now - lastClick.t < 400){
        lastClick = null;
        const e = edgeById(eid);
        // 输入框定位到方案名标签处(标签隐藏时退化为点击位置)
        const tx = document.querySelector(`#edges g[data-edge="${CSS.escape(eid)}"] text`);
        if (e && tx) editEdgeName(e, tx);
      } else if (eid) {
        lastClick = { key:'e:'+eid, t: now };
      }
      select('edge', drag.e.id);
    }
  }
  if (drag && drag.type === 'ann'){
    if (drag.moved) pushHistory();
    else if (drag.wasSel) editAnn(drag.a);          // 已选中再点:行内编辑
    else if (S.selAnn !== drag.a.id){ S.selAnn = drag.a.id; render(); } // 首次点击:紫色选中
  }
  if (drag && drag.type === 'pan' && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 4
      && ev.target === viewport){ S.selAnn = null; select(null); clearMulti(); render(); }
  drag = null; viewport.classList.remove('panning');
});
/* 框选后一键删除 */
delFloat.onclick = () => {
  if (!S.multi.length) return;
  pushHistory();
  const nodeIds = new Set(S.multi.filter(m => m.kind==='node').map(m => m.id));
  const edgeIds = new Set(S.multi.filter(m => m.kind==='edge').map(m => m.id));
  S.edges = S.edges.filter(e => {
    if (edgeIds.has(e.id)) return false;
    if (nodeIds.has(e.from)) return false;
    if (nodeIds.has(e.to)){
      const origTo = e.to; e.to = null; e.status = 'pending';
      const a = nodeById(e.from), b = S.nodes.find(n => n.id === origTo) || {x:a.x+200,y:a.y};
      const d = Math.hypot(b.x-a.x, b.y-a.y)||1;
      e.dx = (b.x-a.x)/d*(d+50); e.dy = (b.y-a.y)/d*(d+50);
    }
    return true;
  });
  S.nodes = S.nodes.filter(n => !nodeIds.has(n.id));
  S.anns = S.anns.filter(a => (a.target.kind==='node' ? !nodeIds.has(a.target.id) : !edgeIds.has(a.target.id)));
  clearMulti(); select(null); render();
};
viewport.addEventListener('wheel', ev => {
  ev.preventDefault();
  if (ev.ctrlKey || ev.metaKey) zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.09 : 1/1.09);
  else { S.view.x -= ev.deltaX; S.view.y -= ev.deltaY; applyView(); }
}, { passive:false });
viewport.addEventListener('contextmenu', ev => {
  ev.preventDefault();
  if (ev.target.closest('.chrome,#panel,#popover,.menu')) return;
  const nodeEl = ev.target.closest('.node'), edgeEl = ev.target.closest('[data-edge]');
  if (nodeEl) nodeMenu(nodeById(nodeEl.dataset.id), ev.clientX, ev.clientY);
  else if (edgeEl) edgeMenu(edgeById(edgeEl.dataset.edge), ev.clientX, ev.clientY);
  else canvasMenu(ev.clientX, ev.clientY);
});
world.addEventListener('dblclick', ev => {
  // 双击方案线任意位置:行内重命名(主要靠 pointerup 的 lastClick 手动识别,这里兜底 DOM 未重建的场景)
  const gEl = ev.target.closest('[data-edge]');
  if (gEl){
    const e = edgeById(gEl.dataset.edge);
    if (e && inlineEdgeEdit !== e.id){
      const tx = ev.target.tagName === 'text' ? ev.target
        : document.querySelector(`#edges g[data-edge="${CSS.escape(e.id)}"] text`);
      if (tx){ editEdgeName(e, tx); return; }
    }
  }
  // 双击节点:行内编辑节点名
  const nodeEl = ev.target.closest('.node');
  if (nodeEl){ const n = nodeById(nodeEl.dataset.id); if (n){ editNodeName(n, nodeEl); return; } }
  // 双击路线名:行内编辑路线名
  const rl = ev.target.closest('.route-label');
  if (rl){ const r = S.routes.find(x => x.id === rl.dataset.route); if (r){ editRouteName(r, rl); return; } }
  // 双击便签:重置手动偏移,回到自动避让位置
  const el = ev.target.closest('.ann'); if (!el) return;
  const a = S.anns.find(x => x.id === el.dataset.ann);
  if (a && (a.dx || a.dy)){ pushHistory(); delete a.dx; delete a.dy; render(); }
});
$('#zoom-in').onclick = () => zoomAt(innerWidth/2, innerHeight/2, 1.25);
$('#zoom-out').onclick = () => zoomAt(innerWidth/2, innerHeight/2, .8);
$('#zoom-val').onclick = () => fitView();
$('#undo').onclick = () => undo();
$('#redo').onclick = () => redo();

/* ---------- 快捷键 ---------- */
addEventListener('keydown', ev => {
  if (ev.target.matches('input,textarea,[contenteditable="true"]')) return;
  const k = ev.key.toLowerCase();
  if (ev.code === 'Space'){ spaceDown = true; viewport.style.cursor = 'grab'; }
  if (k === 'v') setTool('select');
  if (k === 'h') setTool('hand');
  if (k === 'n') setTool('node');
  if (k === 'l') setTool('edge');
  if (k === 'm') setTool('ann');
  if (k === 'escape'){ setTool('select'); S.selAnn = null; clearMulti(); select(null); closeMenu(); closePopover(); render(); }
  if (k === 'delete' || k === 'backspace'){
    // 框选一键删除 > 便签 > 单选对象
    if (S.multi.length){ delFloat.click(); return; }
    if (S.selAnn){ pushHistory(); S.anns = S.anns.filter(x => x.id !== S.selAnn); S.selAnn = null; render(); renderPanel(); return; }
    if (S.sel){
      pushHistory();
      if (S.sel.kind === 'node'){ const id = S.sel.id;
        S.edges = S.edges.filter(e => e.from!==id && e.to!==id);
        S.nodes = S.nodes.filter(n => n.id!==id);
      } else S.edges = S.edges.filter(e => e.id !== S.sel.id);
      select(null); render();
    }
  }
  if ((ev.ctrlKey || ev.metaKey) && k === 'z' && !ev.shiftKey){ ev.preventDefault(); $('#undo').click(); }
  if ((ev.ctrlKey || ev.metaKey) && (k === 'y' || (k === 'z' && ev.shiftKey))){ ev.preventDefault(); $('#redo').click(); }
  if ((ev.ctrlKey || ev.metaKey) && k === 's'){ ev.preventDefault(); exportMap(); }
});
addEventListener('keyup', ev => {
  if (ev.code === 'Space'){ spaceDown = false; viewport.style.cursor = ''; }
});

/* ---------- 新建地图:多地图布局下建一张新图并切换过去 ---------- */