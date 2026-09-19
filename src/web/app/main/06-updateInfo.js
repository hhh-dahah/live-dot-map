let updateInfo = null;           // { current, latest, available } | null
let updateChecked = false;
let updateBannerDismissedFor = '';  // 「稍后」只关当前这个版本号的提示条,红点保留
async function checkForUpdate(){
  if (!window.LiveDotBridge?.active) return;
  const info = await window.LiveDotBridge.checkUpdate();
  if (!info || typeof info !== 'object') return;
  updateInfo = info;
  $('#proj-menu-btn').classList.toggle('has-update', !!info.available);
  renderUpdateBanner();
}
function renderUpdateBanner(){
  let bar = $('#update-bar');
  if (!updateInfo?.available || updateInfo.latest === updateBannerDismissedFor){ bar?.remove(); return; }
  if (!bar){
    bar = document.createElement('div');
    bar.id = 'update-bar';
    bar.innerHTML = `<span class="msg"></span><button type="button" class="apply">立即更新</button><button type="button" class="later" aria-label="稍后" title="稍后（菜单里仍可找到更新入口）">×</button>`;
    bar.querySelector('.apply').addEventListener('click', () => applyUpdateFlow());
    bar.querySelector('.later').addEventListener('click', () => { updateBannerDismissedFor = updateInfo?.latest || ''; renderUpdateBanner(); });
    document.body.appendChild(bar);
  }
  bar.querySelector('.msg').innerHTML = `新版本 <b></b> 可用（当前 ${updateInfo.current ?? '?'}），更新会自动保存并重启画布`;
  bar.querySelector('.msg b').textContent = updateInfo.latest;
}
async function applyUpdateFlow(){
  if (!updateInfo || !updateInfo.available) return;
  const ok = confirm(`发现新版本 ${updateInfo.latest}（当前 ${updateInfo.current}）。\n\n更新前会自动保存当前地图，随后重启画布并恢复到现在的样子。\n地图数据不受影响。是否现在更新？`);
  if (!ok) return;
  // A6 安全契约：更新前强制落盘；落盘失败则中止更新。
  try {
    if (window.LiveDotBridge?.active && typeof window.LiveDotBridge.flushPending === 'function'){
      await window.LiveDotBridge.flushPending();
    } else if (IO.saveTimer){
      clearTimeout(IO.saveTimer);
      await writeMapNow();
    }
  } catch (error) {
    window.LiveDotBridge?.logError?.('update.flush.failed', error);
    toast('尚有修改未能保存，已取消更新。请稍后重试。');
    return;
  }
  try {
    toast(`正在下载更新 ${updateInfo.latest}…`);
    await window.LiveDotBridge.applyUpdate();
    updateInfo = null;
    $('#proj-menu-btn').classList.remove('has-update');
    renderUpdateBanner();
    toast('更新完成，画布即将重新打开…');
  } catch (error) {
    window.LiveDotBridge?.logError?.('update.failed', error);
    toast(error instanceof Error && error.message ? `更新失败：${error.message}` : '更新失败，请稍后重试。');
  }
}
// 桥就绪后自动静默检查一次; 页面长开时每 6 小时复查
const updateWatch = setInterval(() => {
  if (!window.LiveDotBridge?.active) return;
  clearInterval(updateWatch);
  updateChecked = true;
  checkForUpdate();
  setInterval(checkForUpdate, 6 * 3600000);
  // A5：桥端打开项目时若刷新了全局 Agent 运行时，提示重开会话后生效
  if (window.LiveDotBridge.agentSetup?.runtimeRefreshed) toast('Agent 运行时已更新，重开 Kimi/Codex 会话后生效');
}, 500);

/* ---------- 项目菜单 / 设置 ---------- */
function renameMap(){
  const label = $('#proj-name');
  if (!label || IO.readOnly) { if (IO.readOnly) warnReadOnly(); return; }
  popInlineEdit(label.getBoundingClientRect(), S.name || label.textContent || '未命名地图', value => {
    if (!value || value === S.name) return;
    pushHistory();
    S.name = value.slice(0, 80);
    applyName(); render();
    toast('地图名称已更新');
  });
}
$('#proj-name').addEventListener('dblclick', ev => { ev.preventDefault(); ev.stopPropagation(); closePopover(); renameMap(); });
$('#proj-name').addEventListener('contextmenu', ev => {
  ev.preventDefault(); ev.stopPropagation();
  openMenu([{id:'rename-map', icon:I.edit || '✎', label:'重命名地图', fn:renameMap}], ev.clientX, ev.clientY);
});
$('#proj-menu-btn').onclick = ev => {
  ev.stopPropagation();
  buildProjectMenu(ev.clientX, ev.clientY);
};
/* ⋯ 菜单只留应用级入口；项目/地图选择走顶栏两个按钮的弹层 */
function buildProjectMenu(x, y){
  openMenu([
    ...(updateInfo?.available
      ? [{id:'update', icon:'⬇', label:`更新到 ${updateInfo.latest}`, fn:applyUpdateFlow}]
      : [{id:'check-update', icon:'⟳', label:'检查更新', fn:checkForUpdate}]),
    {sep:true},
    {id:'settings', icon:I.gear, label:'设置', fn(){ void openSettingsSpace('archive'); /* id:'archive' */ }},
    {id:'guide', icon:'？', label:'新手引导', fn(){ showGuide(true); }},
    ...(updateInfo?.current ? [{head:`版本 ${updateInfo.current}`}] : [])
  ], x, y);
}

const ARCHIVE_COLLECTION_LABEL = { routes:'路线', nodes:'节点', edges:'方案', anns:'标注' };

/* 全新独立设置空间（设置中心）：两栏式极简禅意空间，包含归档库与系统偏好 */
async function openSettingsSpace(initialTab = 'archive'){
  const bridge = window.LiveDotBridge;
  const ov = document.createElement('div');
  ov.className = 'settings-space-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:90;background:rgba(18,20,24,.45);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;animation:fadeIn .15s ease-out';

  const modal = document.createElement('div');
  modal.className = 'settings-space-modal';
  modal.style.cssText = 'background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.06);width:min(860px,94vw);height:min(620px,86vh);display:flex;overflow:hidden;font-family:inherit;color:var(--fg)';

  modal.innerHTML = `
    <!-- 左侧导航栏 -->
    <aside style="width:200px;background:var(--surface);border-right:1px solid var(--line);padding:20px 12px;display:flex;flex-direction:column;gap:6px;flex:none">
      <div style="font-size:15px;font-weight:700;letter-spacing:.4px;padding:0 8px 12px 8px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px">
        <span style="display:inline-flex;width:18px;height:18px">${I.gear}</span>
        <span>设置中心</span>
      </div>
      <nav style="display:flex;flex-direction:column;gap:3px;margin-top:10px">
        <button type="button" data-tab="archive" class="settings-nav-btn active" style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;font:inherit;font-size:13px;font-weight:600;background:var(--bg);border:1px solid var(--line);box-shadow:0 1px 2px rgba(0,0,0,.05);color:var(--fg);cursor:pointer;text-align:left">
          <span style="font-size:15px">📦</span>
          <span style="flex:1">归档库</span>
          <span data-badge="archive" style="font-size:10px;padding:1px 6px;border-radius:999px;background:var(--line);color:var(--muted);font-weight:500">…</span>
        </button>
        <button type="button" data-tab="general" class="settings-nav-btn" style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;font:inherit;font-size:13px;font-weight:500;background:transparent;border:1px solid transparent;color:var(--muted);cursor:pointer;text-align:left">
          <span style="font-size:15px">⚙️</span>
          <span style="flex:1">通用偏好</span>
        </button>
        <button type="button" data-tab="about" class="settings-nav-btn" style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;font:inherit;font-size:13px;font-weight:500;background:transparent;border:1px solid transparent;color:var(--muted);cursor:pointer;text-align:left">
          <span style="font-size:15px">ℹ️</span>
          <span style="flex:1">关于与系统</span>
        </button>
      </nav>
      <div style="margin-top:auto;padding:8px;font-size:11px;color:var(--muted);line-height:1.5;border-top:1px solid var(--line)">
        活点地图 v2.0<br>本地优先 · 简洁高级
      </div>
    </aside>

    <!-- 右侧内容工作区 -->
    <main style="flex:1;min-width:0;display:flex;flex-direction:column;padding:24px 28px;overflow:hidden;background:var(--bg)">
      <header style="display:flex;align-items:flex-start;gap:12px;border-bottom:1px solid var(--line);padding-bottom:16px;flex:none">
        <div style="flex:1;min-width:0">
          <h2 data-pane-title style="font-size:18px;font-weight:700;margin:0">归档库</h2>
          <p data-pane-desc style="font-size:12px;color:var(--muted);margin:4px 0 0 0;line-height:1.5">管理已归档的节点、方案与路线。归档对象移出画布，可随时完整恢复。</p>
        </div>
        <button data-settings-close type="button" class="icb" style="width:28px;height:28px;border-radius:6px;cursor:pointer" title="关闭 (Esc)" aria-label="关闭">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m4 4 8 8M12 4l-8 8"/></svg>
        </button>
      </header>

      <!-- 选项卡 1：归档库 -->
      <section data-section="archive" style="flex:1;min-height:0;display:flex;flex-direction:column;margin-top:16px">
        <div style="display:flex;align-items:center;gap:10px;flex:none;margin-bottom:12px">
          <div class="seg" id="settings-archive-filter">
            <button class="on" data-filter="all">全部</button>
            <button data-filter="nodes">节点</button>
            <button data-filter="edges">方案</button>
            <button data-filter="routes">路线</button>
          </div>
          <span data-archive-status style="font-size:12px;color:var(--muted);margin-left:auto">正在读取…</span>
        </div>
        <div data-archive-list style="flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-right:4px"></div>
      </section>

      <!-- 选项卡 2：通用偏好 -->
      <section data-section="general" style="flex:1;min-height:0;display:none;flex-direction:column;gap:14px;margin-top:16px;overflow-y:auto">
        <div style="border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:var(--surface);display:flex;align-items:center;gap:14px">
          <div style="flex:1">
            <div style="font-size:14px;font-weight:600">显示对象数字编号</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">在节点和方案上显示 #01、#02 唯一数字编号，方便讨论与引用</div>
          </div>
          <input type="checkbox" id="pref-show-nums" style="width:18px;height:18px;cursor:pointer" ${S.showNums ? 'checked' : ''}>
        </div>
        <div style="border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:var(--surface);display:flex;align-items:center;gap:14px">
          <div style="flex:1">
            <div style="font-size:14px;font-weight:600">显示便签标注</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">在画布上直观显示你与 Agent 留下的便签标注气泡</div>
          </div>
          <input type="checkbox" id="pref-show-anns" style="width:18px;height:18px;cursor:pointer" ${S.showAnns ? 'checked' : ''}>
        </div>
        <div style="border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:var(--surface);display:flex;align-items:center;gap:14px">
          <div style="flex:1">
            <div style="font-size:14px;font-weight:600">显示失败方案弱化线</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">以浅色虚线保留历史上探索失败但包含经验的方案线</div>
          </div>
          <input type="checkbox" id="pref-show-failed" style="width:18px;height:18px;cursor:pointer" ${S.showFailed ? 'checked' : ''}>
        </div>
      </section>

      <!-- 选项卡 3：关于与系统 -->
      <section data-section="about" style="flex:1;min-height:0;display:none;flex-direction:column;gap:14px;margin-top:16px;overflow-y:auto">
        <div style="border:1px solid var(--line);border-radius:10px;padding:16px;background:var(--surface)">
          <div style="font-size:15px;font-weight:700">活点地图 Live Dot Map</div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">版本 ${updateInfo?.current || '2.0.1'} · 禅意极简版</div>
          <p style="font-size:13px;line-height:1.6;margin-top:10px;color:var(--fg)">
            活点地图是一张人与 Agent 共享的探索地图。节点记目标与解决状态，方案线记每次尝试与评分，资料包双向同步。
          </p>
          <div style="display:flex;gap:10px;margin-top:14px">
            <button type="button" id="btn-settings-update" style="border:1px solid var(--line);border-radius:7px;background:var(--bg);padding:6px 12px;font:inherit;font-size:13px;cursor:pointer">⟳ 检查更新</button>
            <button type="button" id="btn-settings-guide" style="border:1px solid var(--line);border-radius:7px;background:var(--bg);padding:6px 12px;font:inherit;font-size:13px;cursor:pointer">🎓 新手教程</button>
          </div>
        </div>
      </section>
    </main>
  `;

  ov.appendChild(modal);
  document.body.appendChild(ov);

  const closeBtn = ov.querySelector('[data-settings-close]');
  const close = () => { ov.remove(); window.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape'){ e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey);
  closeBtn?.addEventListener('click', close);
  ov.addEventListener('pointerdown', e => { if (e.target === ov) close(); });

  // 选项卡切换
  const navBtns = ov.querySelectorAll('.settings-nav-btn');
  const sections = {
    archive: ov.querySelector('[data-section="archive"]'),
    general: ov.querySelector('[data-section="general"]'),
    about: ov.querySelector('[data-section="about"]')
  };
  const paneTitle = ov.querySelector('[data-pane-title]');
  const paneDesc = ov.querySelector('[data-pane-desc]');

  const setTab = tab => {
    navBtns.forEach(btn => {
      const active = btn.dataset.tab === tab;
      btn.style.background = active ? 'var(--bg)' : 'transparent';
      btn.style.borderColor = active ? 'var(--line)' : 'transparent';
      btn.style.boxShadow = active ? '0 1px 2px rgba(0,0,0,.05)' : 'none';
      btn.style.color = active ? 'var(--fg)' : 'var(--muted)';
      btn.style.fontWeight = active ? '600' : '500';
    });
    Object.entries(sections).forEach(([k, sec]) => {
      if (sec) sec.style.display = k === tab ? 'flex' : 'none';
    });
    if (tab === 'archive'){
      paneTitle.textContent = '归档库';
      paneDesc.textContent = '管理已归档的节点、方案与路线。归档对象移出画布，可随时完整恢复。';
    } else if (tab === 'general'){
      paneTitle.textContent = '通用偏好';
      paneDesc.textContent = '调整画布视觉元素与辅助显示偏好。';
    } else if (tab === 'about'){
      paneTitle.textContent = '关于与系统';
      paneDesc.textContent = '产品版本、更新状态与本地桥连接信息。';
    }
  };

  navBtns.forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  setTab(initialTab);

  // 通用偏好事件绑定
  const chkNums = ov.querySelector('#pref-show-nums');
  if (chkNums) chkNums.onchange = () => { S.showNums = chkNums.checked; render(); renderPanel(); };
  const chkAnns = ov.querySelector('#pref-show-anns');
  if (chkAnns) chkAnns.onchange = () => { S.showAnns = chkAnns.checked; render(); };
  const chkFailed = ov.querySelector('#pref-show-failed');
  if (chkFailed) chkFailed.onchange = () => { S.showFailed = chkFailed.checked; render(); };

  // 关于页按钮
  ov.querySelector('#btn-settings-update')?.addEventListener('click', () => { close(); checkForUpdate(); });
  ov.querySelector('#btn-settings-guide')?.addEventListener('click', () => { close(); showGuide(true); });

  // 归档库列表渲染
  const statusEl = ov.querySelector('[data-archive-status]');
  const listEl = ov.querySelector('[data-archive-list]');
  const badgeCount = ov.querySelector('[data-badge="archive"]');
  let currentFilter = 'all';

  const filterBtns = ov.querySelectorAll('#settings-archive-filter button');
  filterBtns.forEach(btn => {
    btn.onclick = () => {
      filterBtns.forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      currentFilter = btn.dataset.filter;
      void renderArchiveList();
    };
  });

  const renderArchiveList = async () => {
    if (!listEl || !statusEl) return;
    listEl.textContent = '';
    statusEl.textContent = '正在读取…';

    let items = [];
    if (bridge?.active && typeof bridge.listArchived === 'function'){
      try {
        items = await bridge.listArchived();
      } catch (err){
        bridge.logError?.('archive.list.failed', err);
      }
    }

    // 内存合并补齐（确保离线与即时归档同样能找回）
    const seenKeys = new Set(items.map(it => `${it.collection}:${it.id}`));
    S.nodes.filter(n => n.archived).forEach(n => {
      if (!seenKeys.has(`nodes:${n.id}`)){
        items.push({ collection:'nodes', id:n.id, name:n.name, archivedAt:n.archivedAt });
      }
    });
    S.edges.filter(e => e.archived).forEach(e => {
      if (!seenKeys.has(`edges:${e.id}`)){
        items.push({ collection:'edges', id:e.id, name:e.name, archivedAt:e.archivedAt });
      }
    });
    S.routes.filter(r => r.archived).forEach(r => {
      if (!seenKeys.has(`routes:${r.id}`)){
        items.push({ collection:'routes', id:r.id, name:r.name, archivedAt:r.archivedAt });
      }
    });

    if (badgeCount) badgeCount.textContent = String(items.length);

    const filtered = items.filter(it => currentFilter === 'all' || it.collection === currentFilter);
    statusEl.textContent = items.length ? `共 ${items.length} 个已归档对象` : '归档库为空';

    if (!filtered.length){
      const empty = document.createElement('div');
      empty.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 20px;color:var(--muted);text-align:center';
      empty.innerHTML = `
        <div style="font-size:36px;margin-bottom:10px;opacity:.6">📦</div>
        <div style="font-size:14px;font-weight:600;color:var(--fg)">归档库暂无内容</div>
        <div style="font-size:12px;margin-top:4px">在节点或方案面板中点击「归档」后将收录于此，不占用画布空间</div>
      `;
      listEl.appendChild(empty);
      return;
    }

    for (const item of filtered){
      const collection = String(item?.collection || '');
      const id = String(item?.id || '');
      if (!collection || !id) continue;

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;border:1px solid var(--line);border-radius:10px;padding:10px 14px;background:var(--surface);transition:background .15s';

      const tag = document.createElement('span');
      tag.style.cssText = 'font-size:11px;padding:2px 7px;border-radius:6px;background:var(--border);color:var(--muted);font-weight:600;flex:none';
      tag.textContent = ARCHIVE_COLLECTION_LABEL[collection] || collection;

      const info = document.createElement('div');
      info.style.cssText = 'min-width:0;flex:1';

      const name = document.createElement('div');
      name.style.cssText = 'font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg)';
      name.textContent = String(item.name || id);

      const meta = document.createElement('div');
      meta.style.cssText = 'font-size:11px;color:var(--muted);margin-top:2px';
      const archivedAt = item.archivedAt ? `归档于 ${String(item.archivedAt).slice(0, 10)}` : '归档时间未知';
      meta.textContent = `${id} · ${archivedAt}${item.purgeEligible ? ' · 已满足保留期' : ''}`;

      info.append(name, meta);

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:6px;flex:none';

      const restore = document.createElement('button');
      restore.type = 'button';
      restore.textContent = '恢复';
      restore.style.cssText = 'border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--fg);padding:5px 10px;font:inherit;font-size:12px;cursor:pointer;font-weight:500';
      restore.onclick = async () => {
        restore.disabled = true;
        try {
          if (bridge?.active && typeof bridge.restoreArchived === 'function'){
            await bridge.restoreArchived(collection, id);
          }
          if (collection === 'nodes'){
            const n = nodeById(id);
            if (n){ delete n.archived; delete n.archivedAt; delete n.archivedBy; }
          } else if (collection === 'edges'){
            const e = edgeById(id);
            if (e){ delete e.archived; delete e.archivedAt; delete e.archivedBy; }
          } else if (collection === 'routes'){
            const r = routeById(id);
            if (r){ delete r.archived; delete r.archivedAt; delete r.archivedBy; }
          }
          pushHistory();
          render();
          toast(`已恢复${ARCHIVE_COLLECTION_LABEL[collection] || '对象'}：${String(item.name || id)}`);
          await renderArchiveList();
        } catch (error){
          restore.disabled = false;
          statusEl.textContent = `恢复失败：${error?.message || '请稍后重试'}`;
          bridge?.logError?.('archive.restore.failed', error, { collection, id });
          toast('恢复失败，归档对象仍保留。');
        }
      };

      const purge = document.createElement('button');
      purge.type = 'button';
      purge.textContent = '永久清除';
      purge.style.cssText = 'border:1px solid color-mix(in srgb,var(--danger) 45%,var(--line));border-radius:7px;background:transparent;color:var(--danger);padding:5px 10px;font:inherit;font-size:12px;cursor:pointer';
      purge.onclick = async () => {
        if (!window.confirm(`永久清除“${String(item.name || id)}”及其资料包？此操作不可撤销。`)) return;
        const confirmation = window.prompt(`请输入对象 ID“${id}”以确认永久清除：`, '');
        if (confirmation === null) return;
        if (confirmation !== id) { toast('确认文本不匹配，未执行永久清除。'); return; }
        purge.disabled = true;
        try {
          if (bridge?.active && typeof bridge.purgeArchived === 'function'){
            await bridge.purgeArchived(collection, id, confirmation);
          }
          if (collection === 'nodes') S.nodes = S.nodes.filter(x => x.id !== id);
          else if (collection === 'edges') S.edges = S.edges.filter(x => x.id !== id);
          else if (collection === 'routes') S.routes = S.routes.filter(x => x.id !== id);
          pushHistory();
          render();
          toast(`已永久清除：${String(item.name || id)}`);
          await renderArchiveList();
        } catch (error){
          purge.disabled = false;
          statusEl.textContent = `永久清除失败：${error?.message || '请稍后重试'}`;
          bridge?.logError?.('archive.purge.failed', error, { collection, id });
          toast('永久清除失败，归档对象仍保留。');
        }
      };

      actions.append(restore, purge);
      row.append(tag, info, actions);
      listEl.appendChild(row);
    }
  };

  void renderArchiveList();
}

/* 兼容现有调用与单元测试入口 */