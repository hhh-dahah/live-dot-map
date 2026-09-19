async function boot(){
  syncBadge();
  if (!hasFS) return;
  let dir = null;
  try{ dir = await idbGet('dotmap-dir'); }catch{}
  if (!dir) return;
  try{
    const p = await dir.queryPermission({ mode:'readwrite' });
    if (p === 'granted') await attachDir(dir);
    else toast('点左上角「选择项目」继续上次项目。');
  }catch{ /* 句柄失效,忽略 */ }
}

/* ---------- 新手引导与三分钟教程 ---------- */
function overlayCard(html, width){
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:80;background:rgba(27,27,31,.36);display:flex;align-items:center;justify-content:center';
  const card = document.createElement('div');
  card.style.cssText = `background:var(--bg);border-radius:14px;box-shadow:var(--shadow);width:min(${width||520}px,92vw);max-height:84vh;overflow:auto;padding:26px 28px`;
  card.innerHTML = html;
  ov.appendChild(card);
  ov.addEventListener('pointerdown', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  return ov;
}
const GUIDE_BTN = 'display:block;width:100%;padding:11px 14px;margin-top:10px;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--fg);font:inherit;font-size:14px;text-align:left;cursor:pointer';
function showGuide(manual){
  const ov = overlayCard(`
    <div style="font-size:20px;font-weight:700;letter-spacing:.5px">活点地图</div>
    <div style="color:var(--muted);font-size:13px;margin-top:6px;line-height:1.7">
      一张人和 Agent 共享的探索地图：节点写目标与结果，方案线记每次尝试，<br>
      Agent 每次会话先读地图汇报全局，你只做判断。
    </div>
    ${hasFS ? `<button data-g="open" style="${GUIDE_BTN};border-color:var(--accent);font-weight:600">📁 选择项目<span style="display:block;font-size:12px;color:var(--muted);font-weight:400;margin-top:3px">改动自动存进项目，Agent 与你读写同一张地图</span></button>` : ''}
    <button data-g="demo" style="${GUIDE_BTN}">🗺️ 先看看演示地图<span style="display:block;font-size:12px;color:var(--muted);margin-top:3px">内置示例，随便点随便改，不碰你的文件</span></button>
    <button data-g="tut" style="${GUIDE_BTN}">🎓 三分钟上手<span style="display:block;font-size:12px;color:var(--muted);margin-top:3px">画布操作、状态规则、Agent 接入各一句话</span></button>
    <div style="color:var(--muted);font-size:12px;margin-top:16px;line-height:1.6">本地优先：文件都在你自己的文件夹里，不上传任何服务器。</div>
  `, 480);
  const seen = () => { try{ localStorage.setItem('dotmap-guide-seen','1'); }catch{} };
  ov.querySelector('[data-g="demo"]').onclick = () => { seen(); ov.remove(); };
  ov.querySelector('[data-g="tut"]').onclick = () => { seen(); ov.remove(); showTutorial(); };
  const b = ov.querySelector('[data-g="open"]');
  if (b) b.onclick = () => { seen(); ov.remove(); openProjectFolder(); };
  if (manual) seen();
}
async function showFirstMapGuide(){
  const ov = $('#first-map-guide'); if (!ov) return;
  const choices = $('#first-guide-choices'); if (!choices) return;
  const seen = () => { try{ localStorage.setItem('dotmap-guide-seen','1'); }catch{} };
  const close = () => ov.classList.remove('on');
  ov.classList.add('on');
  choices.textContent = '';
  const bridge = window.LiveDotBridge;
  let recent = [];
  if (bridge?.active && typeof bridge.recentProjects === 'function'){
    try { recent = await bridge.recentProjects(); } catch { recent = []; }
  }
  const makeChoice = (key, strong, span) => {
    const b = document.createElement('button');
    b.className = 'choice'; b.dataset.firstChoice = key;
    const s = document.createElement('strong'); s.textContent = strong;
    const p = document.createElement('span'); p.textContent = span;
    b.append(s, p); choices.appendChild(b);
    return b;
  };
  // 第一入口：选择项目…（桥模式：最近项目 + 本机选择器；无桥：连接文件夹）
  if (bridge?.active || hasFS){
    const pickBtn = makeChoice('pick', '选择项目…',
      bridge?.active ? '打开最近项目或本机文件夹，Agent 与你看同一张地图' : '选择项目文件夹，地图自动存进项目');
    pickBtn.onclick = async () => {
      seen();
      if (!bridge?.active){ close(); openProjectFolder(); return; }
      choices.textContent = '';
      if (recent.length){
        const head = document.createElement('div'); head.className = 'mhead'; head.textContent = '最近项目';
        choices.appendChild(head);
        for (const root of recent.slice(0, 6)){
          const b = document.createElement('button'); b.className = 'choice';
          const s = document.createElement('strong'); s.textContent = root.split(/[\\/]/).filter(Boolean).pop() || root;
          const p = document.createElement('span'); p.textContent = root;
          b.append(s, p);
          b.onclick = () => { close(); void switchProjectFlow(root); };
          choices.appendChild(b);
        }
        const sep = document.createElement('div'); sep.className = 'msep';
        choices.appendChild(sep);
      }
      const other = makeChoice('pick-other', '选择其他项目…', '使用本机文件夹选择器');
      other.onclick = () => { close(); void pickProjectFlow(); };
      const back = document.createElement('button'); back.className = 'choice back-choice';
      back.textContent = '← 返回';
      back.onclick = () => { void showFirstMapGuide(); };
      choices.appendChild(back);
    };
  }
  // 第二入口：空白开始
  const blankBtn = makeChoice('blank', '空白开始', '自己添加目标、问题和方案线');
  blankBtn.onclick = () => { seen(); close(); newBlankMap(); };
  // 第三入口：看看简单示例
  const demoBtn = makeChoice('demo', '看看简单示例', '只加载内置示例，不读取你的项目文件');
  demoBtn.onclick = () => { seen(); close(); loadDemoMap(); };
}
function loadDemoMap(){
  IO.sourceDocument = null; IO.sourceVersion = null; IO.readOnly = false; IO.mapFile = null; IO.mapId = null;
  currentMapDir = '.live-dot-map';
  S = seed(); undoStack = []; redoStack = [];
  applyName(); render(); fitView(); toast('已加载简单示例（不会读取项目文件）');
}
function showTutorial(){
  const ov = overlayCard(`
    <div style="font-size:16px;font-weight:700">三分钟上手</div>
    <ol style="margin:14px 0 0;padding-left:20px;font-size:13px;line-height:1.9;color:var(--fg)">
      <li><b>画布</b>：滚轮缩放，空格或中键拖拽平移。快捷键 V 选择、N 建节点、L 拉方案线、M 加便签。</li>
      <li><b>节点与方案</b>：节点只写目标/问题/结果；每一次尝试是一条方案线——绿=成功，红=失败，灰=待验证。成功了顺手打个分（0–100），以后一眼看出哪条最值。</li>
      <li><b>文件夹即存档</b>：选择项目后，改动自动存进项目，详情写在 Markdown 里。不用的方案可以归档——只是淡出，不删数据。</li>
      <li><b>Agent 接入</b>：把 <span class="mono">agent-kit/AGENTS.snippet.md</span> 的内容追加到项目 AGENTS.md，Agent 每次会话开始就会先读地图、主动汇报「等你判断的清单」。</li>
      <li><b>安全边界</b>：Agent 只能读写当前项目文件夹；删除节点与方案线前会先问你。</li>
    </ol>
    <button data-g="done" style="${GUIDE_BTN};text-align:center;font-weight:600;border-color:var(--accent)">开始用</button>
  `, 520);
  ov.querySelector('[data-g="done"]').onclick = () => ov.remove();
}

/* ---------- 启动 ---------- */
// PWA:注册 service worker(file:// 双击打开时自动跳过)
// 本地桥 loopback 页面不注册：SW 会拦截 /api/v1/*（Firefox 的 EventSource 尤其受影响），
// 且本地协作页面的应用壳应始终来自当前桥版本，不需要离线缓存。
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !/^(127\.0\.0\.1|localhost|\[::1\])/.test(location.hostname)){
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
const q = new URLSearchParams(location.search);
if (q.get('blank') === '1' || q.get('empty') === '1'){
  // 空画布:工具可用,无中央输入
  S.nodes = []; S.edges = []; S.anns = []; S.routes = [{id:'r1', name:'主路线', source:null, main:true, createdAt:today(), updatedAt:today()}];
}
if (q.get('demo') === '1'){
  S = seed();
}
if (q.get('stress')){
  // 性能压测:?stress=N 生成 N 节点 + 2N 方案线(只在内存,不写文件)
  const N = Math.max(10, +q.get('stress') || 200);
  S.nodes = []; S.edges = []; S.anns = [];
  S.routes = [{id:'r1', name:'压测路线', source:null, main:true, createdAt:today(), updatedAt:today()}];
  for (let i = 0; i < N; i++){
    const col = i % 20, row = (i / 20) | 0;
    S.nodes.push({ id:'n'+(i+1), num:String(i+1).padStart(2,'0'), name:'节点'+(i+1),
      type: i%7===0 ? '问题' : (i%3===0 ? '结果' : '目标'), route:'r1',
      x:col*260, y:row*220, r:34, md:null, createdAt:today(), updatedAt:today() });
  }
  for (let i = 0; i < N*2; i++){
    const f = (i % N) + 1, t = ((i*7+3) % N) + 1;
    const e = { id:'e'+(i+1), from:'n'+f, to: i%4===0 ? null : 'n'+t,
      name:'方案'+(i+1), status:['success','failed','pending'][i%3], route:'r1',
      md:null, createdAt:today(), updatedAt:today() };
    if (!e.to){ e.dx = 120 + (i%5)*30; e.dy = 90 - (i%3)*60; }
    S.edges.push(e);
  }
  S.nextNum = N+1; S.nextEdge = N*2+1;
}
render();
fitView();
if (q.get('from') === 'agent'){
  agentWork('正在建立地图…', () => { render(); }, 1400);
}
boot().then(() => { // 首次使用且未自动连上项目文件夹时,显示新手引导
  // 没有地图时只显示三个明确入口；选择过任意入口后不再打扰（dotmap-guide-seen 去重）。
  let guideSeen = false;
  try { guideSeen = localStorage.getItem('dotmap-guide-seen') === '1'; } catch { /* 隐私模式 */ }
  if (!guideSeen && !window.LiveDotBridge?.active && !IO.mapFile && !q.get('blank') && !q.get('empty') && !q.get('demo') && !q.get('stress') && q.get('from') !== 'agent' && S.nodes.length === 0){
    void showFirstMapGuide();
  }
});

/* ---------- 连接状态弹窗(T9:正常/断线两态,文案定稿见 8-20 讨论 T9) ---------- */
const LiveDotUI = (() => {
  const ONLINE = new Set(['draft', 'saving', 'saved']);
  let current = 'saved';
  let episodeOpen = false; // 同一次断线只自动弹一次,恢复后才复位
  let ov = null;
  let standaloneSeen = false;
  try { standaloneSeen = localStorage.getItem('dotmap-standalone-seen') === '1'; } catch { /* 隐私模式 */ }

  function close(){ ov?.remove(); ov = null; }

  function dialog({ title, body, primary, footnote }){
    close();
    ov = document.createElement('div'); ov.className = 'ld-dialog-ov';
    const card = document.createElement('div'); card.className = 'ld-dialog';
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', title);
    const h = document.createElement('div'); h.className = 'ld-dialog-title'; h.textContent = title;
    const p = document.createElement('div'); p.className = 'ld-dialog-body'; p.textContent = body;
    card.append(h, p);
    if (primary){
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ld-dialog-primary'; btn.textContent = primary.label;
      btn.addEventListener('click', () => void primary.onClick(btn));
      card.appendChild(btn);
    }
    if (footnote){ const f = document.createElement('div'); f.className = 'ld-dialog-foot'; f.textContent = footnote; card.appendChild(f); }
    ov.appendChild(card);
    ov.addEventListener('pointerdown', e => { if (e.target === ov) close(); });
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.body.appendChild(ov);
    (card.querySelector('.ld-dialog-primary') || card).focus();
  }

  function showOffline(){
    dialog({
      title: '已断线',
      body: '画布和电脑的连接断了。你写的内容都在，恢复后会自动保存。',
      footnote: '还是连不上？双击桌面上的「活点地图」图标，再回来点这里。',
      primary: { label: '重新连接', async onClick(btn){
        btn.disabled = true; btn.textContent = '正在连接…';
        let ok = false;
        try { ok = Boolean(await window.LiveDotBridge?.reconnect?.()); } catch { ok = false; }
        // 成功时桥会回置正常状态,onStatusChange 负责关弹窗;失败则恢复按钮,小字继续指路。
        if (!ok && ov){ btn.disabled = false; btn.textContent = '重新连接'; }
      } }
    });
  }

  function showStandalone(){
    dialog({
      title: '单机模式',
      body: '现在内容能保存在这个文件里，但 Agent 看不到。想让 Agent 看到，双击桌面上的「活点地图」图标打开。',
      primary: { label: '知道了', onClick(){ close(); } }
    });
  }

  function onStatusChange(state){
    current = state;
    if (ONLINE.has(state)){ episodeOpen = false; close(); return; }
    // 无桥直开文件 = 单机模式,仅首次提示;有桥时的 fallback(导入旧文件等)不弹。
    if (state === 'fallback'){
      if (!window.LiveDotBridge?.active && !standaloneSeen){
        standaloneSeen = true;
        try { localStorage.setItem('dotmap-standalone-seen', '1'); } catch { /* 隐私模式 */ }
        showStandalone();
      }
      return;
    }
    // conflict 不是断线(语义是双方同时改了),不弹断线窗,详情留在状态点 hover。
    if ((state === 'offline' || state === 'error') && !episodeOpen){
      episodeOpen = true;
      showOffline();
    }
  }

  /* 点状态灯:断线类状态重新打开指引;其余(含 conflict)交给调用方 toast */
  function openStatus(){
    if (ONLINE.has(current) || current === 'conflict') return false;
    if (current === 'fallback' && !window.LiveDotBridge?.active){ showStandalone(); return true; }
    showOffline();
    return true;
  }

  return { onStatusChange, openStatus };
})();
window.LiveDotUI = LiveDotUI;

