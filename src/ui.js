/* ============================================================
 *  糖果屋 · 新都蜗牛巷  —  界面层
 * ============================================================ */
window.UI = (function () {
  const D = window.GameData;
  const E = window.Engine;

  let view = null;
  let tab = 'craft';
  // 坐班时店里可以同时站着好几位客人，各自要各自的东西，逐个招呼
  const CUST_MAX = 3;
  let customers = [];
  let custSel = 0;
  let custSeq = 1;
  let loaded = [];        // 已装载订单 id
  let mapMode = null;     // 'delivery' | 'walk'
  /* 这一阶段有没有真的上过街。用来区分「装车出门」和「再出门」，
     也让「取消装货」能老老实实停在店里，而不是把整个阶段跳过去。 */
  let wentOutThisPhase = false;
  let roadEventOpen = false;   // 路上事件弹窗开着时别再掷第二次
  let storyState = null;
  let modalCloser = null;

  /* ================= 配送现场（跟着存档走） =================
   * loaded / mapMode / wentOutThisPhase 原本只是这里的模块变量，读一次档就全丢了：
   * 车厢空了、得重新装货，已经烧掉的 AP 也白费。现在关键节点把这份现场写进
   * Engine.state.trip，读档再搬回来。地图坐标不存，读档统一回店里点「再出门」。 */
  function syncTrip() {
    E.state.trip = {
      loaded: loaded.slice(),
      mode: mapMode,
      wentOut: wentOutThisPhase,
      onMap: view === 'map'
    };
    E.save();
  }

  function restoreTrip() {
    const t = E.state.trip || {};
    const ids = Array.isArray(t.loaded) ? t.loaded : [];
    loaded = ids.filter(id => E.state.orders.some(o => o.id === id && !o.delivered));
    mapMode = (t.mode === 'delivery' || t.mode === 'walk') ? t.mode : null;
    wentOutThisPhase = !!t.wentOut;
    return loaded.length;
  }

  const el = {};
  let cvs, cctx, csScale = 1, csVW = 480, csDpr = 1, sceneT = 0, sceneRAF = 0;
  let lastStageW = 0, lastStageH = 0;
  let counterBuilt = false;

  /* ================= 工具 ================= */
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Math.round(n).toLocaleString('en-US');
  const locName = id => (D.LOCATIONS.find(l => l.id === id) || { name: '未知' }).name;

  function toast(msg, kind) {
    const root = $('toast-root');
    const d = document.createElement('div');
    d.className = 'toast' + (kind ? ' ' + kind : '');
    d.textContent = msg;
    root.appendChild(d);
    setTimeout(() => {
      d.style.transition = 'opacity .3s, transform .3s';
      d.style.opacity = '0';
      d.style.transform = 'translateY(-6px)';
      setTimeout(() => d.remove(), 320);
    }, 1900);
  }

  /* ================= 初始化 ================= */
  function init() {
    el.viewPanel = $('view-panel');
    el.viewCounter = $('view-counter');
    el.viewMap = $('view-map');
    el.mapTop = $('map-topbar');
    el.mapBottom = $('map-bottombar');
    el.mapAct = $('map-act');

    document.addEventListener('click', onClick);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('modal-root').classList.contains('hidden')) { closeModal(); return; }
      // Ctrl/⌘ + S：随时开存档面板（顺手压掉浏览器的「保存网页」）
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if ($('modal-root').classList.contains('hidden')) openSaveModal();
        return;
      }
      // 地图上按 Tab 掀开车厢看看
      if (e.key === 'Tab' && view === 'map' && window.MapView.isRunning()) {
        e.preventDefault();
        if ($('modal-root').classList.contains('hidden')) openCargoModal();
        else closeModal();
      }
    });

    window.MapView.init($('map-canvas'));
    E.onChange(render);
    refreshTitleBtn();
    window.addEventListener('resize', () => {
      if (view === 'counter') counterResize();
      if (view === 'map') layoutMapAct();
    });

    // 标题页背景复用剧情夜景
    try {
      if (!storyArtUrl) storyArtUrl = buildStoryArt();
      const t = document.getElementById('title-screen');
      if (t) {
        t.style.backgroundImage =
          "radial-gradient(circle at 50% 44%, rgba(8,5,16,.78) 0%, rgba(8,5,16,.5) 38%, rgba(8,5,16,.92) 100%), url('" + storyArtUrl + "')";
        t.style.backgroundSize = 'cover';
        t.style.backgroundPosition = 'center bottom';
        t.style.backgroundRepeat = 'no-repeat';
      }
    } catch (e) { }

    startSceneLoop();
  }

  /* ================= 阶段横幅 / 左上角指引 ================= */
  let bannerTimer = null;
  /* 切阶段时在中上方弹一条，3 秒后自己收起来 */
  function showPhaseBanner(p) {
    const node = $('phase-banner');
    if (!node || !p) return;
    node.innerHTML = `<b>${p.name}</b><span>${p.span}</span>`;
    node.classList.remove('show');
    void node.offsetWidth;            // 强制重排，连续切阶段也能重播动画
    node.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => node.classList.remove('show'), 3000);
  }

  /* 该不该给指引、给什么。面板视图里改用内嵌卡片，不压在页签上。 */
  function guideText() {
    const G = window.GameStory;
    const sneaking = !!(window.MapView && window.MapView.isSneak && window.MapView.isSneak());
    const storyOn = !!(G && G.state && G.state().chapter === 'prologue');
    if (sneaking) {
      return { title: '躲避搜查的人，进入糖果屋', sub: '贴着树影和墙角走，别走进守卫的扇形视野' };
    }
    if (storyOn && G.isStep('rain')) {
      return { title: '躲避搜查的人，进入糖果屋', sub: '绕开巷子里的人，从后门进去' };
    }
    if (storyOn && G.isStep('studio')) {
      return { title: '先完成序章：把盒子放进工作室', sub: '在店里按下收银机旁的瓷砖 · 完成前不会开始第一天' };
    }
    const t = tutorialStep();
    if (t) return { title: t.title, sub: t.hint };
    return null;
  }

  /* 玩家手动收起过哪一条指引。键是「标题＋副标题」：
     提示内容一换（完成一步、进入新阶段），就当成新的一条重新冒出来。 */
  let guideMuted = '';
  const guideKeyOf = g => (g ? g.title + '｜' + g.sub : '');
  const isGuideMuted = g => !!g && guideMuted === guideKeyOf(g);

  /* 地图 / 柜台视图：浮在左上角，带一个 × —— 不做这一步它会一直压着左上的按钮 */
  function updateGuide() {
    const node = $('hud-guide');
    if (!node) return;
    /* 面板视图里指引是右栏的内嵌卡，不浮；但「收起/展开」的状态两种视图共用 */
    const g = guideText();
    const muted = isGuideMuted(g);
    const show = !!g && !muted && view !== 'panel';
    node.classList.toggle('hidden', !show);
    if (show) {
      $('guide-title').textContent = g.title;
      $('guide-sub').textContent = g.sub;
    }
    /* 收起来之后，顶栏多一颗「指引」按钮，随时能叫回来 */
    const pill = $('guide-pill');
    if (pill) pill.classList.toggle('hidden', !muted);
  }

  /* 新手教学的当前一步（定义在 data.js 的 TUTORIAL 里） */
  function tutorialStep() {
    const t = E.state.tutorial;
    if (!t || !t.on) return null;
    return D.TUTORIAL[t.step] || null;
  }

  /* 每一步完成的判定：看状态，不看点击 */
  function checkTutorial() {
    const t = E.state.tutorial;
    if (!t || !t.on) return;
    const def = D.TUTORIAL[t.step];
    if (!def) return;
    const tutOrder = E.state.orders.find(o => o.id === t.orderId);
    /* 订单要是被取消了，教学就没得教了，直接收尾 */
    if (!tutOrder && def.id !== 'deliver') {
      t.on = false;
      E.log('新手订单不在了，教学结束。', 'info');
      E.emit();
      return;
    }
    let done = false;
    if (def.id === 'craft') done = !!tutOrder && Object.keys(tutOrder.items).every(k => E.stockOf(k) >= tutOrder.items[k]);
    else if (def.id === 'load') done = loaded.indexOf(t.orderId) >= 0;
    else if (def.id === 'deliver') done = !tutOrder;
    if (!done) return;
    t.step += 1;
    if (t.step >= D.TUTORIAL.length) {
      t.on = false;
      E.log('新手教学完成。糖果屋正式开张。', 'good');
      toast('教学完成，接下来就是自己的生意了。', 'good');
    } else {
      toast(`下一步：${D.TUTORIAL[t.step].title}`, 'good');
    }
    E.emit();
  }

  /* ================= HUD ================= */
  function renderHUD() {
    const S = E.state, p = E.phase();
    $('hud-phase-name').textContent = p ? p.name : '';
    $('hud-phase-time').textContent = p ? p.span : '';
    $('hud-ap-num').textContent = S.ap + '/' + S.apMax;
    $('hud-money').textContent = money(S.money);
    $('hud-energy').textContent = Math.round(S.energy);
    $('hud-energy-bar').style.width = S.energy + '%';
    $('hud-rep').textContent = Math.round(S.reputation);
    $('hud-day').textContent = '第 ' + S.day + ' 天 · ' + (S.rank || 'D');
    updateGuide();

    const bar = $('hud-ap-bar');
    const n = Math.min(Math.max(S.apMax, 1), 24);
    let html = '';
    for (let i = 0; i < n; i++) {
      const filled = S.apMax <= 24 ? (i < S.ap) : (i / n < S.ap / S.apMax);
      html += `<div class="ap-hex ${filled ? 'on' : ''}"></div>`;
    }
    bar.innerHTML = html;
    document.documentElement.style.setProperty('--phase-tone', p ? p.tone : '#ffd98a');
  }

  /* ================= 视图切换 ================= */
  function setView(name) {
    view = name;
    ['panel', 'counter', 'map'].forEach(v => {
      const node = $('view-' + v);
      if (node) node.classList.toggle('active', v === name);
    });
    if (name === 'panel') renderPanel();
    else if (name === 'counter') { buildCounter(); counterResize(); updateCounter(); }
    else if (name === 'map') updateMapBars();
    if (name !== 'map') showMapAct(null);
  }

  function render() {
    renderHUD();
    checkTutorial();
    if (view === 'panel') renderPanel();
    else if (view === 'counter') updateCounter();
    else if (view === 'map') updateMapBars();
  }

  /* ================= 阶段入口 ================= */
  function enterPhase() {
    const p = E.phase();
    if (!p) return;
    wentOutThisPhase = false;
    if (p.kind === 'map') {
      beginDelivery(p.id);
    } else if (p.kind === 'counter') {
      customers = [];
      custSel = 0;
      setView('counter');
      spawnCustomers();
      updateCounter();   // 换了客人就得同步按钮的可用状态
    } else {
      setView('panel');
    }
    showPhaseBanner(p);
    const tkLast = E.state.takeout && E.state.takeout.last;
    if (tkLast && !tkLast.shown && (tkLast.done || tkLast.expired)) {
      tkLast.shown = true;
      toast(`外卖：${tkLast.done} 单取走 +${tkLast.earned}G`
        + (tkLast.auto ? `（学徒备了 ${tkLast.auto} 单）` : '')
        + (tkLast.expired ? `，${tkLast.expired} 单没赶上` : ''),
        tkLast.expired ? 'bad' : 'good');
    }
    syncTrip();       // 换阶段＝这一趟收尾，把新的配送现场立刻落盘
    // 主线钩子：艾琳只在上午坐班时上门，那封信在下一次进阶段时送到
    maybeErin();
    maybePhoto();
    maybeEvan();
    maybeLetter();
  }

  /* ================= 后场面板 ================= */
  const TABS = [
    { id: 'craft', name: '制作台', hint: '把原料变成货架上的糖' },
    { id: 'stock', name: '库存', hint: '原料与成品' },
    { id: 'orders', name: '订单簿', hint: '预订、时限与尾款' },
    { id: 'people', name: '熟人', hint: '来往过的人、信任与口味' },
    { id: 'shop', name: '店铺', hint: '账本、升级与帮工' },
    { id: 'story', name: '委托', hint: '主线、线索与手上的东西' },
    { id: 'vehicle', name: '车库', hint: '载具与运力' },
    { id: 'log', name: '日记', hint: '今天发生了什么' }
  ];

  function renderPanel() {
    const S = E.state, p = E.phase();
    const cur = TABS.find(t => t.id === tab) || TABS[0];
    const oldScroll = el.viewPanel.querySelector('.panel-content');
    const scrollTop = oldScroll ? oldScroll.scrollTop : 0;

    const tabsHtml = TABS.map(t =>
      `<button class="tab ${t.id === tab ? 'active' : ''}" data-act="tab" data-tab="${t.id}">${t.name}</button>`
    ).join('');

    const actions = phaseActions(p);

    el.viewPanel.innerHTML = `
      <div class="panel-side">
        <div class="side-title">后场</div>
        ${tabsHtml}
        <div class="side-meta" style="margin-top:auto;font-size:10px;color:#6f5d82;line-height:1.8;padding:8px 4px;">
          第 ${S.day} 天<br>${p.name}<br><span style="color:#8d7a9c">${S.ap} / ${S.apMax} 行动点</span>
        </div>
      </div>
      <div class="panel-main">
        <div class="panel-head">
          <h2>${cur.name}</h2>
          <span class="hint">${cur.hint}</span>
        </div>
        <div class="panel-content" id="panel-content">${renderTab(tab)}</div>
      </div>
      <div class="panel-right">
        ${(function () {
          const g = guideText();
          if (!g) return '';
          if (isGuideMuted(g)) {
            return `<div class="guide-muted">
              <span>指引已收起</span>
              <button class="btn btn-sm btn-ghost" data-act="guide-open">显示</button>
            </div>`;
          }
          return `<div class="card guide-card">
            <button class="guide-x" data-act="guide-close" title="收起指引" aria-label="收起指引">×</button>
            <div class="guide-card-title">${esc(g.title)}</div>
            <div class="guide-card-sub">${esc(g.sub)}</div>
          </div>`;
        })()}
        <div class="card">
          <div class="card-title">当前阶段</div>
          <div style="font-size:14px;letter-spacing:1px;">${p.name}</div>
          <div style="font-size:10.5px;color:#8d7a9c;margin-top:3px;">${p.span}</div>
          <div style="font-size:11px;color:#6d5a76;margin-top:8px;line-height:1.7;">${p.tip}</div>
        </div>
        ${actions.length ? `<div class="card"><div class="card-title">可以做的事</div>
          <div class="action-list">${actions.map(a => `
            <button class="action" data-act="phase-action" data-id="${a.id}" ${a.disabled ? 'disabled' : ''}>
              <div class="action-name">${a.name}<span class="action-cost">${a.cost ? a.cost + ' AP' : '免费'}</span></div>
              <div class="action-desc">${a.desc}</div>
            </button>`).join('')}</div></div>` : ''}
        <button class="btn btn-primary end-phase" data-act="end-phase">${endLabel(p)}</button>
      </div>`;

    const pc = el.viewPanel.querySelector('.panel-content');
    if (pc && scrollTop) pc.scrollTop = scrollTop;
  }

  function endLabel(p) {
    if (p.id === 'prep') return '出门配送 →';
    if (p.id === 'shiftAM' || p.id === 'shiftPM') return '结束营业 →';
    if (p.id === 'noon') return '开始下午营业 →';
    if (p.id === 'deliveryPM') return '回家打烊 →';
    if (p.id === 'night') return '熄灯，睡吧 →';
    /* 配送阶段停在店里时（取消了装车、或者中途回家），这颗按钮是「今天不跑了」 */
    if (p.kind === 'map') return '这一趟不去了 →';
    return '下一阶段 →';
  }

  function phaseActions(p) {
    const S = E.state;
    const acts = [];
    if (p.id === 'prep') {
      acts.push({ id: 'tidy', name: '整理橱窗', cost: 1, desc: '元气 +8，信誉 +1', disabled: S.ap < 1 });
    }
    if (p.id === 'noon') {
      acts.push({ id: 'nap', name: '午睡一会儿', cost: 2, desc: '元气 +22', disabled: S.ap < 2 });
      acts.push({ id: 'read', name: '翻翻母亲的旧书', cost: 1, desc: '也许能学到什么', disabled: S.ap < 1 });
      acts.push({ id: 'walk', name: '外出一趟', cost: 0, desc: '进入大地图，用剩余行动点自由活动', disabled: S.ap < 1 });
    }
    if (p.id === 'night') {
      acts.push({ id: 'clean', name: '打扫打烊', cost: 1, desc: '信誉 +2', disabled: S.ap < 1 });
      acts.push({ id: 'account', name: '核对账本', cost: 1, desc: '看看今天的收支', disabled: S.ap < 1 });
    }
    // 配送阶段中途回家补货/现做之后，还得能再出门——不然剩下的行动点就白扔了
    if (p.kind === 'map') {
      const pool = E.state.orders.filter(o => !o.delivered);
      const left = pool.filter(o => loaded.includes(o.id)).length;
      acts.push({
        id: 'go-out', name: wentOutThisPhase ? '再出门' : '装车出门', cost: 0,
        desc: pool.length
          ? `${wentOutThisPhase ? '装货窗重挑' : '挑这一趟要送的订单'} · 待送 ${pool.length} 单${wentOutThisPhase ? `，车上 ${left} 单` : ''} · 剩 ${S.ap} AP`
          : `没有待送订单，空车出门 · 剩 ${S.ap} AP`,
        disabled: S.ap < 1
      });
    }
    if (p.id === 'shiftPM' || p.id === 'shiftAM') {
      acts.push({ id: 'call', name: '接一通电话', cost: 1, desc: '也许有新的预订订单', disabled: S.ap < 1 });
    }
    return acts;
  }

  function renderTab(id) {
    if (id === 'craft') return tabCraft();
    if (id === 'stock') return tabStock();
    if (id === 'orders') return tabOrders();
    if (id === 'people') return tabPeople();
    if (id === 'shop') return tabShop();
    if (id === 'story') return tabStory();
    if (id === 'vehicle') return tabVehicle();
    if (id === 'log') return tabLog();
    return '';
  }

  /* 一张制作卡：色块 + 名字 + 价 + 配方 + AP + 做/×5 */
  function craftCard(k, p) {
    const can = E.canCraft(k);
    const apCost = E.apCostOf(k);
    const canAP = E.state.ap >= apCost;
    const needs = Object.entries(p.recipe).map(([rk, rq]) => {
      const have = E.invOf(rk);
      const cls = have >= rq ? 'ok' : 'lack';
      return `<span class="need-tag ${cls}">${D.RAW[rk].name} ${have}/${rq}</span>`;
    }).join('');
    return `
      <div class="recipe ${can && canAP ? 'ready' : ''}">
        <div class="recipe-top">
          <span class="swatch" style="background:${p.color}"></span>
          <span class="recipe-name">${p.name}</span>
          <span class="recipe-price">${p.price}G</span>
        </div>
        <div class="recipe-need">${needs}</div>
        <div class="recipe-foot">
          <span class="need-tag">${apCost} AP${apCost < p.ap ? ' ↓' : ''}</span>
          <button class="btn btn-sm" data-act="craft" data-key="${k}" data-times="1" ${!can || !canAP ? 'disabled' : ''}>做一份</button>
          <button class="btn btn-sm" data-act="craft" data-key="${k}" data-times="5" ${!can || !canAP ? 'disabled' : ''}>×5</button>
          <span class="stock">货架 ${E.stockOf(k)}</span>
        </div>
      </div>`;
  }

  function tabCraft() {
    const S = E.state;
    const lines = E.lineList();
    const locked = lines.filter(l => !l.unlocked);
    const unlocked = lines.filter(l => l.unlocked);
    const totalGoods = lines.reduce((a, l) => a + l.total, 0);
    const ownedGoods = lines.reduce((a, l) => a + l.owned, 0);

    /* —— 配方书：还没学的线。默认收起来，不然十三本摊开就把制作台挤到屏幕外 —— */
    /* 贵书不是有钱就能拿到：书价越高，要求的评级越高（评级的第一道门）。 */
    const bookRows = locked.map(l => {
      const need = E.bookRank(l.id);
      const rankOk = E.rankAtLeast(need);
      const canBuy = S.money >= l.book && rankOk;
      return `<div class="book-row">
        <div class="book-main">
          <b>${l.name}</b>
          <span class="book-n">${l.total} 个方子</span>
          <span class="book-desc">${esc(l.desc)}</span>
        </div>
        ${rankOk ? '' : `<span class="book-lock">需 ${need} 级</span>`}
        <button class="btn btn-sm ${canBuy ? 'btn-primary' : ''}" data-act="buy-book" data-line="${l.id}" ${canBuy ? '' : 'disabled'}>${l.book}G 买下</button>
      </div>`;
    }).join('');

    const afford = locked.filter(l => S.money >= l.book && E.rankAtLeast(E.bookRank(l.id))).length;
    const bookCard = locked.length
      ? `<details class="book-card">
          <summary class="book-head">
            <span class="book-title">配方书 · 还有 ${locked.length} 本没学</span>
            ${afford ? `<span class="book-afford">现在买得起 ${afford} 本</span>` : ''}
            <span class="book-count">已学会 ${ownedGoods} / ${totalGoods}</span>
          </summary>
          <div class="book-sub">新方子会同时进制作台和客人的点单池。</div>
          ${bookRows}
        </details>`
      : `<div class="card book-card">
          <div class="book-head">
            <span class="book-title">配方书</span>
            <span class="book-count">${ownedGoods} / ${totalGoods} 个方子，全学会了</span>
          </div>
        </div>`;

    /* —— 已解锁的线，按线折叠 —— */
    const groups = unlocked.map(l => {
      const cards = l.goods.map(k => craftCard(k, D.PRODUCTS[k])).join('');
      const open = l.id === 'classic' ? 'open' : '';
      return `<details class="line-group" ${open}>
        <summary>
          <span class="lg-name">${l.name}</span>
          <span class="lg-n">${l.total} 个方子</span>
        </summary>
        <div class="grid-recipes">${cards}</div>
      </details>`;
    }).join('');

    return bookCard + groups
      + `<div style="margin-top:14px;font-size:10.5px;color:#a493ae;line-height:1.8;">
        元气越低，糖越容易烧糊。当前元气 ${Math.round(S.energy)}，成功率约 ${Math.round(E.successRate() * 100)}%。
        ${E.upLv('oven') > 1 ? `糊了的话，${E.upLv('oven') === 3 ? '原料全退' : '退回一半原料'}。` : ''}
      </div>`
      + craftTodo();
  }

  function craftTodo() {
    const S = E.state;
    if (!S.orders.length) {
      return `<div class="card" style="margin-top:16px">
        <div class="card-title">今日待办</div>
        <div class="empty" style="padding:10px;">订单簿是空的，先做点常规货放着。</div></div>`;
    }
    const rows = S.orders.slice(0, 6).map(o => {
      const items = Object.entries(o.items).map(([k, q]) => {
        const have = E.stockOf(k);
        const okc = have >= q;
        return `<span class="need-tag ${okc ? 'ok' : 'lack'}">${D.PRODUCTS[k].name} ${have}/${q}</span>`;
      }).join('');
      const ready = Object.entries(o.items).every(([k, q]) => E.stockOf(k) >= q);
      return `<div class="inv-row" style="flex-wrap:wrap;gap:6px;">
        <span class="inv-name">#${o.id} ${esc(o.customer)}</span>
        <span style="display:flex;gap:4px;flex-wrap:wrap;">${items}</span>
        <span class="inv-num" style="font-size:10px;color:${ready ? '#2c7d58' : '#c2405a'}">${ready ? '可以送' : '缺货'}</span>
      </div>`;
    }).join('');
    return `<div class="card" style="margin-top:16px">
      <div class="card-title">今日待办 · 按订单备货</div>
      ${rows}</div>`;
  }

  /* 某原料在哪几家店有卖，便宜的排前面 */
  function shopsSelling(rawKey) {
    return Object.keys(D.SHOPS)
      .filter(id => D.SHOPS[id].items.includes(rawKey))
      .sort((a, b) => D.SHOPS[a].mult - D.SHOPS[b].mult);
  }

  /* 库存页底部：原料见底时告诉玩家去哪儿进货 */
  function buyHint() {
    const low = Object.entries(D.RAW).filter(([k]) => E.invOf(k) < 2);
    const rows = low.map(([k, r]) => {
      const where = shopsSelling(k).map(id => D.SHOPS[id].name).join(' / ') || '暂无货源';
      return `<div class="bh-need"><span>${r.name}</span><span>→ ${where}</span></div>`;
    }).join('');
    return `<div class="buy-hint">
      <div class="bh-title">没有原料去哪儿进货</div>
      ${low.length ? `<div class="bh-sub">快用完的（少于 2 份）：</div><div class="bh-list">${rows}</div>` : ''}
      <div class="bh-shop"><b>巷口水果摊</b> · 蜗牛巷 · 出店门往左一点 — 砂糖 / 水果 / 牛奶 / 蜂蜜，<b>88 折</b></div>
      <div class="bh-shop"><b>综合市场</b> · 旧城中心 — ${Object.keys(D.RAW).length} 种原料全都有，原价</div>
      <div class="bh-tip">走到门口按 <b>E</b> 或空格 →「采购原料」；按 <b>M</b> 摊开全城图，点地点就能直接导航过去。</div>
    </div>`;
  }

  function tabStock() {
    const S = E.state;
    const rawRows = Object.entries(D.RAW).map(([k, r]) => {
      const n = E.invOf(k);
      return `<div class="inv-row">
        <span class="inv-name">${r.name}</span>
        <span class="inv-tag">${r.tag}</span>
        <span class="inv-num ${n === 0 ? 'zero' : (n < 4 ? 'low' : '')}">${n}</span>
      </div>`;
    }).join('');
    /* 货架上只列「已经做出来、还在架上」的品——
       六十多个方子全列一遍会把库存页撑爆，没货的自然不用看。 */
    const shelf = Object.keys(D.PRODUCTS).filter(k => E.isUnlocked(k) && E.stockOf(k) > 0);
    const prodRows = shelf.map(k => {
      const p = D.PRODUCTS[k];
      const n = E.stockOf(k);
      return `<div class="inv-row">
        <span class="swatch" style="background:${p.color};width:9px;height:9px;"></span>
        <span class="inv-name">${p.name}</span>
        <span class="inv-tag">${p.price}G</span>
        <span class="inv-num">${n}</span>
      </div>`;
    }).join('');
    const totalValue = Object.entries(S.stock).reduce((a, [k, n]) => a + (D.PRODUCTS[k] ? D.PRODUCTS[k].price * n : 0), 0);
    const learned = Object.keys(D.PRODUCTS).filter(k => E.isUnlocked(k)).length;
    const pend = E.pendingPurchases();
    const pendRows = pend.map(p => `<div class="pur-pend"><span>${esc(p.label)}</span>
      <b>${p.phasesLeft ? p.phasesLeft + ' 个阶段后到' : '正在卸货'}</b></div>`).join('');
    const purCard = `<div class="pur-box">
      <div class="pur-head"><b>发起采购</b><span>批发价 · 满量再折 · 隔一个阶段送到</span></div>
      ${pendRows || '<div class="pur-empty">没有在路上的货。</div>'}
      <button class="btn btn-sm" data-act="pur-open">向批发商下单</button>
    </div>`;
    /* 左栏只放原料清单；进货提示和采购入口挪到右栏、成品货架之上——
       左边一长串原料本来就够长，进货提示压在下面要滚很久才看得到。 */
    return `<div class="inv-cols">
      <div><div class="card-title">原料</div>${rawRows}</div>
      <div>
        <div class="inv-side-top">${buyHint()}${purCard}</div>
        <div class="card-title" style="margin-top:14px">成品货架</div>
        ${prodRows || '<div class="empty" style="padding:10px;">货架是空的。去制作台做点东西。</div>'}
        <div style="margin-top:10px;font-size:11px;color:#8d7a9c;">货架总值约 <b style="color:#e0568f">${totalValue}G</b>
          · 会的方子 <b>${learned}</b> / ${Object.keys(D.PRODUCTS).length}</div>
      </div></div>`;
  }

  /* 新手教学那张固定的订单：不给代送，免得跳过整段教学 */
  function isTutorialOrder(o) {
    const t = E.state.tutorial;
    return !!(t && t.on && o && o.id === t.orderId);
  }

  function tabOrders() {
    const S = E.state;
    if (!S.orders.length && !(S.takeout && S.takeout.enabled)) {
      return `<div class="empty">订单簿是空的。<br>配送阶段开始时会自动带上传真过来的预订。</div>`;
    }
    const normal = S.orders.length ? S.orders.map(o => {
      const left = o.deadline - S.day;
      const urgent = left <= 0;
      const items = Object.entries(o.items).map(([k, q]) =>
        `<span class="order-item">${D.PRODUCTS[k] ? D.PRODUCTS[k].name : k} ×${q}</span>`).join('');
      const canMake = Object.entries(o.items).every(([k, q]) => E.stockOf(k) >= q);
      return `<div class="order ${urgent ? 'urgent' : ''}">
        <div class="order-head">
          <span class="order-id">#${o.id}</span>
          ${isTutorialOrder(o) ? '<span class="order-tut">新手</span>' : ''}
          <span class="order-cust">${esc(o.customer)}</span>
          <span class="order-loc">${locName(o.loc)}</span>
          <span class="order-dl">${left <= 0 ? '<b>今天到期</b>' : '还剩 <b>' + left + '</b> 天'}</span>
        </div>
        <div class="order-items">${items}</div>
        <div class="order-foot">
          <span class="order-pay">${o.pay}G</span>
          <span style="font-size:10px;color:${canMake ? '#2c7d58' : '#c2405a'}">${canMake ? '货已备齐' : '货架不足'}</span>
          <div class="order-actions">
            <button class="btn btn-sm" data-act="order-third" data-id="${o.id}"
              title="叫第三方平台代送：准时、安全，抽走尾款的一部分（45%，最低 12G）"
              ${canMake && S.money >= E.thirdPartyFee(o) && !isTutorialOrder(o) ? '' : 'disabled'}>代送 ${E.thirdPartyFee(o)}G</button>
            <button class="btn btn-sm btn-ghost" data-act="order-extend" data-id="${o.id}">请求延期</button>
            <button class="btn btn-sm btn-ghost" data-act="order-cancel" data-id="${o.id}">取消</button>
          </div>
        </div>
      </div>`;
    }).join('') : '';
    return normal + takeoutCard();
  }

  /* 外卖单：单独一池，不进常规配送的订单簿、不占运力 */
  function takeoutCard() {
    const S = E.state, C = D.TAKEOUT;
    const t = E.takeoutState();
    if (!t.enabled) {
      return `<div class="card-title" style="margin-top:16px">外卖终端</div>
        <div class="takeout-card locked">
          <div class="tk-top"><b>还没接入外卖平台</b><span>去店铺页开通</span></div>
          <div class="shop-tip">第 ${C.unlockDay} 天以后、信誉 ${C.unlockRep}，花 ${C.setupFee}G 装一台终端。
            外卖单不用出门，骑手自己来取，但平台要抽 ${Math.round(C.platformRate * 100)}%。</div>
        </div>`;
    }
    const rows = t.orders.length ? t.orders.map(o => {
      const items = Object.entries(o.items).map(([k, q]) =>
        `<span class="order-item">${D.PRODUCTS[k] ? D.PRODUCTS[k].name : k} ×${q}</span>`).join('');
      const ready = o.status === 'ready';
      const has = E.takeoutHas(o.items);
      const canPack = !ready && has && S.ap >= C.packAp;
      return `<div class="takeout-order ${ready ? 'ready' : ''}">
        <div class="tk-head">
          <span class="order-id">外卖 #${o.id}</span>
          <span class="tk-state">${ready ? '已放取餐口 · 收班结算' : (has ? '货已备齐' : '货架不足')}</span>
        </div>
        <div class="order-items">${items}</div>
        <div class="order-foot">
          <span class="order-pay">${o.pay}G</span>
          <span class="dim">抽成后 ${o.pay - Math.round(o.pay * C.platformRate)}G</span>
          <div class="order-actions">
            <button class="btn btn-sm ${canPack ? 'btn-primary' : ''}" data-act="takeout-pack"
              data-id="${o.id}" ${canPack ? '' : 'disabled'}>
              ${ready ? '等骑手来取' : `放入取餐口 · ${C.packAp} AP`}</button>
          </div>
        </div>
      </div>`;
    }).join('') : `<div class="empty">这一班还没有外卖单。坐班开始时终端会响。</div>`;
    const staffTip = S.staff.length
      ? `雇着 ${S.staff.length} 位学徒：收班前她会自己备好最多 ${C.autoCap} 单（货架上得有货），漏单不扣信誉。`
      : '没雇助手：每张单都得自己装取餐口，漏单会掉信誉和履约。';
    return `<div class="card-title" style="margin-top:16px">外卖单 · 与配送订单不互通</div>
      <div class="takeout-card">${rows}
        <div class="shop-tip">${staffTip} 累计做掉 ${t.stats.done} 单、进账 ${t.stats.earned}G。</div>
      </div>`;
  }

  /* ================= 委托（主线） ================= */
  function tabStory() {
    const G = window.GameStory;
    if (!G) return `<div class="empty">主线还没装进来。</div>`;
    const p = G.progress();
    const st = G.state();
    const out = [];

    if (p.on) {
      const cur = G.chapter();
      const pct = Math.round(((p.step - 1) / Math.max(1, p.total)) * 100);
      out.push(`<div class="story-card">
        <div class="story-head">
          <span class="story-no">${esc(cur.title)}</span>
          <span class="story-title">${esc(cur.subtitle)}</span>
        </div>
        <div class="story-meta">
          <span class="story-tag">${esc(cur.sugar)}</span>
          <span class="story-tag">${esc(cur.place)}</span>
          <span class="story-step">第 ${p.step} / ${p.total} 步</span>
        </div>
        <div class="story-goal">${esc(p.goal)}</div>
        ${p.hint ? `<div class="story-hint">${esc(p.hint)}</div>` : ''}
        <div class="story-bar"><i style="width:${pct}%"></i></div>
      </div>`);
    } else if (G.state().done.indexOf('ch2') >= 0) {
      out.push(`<div class="empty">主线暂时写到这里。<br>糖果屋照常开门，订单照常要送——后面的故事还在写。</div>`);
    } else {
      out.push(`<div class="empty">主线还没开始。<br>眼下就是老老实实开店——白天卖糖，晚上送货。</div>`);
    }

    // 手上的东西
    const items = Object.keys(st.items || {}).filter(k => G.ITEMS[k]);
    if (items.length) {
      out.push(`<div class="card"><div class="card-title">手上的东西</div>
        <div class="item-list">${items.map(k => {
          const it = G.ITEMS[k];
          return `<div class="story-item">
            <div class="story-item-top"><b>${esc(it.name)}</b><span>×${st.items[k]}</span></div>
            <div class="story-item-desc">${esc(it.desc)}</div>
          </div>`;
        }).join('')}</div></div>`);
    }

    // 线索
    if (st.clues && st.clues.length) {
      out.push(`<div class="card"><div class="card-title">线索</div>
        <div class="item-list">${st.clues.map(k => {
          const c = G.CLUES[k];
          if (!c) return '';
          return `<div class="story-item clue">
            <div class="story-item-top"><b>${esc(c.name)}</b></div>
            <div class="story-item-desc">${esc(c.desc)}</div>
          </div>`;
        }).join('')}</div></div>`);
    }

    // 可以做的事：当前步骤有专属动作时给个按钮
    const acts = [];
    if (G.isStep('studio')) {
      acts.push({ id: 'open-studio', name: '按下收银机旁的瓷砖', desc: '暗门后面是母亲的工作室' });
    }
    if (G.isStep('brooch') && G.itemCount('snowBrooch') > 0) {
      acts.push({ id: 'recall-brooch', name: '回想胸针里的残影', desc: '把胸针握在手里，再看一遍' });
    }
    if (G.isStep('infil')) {
      acts.push({ id: 'goto-bar', name: '出发去银狐酒吧', desc: '城南工业区 · 3 动作点 · 记得走后巷' });
    }
    if (G.isStep('decode') && G.itemCount('encryptedBox') > 0) {
      acts.push({ id: 'ch2-open-box', name: '在工作室打开金属盒', desc: '防护阵会自毁，得先想个办法骗过它' });
    }
    if (G.isStep('survey')) {
      acts.push({ id: 'ch2-survey', name: '回银狐酒吧后巷', desc: '城南工业区 · 3 动作点 · 潜入取记录' });
    }
    if (G.isStep('network') && G.itemCount('labLog') > 0) {
      acts.push({ id: 'ch2-network', name: '把三张图叠起来看', desc: '素描、全图、实验记录' });
    }
    if (G.isStep('mint')) {
      acts.push({ id: 'ch2-mint', name: '熬一炉薄荷硬糖', desc: '收尾。明晚九点，老地方' });
    }
    if (acts.length) {
      out.push(`<div class="card"><div class="card-title">现在可以做</div>
        <div class="action-list">${acts.map(a => `
          <button class="action" data-act="${a.id}">
            <div class="action-name">${esc(a.name)}</div>
            <div class="action-desc">${esc(a.desc)}</div>
          </button>`).join('')}</div></div>`);
    }

    // 章节目录
    out.push(`<div class="card"><div class="card-title">章节</div>
      <div class="chapter-list">${G.catalog().map(c => `
        <div class="chapter ${c.done ? 'done' : ''} ${c.active ? 'now' : ''} ${c.locked ? 'locked' : ''}">
          <div class="chapter-no">${c.no === 0 ? '序' : c.no}</div>
          <div class="chapter-txt">
            <b>${esc(c.subtitle)}</b>
            <span>${c.done ? '已完成' : c.active ? esc(c.brief) : '——'}</span>
          </div>
        </div>`).join('')}</div></div>`);

    return out.join('');
  }

  /* ---------------- 熟人页 ----------------
   * engine 只给数据和档位，怎么排版全在这里。排序在 engine 里做好了（信任优先、消费次之）。
   */
  function tabPeople() {
    const list = E.peopleList();
    if (!list.length) {
      return `<div class="empty">还没跟谁真正打过交道。<br>
        去柜台站一班，或者把电话订单送到人手里——<br>
        来往过的人会记在这里，记得越多，越有人情可用。</div>`;
    }

    const known = list.filter(p => p.tier.key === 'regular' || p.tier.key === 'old').length;
    const oldOnes = list.filter(p => p.tier.key === 'old').length;
    const tipTotal = list.reduce((a, p) => a + p.tips, 0);
    const spentTotal = list.reduce((a, p) => a + p.spent, 0);

    const head = `<div class="card people-sum">
      <div class="people-sum-row">
        <span>认识 <b>${list.length}</b> 人</span>
        <span>熟客 <b>${known}</b></span>
        <span>老主顾 <b>${oldOnes}</b></span>
      </div>
      <div class="people-sum-row dim">
        <span>他们一共在你店里花了 <b>${spentTotal}G</b></span>
        <span>小费 <b>${tipTotal}G</b></span>
      </div>
      <div class="people-tip">准时送到、送到他爱吃的那口，信任涨得快；超时和退单会掉。
        信任高的人单子更大、小费更舍得给。</div>
    </div>`;

    const rows = list.map(p => {
      const total = p.done + p.late;
      const pct = Math.round((p.trust / 5) * 100);
      const favs = p.fav.map(k => D.PRODUCTS[k] ? D.PRODUCTS[k].name : k).join('、');
      const met = p.lastDay ? `上次来往：第 ${p.lastDay} 天` : '';
      const rate = total ? Math.round((p.done / total) * 100) : 0;
      return `<div class="person">
        <div class="person-top">
          <b class="person-name">${esc(p.name)}</b>
          <span class="person-tier t-${p.tier.key}">${esc(p.tier.name)}</span>
          ${p.tag && p.tag !== p.tier.name ? `<span class="person-tag">${esc(p.tag)}</span>` : ''}
          <span class="person-money">${p.spent}G</span>
        </div>
        <div class="person-trust">
          <i style="width:${pct}%"></i>
        </div>
        <div class="person-stats">
          <span>下单 <b>${p.orders}</b></span>
          <span>准时 <b>${p.done}</b></span>
          ${p.late ? `<span class="bad">超时 <b>${p.late}</b></span>` : ''}
          ${p.refused ? `<span class="bad">退单 <b>${p.refused}</b></span>` : ''}
          ${total ? `<span class="dim">准时率 ${rate}%</span>` : ''}
          ${p.tips ? `<span class="good">小费 ${p.tips}G</span>` : ''}
        </div>
        <div class="person-foot">
          ${favs ? `<span class="person-fav">爱吃：${esc(favs)}</span>` : ''}
          ${met ? `<span class="dim">${met}</span>` : ''}
        </div>
      </div>`;
    }).join('');

    return head + `<div class="people-list">${rows}</div>`;
  }

  /* 店铺页：账本 + 三条升级线 + 帮工。
   * 这是「钱花在哪」的答案，也是店铺越做越大的凭证。 */
  function tabShop() {
    const S = E.state;
    const bill = E.billsPreview();
    const staff = E.apprenticeList();

    /* —— 评级卡：整个经营的压力表 ——
       店不会没，但这三条线决定你配得上什么：更好的单、更好的车、更贵的书、
       以后的新门面。评级低不是死，是慢。 */
    const rk = E.rankInfo();
    const credRows = E.credList().map(c => `
      <div class="cred-row ${c.low ? 'low' : ''}">
        <span class="cred-name">${c.label}</span>
        <span class="cred-bar"><i style="width:${c.value}%"></i></span>
        <b class="cred-val">${c.value}</b>
      </div>`).join('');

    const nextLine = rk.next
      ? `<div class="rank-next">
          <span class="rank-next-title">下一级 <b>${rk.next.id}「${rk.next.name}」</b></span>
          <span class="rank-need ${rk.credGap ? '' : 'ok'}">执照均值 ≥ ${rk.next.cred}${rk.credGap ? `（差 ${Math.ceil(rk.credGap)}）` : ' ✓'}</span>
          <span class="rank-need ${rk.weekGap ? '' : 'ok'}">本周流水 ≥ ${rk.next.week}${rk.weekGap ? `（差 ${rk.weekGap}G）` : ' ✓'}</span>
        </div>`
      : `<div class="rank-next"><span class="rank-next-title">已经是最高评级。别人拿糖果屋当坐标。</span></div>`;

    const week = S.week || { revenue: 0, delivered: 0, onTime: 0 };
    const onTimeRate = week.delivered ? Math.round(week.onTime / week.delivered * 100) : 100;
    const goals = `<div class="goal-box">
      <div class="goal-row"><span>今天</span><b>${S.dayDelivered || 0} 单送出</b><em>${money(S.dayRevenue || 0)}G 进项</em></div>
      <div class="goal-row"><span>本周</span><b>${week.delivered} 单</b><em>${money(week.revenue)}G · 准时 ${onTimeRate}%</em></div>
      <div class="goal-row"><span>考核</span><b>${rk.daysToReview} 天后</b><em>评级 ${rk.id} → ${rk.next ? rk.next.id : '满级'}</em></div>
    </div>`;

    const rankCard = `<div class="card rank-card">
      <div class="rank-top">
        <span class="rank-badge">${rk.id}</span>
        <div class="rank-title"><b>${rk.name}</b><span class="rank-note">${rk.note}</span></div>
        <span class="rank-go">${rk.next ? `→ ${rk.next.id}` : '满级'}</span>
      </div>
      <div class="cred-list">${credRows}</div>
      ${nextLine}
      ${goals}
    </div>`;

    /* —— 账本 —— */
    /* 这间屋子是母亲的，没有房租。母亲只按营业额抽一成「家用」——
       所以这一行会随生意一起涨，冷清的日子也不会逼死人。 */
    const hist = (S.billLog || []).slice(0, 5).map(b => `
      <div class="shop-bill-row">
        <span>第 ${b.day} 天</span>
        <span class="dim">家 ${b.home} · 电 ${b.utility} · 工 ${b.wage}${b.lic ? ` · 检 ${b.lic}` : ''}</span>
        <b>-${b.total}G</b>
      </div>`).join('');

    const ratePct = Math.round((D.COSTS.homeRate || 0) * 100);
    const licRow = bill.lic ? `<span class="lic">执照年检 <b>${bill.lic}G</b></span>` : '';
    const overdraft = (S.money || 0) < 0 ? `
      <div class="shop-over">
        <span>账上透支 <b>${-Math.round(S.money)}G</b>——先进不了货，做单回血就缓过来了。真没辙就去巷口帮半天忙。</span>
      </div>` : '';
    const head = `<div class="card shop-ledger">
      <div class="shop-ledger-top">
        <div><span class="shop-big">-${bill.total}G</span><span class="dim"> 今晚结算</span></div>
        <div class="dim">今天做了 ${S.dayMade || 0} 件</div>
      </div>
      <div class="shop-ledger-grid">
        <span>家用 <b>${bill.home}G</b></span>
        <span>水电 <b>${bill.utility}G</b></span>
        <span>工钱 <b>${bill.wage}G</b></span>
        ${licRow}
      </div>
      ${overdraft}
      ${hist ? `<div class="shop-hist">${hist}</div>` : ''}
      <div class="shop-tip">房子是妈的，不交房租——柜上抽 ${ratePct}% 给家里（最低 ${D.COSTS.homeMin}G），小费不算在里头。
        ${E.licenseDue() ? '今天执照年检，费用已并进账单。' : `下次执照年检还有 <b>${E.licenseDays()}</b> 天。`}
        打烊自动扣；钱不够就透支，透支只拦进货，不会关门。</div>
    </div>`;

    /* —— 设备与赊账 —— */
    const wear = Math.round(S.wear || 0);
    const mCost = E.maintainCost();
    const canMaint = wear >= 1 && S.money >= mCost && S.money >= 0;
    const wearCard = `<div class="card mini-card">
      <div class="mini-top">
        <span class="mini-name">设备状态</span>
        <b class="mini-val ${wear >= 70 ? 'bad' : ''}">${wear}% 磨损</b>
        <button class="btn btn-sm" data-act="maintain" ${canMaint ? '' : 'disabled'}>${mCost}G 保养</button>
      </div>
      <span class="wear-bar"><i style="width:${wear}%"></i></span>
      <div class="shop-tip">磨损吃成功率（磨满 −${Math.round(D.COSTS.wearPenalty * 100)}%），年检时太脏还会扣合规。</div>
    </div>`;

    const cr = E.creditInfo();
    const creditCard = `<div class="card mini-card">
      <div class="mini-top">
        <span class="mini-name">供应商赊账</span>
        <b class="mini-val">${cr.used} / ${cr.cap}G</b>
      </div>
      <div class="credit-list">${cr.list.length
        ? cr.list.map(p => `<span class="${p.daysLeft <= 0 ? 'due' : ''}">${p.daysLeft <= 0 ? '今天到期' : `${p.daysLeft} 天后到期`} · ${p.amt}G</span>`).join('')
        : '<span class="dim">没有欠款。</span>'}</div>
      <div class="shop-tip">现金不够可以赊着进货，额度吃供应链信用，账期 ${D.COSTS.creditDays} 天。逾期不结会缩额度、掉信用。</div>
    </div>`;

    /* —— 升级 —— */
    const upCards = E.upAll().map(u => {
      const dots = Array.from({ length: u.max }, (_, i) => `<i class="${i < u.lv ? 'on' : ''}"></i>`).join('');
      const canBuy = !!(u.next && S.money >= u.next.cost);
      return `<div class="shop-up">
        <div class="shop-up-top">
          <span class="shop-up-icon">${u.icon}</span>
          <b class="shop-up-name">${u.name}</b>
          <span class="shop-up-tag">${u.tag}</span>
          <span class="shop-up-lv">${dots}</span>
        </div>
        <div class="shop-up-cur">${u.cur.label} · ${u.cur.effect}</div>
        ${u.next
          ? `<div class="shop-up-next">→ ${u.next.label}：${u.next.effect}</div>`
          : `<div class="shop-up-next dim">已经到顶了</div>`}
        ${u.next
          ? `<button class="btn btn-sm ${canBuy ? 'btn-primary' : ''}" data-act="buy-upgrade" data-key="${u.key}" ${canBuy ? '' : 'disabled'}>${u.next.cost}G 升级</button>`
          : ''}
      </div>`;
    }).join('');

    /* —— 帮工 —— */
    const onCounter = E.staffOnCounter();
    const staffCards = staff.map(a => {
      const canHire = !a.hired && a.roomLeft && S.money >= a.hire;
      const crafts = a.craft.map(k => (D.PRODUCTS[k] ? D.PRODUCTS[k].name : k)).join('、');
      return `<div class="shop-app ${a.hired ? 'hired' : ''}">
        <div class="shop-app-top">
          <b>${esc(a.name)}</b>
          <span class="shop-app-tag">${esc(a.tag)}</span>
          ${a.hired ? '<span class="shop-app-on">在店里</span>' : ''}
        </div>
        <div class="shop-app-desc">${esc(a.desc)}</div>
        <div class="shop-app-meta">
          <span>每阶段 <b>+${a.ap} AP</b></span>
          <span>工钱 <b>${a.wage}G</b>/天</span>
          <span class="dim">会做 ${esc(crafts)}</span>
        </div>
        ${a.hired
          ? `<div class="staff-btns">
              ${onCounter === a.id
                ? `<span class="post-on">看柜台</span>
                   <button class="btn btn-sm btn-ghost" data-act="staff-post" data-id="${a.id}" data-post="">撤回后场</button>`
                : `<button class="btn btn-sm" data-act="staff-post" data-id="${a.id}" data-post="counter">安排看柜台</button>`}
              <button class="btn btn-sm btn-ghost" data-act="fire-app" data-id="${a.id}">辞退</button>
            </div>`
          : `<button class="btn btn-sm ${canHire ? 'btn-primary' : ''}" data-act="hire-app" data-id="${a.id}" ${canHire ? '' : 'disabled'}>安家费 ${a.hire}G</button>`}
      </div>`;
    }).join('');

    const hired = staff.filter(a => a.hired);
    const bonusAP = hired.reduce((s, a) => s + a.ap, 0);
    const staffTip = `<div class="shop-tip">阁楼住得下 ${E.STAFF_MAX} 个人。
      现在 ${hired.length} 位，每阶段多 <b>${bonusAP}</b> AP，一天多约 <b>${bonusAP * 6}</b> AP。
      开炉前他们还会自己做点什么——吃你的原料。</div>`;

    const oddCard = `<div class="card mini-card">
      <div class="mini-top">
        <span class="mini-name">巷口零工</span>
        <b class="mini-val">一天一次 · ${D.COSTS.oddJobAp} AP</b>
        <button class="btn btn-sm" data-act="odd-job" ${E.canOddJob() ? '' : 'disabled'}>帮半天忙</button>
      </div>
      <div class="shop-tip">货架空、现金见底、赊账额度也用光的时候：去巷口水果摊出一份力，
        换面粉×2、砂糖×1、黄油×1——正好够开一炉黄油曲奇重新开张。</div>
    </div>`;

    const g = E.gearInfo();
    const gearCard = `<div class="card mini-card">
      <div class="mini-top">
        <span class="mini-name">随身装备</span>
        <b class="mini-val">${esc(g.name)}</b>
        ${g.owned
          ? '<span class="gear-owned">已装备</span>'
          : `<button class="btn btn-sm" data-act="buy-gear" ${S.money >= g.price ? '' : 'disabled'}>${g.price}G</button>`}
      </div>
      <div class="shop-tip">${esc(g.desc)}
        没有它时，含烈酒 / 魔法糖浆的成品过不了新岛地铁安检——那几单只能骑车从跨海大桥带进去。</div>
    </div>`;

    /* —— 外卖终端 —— */
    const tk = E.takeoutState();
    const tkOpen = E.takeoutUnlocked();
    const canSetup = !tk.enabled && tkOpen && S.money >= D.TAKEOUT.setupFee;
    const tkCard = `<div class="card mini-card">
      <div class="mini-top">
        <span class="mini-name">外卖终端</span>
        <b class="mini-val">${tk.enabled
          ? `已接入 · 累计 ${tk.stats.done} 单`
          : (tkOpen ? `${D.TAKEOUT.setupFee}G 开通` : `第 ${D.TAKEOUT.unlockDay} 天 / 信誉 ${D.TAKEOUT.unlockRep}`)}</b>
        ${tk.enabled
          ? '<span class="gear-owned">已开通</span>'
          : `<button class="btn btn-sm" data-act="takeout-open" ${canSetup ? '' : 'disabled'}>${D.TAKEOUT.setupFee}G 开通</button>`}
      </div>
      <div class="shop-tip">${esc(D.TAKEOUT.desc)} 坐班时推单，放进取餐口收班结算，
        平台抽 ${Math.round(D.TAKEOUT.platformRate * 100)}%；有学徒的话她会替你打理。
        ${tk.enabled ? '' : `解锁要第 ${D.TAKEOUT.unlockDay} 天、信誉 ${D.TAKEOUT.unlockRep}
          （现在第 ${S.day} 天 / 信誉 ${Math.round(S.reputation)}）。`}</div>
    </div>`;

    return rankCard + head + wearCard + creditCard + gearCard + tkCard + oddCard
      + `<div class="card-title" style="margin-top:16px">店铺升级</div>`
      + `<div class="shop-ups">${upCards}</div>`
      + `<div class="card-title" style="margin-top:16px">帮工</div>`
      + `<div class="shop-apps">${staffCards}</div>`
      + staffTip;
  }

  function tabVehicle() {
    const S = E.state;
    return Object.entries(D.VEHICLES).map(([k, v]) => {
      const owned = S.ownedVehicles.includes(k);
      const active = S.vehicle === k;
      return `<div class="veh ${owned ? 'owned' : ''}">
        <div class="veh-icon">${k === 'bike' ? '🏍' : k === 'van' ? '🚐' : '🚚'}</div>
        <div class="veh-body">
          <div class="veh-name">${v.name} ${active ? '<span style="font-size:9px;color:#2c7d58">（使用中）</span>' : ''}</div>
          <div class="veh-desc">${v.desc}</div>
          <div class="veh-spec">运力 <b>${v.cap}</b> 单位 · 速度 <b>${v.speed}</b></div>
        </div>
        ${owned
          ? `<button class="btn btn-sm" data-act="vehicle-select" data-key="${k}" ${active ? 'disabled' : ''}>使用</button>`
          : `<button class="btn btn-sm btn-gold" data-act="vehicle-buy" data-key="${k}" ${S.money < v.price ? 'disabled' : ''}>${v.price}G</button>`}
      </div>`;
    }).join('') + `<div style="font-size:10.5px;color:#a493ae;margin-top:10px;line-height:1.8;">
      配送阶段开始前，需要在出货单里挑选本次要送的订单——运力装不下的，只能留到下一趟。
    </div>`;
  }

  function tabLog() {
    const S = E.state;
    if (!S.log.length) return `<div class="empty">日记还是空白的。</div>`;
    return S.log.map(l => {
      const cls = l.kind === 'good' ? 'good' : l.kind === 'bad' ? 'bad' : l.kind === 'phase' ? 'phase' : '';
      return `<div class="log-line ${cls}"><span class="log-day">D${l.day}</span><span class="log-txt">${esc(l.text)}</span></div>`;
    }).join('');
  }

  /* ================= 柜台 ================= */
  function buildCounter() {
    if (counterBuilt) return;
    counterBuilt = true;
    el.viewCounter.innerHTML = `
      <div class="counter-stage">
        <canvas id="counter-canvas"></canvas>
        <div class="counter-hud">
          <div class="cust-panel">
            <div class="cust-list" id="cust-list"></div>
            <div class="cust-card" id="cust-card"></div>
          </div>
          <div class="shop-sign">糖果屋 · 营业中</div>
        </div>
      </div>
      <div class="counter-bottom">
        <div class="shelf" id="shelf"></div>
        <div class="counter-actions">
          <button class="btn btn-primary" id="btn-serve" data-act="serve">交付货品</button>
          <button class="btn" id="btn-refuse" data-act="refuse">婉拒</button>
          <button class="btn btn-ghost" data-act="leave-counter" id="btn-leave-counter" title="有助手看店时，可以出门跑一趟">没人看店</button>
          <button class="btn btn-ghost" data-act="end-phase" id="btn-end-shift">结束营业 →</button>
        </div>
      </div>`;
    cvs = $('counter-canvas');
    cctx = cvs.getContext('2d');
  }

  function counterResize() {
    if (!cvs) return;
    const stage = cvs.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, stage.width), h = Math.max(200, stage.height);
    cvs.width = Math.round(w * dpr);
    cvs.height = Math.round(h * dpr);
    cvs.style.width = w + 'px';
    cvs.style.height = h + 'px';
    csDpr = dpr;
    csScale = h / 270;
    csVW = Math.round(270 * (w / h));
    lastStageW = Math.round(stage.width);
    lastStageH = Math.round(stage.height);
    try { drawCounterScene(performance.now() / 1000); } catch (e) { /* 首帧兜底 */ }
  }

  function newCustomer() {
    const cust = E.pick(D.CUSTOMERS);
    /* 上门的客人多数点自己爱吃的那口——但只点你做得出、也上过架的。
       万一口味全被锁住，就退回到现有的品类里挑。 */
    const pool = E.productKeys();
    const fav = (cust.fav || []).filter(k => E.isUnlocked(k));
    const key = (fav.length && Math.random() < 0.65) ? E.pick(fav) : E.pick(pool);
    const qty = 1 + E.rand(2);
    return {
      uid: custSeq++,
      name: cust.name, tag: cust.tag, wants: key, qty,
      pal: paletteFor(cust.name), mood: 'wait'
    };
  }

  /* 柜台等级决定的接待能力：同时站几位（seats）、送走客人后补位多快（flow）。
   * 没升级就是 1 级，和以前一样。 */
  function counterLv() {
    const u = D.SHOP_UPGRADES && D.SHOP_UPGRADES.counter;
    const lv = E.upLv ? E.upLv('counter') : 1;
    return (u && u.levels[lv - 1]) || { seats: CUST_MAX, flow: 1 };
  }
  function counterSeats() { return Math.max(1, Math.min(CUST_MAX, counterLv().seats || CUST_MAX)); }

  /* 门口又进来一位 */
  function spawnCustomer() {
    if (E.state.ap <= 0) return null;
    if (customers.length >= counterSeats()) return null;
    const cu = newCustomer();
    customers.push(cu);
    return cu;
  }

  /* 开始营业：柜台越宽，同时推门进来的人越多 */
  function spawnCustomers() {
    customers = [];
    const n = 1 + E.rand(counterSeats());
    for (let i = 0; i < n; i++) spawnCustomer();
    custSel = 0;
  }

  function currentCustomer() {
    if (!customers.length) return null;
    if (custSel >= customers.length) custSel = 0;
    return customers[custSel];
  }

  function custCanServe(cu) {
    return !!cu && E.stockOf(cu.wants) >= cu.qty && E.state.ap > 0;
  }

  function custCanMake(cu) {
    if (!cu || E.state.ap <= 0) return false;
    const p = D.PRODUCTS[cu.wants];
    return E.state.ap >= Math.max(1, p.ap) && E.canCraft(cu.wants);
  }

  function paletteFor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
    const bodies = ['#6b7fa8', '#8a6b8f', '#7a8a6b', '#a8796b', '#6b8a8a', '#8a7a5a', '#95738f'];
    const hairs = ['#3a2b2b', '#4a3a2a', '#2b2b3a', '#5a4a3a', '#3a3a3a'];
    const skins = ['#f2d1b3', '#e8c0a0', '#f7dcc4', '#d9ae8c'];
    return { body: bodies[h % bodies.length], hair: hairs[h % hairs.length], skin: skins[(h >> 3) % skins.length], legs: '#3a3444' };
  }

  const MILLY_PAL = { body: '#ffc2d6', hair: '#4a2f3d', skin: '#f7d6bd', legs: '#3a2f45' };

  function updateCounter() {
    if (!customers.length && E.state.ap > 0) spawnCustomer();
    const cu = currentCustomer();
    /* 有助手站柜台，这一班就能交给她；没有就只能干看着 */
    const lb = $('btn-leave-counter');
    if (lb) {
      const who = E.staffOnCounter();
      const t = who ? D.APPRENTICES.find(x => x.id === who) : null;
      lb.textContent = t ? `交给${t.name}看着，出门 →` : '没人看店';
      lb.disabled = !t || E.state.ap < 1;
      lb.title = t ? '这一班交给助手，你自己出去跑' : '店里没人，走不开';
    }

    /* 客人列表：点头像切换招呼谁 */
    const list = $('cust-list');
    if (list) {
      list.classList.toggle('is-off', !customers.length);
      list.innerHTML = customers.map((c, i) => {
        const p = D.PRODUCTS[c.wants];
        return `<button class="cust-tab${i === custSel ? ' on' : ''}${c.mood === 'happy' ? ' happy' : ''}"
          data-act="cust-pick" data-idx="${i}" title="${esc(c.name)} · ${p.name}×${c.qty}">
          ${esc(c.name)}<i>${c.qty}</i></button>`;
      }).join('');
    }

    const card = $('cust-card');
    if (card) {
      if (!cu) {
        card.innerHTML = `<div class="cust-name">——</div><div class="cust-tag">打烊了</div>
          <div class="cust-want">今天没有力气再招呼客人了。</div>`;
      } else {
        const p = D.PRODUCTS[cu.wants];
        const have = E.stockOf(cu.wants);
        const apCost = Math.max(1, p.ap);
        const lack = have >= cu.qty ? '' : `<span class="cust-lack">货架只有 ${have}</span>`;
        card.innerHTML = `<div class="cust-name">${esc(cu.name)}<span class="cust-tag">${cu.tag}</span></div>
          <div class="cust-want">想要：<b>${p.name} ×${cu.qty}</b>${lack}</div>
          <div class="cust-btns">
            <button class="btn btn-sm btn-primary" data-act="cust-serve" data-idx="${custSel}" ${custCanServe(cu) ? '' : 'disabled'}>交付</button>
            <button class="btn btn-sm" data-act="cust-make" data-idx="${custSel}" ${custCanMake(cu) ? '' : 'disabled'}
              title="用原料当场做一份，${apCost} 点行动点">现做 ${apCost}AP</button>
            <button class="btn btn-sm btn-ghost" data-act="cust-refuse" data-idx="${custSel}">婉拒</button>
          </div>`;
      }
    }

    const shelf = $('shelf');
    if (shelf) {
      /* 货架只摆「已经做出来、还在架上」的品，外加客人正等着的那些——
         六十多个方子全摆出来，真正有货的那两格会被埋在灰格子里。 */
      const wanted = customers.map(c => c.wants);
      const shelfKeys = Object.keys(D.PRODUCTS).filter(k =>
        E.isUnlocked(k) && (E.stockOf(k) > 0 || wanted.indexOf(k) >= 0));
      shelf.innerHTML = shelfKeys.length ? shelfKeys.map(k => {
        const p = D.PRODUCTS[k];
        const n = E.stockOf(k);
        const hot = wanted.indexOf(k) >= 0;
        const rec = Object.entries(p.recipe).map(([rk, rq]) => `${D.RAW[rk].name}${rq}`).join(' ');
        return `<button class="goods ${hot ? 'hot' : ''}" data-act="serve-item" data-key="${k}" ${n <= 0 ? 'disabled' : ''} title="配方：${rec}">
          <div class="g-name">${p.name}</div>
          <div class="g-num">${n}</div>
          <div class="g-price">${p.price}G</div>
        </button>`;
      }).join('') : '<div class="shelf-empty">货架是空的。客人还在等。</div>';
    }

    const bs = $('btn-serve'), br = $('btn-refuse');
    if (bs && br) {
      bs.disabled = !custCanServe(cu);
      br.disabled = !cu || E.state.ap <= 0;
      bs.textContent = cu ? `交付 ${D.PRODUCTS[cu.wants].name} ×${cu.qty}` : '交付货品';
    }
  }

  /* 送走一位：剩下的往前挪，运气好门口还会再进来一位 */
  function dropCustomer(cu, nextChance) {
    const i = customers.indexOf(cu);
    if (i >= 0) customers.splice(i, 1);
    if (custSel > customers.length - 1) custSel = Math.max(0, customers.length - 1);
    if (nextChance && E.state.ap > 0 && customers.length < counterSeats()) {
      /* 柜台越宽，下一位来得越快 */
      const p = Math.min(0.95, nextChance * (counterLv().flow || 1));
      if (Math.random() < p) spawnCustomer();
    }
    updateCounter();
  }

  function serveCustomer(key, who) {
    const cu = who || currentCustomer();
    if (!cu) return;
    if (key && key !== cu.wants) {
      toast(`${cu.name} 看了你一眼：「我要的不是这个。」`);
      return;
    }
    const r = E.counterServe(cu.wants, cu.qty, cu.name);
    if (!r.ok) { toast(r.msg, 'bad'); updateCounter(); return; }
    cu.mood = 'happy';
    toast(`卖出 ${D.PRODUCTS[cu.wants].name} ×${cu.qty}  +${r.income}G`, 'good');
    dropCustomer(cu, 0.6);
  }

  function refuseCustomer(who) {
    const cu = who || currentCustomer();
    if (!cu) return;
    const r = E.counterRefuse(cu.name);
    if (!r.ok) { toast('没力气了。', 'bad'); updateCounter(); return; }
    toast(`${cu.name} 空手走了。`, 'bad');
    dropCustomer(cu, 0.45);
  }

  /* 现做：客人站在这儿等着，回不去后场开制作台，只能当面做一份 */
  function makeForCustomer(who) {
    const cu = who || currentCustomer();
    if (!cu) return;
    const p = D.PRODUCTS[cu.wants];
    const r = E.counterMake(cu.wants);
    if (!r.ok) { toast(r.msg, 'bad'); updateCounter(); return; }
    toast(`现做 ${p.name}×1  -${r.ap}AP`, 'good');
    updateCounter();
  }

  /* ---- 像素店内场景 ---- */
  function startSceneLoop() {
    let last = 0;
    const tick = ts => {
      sceneRAF = requestAnimationFrame(tick);
      if (view !== 'counter' || !cvs) return;
      if (ts - last < 55) return;
      last = ts;
      // 舞台尺寸变化时自动重算（首次进入布局未完成也能兜住）
      const st = cvs.parentElement.getBoundingClientRect();
      if (Math.round(st.width) !== lastStageW || Math.round(st.height) !== lastStageH) counterResize();
      sceneT = ts / 1000;
      try { drawCounterScene(sceneT); } catch (err) {
        const c = cctx;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.fillStyle = '#000'; c.fillRect(0, 0, cvs.width, cvs.height);
        c.fillStyle = '#ff6b6b'; c.font = '15px monospace';
        c.fillText(String((err && err.stack) || err).slice(0, 300), 20, 40);
        c.fillText('csVW=' + csVW + ' csScale=' + csScale + ' dpr=' + csDpr, 20, 80);
      }
    };
    sceneRAF = requestAnimationFrame(tick);
  }

  function drawCounterScene(t) {
    const c = cctx;
    const W = csVW, H = 270;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#171021';
    c.fillRect(0, 0, cvs.width, cvs.height);
    c.save();
    c.scale(csScale * csDpr, csScale * csDpr);

    const floorY = 200;
    // 柜台左沿：窄屏往右让一截，好让三位客人并排站得下
    const ctrL = W * (W < 430 ? 0.33 : 0.26);

    /* 墙 */
    const wallGrad = c.createLinearGradient(0, 0, 0, floorY);
    wallGrad.addColorStop(0, '#f9ebd9');
    wallGrad.addColorStop(1, '#efd9c0');
    c.fillStyle = wallGrad;
    c.fillRect(0, 0, W, floorY);

    // 墙纸竖纹
    c.fillStyle = 'rgba(210,170,140,0.16)';
    for (let x = 0; x < W; x += 26) c.fillRect(x, 0, 8, floorY);

    // 护墙板
    c.fillStyle = '#dcc0a4';
    c.fillRect(0, floorY - 30, W, 30);
    c.fillStyle = '#c9a888';
    c.fillRect(0, floorY - 30, W, 3);
    for (let x = 0; x < W; x += 40) {
      c.fillStyle = 'rgba(255,255,255,0.18)';
      c.fillRect(x + 6, floorY - 24, 28, 18);
    }

    /* 地板 */
    c.fillStyle = '#9c6a48';
    c.fillRect(0, floorY, W, H - floorY);
    c.fillStyle = 'rgba(255,235,210,0.10)';
    for (let y = floorY; y < H; y += 14) c.fillRect(0, y, W, 5);
    c.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = floorY; y < H; y += 14) c.fillRect(0, y, W, 1);
    for (let x = -40; x < W + 40; x += 58) {
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.fillRect(x + ((Math.floor(x / 58) % 2) ? 24 : 0), floorY, 1, H - floorY);
    }
    // 门口地垫
    c.fillStyle = '#c97f8f';
    c.fillRect(Math.round(W * 0.045), 226, Math.round(W * 0.16), 26);
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.fillRect(Math.round(W * 0.045) + 3, 229, Math.round(W * 0.16) - 6, 3);
    c.fillRect(Math.round(W * 0.045) + 3, 246, Math.round(W * 0.16) - 6, 3);

    /* 橱窗 */
    const winX = Math.round(W * 0.06), winW = Math.round(W * 0.24), winY = 34, winH = 100;
    c.fillStyle = '#3a2f4a';
    c.fillRect(winX - 4, winY - 4, winW + 8, winH + 8);
    const ph = window.Engine.phase();
    const skyMap = {
      prep: '#3d4a78', deliveryAM: '#9fc4de', shiftAM: '#b6d8ef', noon: '#cfe7f7',
      shiftPM: '#f0a86e', deliveryPM: '#4b3a6e', night: '#262144'
    };
    const skyTop = skyMap[ph.id] || '#b6d8ef';
    const skyG = c.createLinearGradient(0, winY, 0, winY + winH);
    skyG.addColorStop(0, skyTop);
    skyG.addColorStop(1, ph.id === 'deliveryPM' || ph.id === 'night' ? '#3a2f52' : '#e8d4b8');
    c.fillStyle = skyG;
    c.fillRect(winX, winY, winW, winH);
    // 街景剪影
    for (let i = 0; i < 5; i++) {
      const bx = winX + 6 + i * (winW / 5);
      const bh = 24 + ((i * 37) % 28);
      c.fillStyle = ph.id === 'night' || ph.id === 'deliveryPM' ? '#1a1c30' : '#5c5a70';
      c.fillRect(bx, winY + winH - bh - 8, winW / 5 - 5, bh);
      c.fillStyle = ph.id === 'night' || ph.id === 'deliveryPM' ? 'rgba(255,214,140,0.7)' : 'rgba(255,255,255,0.35)';
      for (let wy = 0; wy < 3; wy++) {
        if ((i + wy) % 2 === 0) c.fillRect(bx + 3, winY + winH - bh - 2 + wy * 8, 4, 3);
      }
    }
    // 路灯
    c.fillStyle = '#6b6080';
    c.fillRect(winX + winW - 20, winY + winH - 44, 3, 44);
    const lampGlow = c.createRadialGradient(winX + winW - 18, winY + winH - 46, 0, winX + winW - 18, winY + winH - 46, 20);
    lampGlow.addColorStop(0, 'rgba(255,214,140,0.8)');
    lampGlow.addColorStop(1, 'rgba(255,214,140,0)');
    c.fillStyle = lampGlow;
    c.fillRect(winX + winW - 38, winY + winH - 66, 40, 40);
    // 窗框
    c.fillStyle = '#7a5c46';
    c.fillRect(winX, winY + winH / 2 - 2, winW, 4);
    c.fillRect(winX + winW / 2 - 2, winY, 4, winH);
    c.strokeStyle = '#6b4f3e';
    c.lineWidth = 3;
    c.strokeRect(winX, winY, winW, winH);

    /* 门（右侧背景） */
    const doorX = W - 88, doorW = 54, doorY = 96;
    c.fillStyle = '#6b4a38';
    c.fillRect(doorX - 3, doorY - 3, doorW + 6, floorY - doorY + 3);
    c.fillStyle = '#8a6349';
    c.fillRect(doorX, doorY, doorW, floorY - doorY);
    c.fillStyle = 'rgba(255,232,180,0.35)';
    c.fillRect(doorX + 6, doorY + 6, doorW - 12, 40);
    c.fillStyle = '#d8b070';
    c.fillRect(doorX + doorW - 12, doorY + 56, 4, 4);

    /* 货架 */
    const shX = Math.round(W * 0.30), shW = Math.round(W * 0.34), shY = 48;
    c.fillStyle = '#7a5a44';
    c.fillRect(shX - 4, shY - 4, shW + 8, 104);
    c.fillStyle = '#5e4331';
    c.fillRect(shX - 4, shY - 4, shW + 8, 104);
    c.fillStyle = '#6b4c39';
    c.fillRect(shX - 4, shY + 30, shW + 8, 6);
    c.fillRect(shX - 4, shY + 66, shW + 8, 6);
    const jarColors = ['#ff9dc0', '#ffd257', '#9fd8ff', '#a8e6cf', '#d9a94e', '#c3a8ff'];
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 8; i++) {
        const jx = shX + 8 + i * ((shW - 10) / 8);
        const jy = shY + row * 36 + 12;
        c.fillStyle = 'rgba(0,0,0,0.18)';
        c.fillRect(jx + 1, jy + 12, 10, 3);
        c.fillStyle = jarColors[(i + row * 3) % jarColors.length];
        c.fillRect(jx, jy + 3, 10, 11);
        c.fillStyle = 'rgba(255,255,255,0.4)';
        c.fillRect(jx + 2, jy + 5, 3, 6);
        c.fillStyle = '#8a6a52';
        c.fillRect(jx - 1, jy, 12, 4);
      }
    }
    // 顶层糖果罐
    for (let i = 0; i < 5; i++) {
      const jx = shX + 10 + i * ((shW - 20) / 5);
      c.fillStyle = jarColors[i % jarColors.length];
      c.fillRect(jx, shY - 16, 12, 14);
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(jx + 2, shY - 14, 4, 8);
    }

    /* 吊灯 */
    const lampX = W / 2, lampY = 26;
    c.strokeStyle = '#4a3b4a';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(lampX, 0); c.lineTo(lampX, lampY - 8); c.stroke();
    c.fillStyle = '#c88a4e';
    c.beginPath();
    c.moveTo(lampX - 16, lampY + 6);
    c.lineTo(lampX + 16, lampY + 6);
    c.lineTo(lampX + 8, lampY - 8);
    c.lineTo(lampX - 8, lampY - 8);
    c.closePath(); c.fill();
    c.fillStyle = '#ffe9b0';
    c.fillRect(lampX - 6, lampY + 4, 12, 3);
    const flick = 0.72 + Math.sin(t * 3.1) * 0.05 + Math.sin(t * 11) * 0.02;
    const lg = c.createRadialGradient(lampX, lampY, 4, lampX, lampY, 150);
    lg.addColorStop(0, `rgba(255,224,160,${0.30 * flick})`);
    lg.addColorStop(1, 'rgba(255,224,160,0)');
    c.fillStyle = lg;
    c.fillRect(lampX - 160, lampY - 20, 320, 260);

    /* 米莉（柜台后，先画，被柜台遮住下半身） */
    const millyX = Math.round(W * 0.50);
    drawPerson(c, millyX, 212, 3.0, MILLY_PAL, t);

    /* 柜台 */
    const ctrX = Math.round(ctrL), ctrTop = 186;
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.fillRect(ctrX + 4, ctrTop + 8, W - ctrX, 90);
    // 台面
    c.fillStyle = '#e8d0b4';
    c.fillRect(ctrX - 8, ctrTop, W - ctrX + 16, 13);
    c.fillStyle = '#f9ecd8';
    c.fillRect(ctrX - 8, ctrTop, W - ctrX + 16, 4);
    c.fillStyle = 'rgba(120,80,60,0.25)';
    c.fillRect(ctrX - 8, ctrTop + 11, W - ctrX + 16, 2);
    // 柜体
    c.fillStyle = '#a9704f';
    c.fillRect(ctrX, ctrTop + 13, W - ctrX, 71);
    c.fillStyle = '#96604a';
    for (let x = ctrX + 6; x < W - 6; x += 52) c.fillRect(x, ctrTop + 22, 44, 54);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    for (let x = ctrX + 6; x < W - 6; x += 52) c.fillRect(x + 2, ctrTop + 24, 40, 3);
    // 柜台侧板
    c.fillStyle = '#8a5b3e';
    c.fillRect(ctrX - 2, ctrTop + 13, 6, 71);

    /* 顾客（柜台前）：最多三位并排站着。
     * 画布宽度随窗口变，窄屏（手机竖屏）只有 270 上下，三人按 0.075W 排会糊成一团，
     * 所以：窄屏把柜台起点右移腾地方，人物比例再由间距反推（每人占 11u），保证不重叠。 */
    const custN = customers.length;
    const zoneL = W * 0.045, zoneR = ctrL - 14;
    const gap = custN > 1 ? (zoneR - zoneL) / (custN - 1) : 0;
    const pScale = custN <= 1 ? 3.2 : Math.min(3.0, Math.max(1.9, gap / 11));
    customers.forEach((cu, i) => {
      const cx = Math.round(custN <= 1 ? W * 0.115 : zoneL + gap * i);
      const cy = 258;
      const s = pScale;
      const bob = cu.mood === 'happy' ? Math.sin(t * 9) * 1.6 : Math.sin(t * 1.4 + i) * 0.7;
      c.fillStyle = 'rgba(0,0,0,0.26)';
      c.beginPath();
      c.ellipse(cx, cy + 1, 13, 4, 0, 0, Math.PI * 2);
      c.fill();
      // 当前招呼的那位脚下有圈粉光，免得三张脸分不清谁是谁
      if (i === custSel) {
        c.strokeStyle = 'rgba(255,157,200,0.9)';
        c.lineWidth = 2;
        c.beginPath();
        c.ellipse(cx, cy + 1, 16, 5, 0, 0, Math.PI * 2);
        c.stroke();
      }
      drawPerson(c, cx, cy + bob, s, cu.pal, t);
      // 气泡只给正在招呼的那位，三人一起冒就糊了
      if (i === custSel) {
        const bx = cx + 14, by = cy - (s * 26) - 20;
        c.fillStyle = 'rgba(255,255,255,0.95)';
        c.fillRect(bx, by, 22, 18);
        c.beginPath();
        c.moveTo(bx + 2, by + 16); c.lineTo(bx + 8, by + 16); c.lineTo(bx + 2, by + 23);
        c.closePath(); c.fill();
        c.fillStyle = cu.mood === 'happy' ? '#e0568f' : '#7a5fa8';
        c.font = 'bold 13px sans-serif';
        c.textAlign = 'center';
        c.fillText(cu.mood === 'happy' ? '♥' : '?', bx + 11, by + 14);
        c.textAlign = 'left';
      }
    });

    /* 柜台上的样品 */
    c.fillStyle = '#8a6349';
    c.fillRect(ctrX + 26, ctrTop - 3, 16, 3);
    c.fillStyle = '#ffd257';
    c.fillRect(ctrX + 28, ctrTop - 10, 12, 8);
    c.fillStyle = '#fff';
    c.fillRect(ctrX + 31, ctrTop - 8, 3, 4);
    // 收银机
    c.fillStyle = '#6b5a48';
    c.fillRect(ctrX + 54, ctrTop - 16, 22, 17);
    c.fillStyle = '#8f7a62';
    c.fillRect(ctrX + 56, ctrTop - 14, 18, 6);
    c.fillStyle = '#a8e6cf';
    c.fillRect(ctrX + 58, ctrTop - 12, 14, 3);

    /* 暗角 */
    const vg = c.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(20,10,30,0.42)');
    c.fillStyle = vg;
    c.fillRect(0, 0, W, H);

    c.restore();
  }

  function drawPerson(c, x, y, s, pal, t) {
    const u = s;
    // 腿
    c.fillStyle = pal.legs;
    c.fillRect(x - 4 * u, y - 8 * u, 3 * u, 8 * u);
    c.fillRect(x + 1 * u, y - 8 * u, 3 * u, 8 * u);
    // 身体
    c.fillStyle = pal.body;
    c.fillRect(x - 5 * u, y - 17 * u, 10 * u, 10 * u);
    // 手臂
    c.fillStyle = pal.skin;
    c.fillRect(x - 7 * u, y - 16 * u, 2 * u, 7 * u);
    c.fillRect(x + 5 * u, y - 16 * u, 2 * u, 7 * u);
    // 脖子
    c.fillStyle = pal.skin;
    c.fillRect(x - 1.5 * u, y - 19 * u, 3 * u, 2 * u);
    // 头
    c.fillStyle = pal.skin;
    c.fillRect(x - 4 * u, y - 26 * u, 8 * u, 7.5 * u);
    // 头发
    c.fillStyle = pal.hair;
    c.fillRect(x - 5 * u, y - 28.5 * u, 10 * u, 4 * u);
    c.fillRect(x - 5 * u, y - 25 * u, 1.6 * u, 6 * u);
    c.fillRect(x + 3.4 * u, y - 25 * u, 1.6 * u, 6 * u);
    // 眼睛
    c.fillStyle = '#2a2230';
    c.fillRect(x - 2.2 * u, y - 23 * u, 1.5 * u, 1.8 * u);
    c.fillRect(x + 0.8 * u, y - 23 * u, 1.5 * u, 1.8 * u);
    // 腮红
    c.fillStyle = 'rgba(255,150,180,0.5)';
    c.fillRect(x - 3.6 * u, y - 21.4 * u, 1.4 * u, 1 * u);
    c.fillRect(x + 2.2 * u, y - 21.4 * u, 1.4 * u, 1 * u);
  }

  /* ================= 配送 ================= */
  function beginDelivery(phaseId) {
    mapMode = 'delivery';
    /* 先站回店里。以前这里直接弹出货窗，玩家一按「取消」就停在上一阶段的界面上，
       再点一次那个按钮就把整个配送阶段过去了——所以先把当前阶段的店面铺好。 */
    setView('panel');
    const orders = E.state.orders.filter(o => !o.delivered);
    if (!orders.length) {
      toast('今天没有待配送的订单，可以自由活动。');
      enterMap([]);
      return;
    }
    openLoadModal(orders);
  }

  function openLoadModal(orders, preset) {
    const cap = E.capacity();
    // preset：车上原本就有的单（「再出门」时带进来），默认勾上，可以加装也可以卸下
    let chosen = (preset || []).filter(id => orders.some(o => o.id === id));
    const confirmLabel = () => (chosen.length ? `出发（${chosen.length} 单）` : '空车出发');
    const renderList = () => {
      const units = chosen.reduce((a, id) => {
        const o = orders.find(x => x.id === id);
        return a + (o ? E.orderUnits(o) : 0);
      }, 0);
      const list = orders.map(o => {
        const sel = chosen.includes(o.id);
        const u = E.orderUnits(o);
        const full = !sel && units + u > cap;
        const items = Object.entries(o.items).map(([k, q]) => `${D.PRODUCTS[k].name}×${q}`).join('、');
        return `<div class="order" style="cursor:pointer;${sel ? 'border-color:#e0568f;background:#fff5fa;' : ''}" data-act="load-toggle" data-id="${o.id}">
          <div class="order-head">
            <span class="order-id">#${o.id}</span>
            <span class="order-cust">${esc(o.customer)}</span>
            <span class="order-loc">${locName(o.loc)}</span>
            <span class="order-dl">${o.deadline - E.state.day <= 0 ? '<b>今天到期</b>' : '剩 ' + (o.deadline - E.state.day) + ' 天'}</span>
          </div>
          <div class="order-items"><span class="order-item">${items}</span>
            <span class="order-item" style="background:${full ? '#ffe3e3' : '#eef7f1'};">${u} 单位</span></div>
          <div class="order-foot"><span class="order-pay">${o.pay}G</span>
            <span style="margin-left:auto;font-size:11px;color:${sel ? '#e0568f' : '#a493ae'}">${sel ? '✓ 已装车' : (full ? '装不下了' : '点击装车')}</span>
          </div>
        </div>`;
      }).join('');
      const est = chosen.length && window.MapView.estimateRoute
        ? window.MapView.estimateRoute(
          chosen.map(id => (orders.find(o => o.id === id) || {}).loc).filter(Boolean))
        : null;
      const S = E.state;
      let budget = '';
      if (est) {
        const total = est.ap + est.backAp;
        const ok = total <= S.ap;
        budget = `<div class="load-budget ${ok ? 'ok' : 'bad'}">
          这一趟约 <b>${est.px}</b> px　去 ${est.ap} AP · 回 ${est.backAp} AP
          ＝ <b>${total}</b> AP${ok
            ? `　（现有 ${S.ap}，够）`
            : `　（现有 ${S.ap}，差 <b>${total - S.ap}</b>）`}
          ${est.ap > S.ap ? '<br>连第一站都到不了——要么少装两单，要么做好半路叫车的准备。' : ''}
        </div>`;
      }
      return `<div style="font-size:11.5px;color:#6d5a76;margin-bottom:10px;">
        运力：<b style="color:${units > cap ? '#c2405a' : '#2c7d58'}">${units}</b> / ${cap} 单位
        （${D.VEHICLES[E.state.vehicle].name} · 每 AP 约 ${window.MapView.pxPerAp ? window.MapView.pxPerAp() : 86}px）
      </div>${budget}${list}`;
    };

    openModal({
      title: '出货准备',
      sub: preset && preset.length ? `车上已有 ${chosen.length} 单，可以加装或卸下` : '选择这一趟要送的订单',
      body: () => renderList(),
      footer: `<button class="btn btn-ghost" data-act="close-modal">取消</button>
        <button class="btn btn-primary" data-act="confirm-load">${confirmLabel()}</button>`,
      onMount: (root) => {
        root.addEventListener('click', ev => {
          const t = ev.target.closest('[data-act="load-toggle"]');
          if (t) {
            const id = +t.dataset.id;
            const o = orders.find(x => x.id === id);
            if (chosen.includes(id)) chosen = chosen.filter(x => x !== id);
            else {
              const units = chosen.reduce((a, i) => {
                const oo = orders.find(x => x.id === i);
                return a + (oo ? E.orderUnits(oo) : 0);
              }, 0);
              if (units + E.orderUnits(o) > cap) { toast('装不下了。', 'bad'); return; }
              chosen.push(id);
            }
            const body = root.querySelector('.modal-body');
            body.innerHTML = renderList();
            const btn = root.querySelector('[data-act="confirm-load"]');
            if (btn) btn.textContent = confirmLabel();
          }
          if (ev.target.closest('[data-act="confirm-load"]')) {
            closeModal();
            loaded = chosen.slice();
            enterMap(chosen);
          }
        });
      }
    });
  }

  function enterMap(orderIds) {
    wentOutThisPhase = true;
    setView('map');
    const orderList = E.state.orders.filter(o => orderIds.includes(o.id));
    loaded = orderIds.slice();
    const markers = orderList.map(o => ({ locId: o.loc, color: '#ffd257' }));
    window.MapView.enter({
      markers,
      riding: true,
      onInteract: onMapInteract,
      onEmpty: onAPEmpty,
      onGuide: () => updateMapBars(),
      // 自动寻路开关时换导航卡上的按钮（自动走 / 停下）
      onAutoWalk: () => updateMapBars(),
      // 每烧 1 AP 掷一次「路上遇到什么事」
      onAPTick: onRoadTick,
      // 走到门口：「进入 xx」按钮亮起来，手机上直接点，不必按 E
      onNear: loc => showMapAct(loc),
      // 全城图铺满整块画布，DOM 浮层先撤掉
      onBigMap: open => {
        ['map-topbar', 'map-bottombar'].forEach(id => {
          const n = document.getElementById(id);
          if (n) n.style.opacity = open ? '0' : '';
          if (n) n.style.pointerEvents = open ? 'none' : '';
        });
        if (!open) updateMapBars();
      }
    });

    // 送货时自动指向最近的那一单，省得每次都要自己找
    if (mapMode !== 'walk') {
      const p = window.MapView.getPlayer();
      let best = null, bd = 1e9;
      orderList.filter(o => !o.delivered).forEach(o => {
        const l = D.LOCATIONS.find(x => x.id === o.loc);
        if (!l) return;
        const d = Math.hypot(l.doorX - p.x, l.doorY - p.y);
        if (d < bd) { bd = d; best = o; }
      });
      if (best) window.MapView.setGuide(best.loc);
    }

    window.MapView.showToast(mapMode === 'walk' ? '自由活动：走到地点按 E 互动' : '按 E 交付，M 看全城图');
    updateMapBars();
    showMapAct(window.MapView.nearLoc ? window.MapView.nearLoc() : null);
    syncTrip();
  }

  /* 地图上的「进入 xx」——手机没有 E 键，所以做成真正能点的按钮。
   * 叠在底栏上方：底栏在窄屏会折行变高，位置靠 measure 算，否则按钮被压住点不到。 */
  function showMapAct(loc) {
    const b = el.mapAct;
    if (!b) return;
    if (!loc || view !== 'map') { b.classList.add('is-off'); return; }
    b.classList.remove('is-off');
    b.innerHTML = `<span class="mk">E</span>进入 ${esc(loc.name)}`;
    layoutMapAct();
  }

  function layoutMapAct() {
    const b = el.mapAct;
    if (!b || b.classList.contains('is-off')) return;
    const h = el.mapBottom ? el.mapBottom.offsetHeight : 44;
    b.style.bottom = (h + 22) + 'px';
  }

  function onAPEmpty() {
    if (mapMode === 'walk') {
      toast('时间差不多了，回店里吧。', 'bad');
      window.MapView.exit();
      setView('panel');
      return;
    }
    setTimeout(() => {
      const S = E.state;
      const fee = (D.TUNE && D.TUNE.cabFee) || 40;
      const walkCost = (D.TUNE && D.TUNE.walkHomeEnergy) || 12;
      const left = loaded.filter(id => E.state.orders.some(o => o.id === id && !o.delivered)).length;
      window.MapView.exit();
      openModal({
        title: '骑不动了',
        sub: '行动点见底，离家还有一段',
        body: () => `<div style="font-size:12px;line-height:2;color:#4a3b52;">
          车熄了火，腿也发软。${left ? `箱子里还有 <b>${left}</b> 单没送到，只能压到明天。` : '这一趟的货倒是都送完了。'}<br>
          <span style="color:#8d7a9c;">
            叫车最快，但要花钱；推车走回去不要钱，只是明天会更累。没送到的订单留在订单簿里，注意交付期限。
          </span>
        </div>`,
        footer: `<button class="btn btn-ghost" data-act="close-modal">就地收工</button>
          <button class="btn btn-ghost" data-act="walk-home" ${S.energy <= walkCost ? 'disabled' : ''}>推车走回去 · 元气 -${walkCost}</button>
          <button class="btn btn-primary" data-act="cab-home" ${S.money < fee ? 'disabled' : ''}>叫车回店 · ${fee}G</button>`,
        onClose: () => { E.endPhase(); enterPhase(); }
      });
    }, 400);
  }

  /* ================= 送货路上的随机事件 =================
   * 触发点在 map.js 扣行动点的那一刻；这里负责弹窗、暂停地图、把选择交给引擎结算。
   * 自测页和 ?noevent 下不自动触发，免得弹窗挡住自动化流程。 */
  function onRoadTick(o) {
    if (window.CANDY_TEST_MODE || window.CANDY_NO_EVENTS) return;
    if (mapMode !== 'delivery' || roadEventOpen || view !== 'map') return;
    const ev = E.rollRoadEvent(o || {});
    if (ev) openRoadEvent(ev);
  }

  function openRoadEvent(ev) {
    roadEventOpen = true;
    window.MapView.setPaused(true);
    window.MapView.stopWalk();
    const choices = ev.choices.map((c, i) => `
      <button class="btn road-pick" data-act="road-pick" data-i="${i}">
        <span class="rp-label">${esc(c.label)}</span>
        ${c.hint ? `<span class="rp-hint">${esc(c.hint)}</span>` : ''}
      </button>`).join('');
    openModal({
      title: ev.title,
      sub: ev.sub || '送货路上',
      body: `<div class="road-event">
        <p class="rp-text">${esc(ev.text)}</p>
        <div class="rp-choices">${choices}</div>
        <div class="rp-foot">路上的时间停在这儿了。选一个做法。</div>
      </div>`,
      onMount: root => {
        const x = root.querySelector('.x');
        if (x) x.style.display = 'none';        // 事件得处理完才能继续赶路
        root.addEventListener('click', e => {
          const b = e.target.closest('[data-act="road-pick"]');
          if (!b) return;
          const r = E.applyRoadEvent(ev.id, +b.dataset.i);
          closeModal();
          toast(r.text, r.good ? 'good' : '');
          renderHUD();
          updateMapBars();
        });
      },
      onClose: () => {
        roadEventOpen = false;
        window.MapView.setPaused(false);
      }
    });
  }

  function updateMapBars() {
    if (!el.mapTop) return;
    // 潜入时上下两条都换掉：上面看警觉，下面给蹲下/扔糖
    if (window.MapView.isSneak && window.MapView.isSneak()) {
      renderSneakBar(window.MapView.sneakInfo());
      return;
    }
    const S = E.state;
    if (el.mapBottom) el.mapBottom.classList.remove('sneaking');
    const v = D.VEHICLES[S.vehicle];
    const g = window.MapView.getGuide ? window.MapView.getGuide() : null;
    const perAp = window.MapView.pxPerAp ? window.MapView.pxPerAp() : 86;

    // 导航卡片分三档：够去够回 = 正常；去得了回不来 = 黄；连去都不够 = 红
    // 目标定了就能一键自动走过去；走起来后按钮变成「停下」
    const walking = window.MapView.isAutoWalk ? window.MapView.isAutoWalk() : false;
    let navCard;
    if (!g) {
      navCard = `<div class="map-card map-nav dim"><span class="mk">导</span> 未设目标</div>`;
    } else {
      const cls = g.short ? 'bad' : g.tight ? 'tight' : '';
      const gap = g.short
        ? `还差 ${g.ap - S.ap} AP`
        : g.tight ? `回程差 ${g.ap + g.backAp - S.ap} AP` : '够来回';
      const goBtn = walking
        ? `<button class="nav-go stop" data-act="stop-walk" title="停下来，导航线保留">停下</button>`
        : `<button class="nav-go" data-act="walk-to" title="自动走过去（路上按 WASD 可随时接管）">自动走</button>`;
      navCard = `<div class="map-card map-nav ${cls}"><span class="mk">导</span> ${esc(g.name)} · 去 <b>${g.ap}</b>${g.backAp ? ` · 回 <b>${g.backAp}</b>` : ''} AP <span class="nav-gap">${gap}</span>${goBtn}</div>`;
    }

    el.mapTop.innerHTML = `
      <div class="map-card map-meta"><span class="mk">车</span> ${v.name} · 运力 ${v.cap} · 每 AP 约 ${perAp}px</div>
      <div class="map-card map-meta"><span class="mk">点</span> 行动点 <b>${S.ap}</b> / ${S.apMax}</div>
      ${navCard}`;

    const orders = E.state.orders.filter(o => loaded.includes(o.id));
    const units = orders.reduce((a, o) => a + (o.delivered ? 0 : E.orderUnits(o)), 0);
    const chips = orders.map(o => {
      const done = o.delivered;
      return `<span class="map-order-chip ${done ? 'done' : ''}">${esc(o.customer)} · ${locName(o.loc)}</span>`;
    }).join('') || '<span class="map-order-chip" style="opacity:.5">空车</span>';

    el.mapBottom.innerHTML = `
      <button class="map-card map-cargo" data-act="cargo">货箱 <b>${units}</b> / ${v.cap}</button>
      <div class="map-card map-orders">${chips}</div>
      <div style="flex:1"></div>
      <div class="map-card map-hint">点地点设目标 · 点箭头出发 · E 互动 / 回店（-1 AP）· M 全城图 · Tab 货箱</div>
      <button class="btn btn-sm" data-act="end-delivery">结束这一趟</button>`;
    layoutMapAct();
  }

  /* ---------- 货箱清单 ---------- */
  function openCargoModal() {
    const S = E.state;
    const v = D.VEHICLES[S.vehicle];
    const orders = E.state.orders.filter(o => loaded.includes(o.id));
    const units = orders.reduce((a, o) => a + (o.delivered ? 0 : E.orderUnits(o)), 0);
    const pending = E.state.orders.filter(o => !loaded.includes(o.id) && !o.delivered);

    // 按地点归堆，一趟能顺路送完的排在一起
    const byLoc = new Map();
    orders.forEach(o => {
      if (!byLoc.has(o.loc)) byLoc.set(o.loc, []);
      byLoc.get(o.loc).push(o);
    });

    const groups = [...byLoc.entries()].map(([loc, list]) => {
      const rows = list.map(o => {
        const items = Object.entries(o.items).map(([k, q]) => {
          const have = E.stockOf(k);
          const ok = have >= q;
          return `<span class="cargo-item ${ok ? 'ok' : 'lack'}">${D.PRODUCTS[k].name} <b>${q}</b>${ok ? '' : ` （缺 ${q - have}）`}</span>`;
        }).join('');
        return `<div class="cargo-row ${o.delivered ? 'done' : ''}">
          <span class="cargo-cust">${esc(o.customer)}</span>
          <span class="cargo-items">${items}</span>
          <span class="cargo-pay">${o.pay}G</span>
          <span class="cargo-dl">${o.delivered ? '已送到' : '第 ' + o.deadline + ' 天前'}</span>
        </div>`;
      }).join('');
      const loc_ = D.LOCATIONS.find(l => l.id === loc);
      return `<div class="cargo-group">
        <div class="cargo-loc"><span class="cargo-dot"></span>${loc_ ? loc_.name : loc}
          <span class="cargo-count">${list.length} 单</span></div>
        ${rows}
      </div>`;
    }).join('');

    const body = orders.length ? groups : '<div class="empty">车厢是空的。</div>';
    const warn = units > v.cap
      ? `<div class="cargo-warn">已经超载了，路上会掉货。</div>` : '';

    openModal({
      title: '车厢清单',
      sub: `${v.name} · ${units} / ${v.cap} 单位 · ${orders.length} 单`,
      body: `<div class="cargo-wrap">${body}${warn}
        ${pending.length ? `<div class="cargo-pending">还有 <b>${pending.length}</b> 单留在店里没装车，明天再送或者叫第三方。</div>` : ''}
      </div>`,
      footer: `<button class="btn btn-ghost" data-act="close-modal">知道了</button>`,
    });
  }

  function onMapInteract(loc) {
    const ordersHere = E.state.orders.filter(o => loaded.includes(o.id) && o.loc === loc.id && !o.delivered);
    if (ordersHere.length) {
      const canAll = ordersHere.every(o => Object.entries(o.items).every(([k, q]) => E.stockOf(k) >= q));
      const body = ordersHere.map(o => {
        const items = Object.entries(o.items).map(([k, q]) => {
          const have = E.stockOf(k);
          return `<span class="order-item" style="background:${have >= q ? '#e2f5ea' : '#ffe3e3'}">${D.PRODUCTS[k].name} ${have}/${q}</span>`;
        }).join('');
        return `<div class="order"><div class="order-head">
          <span class="order-cust">${esc(o.customer)}</span>
          <span class="order-dl">${o.pay}G</span></div>
          <div class="order-items">${items}</div></div>`;
      }).join('');
      openModal({
        title: loc.name,
        sub: '交付订单',
        body: () => `<div style="font-size:12px;color:#6d5a76;margin-bottom:10px;">${esc(loc.desc)}</div>${body}
          ${canAll ? '' : '<div style="font-size:11px;color:#c2405a;">货架上缺货，交付不了。回店里补货再来。</div>'}`,
        footer: `<button class="btn btn-ghost" data-act="close-modal">再看看</button>
          ${loc.id === 'shop' ? '<button class="btn" data-act="loc-action" data-loc="shop" data-id="inside-shop">进屋歇一会儿 · 1 AP</button>' : ''}
          <button class="btn btn-primary" data-act="deliver-now" ${canAll ? '' : 'disabled'}>交付</button>`,
        onMount: root => {
          root.addEventListener('click', ev => {
            if (ev.target.closest('[data-act="deliver-now"]')) {
              const r = E.deliverOrders(ordersHere, loc.id);
              closeModal();
              if (r.count) {
                toast(`交付完成 +${r.gained}G`, 'good');
                loaded = loaded.filter(id => E.state.orders.some(o => o.id === id && !o.delivered));
                const remain = E.state.orders.filter(o => loaded.includes(o.id));
                window.MapView.setMarkers(remain.map(o => ({ locId: o.loc, color: '#ffd257' })));
                updateMapBars();
                syncTrip();
                if (!remain.length) {
                  setTimeout(() => { toast('这一趟的货全送完了。', 'good'); }, 300);
                }
              } else {
                toast('没有交付成功。', 'bad');
              }
            }
          });
        }
      });
      return;
    }
    openLocationMenu(loc);
  }

  function dialogFor(locId) {
    return D.DIALOGS[locId] || (locId === 'silverfox' ? D.DIALOGS.bar : null) || null;
  }

  function openLocationMenu(loc) {
    const acts = [];
    if (loc.id === 'fruitstand' || loc.id === 'market') acts.push({ id: 'shop', name: '采购原料', desc: '' });
    if (loc.kind === 'metro') acts.push({ id: 'metro', name: '乘坐地铁', desc: '快速移动到其他站' });
    if (loc.id === 'garage' || loc.id === 'shipyard') acts.push({ id: 'garage', name: '看看载具', desc: '买车或换车' });
    if (loc.id === 'shop') acts.push({ id: 'inside', name: '回店里歇一会儿', desc: '元气 +6 · 花 1 行动点，之后还能再出门' });
    if (dialogFor(loc.id)) acts.push({ id: 'talk', name: '说说话 / 看看', desc: '' });
    if (loc.id === 'bookstore') acts.push({ id: 'book', name: '翻翻配方书', desc: '花 120G 学点新东西' });

    const body = `<div style="font-size:12.5px;line-height:1.9;color:#4a3b52;margin-bottom:14px;">${esc(loc.desc)}</div>
      <div class="action-list">
        ${acts.map(a => `<button class="action" data-act="loc-action" data-loc="${loc.id}" data-id="${a.id}">
          <div class="action-name">${a.name}</div>${a.desc ? `<div class="action-desc">${a.desc}</div>` : ''}
        </button>`).join('') || '<div class="empty">这里没什么可做的。</div>'}
      </div>`;
    openModal({ title: loc.name, sub: D.REGIONS[loc.region].name, body, footer: `<button class="btn btn-ghost" data-act="close-modal">离开</button>` });
  }

  /* ================= 采购 / 地铁 / 车库 ================= */
  function openShopModal(locId) {
    const shop = D.SHOPS[locId === 'market' ? 'market' : 'fruitstand'];
    const render = () => shop.items.map(k => {
      const r = D.RAW[k];
      const price = Math.round(r.price * shop.mult);
      return `<div class="shop-item">
        <div><div class="si-name">${r.name}</div>
          <div class="si-price">${price}G / 份</div>
          <div class="si-have">存货 ${E.invOf(k)}</div></div>
        <div class="si-btns">
          <button class="btn btn-sm" data-act="buy" data-key="${k}" data-qty="1" data-mult="${shop.mult}">+1</button>
          <button class="btn btn-sm" data-act="buy" data-key="${k}" data-qty="5" data-mult="${shop.mult}">+5</button>
          <button class="btn btn-sm" data-act="buy" data-key="${k}" data-qty="10" data-mult="${shop.mult}">+10</button>
        </div></div>`;
    }).join('');
    openModal({
      title: shop.name,
      sub: `金钱 ¥${money(E.state.money)}`,
      body: () => `<div style="font-size:12px;color:#6d5a76;margin-bottom:12px;">${shop.greeting}</div>
        <div class="shop-grid">${render()}</div>`,
      footer: `<button class="btn btn-ghost" data-act="close-modal">不买了</button>`,
      onMount: root => {
        root.addEventListener('click', ev => {
          const b = ev.target.closest('[data-act="buy"]');
          if (!b) return;
          const r = E.buyRaw(b.dataset.key, +b.dataset.qty, +b.dataset.mult);
          toast(r.msg, r.ok ? 'good' : 'bad');
          root.querySelector('.modal-head .sub').textContent = `金钱 ¥${money(E.state.money)}`;
          root.querySelector('.modal-body').innerHTML =
            `<div style="font-size:12px;color:#6d5a76;margin-bottom:12px;">${shop.greeting}</div>
             <div class="shop-grid">${render()}</div>`;
        });
      }
    });
  }

  function openMetroModal(locId) {
    const S = E.state;
    const start = locId;
    /* 段数交给引擎算（无向 BFS），界面只负责画 */
    const dist = E.metroDist(start);

    /* 安检：随身带的是「这趟已装载订单里的成品」。含烈酒 / 魔法糖浆的过不去。 */
    const carried = [];
    E.state.orders.filter(o => loaded.includes(o.id) && !o.delivered).forEach(o => {
      Object.keys(o.items || {}).forEach(k => { if (carried.indexOf(k) < 0) carried.push(k); });
    });
    const sec = E.securityCheck(carried);
    const guardNote = sec.blocked
      ? `<div class="metro-note">行李里那几样过不了安检：<b>${sec.names.join('、')}</b>。
         新岛地铁站有 X 光机，这几单只能骑车从跨海大桥带进去。</div>`
      : (sec.shielded ? `<div class="metro-note ok">铅衬行李袋在，X 光机看不出里面是什么。</div>` : '');

    const opts = Object.keys(dist).filter(k => k !== start).map(k => {
      const seg = dist[k];
      const cost = seg * 1;
      const stopped = k === D.SECURITY.station && sec.blocked;
      return `<button class="action" data-act="metro-go" data-loc="${k}" data-cost="${cost}" ${(S.ap < cost || stopped) ? 'disabled' : ''}>
        <div class="action-name">${D.METRO.stations[k].name}<span class="action-cost">${stopped ? '安检' : cost + ' AP'}</span></div>
        <div class="action-desc">${seg} 站 · ${D.METRO.stations[k].lines.map(l => l + '号线').join(' / ')}${stopped ? ' · <span class="metro-guard">行李过不去</span>' : ''}</div>
      </button>`;
    }).join('');

    openModal({
      title: '地铁 · 线路图',
      sub: `首班 06:00 · 末班 23:00`,
      body: () => `<div style="font-size:11.5px;color:#6d5a76;margin-bottom:12px;">
        坐地铁比自己骑快得多，但有些地方到不了——北山没有规划线路。</div>
        ${guardNote}
        <div class="action-list">${opts}</div>`,
      footer: `<button class="btn btn-ghost" data-act="close-modal">离开</button>`
    });
  }

  /* ================= 批发采购 ================= */
  let purDraft = null;
  function openPurchaseModal() {
    purDraft = {};
    const step = 5;
    const body = () => {
      const rows = Object.entries(D.RAW).map(([k, r]) => `<div class="pur-row">
        <span class="pur-name">${r.name}</span>
        <span class="pur-unit">${Math.round(r.price * D.PURCHASE.wholeMul)}G</span>
        <button class="btn btn-sm pur-btn" data-act="pur-dec" data-key="${k}" ${purDraft[k] ? '' : 'disabled'}>−</button>
        <b class="pur-qty">${purDraft[k] || 0}</b>
        <button class="btn btn-sm pur-btn" data-act="pur-inc" data-key="${k}">+</button>
      </div>`).join('');
      const q = E.bulkQuote(purDraft);
      const tiers = D.PURCHASE.tiers.map(t => `${t.qty} 份 −${Math.round(t.off * 100)}%`).join(' · ');
      return `<div style="font-size:11px;color:#8d7a9c;line-height:1.8;margin-bottom:8px;">
          批发价比门市便宜 15%，满量再折：${tiers}。<br>
          跑腿费包含搬货和车马，按货值算；货要隔 ${D.PURCHASE.delayPhases} 个阶段才到店里。</div>
        <div class="pur-list">${rows}</div>
        <div class="pur-sum">
          <div><span>门市价</span><b>${q.retail}G</b></div>
          <div><span>批发价 −15%</span><b>${q.whole}G</b></div>
          <div><span>满量折扣${q.off ? ' −' + Math.round(q.off * 100) + '%' : ''}</span><b>${q.discount ? '−' + q.discount + 'G' : '—'}</b></div>
          <div><span>跑腿搬运</span><b>+${q.fee}G</b></div>
          <div class="sum-total"><span>合计</span><b>${q.total}G</b></div>
        </div>`;
    };
    openModal({
      title: '向批发商下单',
      sub: `隔 ${D.PURCHASE.delayPhases} 个阶段送到 · 现金 ¥${money(E.state.money)}`,
      body,
      footer: `<button class="btn btn-ghost" data-act="close-modal">算了</button>
        <button class="btn btn-primary" data-act="pur-confirm">下单</button>`,
      onMount: root => {
        root.addEventListener('click', ev => {
          const inc = ev.target.closest('[data-act="pur-inc"]');
          const dec = ev.target.closest('[data-act="pur-dec"]');
          if (!inc && !dec) return;
          const k = (inc || dec).dataset.key;
          purDraft[k] = Math.max(0, (purDraft[k] || 0) + (inc ? step : -step));
          const b = root.querySelector('.modal-body');
          if (b) b.innerHTML = body();
        });
      }
    });
  }

  function openGarageModal() {
    const S = E.state;
    const list = Object.entries(D.VEHICLES).map(([k, v]) => {
      const owned = S.ownedVehicles.includes(k);
      return `<div class="veh ${owned ? 'owned' : ''}">
        <div class="veh-icon">${k === 'bike' ? '🏍' : k === 'van' ? '🚐' : '🚚'}</div>
        <div class="veh-body"><div class="veh-name">${v.name}</div>
          <div class="veh-desc">${v.desc}</div>
          <div class="veh-spec">运力 <b>${v.cap}</b> · 速度 <b>${v.speed}</b> · 每 AP <b>${Math.round(((D.TUNE && D.TUNE.apPerPx) || 86) / (v.apMul || 1))}</b>px</div></div>
        ${owned ? '<span style="font-size:11px;color:#2c7d58">已拥有</span>'
          : `<button class="btn btn-sm btn-gold" data-act="veh-buy" data-key="${k}" ${S.money < v.price ? 'disabled' : ''}>${v.price}G</button>`}
      </div>`;
    }).join('');
    openModal({ title: '修车铺', sub: `金钱 ¥${money(S.money)}`, body: list, footer: `<button class="btn btn-ghost" data-act="close-modal">离开</button>` });
  }

  /* ================= 弹窗 ================= */
  function openModal(cfg) {
    // 每次重建 modal-root，避免上一次弹窗的行内监听器累积
    const old = $('modal-root');
    const root = old.cloneNode(false);
    root.innerHTML = '';
    old.parentNode.replaceChild(root, old);

    const bodyHtml = typeof cfg.body === 'function' ? cfg.body() : cfg.body;
    root.innerHTML = `<div class="modal">
      <div class="modal-head">
        <h3>${cfg.title || ''}</h3>
        <span class="sub">${cfg.sub || ''}</span>
        <button class="x" data-act="close-modal">✕</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${cfg.footer ? `<div class="modal-foot">${cfg.footer}</div>` : ''}
    </div>`;
    root.classList.remove('hidden');
    modalCloser = cfg.onClose || null;
    if (cfg.onMount) cfg.onMount(root, cfg);
  }

  function closeModal(runCloser) {
    const root = $('modal-root');
    root.classList.add('hidden');
    root.innerHTML = '';
    const c = modalCloser;
    modalCloser = null;
    if (runCloser !== false && c) c();
  }

  /* ================= 剧情 ================= */
  /* ---- 剧情背景（像素夜景）---- */
  function buildStoryArt() {
    const cv = document.createElement('canvas');
    cv.width = 960; cv.height = 540;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.scale(2, 2);
    const W = 480, H = 270;

    // 夜空
    const sky = c.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#150f26');
    sky.addColorStop(0.55, '#2a2044');
    sky.addColorStop(1, '#3d2f55');
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);

    // 星星
    for (let i = 0; i < 90; i++) {
      const x = (i * 97) % W, y = (i * 53) % 150;
      c.fillStyle = i % 7 === 0 ? 'rgba(255,235,200,0.75)' : 'rgba(255,255,255,0.35)';
      c.fillRect(x, y, 1, 1);
    }
    // 月亮
    c.fillStyle = '#fff2cf';
    c.beginPath(); c.arc(402, 42, 13, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,242,207,0.12)';
    c.beginPath(); c.arc(402, 42, 26, 0, Math.PI * 2); c.fill();

    // 远景天际线
    c.fillStyle = '#1e1735';
    for (let i = 0; i < 14; i++) {
      const bw = 16 + ((i * 37) % 26);
      const bh = 30 + ((i * 53) % 60);
      c.fillRect(i * 36 - 6, 176 - bh, bw, bh);
    }
    // 中景楼
    c.fillStyle = '#171128';
    for (let i = 0; i < 11; i++) {
      const bw = 26 + ((i * 41) % 30);
      const bh = 40 + ((i * 71) % 80);
      const bx = i * 48 - 12;
      c.fillRect(bx, 196 - bh, bw, bh);
      for (let wy = 0; wy < 4; wy++) {
        for (let wx = 0; wx < 3; wx++) {
          if ((i + wy + wx) % 3 === 0) continue;
          c.fillStyle = 'rgba(255,205,130,0.45)';
          c.fillRect(bx + 5 + wx * 8, 196 - bh + 8 + wy * 12, 4, 4);
          c.fillStyle = '#171128';
        }
      }
    }

    // 地面
    c.fillStyle = '#241d33';
    c.fillRect(0, 196, W, H - 196);
    c.fillStyle = 'rgba(255,255,255,0.05)';
    for (let y = 202; y < H; y += 12) c.fillRect(0, y, W, 1);
    c.fillStyle = 'rgba(0,0,0,0.22)';
    for (let x = 0; x < W; x += 34) c.fillRect(x, 196, 1, H - 196);

    // 糖果屋：墙体
    const sx = 54, sy = 96, sw = 168, sh = 104;
    // 后方暖光
    const glow = c.createRadialGradient(sx + sw / 2, sy + 60, 10, sx + sw / 2, sy + 60, 190);
    glow.addColorStop(0, 'rgba(255,190,120,0.30)');
    glow.addColorStop(1, 'rgba(255,190,120,0)');
    c.fillStyle = glow;
    c.fillRect(sx - 120, sy - 80, sw + 240, 300);

    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.fillRect(sx + 5, sy + 6, sw, sh);
    c.fillStyle = '#8e5470';
    c.fillRect(sx, sy, sw, sh);
    // 屋顶
    c.fillStyle = '#c0607f';
    c.fillRect(sx - 6, sy - 12, sw + 12, 14);
    c.fillStyle = 'rgba(255,255,255,0.2)';
    c.fillRect(sx - 6, sy - 12, sw + 12, 3);
    // 砖缝
    c.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = sy + 8; y < sy + sh; y += 9) c.fillRect(sx, y, sw, 1);

    // 招牌
    c.fillStyle = '#3a2233';
    c.fillRect(sx + 26, sy - 34, 116, 22);
    c.fillStyle = '#ffd9a8';
    c.font = 'bold 12px "PoxiaoPixel", sans-serif';
    c.textAlign = 'center';
    c.fillText('糖 果 屋', sx + 84, sy - 19);
    c.textAlign = 'left';

    // 橱窗
    const wx = sx + 12, wy = sy + 26, ww = 92, wh = 56;
    c.fillStyle = '#3a2233';
    c.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
    const wg = c.createLinearGradient(0, wy, 0, wy + wh);
    wg.addColorStop(0, '#ffe9b8');
    wg.addColorStop(1, '#ffb968');
    c.fillStyle = wg;
    c.fillRect(wx, wy, ww, wh);
    // 窗里的糖果剪影
    c.fillStyle = 'rgba(210,86,138,0.75)';
    for (let i = 0; i < 5; i++) {
      c.fillRect(wx + 8 + i * 17, wy + wh - 18, 9, 13);
      c.fillRect(wx + 10 + i * 17, wy + wh - 24, 5, 6);
    }
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillRect(wx + 2, wy + 4, 16, 40);
    // 窗框
    c.fillStyle = '#6b4f3e';
    c.fillRect(wx + ww / 2 - 2, wy, 3, wh);

    // 遮阳棚
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 === 0 ? '#e0568f' : '#fff0e0';
      c.fillRect(wx - 4 + i * 12.5, wy - 12, 12.5, 9);
    }

    // 门
    c.fillStyle = '#5c3348';
    c.fillRect(sx + 118, sy + 44, 36, 60);
    c.fillStyle = '#6d3d55';
    c.fillRect(sx + 121, sy + 47, 30, 57);
    c.fillStyle = 'rgba(255,220,160,0.75)';
    c.fillRect(sx + 126, sy + 52, 20, 22);
    c.fillStyle = '#ffd257';
    c.fillRect(sx + 141, sy + 76, 4, 4);

    // 台阶
    c.fillStyle = '#3a2f48';
    c.fillRect(sx - 4, sy + sh, sw + 8, 7);
    c.fillRect(sx - 8, sy + sh + 7, sw + 16, 6);

    // 路灯
    c.fillStyle = '#4a3f58';
    c.fillRect(268, 120, 3, 88);
    c.fillRect(264, 116, 11, 4);
    const lg = c.createRadialGradient(270, 118, 2, 270, 118, 46);
    lg.addColorStop(0, 'rgba(255,215,150,0.55)');
    lg.addColorStop(1, 'rgba(255,215,150,0)');
    c.fillStyle = lg;
    c.fillRect(224, 72, 92, 92);
    c.fillStyle = '#ffe0a8';
    c.fillRect(266, 112, 8, 6);

    // 老梧桐树
    c.fillStyle = '#2f2536';
    c.fillRect(360, 150, 8, 58);
    c.fillStyle = '#26202f';
    c.beginPath(); c.arc(364, 140, 30, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(340, 152, 20, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(390, 154, 18, 0, Math.PI * 2); c.fill();

    // 暗角
    const vg = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.1);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(8,5,16,0.75)');
    c.fillStyle = vg;
    c.fillRect(0, 0, W, H);

    return cv.toDataURL();
  }

  let storyArtUrl = null;

  let storyNode = null;   // 当前这一段的 DOM 根节点

  function playStory(items, onEnd) {
    /* 上一段还没收掉就又开一段（比如开场白还没播完，艾琳就上门了）：
       先把旧框摘掉。否则两个 #story-node 叠在一起，getElementById 只认第一个，
       后建的那个框永远是空白 —— 就是「点开剧情只有一块白板」的由来。 */
    const stale = document.getElementById('story-node');
    if (stale) stale.remove();
    storyState = { queue: items.slice(), onEnd };
    if (!storyArtUrl) storyArtUrl = buildStoryArt();
    const node = document.createElement('div');
    node.className = 'story';
    node.id = 'story-node';
    node.innerHTML = `<div class="story-art" style="background-image:url('${storyArtUrl}');background-size:cover;background-position:center bottom;"></div>
      <div class="story-box" id="story-box">
        <div class="story-speaker" id="story-speaker"></div>
        <div class="story-text" id="story-text"></div>
        <div class="story-choices" id="story-choices"></div>
        <div class="story-next" id="story-next">点击继续 ▾</div>
      </div>`;
    document.body.appendChild(node);
    storyNode = node;
    node.addEventListener('click', ev => {
      if (ev.target.closest('.story-choice')) return;
      advanceStory();
    });
    renderStory();
  }

  function renderStory() {
    const st = storyState;
    if (!st) return;
    if (!st.queue.length) { endStory(); return; }

    /* 一律从当前这一段自己的节点里取元素：页面里可能还留着上一段的残影 */
    const root = storyNode || document;
    const textEl = root.querySelector('#story-text');
    const chEl = root.querySelector('#story-choices');
    const nextEl = root.querySelector('#story-next');
    if (!textEl || !chEl || !nextEl) { endStory(); return; }
    const head = st.queue[0];

    // 连续选项组
    if (head && head.opt) {
      let n = 0;
      while (n < st.queue.length && st.queue[n].opt) n++;
      const opts = st.queue.slice(0, n);
      textEl.textContent = st.lastText || '';
      textEl.classList.toggle('story-narration', !st.lastWho);
      nextEl.style.display = 'none';
      /* 选项是米莉要说的话：每一条前面都带她的名字，
         不然看起来像玩家在盘问画面上的那个人。 */
      chEl.innerHTML = opts.map((o, i) =>
        `<button class="story-choice" data-opt="${i}">
          <span class="choice-who">${esc(st.choiceWho || '米莉')}</span>
          <span class="choice-text">${esc(o.opt)}</span>
        </button>`).join('');
      if (!st.bound) {
        st.bound = true;
        chEl.addEventListener('click', ev => {
          const b = ev.target.closest('[data-opt]');
          if (!b) return;
          const i = +b.dataset.opt;
          const chosen = opts[i];
          st.queue.splice(0, n);
          if (chosen.then) st.queue.unshift.apply(st.queue, chosen.then);
          chEl.innerHTML = '';
          renderStory();
        });
      }
      return;
    }

    const line = typeof head === 'string' ? { t: head } : head;
    const text = line.t || '';
    const who = line.who || '';
    st.lastText = text;
    st.lastWho = who;
    st.choiceWho = '米莉';        // 选项永远是米莉的话
    textEl.textContent = text;
    textEl.classList.toggle('story-narration', !who);
    const sp = root.querySelector('#story-speaker');
    if (sp) { sp.textContent = who; sp.style.display = who ? '' : 'none'; }
    chEl.innerHTML = '';
    nextEl.style.display = 'block';
  }

  function advanceStory() {
    if (!storyState) return;
    const head = storyState.queue[0];
    if (head && head.opt) return;   // 等待选择
    storyState.queue.shift();
    renderStory();
  }

  function endStory() {
    const st = storyState;
    storyState = null;
    const node = storyNode || document.getElementById('story-node');
    storyNode = null;
    if (node) {
      node.style.transition = 'opacity .35s';
      node.style.opacity = '0';
      setTimeout(() => node.remove(), 380);
    }
    if (st && st.onEnd) st.onEnd();
  }

  /* ================= 事件分发 ================= */
  function onClick(ev) {
    const t = ev.target.closest('[data-act]');
    if (!t) {
      // 剧情点击由自身处理
      return;
    }
    const act = t.dataset.act;
    const S = E.state;

    switch (act) {
      case 'tab':
        tab = t.dataset.tab;
        renderPanel();
        break;

      case 'craft': {
        const key = t.dataset.key, times = +t.dataset.times;
        const r = E.craft(key, times);
        if (r.made || r.failed) {
          toast(`${D.PRODUCTS[key].name}：成功 ${r.made}${r.failed ? `，糊了 ${r.failed}` : ''}`,
            r.failed ? 'bad' : 'good');
        } else {
          toast('原料不够，或者没力气了。', 'bad');
        }
        break;
      }

      case 'serve-item': {
        // 货架上点糖：谁要这个就给谁
        const who = customers.find(c => c.wants === t.dataset.key) || currentCustomer();
        if (!who) { toast('现在没有客人。', 'bad'); break; }
        serveCustomer(t.dataset.key, who);
        break;
      }

      case 'cust-pick':
        custSel = Math.max(0, Math.min(customers.length - 1, +t.dataset.idx));
        updateCounter();
        break;

      case 'cust-serve':
        serveCustomer(null, customers[+t.dataset.idx] || currentCustomer());
        break;

      case 'cust-make':
        makeForCustomer(customers[+t.dataset.idx] || currentCustomer());
        break;

      case 'cust-refuse':
        refuseCustomer(customers[+t.dataset.idx] || currentCustomer());
        break;

      case 'serve':
        // 先同步一次按钮状态，避免换人后还点到上一位的旧按钮
        updateCounter();
        serveCustomer(null, currentCustomer());
        break;

      case 'refuse':
        refuseCustomer(currentCustomer());
        break;

      case 'map-interact':
        if (t.blur) t.blur();
        if (view === 'map' && window.MapView.isRunning()) window.MapView.interact();
        break;

      case 'end-phase':
        endCurrentPhase();
        break;

      /* ---- 主线 ---- */
      case 'sneak-crouch': {
        const info = window.MapView.sneakInfo() || {};
        window.MapView.setCrouch(!info.crouch);
        break;
      }

      case 'sneak-candy':
        if (!window.MapView.throwCandy()) toast('糖已经用完了。', 'bad');
        break;

      case 'open-studio': {
        const G = GS();
        if (!G) break;
        playStory(G.SCRIPTS.prologue_studio, () => {
          G.giveItem('storageBox', 1);
          G.finish();
          /* 序章收尾 → 直接进新手教学：给料、挂一张固定订单，然后才开始第一天 */
          E.startTutorial();
          tab = 'craft';
          renderPanel();
          toast('序章完成。天亮之前，先把第一批糖做出来吧。', 'good');
        });
        break;
      }

      case 'recall-brooch': {
        const G = GS();
        if (!G) break;
        playStory(G.SCRIPTS.ch1_brooch, () => {
          G.addClue('brooch_vision');
          G.setStep('infil');
          tab = 'story';
          renderPanel();
          toast('有人在莉莉安走之前跟她说了什么。', 'good');
        });
        break;
      }

      case 'goto-bar':
        goInfiltrate();
        break;

      case 'ch2-open-box': {
        const G = GS();
        if (!G) break;
        playStory(G.SCRIPTS.ch2_decode, () => {
          G.addClue('sevenAnchors');
          G.addClue('harvestNote');
          G.setStep('survey');
          tab = 'story';
          renderPanel();
          toast('七个锚点。得回后巷找那册实验记录。', 'good');
        });
        break;
      }
      case 'ch2-survey':
        goSurvey();
        break;
      case 'ch2-network': {
        const G = GS();
        if (!G) break;
        playStory(G.SCRIPTS.ch2_network, () => {
          G.addClue('underNet');
          G.setStep('letter');
          tab = 'story';
          renderPanel();
          toast('三张图对上了。有人该送信来了。', 'good');
        });
        break;
      }
      case 'ch2-mint': {
        const G = GS();
        if (!G) break;
        playStory(G.SCRIPTS.ch2_mint, () => {
          G.giveItem('mintHard', 1);
          G.finish();
          tab = 'story';
          renderPanel();
          toast('第二章完成。薄荷硬糖明天上架。', 'good');
        });
        break;
      }

      case 'buy-upgrade': {
        const r = E.buyUpgrade(t.dataset.key);
        toast(r.msg, r.ok ? 'good' : 'bad');
        renderPanel();
        break;
      }

      case 'buy-book': {
        const r = E.buyBook(t.dataset.line);
        toast(r.msg, r.ok ? 'good' : 'bad');
        renderPanel();
        break;
      }

      case 'hire-app': {
        const r = E.hireApprentice(t.dataset.id);
        toast(r.msg, r.ok ? 'good' : 'bad');
        renderPanel();
        break;
      }

      case 'staff-post': {
        const r = E.assignStaff(t.dataset.id, t.dataset.post || null);
        toast(r.msg, r.ok ? 'good' : 'bad');
        renderPanel();
        break;
      }

      case 'fire-app': {
        const r = E.fireApprentice(t.dataset.id);
        toast(r.msg, r.ok ? 'good' : 'bad');
        renderPanel();
        break;
      }

      case 'leave-counter': {
        const who = E.staffOnCounter();
        const mate = who ? D.APPRENTICES.find(x => x.id === who) : null;
        if (!mate) { toast('柜台没人看着，走不开。', 'bad'); break; }
        if (E.state.ap < 1) { toast('没力气出门了。', 'bad'); break; }
        /* 记下「这一班是助手在看店」，阶段结束时结一次流水 */
        E.state.flags.counterAway = E.phase().id;
        mapMode = 'walk';
        loaded = [];
        toast(`${mate.name}留下来看店，你自己出门。`, 'good');
        enterMap([]);
        break;
      }

      case 'guide-close': {
        guideMuted = guideKeyOf(guideText());
        updateGuide();
        renderPanel();
        toast('指引收起来了。左上角的「▸ 指引」可以再打开。', 'info');
        break;
      }

      case 'guide-open': {
        guideMuted = '';
        updateGuide();
        renderPanel();
        break;
      }

      case 'retire-ask':
        openRetireAsk();
        break;

      case 'retire-confirm': {
        const r = E.retire();
        openRetireSummary(r.rec, r.count);
        break;
      }

      case 'retire-done': {
        closeModal(false);
        loaded = [];
        mapMode = null;
        wentOutThisPhase = false;
        syncTrip();
        customers = [];
        custSel = 0;
        renderHUD();
        renderPanel();
        toast('新的早晨。糖果屋的灯又亮了。');
        break;
      }

      case 'buy-gear': {
        const r = E.buyGear();
        toast(r.msg, r.ok ? 'good' : 'bad');
        renderPanel();
        break;
      }

      case 'odd-job': {
        const r = E.oddJob();
        toast(r.msg, r.ok ? 'good' : 'bad');
        renderPanel();
        break;
      }

      case 'maintain': {
        const r = E.maintain();
        toast(r.msg, r.ok ? 'good' : 'bad');
        renderPanel();
        break;
      }

      case 'phase-action':
        doPhaseAction(t.dataset.id);
        break;

      case 'pur-open':
        openPurchaseModal();
        break;

      case 'pur-confirm': {
        const r = E.placePurchase(purDraft || {});
        if (!r.ok) { toast(r.msg, 'bad'); break; }
        closeModal();
        toast(`下单成功：${r.total}G，${D.PURCHASE.delayPhases} 个阶段后送到。`, 'good');
        renderPanel();
        break;
      }

      case 'takeout-open': {
        const r = E.openTakeout();
        toast(r.msg, r.ok ? 'good' : 'bad');
        renderPanel();
        break;
      }
      case 'takeout-pack': {
        const r = E.packTakeout(+t.dataset.id);
        toast(r.msg, r.ok ? 'good' : 'bad');
        renderPanel();
        break;
      }

      case 'order-third': {
        const r = E.thirdParty(+t.dataset.id);
        toast(r.ok ? `平台接单了，抽 ${r.fee}G，到账 ${r.net}G` : r.msg, r.ok ? 'good' : 'bad');
        renderPanel();
        break;
      }

      case 'order-extend': {
        const r = E.extendOrder(+t.dataset.id);
        toast(r.msg, r.ok ? 'good' : 'bad');
        break;
      }
      case 'order-cancel': {
        E.cancelOrder(+t.dataset.id);
        toast('订单取消了。', 'bad');
        break;
      }

      case 'vehicle-buy': {
        const r = E.buyVehicle(t.dataset.key);
        toast(r.msg, r.ok ? 'good' : 'bad');
        break;
      }
      case 'vehicle-select':
        E.selectVehicle(t.dataset.key);
        toast('换了车。');
        break;
      case 'veh-buy': {
        const r = E.buyVehicle(t.dataset.key);
        toast(r.msg, r.ok ? 'good' : 'bad');
        if (r.ok) openGarageModal();
        break;
      }

      case 'close-modal':
        closeModal();
        break;

      case 'walk-to': {
        // 导航卡上的「自动走」：目标可能是地点，也可能只是地上某个点
        const g0 = window.MapView.getGuide ? window.MapView.getGuide() : null;
        if (!g0) { toast('先在地图上点一个目的地。', 'bad'); break; }
        const okGo = window.MapView.walkTo(g0.locId || { x: g0.x, y: g0.y });
        updateMapBars();
        if (!okGo) break;
        break;
      }

      case 'stop-walk':
        window.MapView.stopWalk();
        updateMapBars();
        break;

      case 'end-delivery':
        window.MapView.exit();
        if (loaded.length) {
          toast(`还有 ${E.state.orders.filter(o => loaded.includes(o.id)).length} 单没送完。`, 'bad');
        }
        loaded = [];
        E.endPhase();
        enterPhase();
        break;

      case 'loc-action':
        handleLocAction(t.dataset.id, t.dataset.loc);
        break;

      case 'metro-go': {
        /* 兜一层：界面上已经灰掉了，但别让别的路径绕过去 */
        if (t.dataset.loc === D.SECURITY.station) {
          const carry = [];
          E.state.orders.filter(o => loaded.includes(o.id) && !o.delivered).forEach(o => {
            Object.keys(o.items || {}).forEach(k => { if (carry.indexOf(k) < 0) carry.push(k); });
          });
          const chk = E.securityCheck(carry);
          if (chk.blocked) { toast(`安检拦下了：${chk.names.join('、')}`, 'bad'); break; }
        }
        const cost = +t.dataset.cost;
        if (E.useAP(cost)) {
          const loc = t.dataset.loc;
          closeModal();
          window.MapView.teleport(loc);
          toast(`到达 ${locName(loc)}`, 'good');
          updateMapBars();
        } else toast('行动点不够。', 'bad');
        break;
      }

      case 'end-delivery-cancel':
        closeModal();
        break;

      case 'cargo':
        openCargoModal();
        break;

      case 'cab-home': {
        const r = E.callCab();
        if (!r.ok) { toast(r.msg, 'bad'); break; }
        window.MapView.teleport('shop');
        toast(`车费 ${r.fee}G，到家了。`, 'good');
        closeModal();
        break;
      }

      case 'walk-home': {
        const r = E.walkHome();
        window.MapView.teleport('shop');
        toast(`走了很久才到家，元气 -${r.cost}。`, 'bad');
        closeModal();
        break;
      }

      case 'new-game': {
        $('title-screen').classList.add('hide');
        E.newGame();
        // 主线从序章开始：先播雨夜，再接潜入；主线不在才退回普通开局
        if (!startStoryIfNeeded()) enterPhase();
        break;
      }

      case 'continue-game': {
        if (!E.hasSave()) { toast('没有存档。'); break; }
        $('title-screen').classList.add('hide');
        E.load();
        const back = restoreTrip();   // 车厢、模式、这一阶段出没出过门，一起还原
        renderHUD();          // 读档后 HUD 得跟着变，否则还是标题页前的旧数字
        // 恢复阶段视图：地图坐标不进存档，配送途中读档先回到店里
        if (E.phase().kind === 'map') {
          setView('panel');
          syncTrip();
        } else enterPhase();
        resumeStory();
        if (back && E.phase().kind === 'map') {
          toast(`车厢里还有 ${back} 单，点「再出门」接着送。`, 'good');
        }
        break;
      }

      case 'save-quit':
        E.save();
        toast('已保存。');
        break;

      case 'save-menu':
        openSaveModal();
        break;

      case 'slot-save': {
        const n = +t.dataset.slot;
        if (E.slotInfo(n).exists && slotConfirm !== n) {
          // 覆盖已有存档：先问一句，再点一次才真写
          slotConfirm = n;
          clearTimeout(slotConfirmTimer);
          slotConfirmTimer = setTimeout(() => { slotConfirm = null; refreshSaveModal(); }, 3500);
          refreshSaveModal();
          break;
        }
        slotConfirm = null;
        clearTimeout(slotConfirmTimer);
        const r = E.saveSlot(n);
        toast(r.msg, r.ok ? 'good' : 'bad');
        refreshSaveModal();
        break;
      }

      case 'slot-load': {
        const n = +t.dataset.slot;
        const r = E.loadSlot(n);
        if (!r.ok) { toast(r.msg, 'bad'); break; }
        closeModal(false);
        $('title-screen').classList.add('hide');
        const back = restoreTrip();
        customers = [];
        custSel = 0;
        slotConfirm = null;
        window.MapView.exit();
        refreshTitleBtn();
        toast(`已读取槽位 ${n}`, 'good');
        if (E.phase() && E.phase().kind === 'map') {
          setView('panel');
          syncTrip();
          if (back) setTimeout(() => toast(`车厢里还有 ${back} 单，点「再出门」接着送，行动点不会白扔。`), 900);
        } else enterPhase();
        break;
      }

      case 'slot-del': {
        const n = +t.dataset.slot;
        const r = E.deleteSlot(n);
        slotConfirm = null;
        clearTimeout(slotConfirmTimer);
        toast(r.msg);
        refreshSaveModal();
        break;
      }

      case 'to-title':
        openQuitModal();
        break;

      case 'quit-title-confirm':
        doQuitToTitle();
        break;

      case 'help':
        openHelp();
        break;
    }
  }

  function endCurrentPhase() {
    /* 序章还没收尾：先别让时间往前走 —— 否则第一天早晨会在暗门没打开时就过去了 */
    const G0 = window.GameStory;
    if (G0 && G0.state && G0.state().chapter === 'prologue') {
      toast('先把序章做完：在店里按下收银机旁的瓷砖。', 'bad');
      tab = 'story';
      renderPanel();
      return;
    }
    const wasLast = E.isLastPhase();
    loaded = [];              // 换阶段＝这趟结束，车厢清单别留到下一段
    syncTrip();
    /* 这一班你出门了：助手把柜台撑完，先结一次流水再翻页 */
    const away = E.state.flags.counterAway;
    if (away && E.phase() && away === E.phase().id) {
      const r = E.staffCounterShift();
      if (r) {
        toast(r.units
          ? `你不在店里，${r.who}卖了 ${r.units} 件，柜上收了 ${r.income}G。`
          : `货架空着，${r.who}只能一直跟客人道歉。`, r.units ? 'good' : 'bad');
      }
      E.state.flags.counterAway = null;
    }
    E.endPhase();
    if (wasLast) {
      showDaySummary();
    } else {
      enterPhase();
    }
  }

  function showDaySummary() {
    const S = E.state;
    const prevDay = S.day - 1;
    openModal({
      title: `第 ${prevDay} 天 · 打烊`,
      sub: `第 ${S.day} 天开始了`,
      body: () => `<div style="font-size:12.5px;line-height:2.2;color:#4a3b52;">
        <div>当天营业额 <b style="color:#e0568f">${money(S.log.filter(l => false).length + (S.stats.earned))}G</b>（累计）</div>
        <div>累计交付订单 <b>${S.stats.delivered}</b> 单 · 累计售出 <b>${S.stats.sold}</b> 件</div>
        <div>信誉 <b>${Math.round(S.reputation)}</b> · 元气 <b>${Math.round(S.energy)}</b></div>
        <div style="margin-top:12px;font-size:11px;color:#8d7a9c;">明天五点还要起床。今天到这里就好。</div>
      </div>`,
      footer: `<button class="btn btn-primary" data-act="close-modal">开始新的一天</button>`,
      onClose: () => enterPhase()
    });
  }

  function doPhaseAction(id) {
    const S = E.state;
    if (id === 'tidy') {
      if (!E.useAP(1)) { toast('没力气了。', 'bad'); return; }
      S.energy = E.clamp(S.energy + 8, 0, 100);
      S.reputation = E.clamp(S.reputation + 1, 0, 100);
      toast('橱窗擦得干干净净。', 'good');
      renderPanel();
    } else if (id === 'nap') {
      if (!E.useAP(2)) { toast('行动点不够。', 'bad'); return; }
      S.energy = E.clamp(S.energy + 22, 0, 100);
      E.log('趴在柜台后面睡了一会儿。', 'good');
      toast('元气 +22', 'good');
      renderPanel();
    } else if (id === 'read') {
      if (!E.useAP(1)) { toast('行动点不够。', 'bad'); return; }
      if (Math.random() < 0.45) {
        S.reputation = E.clamp(S.reputation + 2, 0, 100);
        E.log('母亲的旧书里夹着一张配方草稿，可惜缺了一半。', 'info');
        toast('看到一页母亲的笔记。', 'good');
      } else {
        E.log('翻了几页，全是看不懂的魔法符号。', 'info');
        toast('什么也没看懂。');
      }
      renderPanel();
    } else if (id === 'walk') {
      mapMode = 'walk';
      loaded = [];
      enterMap([]);
    } else if (id === 'go-out') {
      // 再出门也走装货窗：车上原有的单默认勾着，可以加装、也可以卸下
      mapMode = 'delivery';
      const left = E.state.orders.filter(o => loaded.includes(o.id) && !o.delivered);
      const pool = E.state.orders.filter(o => !o.delivered);
      if (!pool.length) {
        loaded = [];
        toast('没有待送的订单了，空车出门。');
        enterMap([]);
        return;
      }
      openLoadModal(pool, left.map(o => o.id));
    } else if (id === 'clean') {
      if (!E.useAP(1)) { toast('行动点不够。', 'bad'); return; }
      S.reputation = E.clamp(S.reputation + 2, 0, 100);
      toast('地板拖得发亮。信誉 +2', 'good');
      renderPanel();
    } else if (id === 'account') {
      if (!E.useAP(1)) { toast('行动点不够。', 'bad'); return; }
      openModal({
        title: '账本',
        sub: `第 ${S.day} 天`,
        body: `<div style="font-size:12.5px;line-height:2.1;">
          <div>现金：<b style="color:#e0568f">¥${money(S.money)}</b></div>
          <div>今日柜台收入：<b>${money(S.daySold)}G</b></div>
          <div>今日交付：<b>${S.dayDelivered}</b> 单</div>
          <div>未完成订单：<b>${S.orders.length}</b> 单</div>
          <div>信誉：<b>${Math.round(S.reputation)}</b> / 100</div>
        </div>`,
        footer: `<button class="btn btn-primary" data-act="close-modal">合上账本</button>`
      });
      renderPanel();
    } else if (id === 'call') {
      if (!E.useAP(1)) { toast('行动点不够。', 'bad'); return; }
      const o = E.makeOrder({ type: 'phone' });
      toast(`接到预订：${o.customer} 想要 ${Object.entries(o.items).map(([k, q]) => D.PRODUCTS[k].name + '×' + q).join('、')}`, 'good');
      tab = 'orders';
      renderPanel();
    }
  }

  /* ================= 潜入 HUD ================= */
  function renderSneakBar(info) {
    if (!info) { updateMapBars(); return; }
    const pct = Math.max(0, Math.min(100, info.alarm));
    const cls = pct >= 75 ? 'bad' : pct >= 40 ? 'tight' : '';
    el.mapTop.innerHTML = `
      <div class="map-card sneak-tag"><span class="mk">潜</span> ${esc(info.title)}</div>
      <div class="map-card map-alarm ${cls}">
        <span class="mk">眼</span> 警觉 <b>${pct}%</b>
        <div class="alarm-bar"><i style="width:${pct}%"></i></div>
      </div>
      <div class="map-card sneak-tag"><span class="mk">标</span> ${esc(info.goal || '——')}</div>`;
    // .sneaking 让提示语与按钮分居两端（窄屏下提示隐藏、按钮自然落回左边）
    el.mapBottom.classList.add('sneaking');
    el.mapBottom.innerHTML = `
      <div class="map-card map-hint">避开扇形视野 · 贴墙角与树影能压下警觉</div>
      <div class="sneak-btns">
        <button class="btn btn-sm ${info.crouch ? 'btn-primary' : 'btn-ghost'}" data-act="sneak-crouch">${info.crouch ? '站起来' : '蹲下'}</button>
        <button class="btn btn-sm btn-ghost" data-act="sneak-candy" ${info.candies <= 0 ? 'disabled' : ''}>扔糖 ×${info.candies}</button>
      </div>`;
    layoutMapAct();
  }

  /* ================= 主线流程 =================
   * story.js 只记「走到第几步」，这里决定「什么时候播哪一段、什么时候切场景」。
   * 所有判断都收在这一块，免得散到各个事件分支里以后找不到。
   */
  const GS = () => window.GameStory;

  /* 新局：从序章开始。返回 true 表示已经由主线接管了开场 */
  function startStoryIfNeeded() {
    const G = GS();
    if (!G) return false;
    if (G.isStep('rain')) {
      playStory(G.SCRIPTS.prologue_open, () => beginRainSneak());
      return true;
    }
    return false;
  }

  /* 读档：序章还没走完就接着走，不重播开场白 */
  function resumeStory() {
    const G = GS();
    if (!G) return false;
    if (G.isStep('rain')) { beginRainSneak(); return true; }
    if (G.isStep('studio')) { tab = 'story'; return false; }
    return false;
  }

  /* ---- 序章 ---- */
  function beginRainSneak() {
    const G = GS();
    enterSneakScene(G.SNEAKS.prologue_rain, rainArrived, rainCaught);
  }

  function rainCaught() {
    const S = E.state;
    S.energy = E.clamp(S.energy - 4, 0, 100);
    E.emit();
    toast('被一只手抓住了衣领——你挣脱了。绕回去，再试一次。', 'bad');
    window.MapView.endSneak();
    setTimeout(() => beginRainSneak(), 1100);
  }

  function rainArrived() {
    const G = GS();
    window.MapView.endSneak();
    window.MapView.exit();
    playStory(G.SCRIPTS.prologue_door, () => {
      G.setStep('studio');
      setView('panel');
      tab = 'story';
      renderPanel();
      toast('到家了。收银机旁边那几块瓷砖——按下去。', 'good');
    });
  }

  /* ---- 潜入场景入口 ---- */
  function enterSneakScene(preset, onArrive, onCaught) {
    mapMode = 'walk';
    setView('map');
    window.MapView.enter({
      x: preset.start.x,
      y: preset.start.y,
      riding: false,
      markers: [],
      onInteract: () => { },
      onEmpty: () => { },
      onNear: () => showMapAct(null),
      onSneak: () => updateMapBars()
    });
    showMapAct(null);
    window.MapView.startSneak({
      ...preset,
      onArrive,
      onCaught
    });
    updateMapBars();
  }

  /* ---- 第一章 ---- */
  /* 艾琳上门：上午坐班一开始就来，别让她在门口等太久 */
  function maybeErin() {
    const G = GS();
    if (!G || !G.isStep('visit') || G.flag('erinDone')) return false;
    if (!E.phase() || E.phase().id !== 'shiftAM') return false;
    G.setFlag('erinDone');
    playStory(G.SCRIPTS.ch1_erin, () => {
      playStory(G.SCRIPTS.ch1_erin_ask, () => {
        G.giveItem('snowBrooch', 1);
        G.giveItem('contactCandy', 12);
        G.setStep('brooch');
        tab = 'story';
        renderPanel();
        toast('收下雪花胸针作预付，给了艾琳十二颗联络糖。', 'good');
      });
    });
    return true;
  }

  /* 潜入银狐酒吧：扣 3 AP，直接送到后街 */
  function goInfiltrate() {
    const G = GS();
    if (!G || !G.isStep('infil')) return;
    const S = E.state;
    if (S.ap < 3) { toast(`这一趟要 3 动作点，现在只有 ${S.ap}。`, 'bad'); return; }
    S.ap -= 3;
    E.emit();
    E.log('换下围裙，从后门出去。银狐酒吧在后半夜最热闹。', 'info');
    enterSneakScene(G.SNEAKS.ch1_bar, barArrived, barCaught);
  }

  function barCaught() {
    const S = E.state;
    S.reputation = E.clamp(S.reputation - 1, 0, 100);
    S.energy = E.clamp(S.energy - 3, 0, 100);
    E.emit();
    toast('有人吹了声口哨。你先退出去，绕一圈再来。', 'bad');
    window.MapView.endSneak();
    setTimeout(() => {
      const G = GS();
      enterSneakScene(G.SNEAKS.ch1_bar, barArrived, barCaught);
    }, 1100);
  }

  function barArrived() {
    const G = GS();
    playStory(G.SCRIPTS.ch1_basement, () => {
      G.setStep('rescue');
      G.setFlag('lilian', 1);
      G.addClue('blueMark');
      // 目标改成撤离点：修车铺门口
      window.MapView.setSneakGoal({ x: 400, y: 664, r: 24, label: '修车铺门口' }, barEscaped);
      toast('带上她。往西，一直走到修车铺。', 'good');
    });
  }

  function barEscaped() {
    const G = GS();
    window.MapView.endSneak();
    window.MapView.exit();
    playStory(G.SCRIPTS.ch1_rescue, () => {
      G.setStep('home');
      setView('panel');
      tab = 'story';
      renderPanel();
      toast('她安全了。回糖果屋安顿她。', 'good');
    });
  }

  /* 回店安顿莉莉安：从街上回店时触发一次 */
  function maybeStoryHome() {
    const G = GS();
    if (!G || !G.isStep('home') || G.flag('lilianHome')) return false;
    G.setFlag('lilianHome');
    setTimeout(() => {
      playStory(G.SCRIPTS.ch1_home, () => {
        G.setStep('photo');
        E.log('莉莉安在楼上客房睡着了。手腕上的蓝色印记还在。', 'info');
        tab = 'story';
        renderPanel();
        toast('等天亮，还有一件事。', 'good');
      });
    }, 400);
    return true;
  }

  /* 门缝里的照片：下一次进入阶段时送来 */
  function maybePhoto() {
    const G = GS();
    if (!G || !G.isStep('photo') || G.flag('photoShown')) return false;
    G.setFlag('photoShown');
    setTimeout(() => {
      playStory(G.SCRIPTS.ch1_photo, () => {
          G.addClue('watcher');
          playStory(G.SCRIPTS.ch1_end, () => {
            G.setFlag('ch1Day', E.state.day);   // 第二章「两天后」才上门
            G.finish();
          tab = 'story';
          renderPanel();
          toast('第一章完成。有人在看。', 'good');
        });
      });
    }, 500);
    return true;
  }

  /* ================= 第二章：薄荷硬糖与加密数据 =================
   * 复用第一章已经验证过可走的后巷潜入地形，不新造一张地图。
   * 节奏：上门 → 破解 → 回后巷取记录 → 叠图 → 黑信封 → 熬糖收尾。 */
  function maybeEvan() {
    const G = GS();
    if (!G || !G.isStep('visit') || G.flag('evanDone')) return false;
    const ch1Day = G.state().flags.ch1Day || 1;
    if (E.state.day < ch1Day + 2) return false;      // 原文「三天后」
    G.setFlag('evanDone');
    playStory(G.SCRIPTS.ch2_evan, () => {
      playStory(G.SCRIPTS.ch2_evan_ask, () => {
        G.giveItem('encryptedBox', 1);
        G.giveItem('netSketch', 1);
        G.setStep('decode');
        tab = 'story';
        renderPanel();
        toast('收下金属盒和那张素描。', 'good');
      });
    });
    return true;
  }

  function goSurvey() {
    const G = GS();
    if (!G || !G.isStep('survey')) return;
    const S = E.state;
    if (S.ap < 3) { toast(`这一趟要 3 动作点，现在只有 ${S.ap}。`, 'bad'); return; }
    S.ap -= 3;
    E.emit(); E.save();
    E.log('换下围裙。银狐酒吧的地下室应该还没搬空。', 'info');
    enterSneakScene(G.SNEAKS.ch1_bar, surveyArrived, surveyCaught);
  }

  function surveyCaught() {
    const S = E.state;
    S.reputation = E.clamp(S.reputation - 1, 0, 100);
    S.energy = E.clamp(S.energy - 2, 0, 100);
    E.emit();
    toast('巷口有人在看。先退出去，绕一圈再来。', 'bad');
    window.MapView.endSneak();
    setTimeout(() => {
      const G = GS();
      enterSneakScene(G.SNEAKS.ch1_bar, surveyArrived, surveyCaught);
    }, 1100);
  }

  function surveyArrived() {
    const G = GS();
    window.MapView.endSneak();
    window.MapView.exit();
    playStory(G.SCRIPTS.ch2_anchor, () => {
      G.giveItem('labLog', 1);
      G.setStep('network');
      setView('panel');
      tab = 'story';
      renderPanel();
      toast('带回来一册实验记录。回去把图叠起来看。', 'good');
    });
  }

  /* 黑信封：下一次进入阶段时送到 */
  function maybeLetter() {
    const G = GS();
    if (!G || !G.isStep('letter') || G.flag('letterShown')) return false;
    G.setFlag('letterShown');
    setTimeout(() => {
      playStory(G.SCRIPTS.ch2_letter, () => {
        G.giveItem('ravenCard', 1);
        G.addClue('raven');
        G.setStep('mint');
        tab = 'story';
        renderPanel();
        toast('信箱里躺着一个黑信封。', 'good');
      });
    }, 500);
    return true;
  }

  function handleLocAction(id, locId) {
    closeModal();
    if (id === 'shop') openShopModal(locId);
    else if (id === 'metro') openMetroModal(locId);
    else if (id === 'garage') openGarageModal();
    else if (id === 'book') {
      if (E.state.money < 120) { toast('钱不够。', 'bad'); return; }
      E.state.money -= 120;
      E.log('在旧书店买了一本手抄配方，看不懂但闻起来很甜。', 'info');
      E.state.reputation = E.clamp(E.state.reputation + 3, 0, 100);
      toast('花了 120G，学到一点东西。', 'good');
      E.emit(); E.save();
    } else if (id === 'inside' || id === 'inside-shop') {
      // 从街上回店要花 1 行动点（开门、卸车、洗手），但回店不再等于「这一趟结束」：
      // 进屋能补货、现做，之后从面板的「再出门」接着把剩下的单送完。
      const fromStreet = view === 'map';
      const charged = fromStreet && E.state.ap > 0 ? (E.useAP(1), 1) : 0;
      E.state.energy = E.clamp(E.state.energy + 6, 0, 100);
      const left = E.state.orders.filter(o => loaded.includes(o.id) && !o.delivered).length;
      E.emit(); E.save();
      tab = 'stock';
      window.MapView.exit();
      setView('panel');
      syncTrip();       // 回店补货：车厢留在存档里，点「再出门」接着跑
      if (fromStreet) {
        const head = `回到店里${charged ? '，行动点 -1' : ''}，元气 +6`;
        // 配送中回家＝这一趟还没结束，告诉玩家还能接着出门；自由活动回家就只是歇脚
        const tail = mapMode === 'delivery'
          ? (left ? `，还有 ${left} 单没送完，点「再出门」接着跑。` : '，货都送完了。')
          : '。';
        toast(head + tail, 'good');
      } else {
        toast('在店里坐了一会儿，元气 +6', 'good');
      }
      maybeStoryHome();   // 第一章：把莉莉安带回来之后安顿她
    } else if (id === 'talk') {
      const lines = dialogFor(locId);
      if (lines) playStory(lines, () => { });
    }
  }

  /* ================= 存档 / 读档 ================= */
  let slotConfirm = null;      // 要覆盖哪个槽位：第一下只是问问，第二下才真写
  let slotConfirmTimer = 0;

  function fmtTime(ts) {
    if (!ts) return '未知时间';
    const d = new Date(ts);
    const p = n => (n < 10 ? '0' + n : '' + n);
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* 标题页「继续上次」的文案：存档在第几天、什么时候存的 */
  function refreshTitleBtn() {
    const btn = $('btn-continue');
    if (!btn) return;
    const a = E.autoInfo();
    if (!a.exists) {
      btn.disabled = true;
      btn.title = '还没有自动存档';
      btn.textContent = '继续上次';
    } else {
      btn.disabled = false;
      btn.title = `自动存档 · 第 ${a.day} 天 · ${a.phase} · ${fmtTime(a.savedAt)}`;
      btn.textContent = `继续上次（第 ${a.day} 天）`;
    }
  }

  function slotRowsHtml() {
    // 标题页（view 为空）只让读，不让存——那时的 state 还是空局，存进去就是把好档覆盖成白板
    const inGame = view !== null;
    return E.slotList().map(s => {
      const confirm = slotConfirm === s.n;
      const info = s.exists
        ? `<div class="slot-main">第 ${s.day} 天 · ${s.phase}</div>
           <div class="slot-sub">¥${money(s.money)} · 信誉 ${s.rep} · 元气 ${s.energy} · ${fmtTime(s.savedAt)}</div>`
        : `<div class="slot-main vacant">空槽位</div><div class="slot-sub">还没有存过东西</div>`;
      const saveBtn = inGame
        ? `<button class="btn btn-sm${confirm ? ' btn-danger' : ''}" data-act="slot-save" data-slot="${s.n}">${confirm ? '确认覆盖' : (s.exists ? '覆盖' : '存入')}</button>`
        : '';
      return `<div class="slot${s.exists ? '' : ' vacant'}">
        <div class="slot-no">${s.n}</div>
        <div class="slot-body">${info}</div>
        <div class="slot-acts">
          ${saveBtn}
          <button class="btn btn-sm" data-act="slot-load" data-slot="${s.n}"${s.exists ? '' : ' disabled'}>读取</button>
          ${s.exists && inGame ? `<button class="btn btn-sm btn-ghost" data-act="slot-del" data-slot="${s.n}" title="清空这个槽位">清空</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function saveBodyHtml() {
    const tip = view
      ? '每次行动、每次换阶段都会写一份<b>自动存档</b>。下面三个是<b>手动槽位</b>——想留住某一刻就存一下。'
      : '这里只能<b>读取</b>。进了游戏之后，点右上角<b>「存」</b>或按 <b>Ctrl+S</b> 才会往槽位里写。';
    return `<div class="save-tip">${tip}</div>
      <div class="slot-list">${slotRowsHtml()}</div>
      <div class="save-tip foot">读取会立刻把当前进度换成槽位里的那一段，手上没存的会丢。返回标题前也会自动存一次。</div>`;
  }

  function saveSubText() {
    return view
      ? `现在：第 ${E.state.day} 天 · ${E.phase() ? E.phase().name : '—'}`
      : '标题页 · 选一个槽位读取';
  }

  function refreshSaveModal() {
    const root = $('modal-root');
    if (!root || root.classList.contains('hidden')) return;
    const body = root.querySelector('.modal-body');
    if (!body || !body.querySelector('.slot-list')) return;
    body.innerHTML = saveBodyHtml();
    const sub = root.querySelector('.modal-head .sub');
    if (sub) sub.textContent = saveSubText();
  }

  function openSaveModal() {
    slotConfirm = null;
    clearTimeout(slotConfirmTimer);
    openModal({
      title: '存档 / 读档',
      sub: saveSubText(),
      body: saveBodyHtml(),
      footer: `<button class="btn btn-ghost" data-act="close-modal">关闭</button>
        <button class="btn" data-act="retire-ask">结档</button>`
    });
  }

  /* —— 结档：不是失败，是把这一档的成绩封存起来 —— */
  function openRetireAsk() {
    const S = E.state;
    const n = E.retireList().length;
    openModal({
      title: '结档',
      sub: `第 ${S.day} 天 · ${S.rank} 级「${E.rankInfo().name}」`,
      body: `<div style="font-size:12.5px;line-height:2;color:#4a3b52;">
        <b>结档不是失败。</b>糖果屋不会关，只是这一档到此为止——留一张成绩单，再开一家新的。<br>
        会清空<b>当前进度和自动存档</b>（手动槽位不动），已封存 <b>${n}</b> 档。
      </div>`,
      footer: `<button class="btn btn-ghost" data-act="close-modal">再想想</button>
        <button class="btn btn-primary" data-act="retire-confirm">结档并开新的一档</button>`
    });
  }

  function openRetireSummary(rec, count) {
    const rows = [
      ['天数', `${rec.day} 天`],
      ['评级', `${rec.rank}「${rec.rankName}」`],
      ['累计营业额', `${money(rec.earned)}G`],
      ['卖出去', `${rec.sold} 件糖 · ${rec.delivered} 单送达`],
      ['熟人', `${rec.people} 位`],
      ['三条线', `履约 ${rec.cred.fulfill} · 合规 ${rec.cred.compliance} · 供应链 ${rec.cred.supply}`]
    ].map(([k, v]) => `<div class="retire-row"><span>${k}</span><b>${v}</b></div>`).join('');
    openModal({
      title: '这一档封存了',
      sub: `第 ${count} 档`,
      body: `<div class="retire-card">
        <div class="retire-badge">${rec.rank}</div>
        <div class="retire-verdict">${esc(rec.verdict)}</div>
        <div class="retire-rows">${rows}</div>
      </div>`,
      footer: `<button class="btn btn-primary" data-act="retire-done">开始新的早晨</button>`
    });
  }

  function openQuitModal() {
    const S = E.state;
    openModal({
      title: '返回标题',
      sub: `第 ${S.day} 天 · ${E.phase() ? E.phase().name : ''}`,
      body: `<div style="font-size:12.5px;line-height:2;color:#4a3b52;">
        回标题之前会<b>自动存一次</b>，下次点「继续上次」就能接着这里。
        只存在手动槽位之外、又没进槽位的进度，之后被覆盖就找不回来了。
      </div>`,
      footer: `<button class="btn btn-ghost" data-act="close-modal">再想想</button>
        <button class="btn btn-primary" data-act="quit-title-confirm">回标题</button>`
    });
  }

  function doQuitToTitle() {
    E.save();
    closeModal(false);          // 别触发上一个弹窗的 onClose（比如日结后的 enterPhase）
    window.MapView.exit();
    loaded = [];
    customers = [];
    custSel = 0;
    slotConfirm = null;
    if (storyState) {           // 剧情演到一半也一并收掉
      storyState = null;
      const node = $('story-node');
      if (node) node.remove();
    }
    view = null;
    ['panel', 'counter', 'map'].forEach(v => {
      const node = $('view-' + v);
      if (node) node.classList.remove('active');
    });
    const t = $('title-screen');
    if (t) t.classList.remove('hide');
    refreshTitleBtn();
    toast('已存档，回到标题。');
  }

  function openHelp() {
    const html = `
      <div class="help-sec">
        <h4>一天怎么过</h4>
        <p>一天分七个阶段，每个阶段有一份<b>行动点</b>。做任何事都要花行动点，用完或者你自己点「下一阶段」，时间就会往前走。</p>
        <div class="help-flow">
          <span class="help-step">早起准备 <b>8AP</b></span>
          <span class="help-step">早间配送 <b>14AP</b></span>
          <span class="help-step">上午坐班 <b>8AP</b></span>
          <span class="help-step">午休 <b>3AP</b></span>
          <span class="help-step">下午坐班 <b>6AP</b></span>
          <span class="help-step">晚间配送 <b>22AP</b></span>
          <span class="help-step">睡前 <b>3AP</b></span>
        </div>
      </div>
      <div class="help-sec">
        <h4>做糖</h4>
        <p>后场的<b>制作台</b>用原料做成品，每份 1–2 行动点。<b>元气</b>低于 55 会开始出现烧糊的概率，先午睡或休息一下更划算。</p>
        <p>原料去地图上的<b>巷口水果摊</b>（便宜、品类少）或<b>综合市场</b>（齐全、贵一点）买。</p>
        <p><b>助手看柜台</b>：在店铺页把雇来的学徒安排到「看柜台」，坐班时柜台左下角会亮起「交给小X看着，出门 →」。这一班你可以在外面跑，收班时她按柜台价九折替你卖掉一批货——卖得比你自己便宜，也记不住熟客。</p>
        <p><b>第三方配送</b>：订单页每单都有「代送」，平台替你跑腿、准时安全、不用出门，代价是抽走尾款 45%（最低 12G）。货还是得你自己做出来。</p>
        <p><b>批发采购</b>：库存页底部可以「向批发商下单」，不用自己跑市场。批发价比门市便宜 15%，买满 10/20/40/60 份再打 3%/6%/10%/15%；代价是一笔跑腿搬运费，而且货要隔两个阶段才到。</p>
        <p>现金见底、供应商也不肯赊了？店铺页有<b>「巷口零工」</b>：一天一次，花 1 点行动点帮水果摊卸货，换一炉基础原料。店铺页的<b>存档面板</b>底部还能<b>结档</b>，把这一档封存成成绩单。</p>
      </div>
      <div class="help-sec">
        <h4>卖糖</h4>
        <p>坐班阶段是<b>柜台</b>：客人最多<b>同时进来三位</b>，各自要各自的东西。点左上角的名字标签切换招呼谁，脚下有粉圈的就是当前这位。货架上有他要的，点「交付」成交；没有就<b>婉拒</b>——会掉一点信誉，但总比让人干等好。</p>
        <p>来不及回后场做？客人正等着的时候可以点<b>「现做」</b>：用原料当场做一份（必定成功，花的行动点和后场一样），做完再点交付。配方缺料时按钮是灰的。</p>
      </div>
      <div class="help-sec">
        <h4>送糖</h4>
        <p>配送阶段先选这一趟要送的订单，运力装不下的留在店里。出货窗会算出<b>这一趟来回要多少行动点</b>——不够就少装两单。到了大地图上用 <b>WASD / 方向键</b> 骑车，或者点地图上的目的地让它自己走，走到门口按 <b>E</b>（手机点画面下方的「进入 xx」按钮）交货。</p>
        <p>半路发现货不够、或者想回去补点原料？走回<b>糖果屋</b>按 <b>E</b> 选「回店里歇一会儿」：花 <b>1 行动点</b>、元气 +6，进屋能补货现做。之后在右侧「可以做的事」里点<b>「再出门」</b>会重新过一遍<b>出货窗</b>——车上原有的单默认勾着，可以<b>再加装几单</b>，也能卸下来；确认后带着新的车厢继续跑，<b>剩下的行动点不会白扔</b>。</p>
      </div>
      <div class="help-sec">
        <h4>看路</h4>
        <p>出发时会自动把导航指向最近的一单，地上那串粉点就是<b>该走的路</b>。前面还亮着的是走得动的，<b>变暗那一截就是你行动点不够的地方</b>，末端打叉——骑到那儿就该回头了。顶部卡片会同时给出「去几 AP / 回几 AP」，回程不够会变黄。</p>
        <p>按 <b>M</b>（或点右上角小地图）摊开<b>全城图</b>，把鼠标放到任意地点上，就能看到去那儿要几个行动点、来不来得及回家。<b>Tab</b> 掀开车厢，看清这趟装了什么、哪个客户的东西还没备齐。</p>
        <p><b>点地点只是设目标，不会让你自己走</b>——误触一下白白烧掉行动点太亏。真要走，再点一次目标、点屏幕边缘那个粉色箭头（写着「点我出发」），或者点顶部导航卡上的<b>「自动走」</b>；路上按任何方向键、或点<b>「停下」</b>都能随时接管。</p>
        <p>手机上不用键盘：目标出屏时点那个箭头就会沿路走过去，走到门口后画面下方会出现<b>「进入 xx」</b>按钮，点它就行。</p>
        <div class="help-flow">
          <span class="help-step"><b>M</b> 全城图</span>
          <span class="help-step"><b>Tab</b> 车厢清单</span>
          <span class="help-step"><b>E</b> 互动 / 交付</span>
          <span class="help-step"><b>点箭头</b> 自动走过去</span>
        </div>
      </div>
      <div class="help-sec">
        <h4>潜入（主线）</h4>
        <p>主线在<b>「委托」</b>页。有些章节要摸进别人的地盘——那时地图上会出现<b>守卫</b>，他们身前那片半透明扇形就是视野。走进去会涨<b>警觉度</b>（顶部那条），涨满就被抓住。</p>
        <p>被抓不会删档，扣点元气或信誉，退回起点重来。躲的办法有三个：<b>蹲下</b>走得慢但不容易被看见；<b>扔糖</b>把守卫引到糖落地的地方；站进地上那圈<b>暗色</b>（藏匿点）警觉掉得更快。潜入里走路不花行动点——那一趟的价钱进门时就扣过了。</p>
        <div class="help-flow">
          <span class="help-step"><b>Shift</b> 蹲下</span>
          <span class="help-step"><b>Q</b> 扔糖</span>
          <span class="help-step"><b>扇形</b> 别踩进去</span>
        </div>
      </div>
      <div class="help-sec">
        <h4>骑不动了</h4>
        <p>行动点见底不会直接把你踢回去，而是让你选：<b>叫车</b>（花几十块，立刻到家，人不累）、<b>推车走回去</b>（不花钱，扣元气，明天更累）、或者<b>就地收工</b>。没送完的订单会回到订单簿，注意期限。</p>
        <p>想跑得更远，除了攒钱换<b>厢型车 / 小货车</b>（越好的车每点行动点能跑越远），还可以先骑到地铁站再坐地铁跨区——地铁按站收费，比一路骑过去省得多。</p>
      </div>
      <div class="help-sec">
        <h4>订单与信誉</h4>
        <p>订单有交付期限，过期会掉信誉。赶不上就在订单簿里点「请求延期」，客户通常会同意，但<b>尾款会少一些</b>。信誉越高，同样的东西卖得越贵。</p>
      </div>
      <div class="help-sec">
        <h4>存档与读档</h4>
        <p>每次行动、每次换阶段都会<b>自动存档</b>；标题页的「继续上次」读的就是它。想留住某一刻，点右上角的<b>「存」</b>（或按 <b>Ctrl+S</b>）打开存档面板，三个槽位随便存。覆盖已有存档要点两下，第一下只是问你。</p>
        <p>读取会立刻把进度换成槽位里的那一段，所以读之前先存一下手上的。想重新开始或重走一条路，点<b>「退」</b>回标题——回之前会自动存一次。</p>
      </div>`;
    openModal({
      title: '玩法说明',
      sub: '糖果屋 · 地下万事屋',
      body: html,
      footer: `<button class="btn btn-primary" data-act="close-modal">知道了</button>`
    });
  }

  /* ================= 对外 ================= */
  return {
    init, enterPhase, setView, render, renderHUD, toast, playStory,
    getView: () => view,
    refreshTitleBtn, openSaveModal,
    // 调试用：直接触发「行动点见底」那条分支
    simulateAPEmpty: () => { if (view === 'map') onAPEmpty(); },
    // 调试用：指定这一趟装了哪几单（安检提示截图、手动验证要用）
    debugLoad: ids => { loaded = (ids || []).slice(); syncTrip(); },
    // 测试钩子：把配送现场写进存档 / 从存档还原（S/L 回归用）
    syncTrip, restoreTrip,
    // 测试钩子：直接摊开某一条路上事件（?event=gang_fight 截图用）
    debugRoadEvent: id => {
      const ev = (D.ROAD_EVENTS.list || []).find(e => e.id === id);
      if (ev) openRoadEvent(ev);
    },
    // 测试钩子：把店里塞满客人 / 看看现在谁在等
    forceCustomers: (n, want) => {
      customers = [];
      custSel = 0;
      const cnt = Math.max(1, Math.min(CUST_MAX, n || CUST_MAX));
      /* 直接建人，不走 spawnCustomer——那个会按柜台等级限流，
         而这里是调试/测试用的「硬塞」。 */
      for (let i = 0; i < cnt; i++) {
        const c = newCustomer();
        customers.push(c);
        if (i === 0 && want) { c.wants = want; c.qty = 1; }
      }
      updateCounter();
    },
    customerInfo: () => customers.map(c => ({ name: c.name, wants: c.wants, qty: c.qty })),
    selectCustomer: i => { custSel = i; updateCounter(); },
    // 测试钩子：回店 / 再出门 / 这一趟的状态
    goInside: () => handleLocAction('inside', 'shop'),
    goOut: () => doPhaseAction('go-out'),
    tripInfo: () => ({ mode: mapMode, loaded: loaded.slice() })
  };
})();
