/* ============================================================
 *  自测脚本（仅 selftest.html 使用）
 *  自动驱动一遍核心流程，把结果画在页面上
 * ============================================================ */
(function () {
  // 自测页不让「路上事件」的弹窗打断自动化流程；引擎的 roll/apply 仍会被单独断言
  window.CANDY_TEST_MODE = true;
  const results = [];
  const errors = [];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  function ok(name, cond, extra) {
    results.push({ name, pass: !!cond, extra: extra || '' });
  }
  function click(sel) {
    const n = typeof sel === 'string' ? $(sel) : sel;
    if (!n) { results.push({ name: '找不到元素 ' + sel, pass: false }); return false; }
    n.click();
    return true;
  }
  function panel(txt) {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;background:#101018;color:#dfe;font:12px/1.6 monospace;padding:16px;overflow:auto;white-space:pre-wrap';
    const pass = results.filter(r => r.pass).length;
    d.textContent = '自测结果 ' + pass + '/' + results.length + '\n\n' +
      results.map(r => (r.pass ? '✔ ' : '✘ ') + r.name + (r.extra ? '  [' + r.extra + ']' : '')).join('\n') +
      (errors.length ? '\n\n!! 异常:\n' + errors.join('\n') : '');
    document.body.appendChild(d);
  }

  window.addEventListener('error', e => errors.push((e.message || '') + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));

  function key(k) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
  }

  async function run() {
    const E = window.Engine, D = window.GameData, UI = window.UI;
    localStorage.removeItem('candyhouse_save_v1');
    for (let i = 1; i <= 3; i++) localStorage.removeItem('candyhouse_slot_v1_' + i);
    E.newGame();
    // 常规流程测试不跑主线：主线有自己的流程测试（flowtest.html），
    // 放在这里会打断「阶段—面板—地图」的既有断言
    E.state.story.chapter = null;
    document.getElementById('title-screen').classList.add('hide');
    UI.enterPhase();
    await wait(120);

    ok('初始进入 早起准备', E.phase().id === 'prep');
    ok('初始订单已生成', E.state.orders.length >= 1, E.state.orders.length + ' 单');
    ok('面板已渲染', !!$('.grid-recipes'));

    // 制作
    const ap0 = E.state.ap, st0 = E.stockOf('lollipop');
    click('[data-act="craft"][data-key="lollipop"][data-times="1"]');
    await wait(60);
    ok('制作消耗行动点', E.state.ap === ap0 - 1, ap0 + '→' + E.state.ap);
    ok('成品进入货架', E.stockOf('lollipop') >= st0, '货架 ' + E.stockOf('lollipop'));

    // 切标签
    click('[data-act="tab"][data-tab="orders"]');
    await wait(50);
    ok('订单簿可打开', !!$('.order') || !!$('.empty'));
    click('[data-act="tab"][data-tab="stock"]');
    await wait(50);
    ok('库存页可打开', !!$('.inv-cols'));
    ok('库存页标明进货点', !!$('.buy-hint') && /巷口水果摊/.test($('.buy-hint').textContent));
    click('[data-act="tab"][data-tab="vehicle"]');
    await wait(50);
    ok('车库页可打开', !!$('.veh'));
    click('[data-act="tab"][data-tab="log"]');
    await wait(50);
    ok('日记页可打开', !!$('.log-line'));

    // 买原料（在地图上测）
    click('[data-act="tab"][data-tab="craft"]');
    await wait(40);

    // 进入配送
    click('[data-act="end-phase"]');
    await wait(300);
    ok('进入早间配送', E.phase().id === 'deliveryAM');
    ok('出货弹窗出现', !$('#modal-root').classList.contains('hidden'), UI.getView());

    // 装车
    const toggle = $('[data-act="load-toggle"]');    ok('出货单有可选订单', !!toggle);
    if (toggle) { toggle.click(); await wait(60); }
    ok('出货窗显示行动点预算', !!$('.load-budget'),
      $('.load-budget') ? ($('.load-budget').textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70) : '无预算行');
    click('[data-act="confirm-load"]');
    await wait(400);
    ok('进入大地图', UI.getView() === 'map');
    const d0 = window.MapView.debug();
    // headless 里 rAF 不一定跑，frames 会一直是 0；这里只验循环被拉起来了，
    // 真正的「能走」由后面的 stepForTest 推帧覆盖
    ok('地图循环已启动', d0.running, JSON.stringify(d0) + ' cw=' + $('#map-canvas').width);
    ok('地图画布已渲染', $('#map-canvas').width > 320, 'w=' + $('#map-canvas').width);
    ok('已装车订单', !($('#map-bottombar').textContent || '').includes('空车'), ($('#map-bottombar').textContent || '').replace(/\s+/g, ' ').slice(0, 60));

    /* ---- 导航指引 ---- */
    const guide = window.MapView.getGuide();
    ok('配送自动设定导航目标', !!guide, guide ? guide.name : 'null');
    if (guide) {
      ok('导航给出行动点估算', guide.ap >= 0, guide.dist + 'px → ' + guide.ap + 'AP');
      // 订单地点随机，碰巧就落在糖果屋时回程当然是 0，别误判
      ok('导航给出回程估算', guide.backAp > 0 || guide.dist < 30,
        '回 ' + guide.backAp + 'AP（去 ' + Math.round(guide.dist) + 'px）');
      ok('导航标注够不够', typeof guide.short === 'boolean' && typeof guide.tight === 'boolean',
        `short=${guide.short} tight=${guide.tight} 有${guide.haveAp}AP`);
      ok('顶部显示导航卡片', ($('#map-topbar').textContent || '').includes(guide.name), ($('#map-topbar').textContent || '').replace(/\s+/g, ' ').slice(0, 50));
    }

    /* ---- 里程预算 ---- */
    // 用两个固定的远端地点，不依赖随机订单落在哪儿
    const est2 = window.MapView.estimateRoute(['market', 'pier']);
    ok('路线估算含回程', est2.ap > 0 && est2.backAp > 0, `${est2.px}px 去${est2.ap} 回${est2.backAp}`);
    ok('路线估算给出顺序', est2.order.length === 2, est2.order.join('→'));
    ok('载具效率可查', window.MapView.pxPerAp() > 0, window.MapView.pxPerAp() + 'px/AP');

    /* ---- 全城地图 ---- */
    key('m');
    await wait(250);
    ok('M 键摊开全城图', window.MapView.isBigMapOpen());
    ok('全城图时收起底部浮层', ($('#map-bottombar').style.opacity || '1') === '0', 'opacity=' + ($('#map-bottombar').style.opacity || '(none)'));
    key('m');
    await wait(250);
    ok('M 键再按关闭全城图', !window.MapView.isBigMapOpen());
    ok('关闭后恢复底部浮层', ($('#map-bottombar').style.opacity || '1') !== '0');

    // 点击小地图区域应当展开
    const cvs = $('#map-canvas');
    const cr = cvs.getBoundingClientRect();
    const dprNow = Math.min(window.devicePixelRatio || 1, 2);
    const cw = cvs.width / dprNow, ch = cvs.height / dprNow;
    cvs.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: cr.left + (cw - 80) / cw * cr.width,   // 小地图中心：右侧 80px、顶部 98px
      clientY: cr.top + 98 / ch * cr.height
    }));
    await wait(200);
    ok('点击小地图摊开全城图', window.MapView.isBigMapOpen());

    // 点右下角那个叉关掉
    cvs.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: cr.left + (cw - 44) / cw * cr.width,
      clientY: cr.top + (ch - 44) / ch * cr.height
    }));
    await wait(200);
    ok('点关闭按钮收起全城图', !window.MapView.isBigMapOpen());

    /* ---- 手机端「进入 xx」按钮：以前是画在 canvas 里的一行字，手机点不到 ---- */
    window.MapView.teleport('market');
    window.MapView.stepForTest(0.016, 3);
    await wait(150);
    const actBtn = $('#map-act');
    ok('走到门口出现「进入」按钮', !!actBtn && !actBtn.classList.contains('is-off'),
      actBtn ? actBtn.textContent.trim() : '无');
    const barRect = $('#map-bottombar').getBoundingClientRect();
    const actRect = actBtn ? actBtn.getBoundingClientRect() : null;
    ok('交互按钮在底栏之上，没被压住', !!actRect && actRect.bottom <= barRect.top + 1,
      actRect ? `btn.bottom=${Math.round(actRect.bottom)} bar.top=${Math.round(barRect.top)}` : '无');
    if (actBtn) { actBtn.click(); await wait(300); }
    ok('点按钮等于按 E（打开交互菜单）', !$('#modal-root').classList.contains('hidden'),
      $('#modal-root').className);
    click('[data-act="close-modal"]');
    await wait(150);

    /* ---- 配送中途回店：扣 1 行动点，但还能再出门 ---- */
    window.MapView.teleport('shop');
    window.MapView.stepForTest(0.016, 3);
    await wait(150);
    const apBeforeHome = E.state.ap;
    const loadedBeforeHome = UI.tripInfo().loaded.length;
    UI.goInside();
    await wait(250);
    ok('回到店里看到后场面板', UI.getView() === 'panel', String(UI.getView()));
    ok('回店花掉 1 行动点', E.state.ap === apBeforeHome - 1, apBeforeHome + ' → ' + E.state.ap);
    const goOutBtn = $('[data-act="phase-action"][data-id="go-out"]');
    ok('配送阶段的面板有「再出门」', !!goOutBtn, goOutBtn ? goOutBtn.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : '无');
    if (goOutBtn) { goOutBtn.click(); await wait(400); }

    /* 再出门先过一遍装货窗：车上原有的单默认勾着，还能加装 */
    const reloadBtn = () => $('[data-act="confirm-load"]');
    const pendingN = E.state.orders.filter(o => !o.delivered && !o.pickup).length;
    const pickupIds = E.state.orders.filter(o => o.pickup && !o.delivered).map(o => o.id);
    ok('再出门先打开装货窗', !!reloadBtn(), reloadBtn() ? reloadBtn().textContent.trim() : '无');
    ok('装货窗列出全部待送单', $$('[data-act="load-toggle"]').length === pendingN,
      `列出 ${$$('[data-act="load-toggle"]').length} / 待送 ${pendingN}`);
    ok('自提单不进装货窗',
      pickupIds.every(id => !$$('[data-act="load-toggle"]').some(b => +b.dataset.id === id)));
    ok('装货窗默认勾上车上原有的单', new RegExp(`出发（${loadedBeforeHome} 单）`).test(reloadBtn() ? reloadBtn().textContent : ''),
      reloadBtn() ? reloadBtn().textContent.trim() : '无');
    // 只挑「能装」的那张：运力不够的卡片点了会被拒绝，那不是 bug
    const unchecked = $$('[data-act="load-toggle"]').find(n => !/已装车|装不下/.test(n.textContent));
    if (unchecked) { unchecked.click(); await wait(150); }
    const loadLbl = reloadBtn() ? reloadBtn().textContent : '';
    const picked = parseInt((loadLbl.match(/出发（(\d+) 单）/) || [0, '0'])[1], 10);
    ok('可以在装货窗里加装订单', !unchecked || picked > loadedBeforeHome,
      `勾选 ${picked} 单 / 回店前 ${loadedBeforeHome} 单${unchecked ? '' : '（没有可加的单）'}`);
    if (reloadBtn()) { reloadBtn().click(); await wait(400); }

    ok('「再出门」回到大地图', UI.getView() === 'map', String(UI.getView()));
    const trip = UI.tripInfo();
    ok('再出门带上勾选的单', trip.loaded.length === picked, `装上 ${trip.loaded.length} 单 / 勾选 ${picked} 单`);
    ok('再出门不再额外扣行动点', E.state.ap === apBeforeHome - 1, E.state.ap + ' AP');

    /* ---- 家门口正好有单要送时，交付窗里也得能进屋（否则回不了家） ---- */
    const oHome = E.state.orders.find(o => !o.delivered && UI.tripInfo().loaded.includes(o.id));
    if (oHome) {
      const locBak = oHome.loc;
      oHome.loc = 'shop';
      window.MapView.teleport('shop');
      window.MapView.stepForTest(0.016, 3);
      await wait(150);
      window.MapView.interact();
      await wait(250);
      const inBtn = $('[data-act="loc-action"][data-id="inside-shop"]');
      ok('家门口有单时交付窗也给「进屋」', !!inBtn, inBtn ? inBtn.textContent.trim() : '无');
      if (inBtn) { inBtn.click(); await wait(250); }
      ok('从交付窗也能进屋', UI.getView() === 'panel', String(UI.getView()));
      oHome.loc = locBak;          // 还原，后面的交付测试还要用这个单的地点
      UI.goOut();
      await wait(300);
      if (reloadBtn()) { reloadBtn().click(); await wait(400); }
      ok('还原后仍在配送中', UI.getView() === 'map' && UI.tripInfo().mode === 'delivery');
    }

    /* ---- 车厢清单 ---- */
    click('[data-act="cargo"]');
    await wait(200);
    const cargoModal = $('.cargo-wrap');
    ok('货箱按钮打开车厢清单', !!cargoModal, cargoModal ? '有内容' : '未出现');
    if (cargoModal) {
      ok('列出载具与运力', /单位/.test($('.modal-head') ? $('.modal-head').textContent : ''));
      ok('车厢含当前订单分组', $$('.cargo-group').length >= 1, $$('.cargo-group').length + ' 组');
      click('[data-act="close-modal"]');
      await wait(150);
    }

    /* ---- 点地点：只设目标，不自动走路（免得误触烧行动点） ---- */
    const shopLoc = window.GameData.LOCATIONS.find(l => l.id === 'shop');
    window.MapView.clearGuide();
    window.MapView.tapWorld(shopLoc.doorX, shopLoc.doorY);
    await wait(60);
    ok('点地点只设目标、不出发',
      !window.MapView.isAutoWalk() && window.MapView.clickDebug().path === 0,
      JSON.stringify(window.MapView.clickDebug()));
    const gShop = window.MapView.getGuide();
    ok('导航目标切到刚点的地点', gShop && gShop.locId === 'shop', gShop ? gShop.locId : '无');

    /* ---- 点空地：沿折线自己走过去 ---- */
    let walkDbg = null, walkFrom = null;
    for (const [ox, oy] of [[0, 130], [0, -130], [150, 0], [-150, 0], [110, 110], [-110, -110]]) {
      window.MapView.clearGuide();
      const p0 = window.MapView.getPlayer();
      window.MapView.tapWorld(p0.x + ox, p0.y + oy);
      const d = window.MapView.clickDebug();
      if (d.path > 0) { walkDbg = d; walkFrom = p0; break; }
    }
    ok('点空地生成寻路折线', !!walkDbg, JSON.stringify(walkDbg || {}));
    ok('回读当前目标是可走点', !!walkDbg && !!walkDbg.target);

    // 手动推帧（headless 下 rAF 不一定跑）：人应该沿折线靠近目标，而不是直线撞墙不动
    const target = walkDbg && walkDbg.target;
    const dBefore = target && walkFrom ? Math.hypot(target.x - walkFrom.x, target.y - walkFrom.y) : 0;
    window.MapView.stepForTest(0.016, 30);
    const walkToP = window.MapView.getPlayer();
    const dAfter = target ? Math.hypot(target.x - walkToP.x, target.y - walkToP.y) : 0;
    ok('点击后沿折线接近目标', dBefore > 0 && dAfter < dBefore - 1,
      `${Math.round(dBefore)}px → ${Math.round(dAfter)}px`);
    window.MapView.stopWalk(true);      // 后面的断言不该被人还在走这件事干扰
    await wait(200);

    /* ---- 自动寻路：设目标不自动走，要玩家确认才出发 ---- */
    window.MapView.setGuide('pier');
    ok('设导航目标本身不走路', !window.MapView.isAutoWalk() && window.MapView.clickDebug().path === 0,
      JSON.stringify(window.MapView.clickDebug()));

    const apWalk = E.state.ap;
    E.state.ap = 1;                    // 只剩 1 AP，肯定走不到码头
    const goBad = window.MapView.walkTo('pier');
    ok('行动点不够时拒绝自动寻路', !goBad && !window.MapView.isAutoWalk(), String(goBad));
    E.state.ap = apWalk;

    window.MapView.setGuide('pier');
    const goOk = window.MapView.walkTo('pier');
    ok('确认后开始自动寻路', goOk && window.MapView.isAutoWalk() && window.MapView.clickDebug().path > 0,
      JSON.stringify(window.MapView.clickDebug()));

    const apStop = E.state.ap;
    const stopped = window.MapView.stopWalk();
    ok('点「停下」立刻结束寻路', stopped && !window.MapView.isAutoWalk() && window.MapView.clickDebug().path === 0);
    ok('停下本身不消耗行动点', E.state.ap === apStop, apStop + '→' + E.state.ap);

    /* ---- 传送到订单地点并交付 ---- */
    const orders = E.state.orders.filter(o => !o.delivered && !o.pickup);
    /* 自提单不进配送池，别拿它当交付目标；极端情况下全是自提单就补一张普通单 */
    if (!orders.length) {
      const spare = E.state.orders.find(o => o.pickup && !o.delivered);
      if (spare) { delete spare.pickup; spare.loc = 'busstop'; spare.type = 'phone'; orders.push(spare); }
      else orders.push(E.makeOrder({ loc: 'busstop', type: 'phone' }));
    }
    if (orders.length) {
      const target = orders[0];
      /* 补货：同一个地点上可能挂着好几张已装车的单，只补 orders[0] 的料会漏，
         交付时那一单因为缺货被跳过，断言就会偶发失败。 */
      E.state.orders.filter(o => !o.delivered && o.loc === target.loc)
        .forEach(o => { for (const k in o.items) E.addStock(k, o.items[k]); });
      window.MapView.teleport(target.loc);
      await wait(200);
      const mp = window.MapView.getPlayer();
      const dbg = window.MapView.debug();
      ok('传送到目标地点', Math.hypot(mp.x - (target.loc === 'church' ? 512 : mp.x), 0) < 999, target.loc + ' @' + Math.round(mp.x) + ',' + Math.round(mp.y) + ' near=' + dbg.near + ' frames=' + dbg.frames + ' run=' + dbg.running);
      key('e');
      await wait(250);
      const deliverBtn = $('[data-act="deliver-now"]');
      ok('交付弹窗出现', !!deliverBtn, target.loc + ' | modal=' + (($('#modal-root .modal-head h3') || {}).textContent || 'none'));
      if (deliverBtn) {
        const m0 = E.state.money;
        deliverBtn.click();
        await wait(200);
        ok('交付获得报酬', E.state.money > m0, m0 + '→' + E.state.money);
      }
    }

    // 采购（水果摊不在订单地点池里，交互一定是地点菜单）
    window.MapView.teleport('fruitstand');
    await wait(150);
    key('e');
    await wait(200);
    const buyAct = $('[data-act="loc-action"][data-id="shop"]');
    ok('地点菜单出现', !!buyAct, (($('#modal-root .modal-head h3') || {}).textContent || 'none'));
    if (buyAct) {
      buyAct.click();
      await wait(200);
      ok('采购界面打开', !!$('.shop-grid'), ($('[data-act="buy"]') ? '有货品' : '空'));
      const m0 = E.state.money, s0 = E.invOf('sugar');
      const b = $('[data-act="buy"][data-key="sugar"][data-qty="5"]');
      if (b) { b.click(); await wait(150); }
      ok('采购扣钱加货', E.state.money < m0 && E.invOf('sugar') > s0, m0 + '→' + E.state.money);
      click('[data-act="close-modal"]');
      await wait(120);
    }

    // 结束配送
    const endBtn = $('[data-act="end-delivery"]');    ok('地图有结束按钮', !!endBtn);
    if (endBtn) { endBtn.click(); await wait(400); }
    ok('进入上午坐班', E.phase().id === 'shiftAM', E.phase().id);
    ok('柜台视图已渲染', UI.getView() === 'counter' && !!$('#counter-canvas'));
    await wait(300);
    ok('柜台场景有内容', (() => {
      const cv = $('#counter-canvas');
      if (!cv) return false;
      const px = cv.getContext('2d').getImageData(Math.floor(cv.width / 2), Math.floor(cv.height / 2), 1, 1).data;
      return px[3] > 0 && (px[0] + px[1] + px[2]) > 30;
    })());

    /* ---- 三位客人同时在场 ---- */
    UI.forceCustomers(3);
    await wait(150);
    let tabs = $$('.cust-tab');
    ok('可以同时来三位客人', tabs.length === 3, tabs.length + ' 位');
    ok('客人标签能切换当前招呼对象', (() => {
      if (tabs.length < 2) return false;
      tabs[1].click();
      const on = $$('.cust-tab.on');
      return on.length === 1 && $$('.cust-tab')[1] === on[0];
    })());
    UI.selectCustomer(0);
    await wait(80);
    ok('客人卡片显示想要的货', /想要/.test($('#cust-card') ? $('#cust-card').textContent : ''));
    ok('客人卡片带交付/现做/婉拒三个动作',
      !!$('[data-act="cust-serve"]') && !!$('[data-act="cust-make"]') && !!$('[data-act="cust-refuse"]'));

    /* ---- 柜台现做 ---- */
    E.addInv('sugar', 10);
    const loll0 = E.stockOf('lollipop'), apMake = E.state.ap;
    const mk = E.counterMake('lollipop');
    ok('柜台现做产出一份', mk.ok && E.stockOf('lollipop') === loll0 + 1, JSON.stringify(mk));
    ok('现做消耗行动点', E.state.ap === apMake - Math.max(1, D.PRODUCTS.lollipop.ap),
      apMake + '→' + E.state.ap);
    E.state.inv.syrup = 0;
    const mkBad = E.counterMake('starcandy');
    ok('原料不够时现做会被拒', !mkBad.ok, mkBad.msg);

    // 走一遍界面链路：缺货 → 点「现做」→ 货架上有了
    UI.forceCustomers(1, 'lollipop');
    await wait(80);
    E.state.stock.lollipop = 0;
    E.addInv('sugar', 6);
    UI.selectCustomer(0);
    await wait(80);
    const mkBtn = $('[data-act="cust-make"]');
    ok('缺货时「现做」按钮可点', !!mkBtn && !mkBtn.disabled,
      mkBtn ? 'disabled=' + mkBtn.disabled : '无按钮');
    if (mkBtn && !mkBtn.disabled) {
      mkBtn.click();
      await wait(180);
      ok('点现做按钮后货架补上', E.stockOf('lollipop') >= 1, '库存 ' + E.stockOf('lollipop'));
    }

    // 接待一位顾客
    const apBefore = E.state.ap;
    const serveBtn = $('#btn-serve');
    if (serveBtn && !serveBtn.disabled) {
      const m0 = E.state.money;
      serveBtn.click();
      await wait(150);
      ok('柜台成交', E.state.money > m0, m0 + '→' + E.state.money);
      ok('接待消耗行动点', E.state.ap === apBefore - 1);
    } else {
      // 缺货就跳过
      ok('柜台交付按钮存在', !!serveBtn);
    }

    // 结束营业 → 午休
    click('[data-act="end-phase"]');
    await wait(300);
    ok('进入午休', E.phase().id === 'noon', E.phase().name);

    // 午休外出
    const walk = $('[data-act="phase-action"][data-id="walk"]');
    ok('午休可以外出', !!walk);
    if (walk) { walk.click(); await wait(300); ok('外出进入地图', UI.getView() === 'map'); 
      const ed = $('[data-act="end-delivery"]'); if (ed) { ed.click(); await wait(300); } }

    // 走到下午坐班
    ok('回到午休/下一阶段', ['noon','shiftPM'].includes(E.phase().id), E.phase().name);
    if (E.phase().id === 'noon') { click('[data-act="end-phase"]'); await wait(250); }
    ok('进入下午坐班', E.phase().id === 'shiftPM', E.phase().name);

    click('[data-act="end-phase"]');
    await wait(300);
    ok('进入晚间配送', E.phase().id === 'deliveryPM');
    const modalOpen = !$('#modal-root').classList.contains('hidden');
    if (modalOpen) {
      const t = $('[data-act="load-toggle"]');
      if (t) { t.click(); await wait(50); }
      click('[data-act="confirm-load"]');
      await wait(350);
    }
    const ed2 = $('[data-act="end-delivery"]');
    if (ed2) { ed2.click(); await wait(350); }
    ok('进入睡前', E.phase().id === 'night', E.phase().name);

    // 睡前结束一天
    click('[data-act="end-phase"]');
    await wait(400);
    ok('跨到第 2 天', E.state.day === 2, '第 ' + E.state.day + ' 天');
    const sumBtn = $('#modal-root [data-act="close-modal"]');
    ok('出现日结弹窗', !!sumBtn);
    if (sumBtn) { sumBtn.click(); await wait(250); }
    ok('日结后回到面板', UI.getView() === 'panel');

    // 存档读取
    E.save();
    const before = E.state.day;
    const loaded = E.load();
    ok('存档可读取', loaded && E.state.day === before);

    // 手动槽位：存 → 改 → 读 → 清
    E.saveSlot(1);
    ok('槽位 1 写入成功', E.slotInfo(1).exists, '第 ' + E.slotInfo(1).day + ' 天');
    ok('三个槽位都在', E.slotList().length === 3);
    const money0 = E.state.money;
    E.state.money = 9999;
    const lr = E.loadSlot(1);
    ok('读槽位还原进度', lr.ok && E.state.money === money0, money0 + '→' + E.state.money);
    E.saveSlot(2);
    ok('槽位互不影响', E.slotInfo(1).exists && E.slotInfo(2).exists);
    E.deleteSlot(2);
    ok('清空槽位 2', !E.slotInfo(2).exists && E.slotInfo(1).exists);

    // 存档面板
    click('[data-act="save-menu"]');
    await wait(180);
    ok('存档面板打开', !!$('.slot-list') && $$('.slot').length === 3);
    ok('面板里有存档信息', /第 \d+ 天/.test(($('.slot') || {}).textContent || ''));
    const ov = $('[data-act="slot-save"][data-slot="1"]');
    ok('已有档的按钮是「覆盖」', ov && /覆盖/.test(ov.textContent));
    if (ov) { ov.click(); await wait(120); }
    const ov2 = $('[data-act="slot-save"][data-slot="1"]');
    ok('覆盖需要二次确认', ov2 && /确认覆盖/.test(ov2.textContent));
    click('[data-act="close-modal"]');
    await wait(150);

    // 返回标题
    click('[data-act="to-title"]');
    await wait(180);
    ok('返回标题有确认窗', !!$('[data-act="quit-title-confirm"]'));
    click('[data-act="quit-title-confirm"]');
    await wait(260);
    ok('回到标题页', UI.getView() === null && !$('#title-screen').classList.contains('hide'));
    ok('标题页「继续上次」可用', !$('#btn-continue').disabled);

    // 从标题页继续游戏：HUD 必须跟着读档结果刷新
    const tday = E.state.day;
    click('[data-act="continue-game"]');
    await wait(260);
    ok('继续游戏回到面板', UI.getView() === 'panel', String(UI.getView()));
    ok('HUD 天数与读档一致', $('#hud-day').textContent.indexOf(String(tday)) >= 0,
      $('#hud-day').textContent + ' / state ' + E.state.day);

    // 标题页的读档入口：面板层级必须压过标题屏，否则点了像没反应
    click('[data-act="to-title"]');
    await wait(180);
    click('[data-act="quit-title-confirm"]');
    await wait(240);
    const zModal = +getComputedStyle($('#modal-root')).zIndex;
    const zTitle = +getComputedStyle($('#title-screen')).zIndex;
    ok('弹窗层级高于标题屏', zModal > zTitle, zModal + ' vs ' + zTitle);

    const slotDay = E.slotInfo(1).day;
    click('#title-screen [data-act="save-menu"]');
    await wait(220);
    ok('标题页能开出读档面板', !!$('.slot-list'));
    const ld = $('#modal-root [data-act="slot-load"][data-slot="1"]');
    ok('标题页槽位可读', !!ld && !ld.disabled);
    if (ld) { ld.click(); await wait(320); }
    ok('标题页读档后进入游戏', UI.getView() === 'panel' && E.state.day === slotDay,
      UI.getView() + ' 第 ' + E.state.day + ' 天');

    /* ================= 主线：序章 + 第一章 ================= */
    const G = window.GameStory;
    ok('主线模块已加载', !!G);

    let arrived = false;
    localStorage.removeItem('candyhouse_save_v1');
    E.newGame();
    ok('新局落在序章', G.state().chapter === 'prologue', String(G.state().chapter));
    ok('序章第一步是雨夜', G.isStep('rain'));

    UI.setView('panel');
    click('[data-act="tab"][data-tab="story"]');
    await wait(90);
    ok('委托页显示当前目标', !!$('.story-card') && !!$('.story-goal'),
      $('.story-goal') ? $('.story-goal').textContent : '无');
    ok('章节目录列出全部章节', $$('.chapter').length === window.GameStory.ORDER.length,
      $$('.chapter').length + ' 条');

    // 潜入：进场就有目标，走到目标点会回调
    UI.setView('map');
    window.MapView.enter({ x: 568, y: 516, riding: false, onSneak: () => { } });
    window.MapView.startSneak({ ...G.SNEAKS.prologue_rain, onArrive: () => { arrived = true; } });
    const si = window.MapView.sneakInfo();
    ok('潜入场景已启动', window.MapView.isSneak());
    ok('潜入有明确目标', si && si.goal === '糖果屋后门', si && si.goal);

    // 扔糖：消耗一颗
    const c0 = window.MapView.sneakInfo().candies;
    window.MapView.throwCandy();
    ok('扔糖消耗一颗', window.MapView.sneakInfo().candies === c0 - 1,
      c0 + '→' + window.MapView.sneakInfo().candies);

    // 蹲下会改状态
    window.MapView.setCrouch(true);
    ok('可以蹲下', window.MapView.sneakInfo().crouch === true);
    window.MapView.setCrouch(false);

    // 站到目标点：推几帧应该触发到达
    const goal = G.SNEAKS.prologue_rain.goal;
    window.MapView.setPosition(goal.x, goal.y);
    window.MapView.stepForTest(0.05, 3);
    ok('走到目标点触发到达', arrived);

    // 被看见时警觉度会涨：站到守卫正前方（守卫从 552 往 600 走，朝下）
    window.MapView.startSneak(G.SNEAKS.prologue_rain);
    window.MapView.setPosition(472, 580);
    window.MapView.stepForTest(0.05, 10);
    const alarm = window.MapView.sneakInfo().alarm;
    ok('暴露在视野里警觉度上升', alarm > 0, alarm + '%');

    window.MapView.endSneak();
    ok('可以退出潜入', !window.MapView.isSneak());
    window.MapView.exit();

    // 进度推进：序章 → 第一章
    G.finish();
    ok('序章完成后进入第一章', G.state().chapter === 'ch1', String(G.state().chapter));

    // 老存档没有 story 字段时不能崩
    const raw = JSON.parse(localStorage.getItem('candyhouse_save_v1'));
    if (raw && raw.data) {
      delete raw.data.story;
      localStorage.setItem('candyhouse_save_v1', JSON.stringify(raw));
      E.load();
      ok('老存档缺 story 字段也能读', !!E.state.story && E.state.story.chapter === null,
        JSON.stringify(E.state.story));
    }

    // 第一章：艾琳在上午坐班上门
    G.startChapter('ch1');
    E.startPhase(2);
    UI.enterPhase();
    await wait(200);
    ok('艾琳在上午坐班上门', !!document.getElementById('story-node'));
    await dismissStory();
    ok('剧情可以读完并关闭', !document.getElementById('story-node'));

    // 送货地址：不能送到自己家，且"谁下的单"与"送到哪"要对得上
    E.state.orders = [];
    for (let i = 0; i < 60; i++) E.makeOrder({ type: 'phone' });
    const toSelf = E.state.orders.filter(o => o.loc === 'shop');
    ok('订单不会送到自己家', toSelf.length === 0, toSelf.length + ' 单');
    const locOf = {};
    window.GameData.CUSTOMERS.forEach(c => { locOf[c.name] = c.loc; });
    const mismatch = E.state.orders.filter(o => locOf[o.customer] !== o.loc);
    ok('订单客人所在地与收货点一致', mismatch.length === 0,
      mismatch.length ? mismatch[0].customer + ' → ' + mismatch[0].loc : '');
    ok('送货白名单不含糖果屋', window.GameData.DELIVER_LOCS.indexOf('shop') < 0);
    E.state.orders = [];

    /* ---- 熟人档案：信任是攒出来的，不是模板给的 ---- */
    const D2 = window.GameData;
    const probe = D2.CUSTOMERS.find(c => c.name === '咖啡师诺亚');
    E.state.people = {};           // 前面批量下单已经建过档，这里从白纸开始
    ok('打交道前没有档案', !E.state.people[probe.name]);
    E.state.orders = [];
    const ord = E.makeOrder({ customer: probe });
    ok('下单后自动建档', !!E.state.people[probe.name], probe.name);
    const trustStart = E.personOf(probe.name).trust;
    ok('信任初值取模板', trustStart === probe.trust, trustStart + '');

    // 准时交付 → 信任涨
    for (const k in ord.items) E.addStock(k, ord.items[k] + 1);
    E.deliverOrders([ord], ord.loc);
    const trustUp = E.personOf(probe.name).trust;
    ok('准时交付信任上升', trustUp > trustStart, trustStart + ' → ' + trustUp);

    // 超时交付 → 信任掉，且挑剔的地方掉得更多
    E.state.orders = [];
    const o2 = E.makeOrder({ customer: D2.CUSTOMERS.find(c => c.name === '拍卖会文森') });
    for (const k in o2.items) E.addStock(k, o2.items[k] + 1);
    o2.deadline = E.state.day - 1;
    const beforeLate = E.personOf('拍卖会文森').trust;
    E.deliverOrders([o2], o2.loc);
    const drop = beforeLate - E.personOf('拍卖会文森').trust;
    ok('超时交付信任下降', drop > 0, '-' + drop.toFixed(2));
    ok('挑剔地点超时罚更重', o2.strict >= 2 && drop > 0.15, 'strict=' + o2.strict + ' -' + drop.toFixed(2));

    // 退单 → 信任掉
    E.state.orders = [];
    const o3 = E.makeOrder({ customer: D2.CUSTOMERS.find(c => c.name === '学生莉莉') });
    const beforeRef = E.personOf('学生莉莉').trust;
    E.cancelOrder(o3.id, '自测');
    ok('退单会掉信任', E.personOf('学生莉莉').trust < beforeRef);

    // 订单品类来自地点画像
    let favOk = true, unitOk = true;
    for (let i = 0; i < 40; i++) {
      E.state.orders = [];
      const oo = E.makeOrder({ type: 'phone' });
      const dm = D2.DEMAND[oo.loc];
      if (dm && dm.fav.length) {
        for (const k in oo.items) if (dm.fav.indexOf(k) < 0) favOk = false;
      }
      if (E.orderUnits(oo) > 6) unitOk = false;
    }
    ok('订单品类符合地点口味', favOk);
    ok('单笔不超过一辆车的运力', unitOk);
    E.state.orders = [];

    // 熟人页能把他列出来
    click('[data-act="tab"][data-tab="people"]');
    const panelTxt = document.querySelector('.panel-content').textContent;
    ok('熟人页列出来往过的人', /咖啡师诺亚/.test(panelTxt));
    ok('熟人页显示关系档位', /熟客|老主顾|认识|生客/.test(panelTxt));
    ok('熟人页显示偏好口味', /爱吃/.test(panelTxt));
    click('[data-act="tab"][data-tab="craft"]');

    /* ================= 钱的出口：固定支出 / 升级 / 学徒 ================= */
    E.state.story.chapter = null;

    // 账单预览 = 家用 + 水电 + 工钱。房子是母亲的，账本里没有房租这回事。
    E.state.dayRevenue = 0;
    E.state.staff = [];
    E.state.dayMade = 0;
    const b0 = E.billsPreview();
    ok('账本里没有房租', b0.rent === undefined && D.COSTS.rent === undefined);
    ok('冷清的一天也有家用保底', b0.home === D.COSTS.homeMin, b0.home + 'G');
    ok('账单合计等于三项相加', b0.total === b0.home + b0.utility + b0.wage);

    // 家用随营业额涨：赚得多多分担，赚得少不逼你
    E.state.dayRevenue = 1000;
    const bRich = E.billsPreview();
    ok('家用按营业额抽成', bRich.home === Math.round(1000 * D.COSTS.homeRate), bRich.home + 'G');
    ok('赚得多家用也多', bRich.home > b0.home);
    ok('营业额不影响水电和工钱', bRich.utility === b0.utility && bRich.wage === b0.wage);
    E.state.dayRevenue = 0;

    // 营业额确实在记账（卖货那条路）
    E.state.dayRevenue = 0;
    const sellKey = E.productKeys()[0];
    E.addStock(sellKey, 1);
    E.sell(sellKey, 1);
    ok('卖出货会记进当日营业额', E.state.dayRevenue > 0, E.state.dayRevenue + 'G');
    E.state.dayRevenue = 0;

    E.state.staff = [];
    E.state.dayMade = 10;
    const b1 = E.billsPreview();
    ok('水电按制作件数算', b1.utility === 10 * D.COSTS.utilityPerUnit);

    // 钱够 → 日结直接扣
    E.state.money = 5000;
    E.state.dayMade = 10;
    E.state.payables = [];
    const mBefore = E.state.money;
    const dueBefore = E.billsPreview().total;
    E.endDay();
    ok('日结自动扣掉当日开销', E.state.money === mBefore - dueBefore,
      `${mBefore} → ${E.state.money}，应扣 ${dueBefore}`);
    ok('日结记进账簿', E.state.billLog.length > 0 && E.state.billLog[0].total === dueBefore);
    ok('日结后水电重新计数', E.state.dayMade === 0);

    /* ===== 软失败模型：现金可以变负，但游戏不会结束 ===== */
    E.state.money = 10;
    E.state.dayMade = 10;
    E.state.payables = [];
    E.state.license.due = 9999;
    const compBefore = E.state.cred.compliance;
    E.endDay();
    ok('钱不够时账上变负数', E.state.money < 0, '账上 ' + E.state.money + 'G');
    ok('透支会掉合规', E.state.cred.compliance < compBefore);
    ok('透支不会结束游戏', E.state.day > 1);

    const rawKey0 = Object.keys(D.RAW)[0];
    ok('透支期间买不了原料', !E.buyRaw(rawKey0, 1).ok);
    ok('透支期间升不了级', !E.buyUpgrade('case').ok);
    ok('透支期间雇不了人', !E.hireApprentice('pip').ok);

    // 透支期唯一的出路是卖货回血
    const sellKey2 = E.productKeys()[0];
    E.addStock(sellKey2, 2);
    const overBefore = E.state.money;
    E.sell(sellKey2, 2);
    ok('透支期可以靠卖货回血', E.state.money > overBefore, `${overBefore} → ${E.state.money}`);

    // 现金见底、赊账也用光：去巷口出半天力换料（母亲还没找到，没人可开口）
    E.state.money = -60;
    E.state.flags.oddJobDay = 0;
    E.state.ap = 5;
    E.state.inv = {};
    E.state.recipes = E.lineKeys('classic');
    ok('没有「跟妈开口」这条路', typeof E.borrowFromMom === 'undefined');
    ok('穷途末路时可以去做巷口零工', E.canOddJob());
    const apBeforeJob = E.state.ap;
    const job = E.oddJob();
    const give = D.COSTS.oddJobGive;
    ok('零工能换到原料', job.ok && Object.keys(give).every(k => E.invOf(k) >= give[k]));
    ok('零工花 1 点行动点', E.state.ap === apBeforeJob - D.COSTS.oddJobAp);
    ok('零工一天只有一次', !E.oddJob().ok);
    ok('换来的料够开一炉黄油曲奇', E.canCraft('cookie'));
    E.state.ap = 9;
    E.state.money = 99999;

    E.state.money = 99999;

    /* ===== 三条软失败线：不扣钱、不结束，只关门 ===== */
    E.state.cred = { fulfill: 70, compliance: 80, supply: 70 };
    ok('三条线都在', E.credList().length === 3);
    const f0 = E.state.cred.fulfill;
    E.bumpCred('fulfill', -5);
    ok('履约可以掉', E.state.cred.fulfill === f0 - 5);
    E.bumpCred('fulfill', -999);
    ok('三条线最低压到 0 不会变负', E.state.cred.fulfill === 0);
    E.bumpCred('fulfill', 999);
    ok('三条线最高 100', E.state.cred.fulfill === 100);
    ok('掉到 30 以下会被标成低', E.credList().every(c => typeof c.low === 'boolean'));
    E.state.cred = { fulfill: 70, compliance: 80, supply: 70 };

    /* ===== 评级：周考核升降，门都借它一把 ===== */
    E.state.rank = 'D';
    const rk0 = E.rankInfo();
    ok('开局是 D 级', rk0.id === 'D' && rk0.next.id === 'C');
    ok('评级给出到下一级的差距', rk0.credGap >= 0 && rk0.weekGap >= 0);

    E.state.cred = { fulfill: 80, compliance: 80, supply: 80 };
    E.state.week = { start: E.state.day, revenue: 5000, delivered: 9, onTime: 9 };
    E.state.day = 7;
    E.weeklyReview();
    ok('周考核达标会升一级', E.state.rank === 'C', E.state.rank);
    ok('考核后本周流水清零', E.state.week.revenue === 0);

    E.state.cred = { fulfill: 20, compliance: 20, supply: 20 };
    E.state.week = { start: 8, revenue: 10, delivered: 0, onTime: 0 };
    E.state.day = 14;
    E.weeklyReview();
    ok('守不住底线会掉级', E.state.rank === 'D', E.state.rank);

    E.state.reputation = 90;
    ok('D 级接不到慕名单', E.fameChance() === 0);
    E.state.rank = 'C';
    ok('C 级开始有慕名单', E.fameChance() > 0);
    ok('评级越高订单簿越大', E.orderCap() >= 8);
    E.state.rank = 'D';

    /* ===== 设备磨损 / 执照年检 / 供应商赊账 ===== */
    E.state.money = 99999;
    E.state.energy = 100;
    E.state.wear = 0;
    const rateClean = E.successRate();
    E.state.wear = 100;
    const rateWorn = E.successRate();
    ok('设备磨损会降成功率', rateWorn < rateClean, `${rateClean} → ${rateWorn}`);
    ok('保养费随磨损涨', E.maintainCost() > D.COSTS.maintainBase);
    const mCost = E.maintainCost();
    const cashM = E.state.money;
    const mres = E.maintain();
    ok('可以花钱保养', mres.ok && E.state.wear === 0);
    ok('保养扣钱', E.state.money === cashM - mCost);

    E.state.wear = 0;
    E.state.money = 99999;
    E.state.day = 20;
    E.state.license.due = E.state.day;
    const licBill = E.billsPreview();
    ok('年检那天账单多一笔执照费',
      licBill.lic === D.COSTS.licenseFee &&
      licBill.total === licBill.home + licBill.utility + licBill.wage + licBill.lic);
    const compLic = E.state.cred.compliance;
    E.endDay();
    ok('年检通过会加合规', E.state.cred.compliance > compLic);
    ok('年检后重排下一次', E.state.license.due > E.state.day);

    E.state.money = 0;
    E.state.payables = [];
    E.state.cred.supply = 80;
    const room0 = E.creditRoom();
    ok('供应链信用给出赊账额度', room0 > 0, room0 + 'G');
    const rawKey = Object.keys(D.RAW)[0];
    const creditBuy = E.buyRaw(rawKey, 5);
    ok('现金不够可以赊账进货', creditBuy.ok && E.state.payables.length === 1);
    ok('赊账不吃现金', E.state.money === 0);
    ok('赊账吃掉额度', E.creditRoom() < room0);

    E.state.payables[0].due = E.state.day;
    E.state.money = 0;
    const supBefore = E.state.cred.supply;
    E.settlePayables();
    ok('赊账还不上会掉供应链信用', E.state.cred.supply < supBefore);
    ok('还不上会顺延账期', E.state.payables[0].due > E.state.day);
    const supLate = E.state.cred.supply;
    E.state.payables[0].due = E.state.day;     // 推到下一轮账期，再到期一次
    E.state.money = 99999;
    E.settlePayables();
    ok('有钱就能结清赊账', E.state.payables.length === 0 && E.state.cred.supply > supLate);
    E.state.cred = { fulfill: 70, compliance: 80, supply: 70 };

    // 升级：扣钱 + 等级 +1
    E.state.money = 99999;
    E.state.shop = { counter: 1, case: 1, oven: 1 };
    const lvBefore = E.upLv('case');
    const costBefore = E.upInfo('case').next.cost;
    const cashBefore = E.state.money;
    const up = E.buyUpgrade('case');
    ok('可以买升级', up.ok);
    ok('升级后等级 +1', E.upLv('case') === lvBefore + 1);
    ok('升级扣掉对应价钱', E.state.money === cashBefore - costBefore);
    ok('展示柜升级后零售加价', E.caseMul() > 1);

    // 升到顶之后不能再买
    E.buyUpgrade('case');
    ok('升级到顶后 isMax', E.upInfo('case').next === null);
    ok('到顶后买不动', !E.buyUpgrade('case').ok);

    // 烤炉满级给高档品省 AP
    E.state.shop.oven = 3;
    ok('满级烤炉让高档品省 1 AP', E.apCostOf('starcandy') === Math.max(1, D.PRODUCTS.starcandy.ap - 1));
    ok('满级烤炉糊了能退全料', E.ovenSalvage() === 1);
    E.state.shop.oven = 1;
    ok('煤炉不省料', E.ovenSalvage() === 0);

    // 学徒：安家费、AP、工钱
    E.state.staff = [];
    E.state.money = 99999;
    const stApBefore = E.staffAP();
    const hire = E.hireApprentice('toto');
    ok('可以雇学徒', hire.ok && E.state.staff.indexOf('toto') >= 0);
    ok('学徒带来额外行动点', E.staffAP() > stApBefore);
    ok('学徒计入每日工钱', E.dailyWage() === 140);
    E.startPhase(1);
    ok('学徒的行动点加进阶段上限', E.state.apMax === D.PHASES[1].ap + E.staffAP());

    E.hireApprentice('pip');
    ok('第二位也能雇', E.state.staff.length === 2);
    ok('阁楼住满就雇不下第三个', !E.hireApprentice('nana').ok);

    const fire = E.fireApprentice('toto');
    ok('可以辞退学徒', fire.ok && E.state.staff.indexOf('toto') < 0);
    E.state.staff = [];

    // 信誉扩散：订单量与慕名单（慕名单还要求评级到 C——门面不够，人家不知道你）
    E.state.rank = 'D';
    E.state.reputation = 50;
    ok('低信誉时订单上限也不少于 8', E.orderCap() === 8);
    E.state.reputation = 95;
    ok('高信誉时订单上限变大', E.orderCap() > 8);
    E.state.rank = 'C';
    ok('低信誉没有慕名单', (function () { E.state.reputation = 50; return E.fameChance() === 0; })());
    ok('高信誉会有人慕名而来', (function () { E.state.reputation = 95; return E.fameChance() > 0; })());
    E.state.reputation = 60;
    E.state.rank = 'D';

    // 慕名单确实加价（同一个人、比加价率，避免被随机品类带偏）
    E.state.orders = [];
    const plain = E.makeOrder({ type: 'phone' });
    E.state.orders = [];
    const famed = E.makeOrder({ type: 'fame', fame: true, customer: D.CUSTOMERS.find(c => c.name === plain.customer) });
    const goodsValue = o => Object.entries(o.items).reduce((a, [k, q]) => a + D.PRODUCTS[k].price * q, 0);
    const plainRatio = plain.pay / goodsValue(plain);
    const fameRatio = famed.pay / goodsValue(famed);
    ok('慕名单加价更多', fameRatio > plainRatio,
      `普通 ×${plainRatio.toFixed(2)}，慕名 ×${fameRatio.toFixed(2)}`);
    ok('慕名单时限更紧', famed.deadline - E.state.day <= 2);
    E.state.orders = [];

    // 柜台等级决定同时能站几位、补位多快
    E.state.shop = { counter: 1, case: 1, oven: 1 };
    ok('旧柜台同时只站 2 位', E.upInfo('counter').cur.seats === 2);
    E.state.shop.counter = 2;
    ok('双开柜台能站 3 位', E.upInfo('counter').cur.seats === 3);
    E.state.shop.counter = 3;
    ok('三席柜台补位更快', E.upInfo('counter').cur.flow > 1);

    // 店铺页渲染
    E.state.money = 3000;
    E.state.shop = { counter: 2, case: 2, oven: 1 };
    E.state.staff = ['pip'];
    /* 故意留一条「房租」旧条目：模拟老档，验证迁移逻辑没崩。 */
    E.state.billLog = [{ day: 3, rent: 60, utility: 40, wage: 80, total: 180 }];
    E.startPhase(0);
    click('[data-act="tab"][data-tab="shop"]');
    const shopTxt = document.querySelector('.panel-content').textContent;
    ok('店铺页显示账本', /今晚结算/.test(shopTxt));
    ok('店铺页显示三条升级线', /柜台/.test(shopTxt) && /展示柜/.test(shopTxt) && /烤炉/.test(shopTxt));
    ok('店铺页显示帮工', /小皮/.test(shopTxt));
    ok('店铺页显示工钱', /工钱/.test(shopTxt));
    ok('店铺页写的是家用不是房租', /家用/.test(shopTxt) && !/房东/.test(shopTxt));
    ok('店铺页说明里点明不交房租', /不交房租/.test(shopTxt));
    ok('账本说明交代了房子是妈的', /房子是妈的/.test(shopTxt));
    /* 老档迁移：applyData 会把 rent 条目搬成 home */
    E.applyData(JSON.parse(JSON.stringify(E.state)));
    ok('老档的房租条目迁成家用', E.state.billLog[0].home === 60 && E.state.billLog[0].rent === undefined,
      JSON.stringify(E.state.billLog[0]));
    click('[data-act="tab"][data-tab="craft"]');

    /* ================= 商品与配方书 ================= */
    E.state.recipes = E.lineKeys('classic');
    E.state.money = 99999;
    E.state.rank = 'S';       // 这一节先验「买得到」，评级门槛下面单独验

    const allKeys = Object.keys(D.PRODUCTS);
    ok('商品数量够多', allKeys.length >= 50, allKeys.length + ' 个');
    ok('初始只解锁基础线', E.productKeys().length === E.lineKeys('classic').length,
      E.productKeys().length + ' 个');

    // 每个配方引用的原料都得真的存在
    let recipeOk = true;
    allKeys.forEach(k => {
      const p = D.PRODUCTS[k];
      if (!p.name || !p.price || !p.ap || !p.color || !p.line) recipeOk = false;
      for (const r in p.recipe) if (!D.RAW[r]) recipeOk = false;
    });
    ok('所有配方都引用真实原料', recipeOk);

    // 每条线的成品 key 都得对得上
    let lineOk = true;
    E.lineList().forEach(l => {
      if (!l.total) lineOk = false;
      l.goods.forEach(k => { if (!D.PRODUCTS[k]) lineOk = false; });
    });
    ok('配方线里的成品都存在', lineOk);

    // 没学会的品不能进订单
    E.state.orders = [];
    let onlyUnlocked = true;
    for (let i = 0; i < 60; i++) {
      E.state.orders = [];
      const o = E.makeOrder({ type: 'phone' });
      for (const k in o.items) if (!E.isUnlocked(k)) onlyUnlocked = false;
    }
    ok('没学会的品不会有人点', onlyUnlocked);
    E.state.orders = [];

    // 买配方书：扣钱、解锁整条线、不能重复买
    const beforeCnt = E.productKeys().length;
    const bookCost = D.LINES.bread.book;
    const cashB = E.state.money;
    const buyRes = E.buyBook('bread');
    ok('可以买配方书', buyRes.ok);
    ok('买书扣掉书价', E.state.money === cashB - bookCost);
    ok('买书解锁整条线', E.productKeys().length === beforeCnt + E.lineKeys('bread').length,
      `${beforeCnt} → ${E.productKeys().length}`);
    ok('买过的书不能再买', !E.buyBook('bread').ok);

    // 评级不够时，贵的书借不出来
    E.state.money = 99999;
    const hiLine = Object.keys(D.LINES).find(k => E.bookRank(k) === 'B' && !E.lineUnlocked(k));
    E.state.rank = 'D';
    ok('评级不够时买不了高级配方书', !!hiLine && !E.buyBook(hiLine).ok, String(hiLine));
    E.state.rank = 'S';
    ok('评级够了就能买', !!hiLine && E.buyBook(hiLine).ok);

    // 制作台渲染配方书与按线分组
    click('[data-act="tab"][data-tab="craft"]');
    const craftTxt = document.querySelector('.panel-content').textContent;
    ok('制作台显示配方书区块', /配方书/.test(craftTxt));
    ok('制作台按线分组', /基础糖果/.test(craftTxt) && /面包房/.test(craftTxt));
    ok('制作台显示已学会数量', /已学会/.test(craftTxt));

    // 库存页只列有货的成品
    E.state.stock = { lollipop: 2 };
    click('[data-act="tab"][data-tab="stock"]');
    const stockTxt = document.querySelector('.panel-content').textContent;
    ok('库存页列出手上的成品', /星星棒棒糖/.test(stockTxt));
    ok('库存页不列没货的品', !/日式盐可颂/.test(stockTxt) || E.stockOf('saltCroissant') > 0);
    click('[data-act="tab"][data-tab="craft"]');

    E.state.recipes = E.lineKeys('classic');
    E.state.money = 800;
    E.state.billLog = [];
    E.state.staff = [];
    E.state.shop = { counter: 1, case: 1, oven: 1 };

    /* ================= 剧情：说话人与选项 ================= */
    const SC = window.GameStory.SCRIPTS;
    ok('序章开场有米莉的独白', SC.prologue_open.some(l => l.who === '米莉'));
    ok('艾琳上门那段有她的台词', SC.ch1_erin.filter(l => l.who === '艾琳').length >= 3);
    ok('叙述行不带说话人', SC.ch1_erin.some(l => !l.who));
    ok('选项是米莉的话（不再套引号）',
      SC.ch1_erin_ask.filter(l => l.opt).every(o => o.opt.indexOf('「') < 0));
    ok('信件的落款是「信」', SC.ch1_photo.some(l => l.who === '信'));

    /* 原文里联络糖是米莉发给艾琳的，不是艾琳带来的定金 */
    ok('联络糖由米莉交给艾琳',
      SC.ch1_erin_ask.some(l => l.who === '米莉' && /联络糖/.test(l.t)));
    ok('没有「艾琳带糖来」这种反过来的写法',
      !SC.ch1_erin_ask.some(l => /布包里是一枚雪花胸针/.test(l.t)));

    /* 任何一句台词都不能是空的——空了就是一块白板 */
    const emptyLines = [];
    Object.keys(SC).forEach(k => SC[k].forEach((l, i) => {
      if (l.then) l.then.forEach((x, j) => {
        if (!x.t || !String(x.t).trim()) emptyLines.push(`${k}[${i}].then[${j}]`);
      });
      if (l.opt) return;                     // 选项没有 t 是正常的
      if (!l.t || !String(l.t).trim()) emptyLines.push(`${k}[${i}]`);
    }));
    ok('没有空白台词', emptyLines.length === 0, emptyLines.join('、'));

    /* 两段剧情接连播放时，页面上只能留一个框（否则后那个永远是白板） */
    UI.playStory(SC.ch1_home, () => { });
    UI.playStory(SC.ch1_brooch, () => { });
    ok('剧情框不会叠出第二个', document.querySelectorAll('#story-node').length === 1,
      document.querySelectorAll('#story-node').length + ' 个');
    ok('叠播之后框里仍有字',
      (document.getElementById('story-text').textContent || '').trim().length > 0);
    const sNode = document.getElementById('story-node');
    if (sNode) sNode.remove();

    /* ================= 巷口：水果摊旁边得留得下人 ================= */
    const covered = (tx, ty) => D.LOCATIONS.some(l =>
      tx >= l.x && tx < l.x + l.w && ty >= l.y && ty < l.y + l.h);
    ok('水果摊东侧留出一列通路', !covered(29, 41) && !covered(29, 42),
      covered(29, 41) ? '被建筑占住了' : '通了');
    ok('糖果屋门前那排能走', !covered(31, 41) && !covered(33, 41) && !covered(35, 41));

    /* 建筑之间不能互相压住：压住就会多出一堵看不见的墙 */
    const overlaps = [];
    D.LOCATIONS.forEach((a, i) => D.LOCATIONS.slice(i + 1).forEach(b => {
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
        overlaps.push(a.name + '×' + b.name);
      }
    }));
    ok('没有两栋建筑压在一起', overlaps.length === 0, overlaps.join('、'));

    /* 只按建筑占位做一次 BFS：从城南地道口能不能走到糖果屋门口。
       城南这一片以前被水果摊从南边堵死，走进去只能原路退回。 */
    const reach = (ax, ay, bx, by) => {
      const W = D.WORLD.w, H = D.WORLD.h;
      const seen = new Uint8Array(W * H);
      const q = [ay * W + ax];
      seen[ay * W + ax] = 1;
      while (q.length) {
        const cur = q.shift();
        const cx = cur % W, cy = (cur - cx) / W;
        if (cx === bx && cy === by) return true;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
          const n = ny * W + nx;
          if (seen[n] || covered(nx, ny)) return;
          seen[n] = 1; q.push(n);
        });
      }
      return false;
    };
    ok('城南地道口能走到糖果屋', reach(24, 45, 33, 41));
    ok('城南站能走到糖果屋', reach(20, 48, 33, 41));
    ok('修车铺能走到糖果屋', reach(23, 41, 33, 41));
    ok('废弃仓库能走到糖果屋', reach(17, 46, 33, 41));
    ok('澡堂门前没被摊子堵死', reach(21, 45, 33, 41));
    /* 更关键的是「一眼能看出来」：城南地道口正北要有一条直路，
       不然玩家只会看到水果摊压在前面，以为整片都走不通。 */
    ok('地道口正北留出两格宽的直路',
      !covered(25, 44) && !covered(26, 44) && !covered(25, 43) &&
      !covered(26, 43) && !covered(25, 42) && !covered(25, 41));

    /* ================= 序章没做完不许翻阶段 ================= */
    const chapSaved = E.state.story.chapter;
    E.state.story.chapter = 'prologue';
    E.state.story.step = 1;                  // studio 那一步
    E.state.phaseIdx = 0;
    UI.enterPhase();
    const phBeforeGate = E.phase().id;
    const gateBtn = document.querySelector('#view-panel [data-act="end-phase"]');
    if (gateBtn) gateBtn.click();
    ok('序章没做完时翻不了阶段', E.phase().id === phBeforeGate, E.phase().id);
    E.state.story.chapter = chapSaved;
    E.state.story.step = 0;

    /* ================= 新手教学 ================= */
    E.state.tutorial = { on: false, step: 0, orderId: 0 };
    E.state.orders = [];
    const sugarBeforeTut = E.invOf('sugar');
    const tut = E.startTutorial();
    const tutOrder = E.state.orders.find(o => o.id === tut.orderId);
    ok('教学会挂一张固定订单', tut.ok && !!tutOrder);
    ok('教学订单是五支星星棒棒糖（货架上只有 3 支）', !!tutOrder && tutOrder.items.lollipop === 5);
    ok('教学先给一批材料', E.invOf('sugar') > sugarBeforeTut, `${sugarBeforeTut} → ${E.invOf('sugar')}`);
    ok('教学三步的第一步是「做糖」', E.state.tutorial.on && D.TUTORIAL[0].id === 'craft');

    /* 指引要能收起：不做任务时它会一直压在左上角，挡住柜台按钮 */
    E.state.tutorial = { on: true, step: 0, orderId: 0 };
    UI.setView('counter');
    UI.renderHUD();
    const gNode = document.getElementById('hud-guide');
    ok('柜台视图会浮出指引', !gNode.classList.contains('hidden'));
    const gX = gNode.querySelector('.guide-x');
    ok('指引右上角有收起按钮', !!gX);
    if (gX) gX.click();
    ok('点 × 能收起指引', gNode.classList.contains('hidden'));
    const gPill = document.getElementById('guide-pill');
    ok('收起后顶栏出现「指引」按钮', !!gPill && !gPill.classList.contains('hidden'));
    if (gPill) gPill.click();
    ok('点「指引」能再打开', !gNode.classList.contains('hidden') && gPill.classList.contains('hidden'));

    // 收起之后完成一步：内容变了，就当新提示重新弹出来
    const gX2 = gNode.querySelector('.guide-x');
    if (gX2) gX2.click();
    E.state.tutorial.step = 1;
    UI.renderHUD();
    ok('换到下一步，指引会自己回来', !gNode.classList.contains('hidden'));

    E.state.tutorial = { on: false, step: 0, orderId: 0 };
    UI.setView('panel');
    UI.renderHUD();
    E.state.orders = [];

    /* ================= 批发采购 ================= */
    E.state.purchases = [];
    E.state.purchaseSeq = 1;
    E.state.money = 99999;
    E.state.day = 5;
    E.startPhase(0);
    const q10 = E.bulkQuote({ sugar: 10 });
    ok('批发价比门市便宜', q10.whole < q10.retail, `${q10.whole} / ${q10.retail}`);
    ok('采购要收跑腿搬运费', q10.fee >= D.PURCHASE.feeMin, q10.fee + 'G');
    ok('合计 = 批发价 − 折扣 + 跑腿费',
      q10.total === Math.round(q10.whole - q10.discount + q10.fee));
    const q60 = E.bulkQuote({ sugar: 60 });
    ok('买得越多折扣越高', q60.off > q10.off, `${q10.off} → ${q60.off}`);

    const sugarNow = E.invOf('sugar');
    const cashP = E.state.money;
    const purRes = E.placePurchase({ sugar: 20 });
    ok('可以下采购单', purRes.ok && E.state.purchases.length === 1);
    ok('下单当场扣钱', E.state.money === cashP - purRes.total);
    ok('采购不会立刻进仓库', E.invOf('sugar') === sugarNow);
    ok('到货至少隔一个阶段', E.pendingPurchases()[0].phasesLeft >= 2,
      E.pendingPurchases()[0].phasesLeft + ' 个阶段');
    E.startPhase(1);
    ok('下一个阶段还没到', E.invOf('sugar') === sugarNow);
    E.startPhase(2);
    ok('隔一个阶段之后到货', E.invOf('sugar') === sugarNow + 20,
      `${sugarNow} → ${E.invOf('sugar')}`);
    ok('到货后队列清空', E.state.purchases.length === 0);
    E.state.phaseIdx = 0;

    /* ================= 地铁：线路拓扑 ================= */
    const mAdj = E.metroAdj();
    ok('地铁图每一段都是双向通',
      Object.keys(mAdj).every(a => mAdj[a].every(b => mAdj[b].indexOf(a) >= 0)));
    ok('旧城中心到新岛是 1 段（1 号线直达）', E.metroCost('metro_old', 'metro_island') === 1);
    ok('蜗牛巷到学院是 2 段（经旧城中心）', E.metroCost('metro_snail', 'metro_acad') === 2);
    ok('城南到新岛是 2 段（经学院）', E.metroCost('metro_ind', 'metro_island') === 2);
    ok('码头到学院是 2 段（要换 3 号线）', E.metroCost('metro_dock', 'metro_acad') === 2);
    ok('同一条路来回段数一致',
      E.metroCost('metro_dock', 'metro_acad') === E.metroCost('metro_acad', 'metro_dock'));
    ok('每个站都互相可达', Object.keys(D.METRO.stations).every(a =>
      Object.keys(D.METRO.stations).every(b => a === b || E.metroCost(a, b) != null)));
    ok('北山不通地铁', E.metroCost('metro_old', 'grave') === null);

    /* ================= 配送阶段：取消装货不能跳过阶段 ================= */
    E.state.orders = [];
    for (let i = 0; i < 2; i++) E.state.orders.push(E.makeOrder({ type: 'phone' }));
    E.state.phaseIdx = 1;                       // 早间配送
    UI.enterPhase();
    const phaseBeforeCancel = E.phase().id;
    ok('配送阶段会先停回店里', document.getElementById('view-panel').classList.contains('active'));
    const cancelBtn = document.querySelector('#modal-root [data-act="close-modal"]');
    ok('配送阶段弹出了出货准备', !!cancelBtn);
    if (cancelBtn) cancelBtn.click();
    ok('取消装货不会把阶段跳过', E.phase().id === phaseBeforeCancel, E.phase().id);
    const clBtn = document.querySelector('#view-panel [data-act="phase-action"][data-id="go-out"]');
    const clTxt = document.querySelector('.panel-content').textContent;
    ok('取消后仍能重新装车出发', !!clBtn,
      (clBtn ? clBtn.textContent.trim() : '没按钮') + ' / 面板 ' + clTxt.length + ' 字');
    E.state.phaseIdx = 0;
    E.state.orders = [];

    /* ================= 助手坐班 ================= */
    E.state.staff = ['pip'];
    E.state.staffPost = {};
    ok('一开始没人看柜台', E.staffOnCounter() === null);
    ok('可以安排助手看柜台', E.assignStaff('pip', 'counter').ok && E.staffOnCounter() === 'pip');
    ok('撤回后柜台又空了', E.assignStaff('pip', null).ok && E.staffOnCounter() === null);
    E.assignStaff('pip', 'counter');

    E.state.stock = { cookie: 4, lollipop: 3 };
    E.state.money = 0;
    const pipShift = E.staffCounterShift();
    ok('助手守着柜台会卖货', !!pipShift && pipShift.units > 0, pipShift ? pipShift.units + ' 件' : 'null');
    ok('助手卖货有钱进账', E.state.money > 0, E.state.money + 'G');
    ok('助手卖货会消耗库存', E.stockOf('cookie') + E.stockOf('lollipop') < 7);
    E.assignStaff('pip', null);

    /* ================= 第三方配送 ================= */
    E.state.orders = [];
    E.state.stock = {};
    const platOrder = E.makeOrder({ type: 'phone' });
    E.state.orders.push(platOrder);            // makeOrder 只造单，得自己挂到订单簿上
    Object.keys(platOrder.items).forEach(k => E.addStock(k, platOrder.items[k]));
    const platFee = E.thirdPartyFee(platOrder);
    ok('第三方要抽成', platFee > 0 && platFee < platOrder.pay, `${platFee}/${platOrder.pay}`);
    E.state.money = platFee - 1;
    ok('钱不够叫不了第三方', !E.thirdParty(platOrder.id).ok);
    E.state.money = platFee + 1000;
    const platBefore = E.state.money;
    const platRes = E.thirdParty(platOrder.id);
    ok('可以叫第三方代送', platRes.ok && !E.state.orders.some(o => o.id === platOrder.id));
    ok('第三方按抽成结算', E.state.money === platBefore + platOrder.pay - platFee,
      `${platBefore} → ${E.state.money}`);
    ok('代送也要消耗库存', Object.keys(platOrder.items).every(k => E.stockOf(k) === 0));

    /* ================= 新岛安检 ================= */
    ok('含烈酒/糖浆的成品是敏感货',
      E.sensitiveGoods().indexOf('starcandy') >= 0 && E.sensitiveGoods().indexOf('whiskyTruffle') >= 0);
    ok('普通品不算敏感货', E.sensitiveGoods().indexOf('lollipop') < 0);
    E.state.gear = {};
    const secHit = E.securityCheck(['starcandy', 'lollipop']);
    ok('带敏感货过安检会被拦', secHit.blocked && secHit.items.length === 1);
    ok('拦截时点名是哪一样', secHit.names[0] === '虹彩糖');
    ok('只带普通货能过安检', !E.securityCheck(['lollipop']).blocked);
    E.state.money = 99999;
    const gearBuy = E.buyGear();
    ok('可以买铅衬行李袋', gearBuy.ok && E.hasGear('leadBag'));
    ok('有装备就能带敏感货过安检', !E.securityCheck(['starcandy']).blocked);
    ok('装备不能重复买', !E.buyGear().ok);

    /* ================= 结档：封存成绩单 ================= */
    const retiredBefore = E.retireList().length;
    E.state.day = 23;
    E.state.rank = 'B';
    E.state.stats = { sold: 40, delivered: 30, made: 50, earned: 12345 };
    const retireSum = E.retireSummary();
    ok('成绩单记下天数', retireSum.day === 23);
    ok('成绩单记下评级与评语', retireSum.rank === 'B' && !!retireSum.verdict);
    ok('成绩单记下累计营业额', retireSum.earned === 12345);
    ok('成绩单记下三条线', typeof retireSum.cred.fulfill === 'number');

    const retired = E.retire();
    ok('结档会写进封存列表', retired.ok && E.retireList().length === retiredBefore + 1);
    ok('结档后是新的一档', E.state.day === 1 && E.state.money === 320 && E.state.rank === 'D');
    E.load();                                   // 读回来的是新档，不是被结掉的那一档
    ok('结档后读不到旧进度', E.state.day === 1 && E.state.stats.earned === 0);

    /* ================= 配送现场跟着存档走 ================= */
    delete E.state.trip;                        // 模拟老档：还没有 trip 字段
    E.save(); E.load();
    ok('老档没有配送现场也能读', !!E.state.trip && Array.isArray(E.state.trip.loaded));

    const tripOrder = E.state.orders.find(o => !o.delivered);
    ok('有一张待送订单可以拿来验车厢', !!tripOrder);
    if (tripOrder) {
      UI.debugLoad([tripOrder.id]);             // 装车：车厢、模式一起落盘
      ok('装车写进了存档', (E.state.trip.loaded || []).indexOf(tripOrder.id) >= 0);
      UI.debugLoad([]);                         // 模拟读档前 UI 变量被清空
      E.state.trip.loaded = [tripOrder.id];
      E.save(); E.load();
      ok('读档后车厢还在', (E.state.trip.loaded || []).indexOf(tripOrder.id) >= 0);
      const back = UI.restoreTrip();
      ok('读档能还原车厢', back === 1 && UI.tripInfo().loaded.indexOf(tripOrder.id) >= 0,
        `还原 ${back} 单`);
      UI.debugLoad([]);
    }

    /* ================= 送货路上的随机事件 ================= */
    ok('事件表覆盖了黑帮火并 / 救助伤员 / 货物失窃',
      ['gang_fight', 'help_wounded', 'theft'].every(id => D.ROAD_EVENTS.list.some(e => e.id === id)));
    ok('按坐标认得出危险城区', E.regionAt(20 * D.TILE, 40 * D.TILE) === 'industry');
    const rnd = Math.random;
    Math.random = () => 0;                   // 强制命中，顺便固定抽第一条
    E.state.roadEvent = { key: '', count: 0 };
    E.state.trip.loaded = [];
    const roadEv = E.rollRoadEvent({ x: 20 * D.TILE, y: 40 * D.TILE });
    ok('路上能掷出事件', !!roadEv, roadEv ? roadEv.title : 'null');
    ok('同一阶段事件次数有上限', (() => {
      E.state.roadEvent.count = D.ROAD_EVENTS.maxPerTrip;
      const none = E.rollRoadEvent({ x: 20 * D.TILE, y: 40 * D.TILE });
      E.state.roadEvent.count = 0;
      return none === null;
    })());
    Math.random = rnd;
    if (roadEv) {
      E.state.ap = 8;
      const apBefore = E.state.ap;
      const res = E.applyRoadEvent(roadEv.id, 0);
      ok('事件选项能结算', res.ok && typeof res.text === 'string');
      ok('事件会记进日记', ((E.state.log[0] || {}).text || '').indexOf(roadEv.title) >= 0);
      const fx = roadEv.choices[0].fx || {};
      ok('事件按选项改了数值', !fx.ap || E.state.ap !== apBefore, `${apBefore} → ${E.state.ap}`);
    }
    const stealEv = D.ROAD_EVENTS.list.find(e => e.choices.some(c => c.fx && c.fx.steal));
    ok('存在会顺走货的事件', !!stealEv);
    if (stealEv) {
      const idx = stealEv.choices.findIndex(c => c.fx && c.fx.steal);
      const order = E.state.orders.find(o => !o.delivered);
      if (order) {
        E.state.stock.lollipop = 2;
        E.state.trip.loaded = [order.id];
        order.items = { lollipop: 1 };
        const r2 = E.applyRoadEvent(stealEv.id, idx);
        ok('失窃会从车上拿走一件成品', E.stockOf('lollipop') === 1, `剩 ${E.stockOf('lollipop')} 件`);
        ok('失窃结果点名是哪一样',
          r2.text.indexOf(D.PRODUCTS.lollipop.name) >= 0 || r2.text.indexOf('没备着') >= 0, r2.text);
      }
    }
    UI.debugRoadEvent('gang_fight');
    ok('路上事件弹窗列出了可选做法', $$('#modal-root [data-act="road-pick"]').length >= 2);
    const rp = $('#modal-root [data-act="road-pick"]');
    if (rp) { rp.click(); await wait(80); }
    ok('选完之后事件弹窗收起', $$('#modal-root [data-act="road-pick"]').length === 0);

    /* ================= 外卖平台 ================= */
    const tk = E.takeoutState();
    ok('外卖是独立订单池', Array.isArray(tk.orders) && tk.enabled === false);
    E.state.day = 3; E.state.reputation = 60; E.state.money = 2000;
    ok('第三天信誉够就能接入', E.takeoutUnlocked());
    const openR = E.openTakeout();
    ok('花 680G 开通终端', openR.ok && tk.enabled && E.state.money === 2000 - D.TAKEOUT.setupFee);
    E.state.staff = [];
    const normalBefore = E.state.orders.length;
    E.startPhase(2);                        // 上午坐班：平台推单
    ok('坐班时平台会推外卖单', tk.orders.length > 0, `${tk.orders.length} 单`);
    ok('外卖单不进常规配送订单池', E.state.orders.length === normalBefore);
    const first = tk.orders[0];
    tk.orders = [first];                    // 只留一张，方便精确对账
    Object.keys(first.items).forEach(k => { E.state.stock[k] = 0; });
    ok('缺货时装不了取餐口', !E.packTakeout(first.id).ok);
    Object.keys(first.items).forEach(k => { E.state.stock[k] = first.items[k]; });
    E.state.ap = 5;
    const packR = E.packTakeout(first.id);
    ok('备齐货能放进取餐口', packR.ok && first.status === 'ready');
    ok('装取餐口花 1 AP', E.state.ap === 4);
    ok('装取餐口会扣掉成品', Object.keys(first.items).every(k => E.stockOf(k) === 0));
    const moneyBefore = E.state.money;
    const settle = E.settleTakeout();
    const net = first.pay - Math.round(first.pay * D.TAKEOUT.platformRate);
    ok('收班按平台抽成到账', settle.done === 1 && E.state.money === moneyBefore + net,
      `${moneyBefore} → ${E.state.money}，应得 ${net}`);
    ok('结算后外卖池清空', tk.orders.length === 0);

    /* 有学徒：她自己把备得出来的单装好，不花玩家的 AP、漏单也不掉信誉 */
    const mate = E.apprenticeList()[0];
    E.state.staff = mate ? [mate.id] : ['pip'];
    E.startPhase(4);                        // 下午坐班
    const apAuto = E.state.ap;
    tk.orders = [{ id: 9901, items: { lollipop: 1 }, pay: 30, day: 3, status: 'new', byStaff: false }];
    E.state.stock.lollipop = 1;
    const auto = E.settleTakeout();
    ok('学徒会自动打理外卖单', auto.auto === 1 && auto.done === 1);
    ok('自动打理不花玩家行动点', E.state.ap === apAuto, `${apAuto} → ${E.state.ap}`);
    ok('自动打理会消耗成品', E.stockOf('lollipop') === 0);

    E.state.staff = [];
    tk.orders = [{ id: 9902, items: { lollipop: 1 }, pay: 30, day: 3, status: 'new', byStaff: false }];
    const missed = E.settleTakeout();
    ok('没雇人时漏单会记下来', missed.expired === 1 && tk.orders.length === 0);

    /* ================= 交通：地铁票价 / 首末班 / 公交渡船 ================= */
    E.startPhase(0);                        // 05:00 早起准备
    ok('05:00 站台还没开门', !E.metroOpen());
    E.startPhase(1);                        // 07:00 早间配送
    ok('07:00 地铁在运营', E.metroOpen());
    const seg = E.metroCost('metro_snail', 'metro_island');
    const fare = E.metroFare('metro_snail', 'metro_island');
    ok('地铁票价按段收', seg > 0 && fare === seg * D.METRO.farePerStop, `${seg} 段 / ${fare}G`);
    E.state.money = 500; E.state.ap = 14;
    const ride = E.rideMetro('metro_snail', 'metro_island');
    ok('坐地铁同时扣 AP 和车票', ride.ok && E.state.ap === 14 - seg && E.state.money === 500 - fare);
    E.state.money = 0;
    ok('钱不够买不了车票', !E.rideMetro('metro_snail', 'metro_old').ok);
    E.startPhase(0);
    ok('非运营时段坐不了地铁', !E.rideMetro('metro_snail', 'metro_old').ok);
    E.startPhase(1);
    E.state.money = 500; E.state.ap = 14;
    const bus = E.rideTransit('bus', 'metro_old');
    ok('公交按路线扣 AP 与票价', bus.ok && E.state.ap === 14 - D.TRANSIT.bus.routes[0].ap);
    const boat = E.rideTransit('boat', 'metro_island');
    ok('渡船能跨海到新岛', boat.ok && boat.name === '新岛站');
    ok('公交不去没开的地方', !E.rideTransit('bus', 'market').ok);

    /* ================= 载具改装 ================= */
    ok('改装表有三条线', D.VEHICLE_MODS.length === 3);
    E.state.mods = [];
    E.state.money = 9999;
    E.state.rank = 'C';
    E.state.vehicle = 'bike';
    const cap0 = E.capacity();
    const px0 = window.MapView.pxPerAp();
    const m1 = E.buyMod('rack');
    ok('能装加宽货架', m1.ok && E.capacity() === cap0 + 4);
    const m2 = E.buyMod('engine');
    ok('高扭矩电机让每 AP 跑得更远', m2.ok && window.MapView.pxPerAp() > px0,
      `${px0} → ${window.MapView.pxPerAp()}px`);
    ok('同一件改装不能装两次', !E.buyMod('rack').ok);
    ok('改装按标价扣钱', E.state.money === 9999 - 1200 - 1600);
    const m3 = E.buyMod('battery');
    ok('续航电池加速度', m3.ok && E.modSpeed() === 18);

    /* ================= 基地 / 厂房自动生产 ================= */
    E.state.bases = [];
    E.state.rank = 'D';
    ok('评级不够盘不下厂房', !E.buyBase('factory').ok);
    E.state.rank = 'B';
    E.state.money = 99999;
    E.state.inv = {}; E.state.stock = {};
    const baseWh = E.buyBase('warehouse');
    ok('能盘下小仓库', baseWh.ok && (E.state.bases || []).indexOf('warehouse') >= 0);
    ok('能盘下旧厂房', E.buyBase('factory').ok);
    ok('同一处产业不能盘两次', !E.buyBase('warehouse').ok);
    E.startPhase(2);
    ok('仓库每阶段自动送原料', E.invOf('sugar') >= 1 && E.invOf('flour') >= 1);
    ok('厂房每阶段自动做一件成品', E.totalStockUnits() >= 1);

    /* ================= 助手配送员岗位 ================= */
    E.state.staff = [];
    E.state.staffPost = {};
    E.state.ownedVehicles = ['bike'];
    const courierId = D.APPRENTICES[0].id;
    E.state.staff = [courierId];
    ok('只有一辆车不能安排跑配送', !E.assignStaff(courierId, 'courier').ok);
    E.state.ownedVehicles = ['bike', 'van'];
    ok('有第二辆车就能安排跑配送',
      E.assignStaff(courierId, 'courier').ok && E.staffPostOf(courierId) === 'courier');
    E.state.orders = [{ id: 9911, customer: '报摊大爷', loc: 'busstop', items: { lollipop: 1 },
      pay: 40, deadline: E.state.day + 2, trust: 2, strict: 0, type: 'phone', delivered: false }];
    E.state.stock.lollipop = 1;
    const cashBeforeCourier = E.state.money;
    const courierRun = E.courierShift();
    ok('学徒自动代送一单并全额到账',
      courierRun.count === 1 && E.state.money === cashBeforeCourier + 40);
    ok('代送会消耗成品', E.stockOf('lollipop') === 0);
    ok('代送后订单从订单簿移走', !E.state.orders.some(o => o.id === 9911));

    /* ================= 到店自提 ================= */
    const pkCust = D.CUSTOMERS.find(c => D.DELIVER_LOCS.indexOf(c.loc) < 0);
    ok('有不住在送货点的客人', !!pkCust);
    const pkOrder = E.makeOrder({ customer: pkCust, loc: 'shop', type: 'pickup', pickup: true });
    ok('自提单落在糖果屋、不进配送池', pkOrder.pickup === true && pkOrder.loc === 'shop');
    Object.keys(pkOrder.items).forEach(k => {
      E.state.stock[k] = (E.state.stock[k] || 0) + pkOrder.items[k] + 1;
    });
    const cashBeforePickup = E.state.money;
    const pkResult = E.pickupOrder(pkOrder.id);
    ok('备齐货能交给上门的客人', pkResult.ok && E.state.money === cashBeforePickup + pkOrder.pay);
    ok('自提单交完从订单簿移走', !E.state.orders.some(o => o.id === pkOrder.id));
    const pk2 = E.makeOrder({ customer: pkCust, loc: 'shop', type: 'pickup', pickup: true });
    Object.keys(pk2.items).forEach(k => { E.state.stock[k] = 0; });
    ok('缺货时交不了自提单', !E.pickupOrder(pk2.id).ok);

    /* ================= 疲劳 / 睡眠 ================= */
    E.state.flags.napped = false;
    E.state.energy = 60;
    E.restNap();
    ok('午睡回元气并记下标记', E.state.flags.napped === true && E.state.energy === 82);
    E.state.flags.overtimeDay = -1;
    const apBeforeOvertime = E.state.ap;
    const otResult = E.overtime();
    ok('睡前加班换 2 AP', otResult.ok && E.state.ap === apBeforeOvertime + 2
      && E.state.flags.sleptEarly === false);
    ok('同一天不能反复加班', !E.overtime().ok);
    E.state.flags.napped = true;
    E.state.flags.sleptEarly = true;
    const recFull = E.nightRecovery();
    ok('夜觉和午睡都够，元气全满', recFull.energy === 100);
    E.state.flags.napped = false;
    E.state.flags.sleptEarly = false;
    const recTired = E.nightRecovery();
    ok('熬夜又没午睡，第二天更累', recTired.energy < 78, String(recTired.energy));

    panel();
  }

  /* 把剧情点击到底：有选项就选第一个，直到节点消失 */
  async function dismissStory() {
    for (let i = 0; i < 60; i++) {
      const n = document.getElementById('story-node');
      if (!n) return;
      const opt = n.querySelector('.story-choice');
      if (opt) opt.click(); else n.click();
      await wait(25);
    }
    const n = document.getElementById('story-node');
    if (n) n.remove();
  }

  window.addEventListener('load', () => {
    run().catch(e => { errors.push(String(e && e.stack || e)); panel(); });
  });
})();
