/* ============================================================
 *  糖果屋 · 新都蜗牛巷  —  核心引擎（状态 / 时间循环 / 行动点）
 * ============================================================ */
window.Engine = (function () {
  const D = window.GameData;
  const SAVE_KEY = 'candyhouse_save_v1';
  const SLOT_PREFIX = 'candyhouse_slot_v1_';

  const state = {
    day: 1,
    phaseIdx: 0,
    ap: 0,
    apMax: 0,
    money: 320,
    energy: 100,
    reputation: 50,
    inv: {},
    stock: {},
    orders: [],
    vehicle: 'bike',
    ownedVehicles: ['bike'],
    /* 已解锁的配方。老档是全量数组，读进来照样能用。 */
    recipes: classicKeys(),
    stats: { sold: 0, delivered: 0, made: 0, earned: 0 },
    flags: { intro: false, metro: true },
    log: [],
    orderSeq: 1,
    dayDelivered: 0,
    daySold: 0,
    /* 当日营业额：卖货 + 柜台 + 订单尾款（小费不算），家用按这个数抽成。 */
    dayRevenue: 0,
    lastSleepDay: 0,
    /* 熟人档案：名字 → { orders, done, late, refused, spent, trust, lastDay }
       懒创建——第一次跟这个人打交道时才写进来，老档没有就是空表。 */
    people: {},
    /* 店铺：三条升级线的当前等级（1 起步，最高 3）。 */
    shop: { counter: 1, case: 1, oven: 1 },
    /* 雇来的学徒：存 id 数组，具体资料查 D.APPRENTICES。 */
    staff: [],
    /* 岗位安排：id → 'counter'（看柜台）。一个人只能站一处。 */
    staffPost: {},
    /* 账本：今天做掉多少件（水电按件算）、当日营业额、最近几天的收支。
       注意没有 rent —— 房子是母亲的，只有「家用」。
       现金可以是负数：透支只拦采购，不会结束游戏。 */
    dayMade: 0,
    billsToday: { home: 0, utility: 0, wage: 0, lic: 0, total: 0 },
    billLog: [],
    /* 三条软失败线（0–100）。店不会没，但生意会没。 */
    cred: { fulfill: 70, compliance: 80, supply: 70 },
    /* 当前评级（D→S），每 7 天考一次。 */
    rank: 'D',
    /* 设备磨损 0–100：越磨越做不好，保养要花钱。 */
    wear: 0,
    /* 本周考核窗口：从第几天开始、这一周赚了多少、送了几单、几单准时。 */
    week: { start: 1, revenue: 0, delivered: 0, onTime: 0 },
    /* 执照年检：下一张到期的日子。 */
    license: { due: 28 },
    /* 赊账：向供应商欠着的货款，到期自动扣，扣不出就掉供应链信用。 */
    payables: [],
    /* 随身装备：目前只有铅衬行李袋（过新岛安检用）。 */
    gear: {},
    /* 新手教学：序章收尾后开始，走完「做糖 → 装车 → 送到」三步。 */
    tutorial: { on: false, step: 0, orderId: 0 },
    /* 批发采购：还没送到的货。{ id, items, total, due, day } */
    purchases: [],
    purchaseSeq: 1,
    /* 主线进度（由 GameStory 读写）。chapter 为 null 表示不跑主线，
       老存档读进来就是这个状态，行为和以前完全一样。 */
    story: { chapter: null, step: 0, flags: {}, done: [], items: {}, clues: [] },
    /* 这一趟配送的现场：车厢里装了哪几单、地图上是什么模式、这阶段出没出过门。
       以前这三样只在 UI 的模块变量里，读档一抹就没了——现在跟着存档走。
       地图坐标不存（一次移动一存太吵），读档统一回店里点「再出门」，AP 不白扔。 */
    trip: { loaded: [], mode: null, wentOut: false, onMap: false },
    /* 路上事件的冷却窗口：{ key: '第几天-第几阶段', count: 这一阶段已经碰上几回 } */
    roadEvent: { key: '', count: 0 },
    /* 外卖平台：独立订单池，不占常规配送的运力，也不进订单簿 */
    takeout: { enabled: false, orders: [], seq: 1, stats: { done: 0, earned: 0 }, last: null },
    /* 修车铺装过的改装 id（全车通用，跟着存档走） */
    mods: [],
    /* 已经盘下来的产业 id：仓库 / 厂房 */
    bases: [],
    /* 地下管网：探明过的出口 id、累计通行次数、最近一次动线 */
    tunnels: { seen: ['snail'], uses: 0, last: null },
    /* 深夜特殊事件：一天至多一回，key 记的是「第几天」 */
    nightEvent: { key: '', count: 0 },
    /* 当前这场战斗（进行中也跟着存档，读档能接着打）；null = 没在打 */
    battle: null,
    combat: { wins: 0, losses: 0, fled: 0 }
  };

  /* ---------------- 事件总线 ---------------- */
  const listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(f => f(state)); }

  /* ---------------- 工具 ---------------- */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rand(n) { return Math.floor(Math.random() * n); }
  function pick(arr) { return arr[rand(arr.length)]; }
  function phase() { return D.PHASES[state.phaseIdx]; }
  function isLastPhase() { return state.phaseIdx >= D.PHASES.length - 1; }

  function log(text, kind) {
    state.log.unshift({ day: state.day, phase: phase() ? phase().name : '', text, kind: kind || 'info' });
    if (state.log.length > 120) state.log.pop();
  }

  /* ---------------- 库存 ---------------- */
  function invOf(key) { return state.inv[key] || 0; }
  function stockOf(key) { return state.stock[key] || 0; }
  function addInv(key, n) { state.inv[key] = Math.max(0, invOf(key) + n); }
  function addStock(key, n) { state.stock[key] = Math.max(0, stockOf(key) + n); }

  function totalStockUnits() {
    return Object.values(state.stock).reduce((a, b) => a + b, 0);
  }

  /* ---------------- 新游戏 ---------------- */
  function newGame() {
    state.day = 1;
    state.phaseIdx = 0;
    state.money = 320;
    state.energy = 100;
    state.reputation = 50;
    state.inv = { sugar: 14, flour: 10, salt: 6, butter: 6, cream: 4, milk: 5, cocoa: 4, fruit: 6, honey: 2, nuts: 2, syrup: 1 };
    state.stock = { lollipop: 3, cookie: 2 };
    state.orders = [];
    state.vehicle = 'bike';
    state.ownedVehicles = ['bike'];
    state.recipes = classicKeys();
    state.stats = { sold: 0, delivered: 0, made: 0, earned: 0 };
    state.flags = { intro: false, metro: true };
    state.log = [];
    state.orderSeq = 1;
    state.dayDelivered = 0;
    state.daySold = 0;
    state.dayRevenue = 0;
    state.lastSleepDay = 0;
    state.people = {};
    state.shop = { counter: 1, case: 1, oven: 1 };
    state.staff = [];
    state.staffPost = {};
    state.dayMade = 0;
    state.billsToday = { home: 0, utility: 0, wage: 0, lic: 0, total: 0 };
    state.billLog = [];
    state.cred = { fulfill: D.CRED.start.fulfill, compliance: D.CRED.start.compliance, supply: D.CRED.start.supply };
    state.rank = 'D';
    state.wear = 0;
    state.week = { start: 1, revenue: 0, delivered: 0, onTime: 0 };
    state.license = { due: D.COSTS.licenseEvery };
    state.payables = [];
    state.gear = {};
    state.tutorial = { on: false, step: 0, orderId: 0 };
    state.purchases = [];
    state.purchaseSeq = 1;
    state.story = { chapter: 'prologue', step: 0, flags: {}, done: [], items: {}, clues: [] };
    state.trip = { loaded: [], mode: null, wentOut: false, onMap: false };
    state.roadEvent = { key: '', count: 0 };
    state.takeout = { enabled: false, orders: [], seq: 1, stats: { done: 0, earned: 0 }, last: null };
    state.mods = [];
    state.bases = [];
    state.tunnels = { seen: ['snail'], uses: 0, last: null };
    state.nightEvent = { key: '', count: 0 };
    state.battle = null;
    state.combat = { wins: 0, losses: 0, fled: 0 };
    log('清晨五点。糖果屋的灯亮起来了。', 'good');
    generatePhoneOrders(2);
    startPhase(0);
    save();
  }

  /* ---------------- 阶段 ---------------- */
  /* 学徒带来的额外行动点：每个阶段都会多给一点。
   * 这是「花钱买时间」的主要出口——日薪换每天多出来的行动点。 */
  function staffAP() {
    return state.staff.reduce((a, id) => {
      const t = D.APPRENTICES.find(x => x.id === id);
      return a + (t ? t.ap : 0);
    }, 0);
  }

  function startPhase(idx) {
    state.phaseIdx = idx;
    baseProduce();              // 仓库/厂房每个阶段自动产出
    arrivePurchases();          // 批发商的货可能在换阶段时到
    const p = D.PHASES[idx];
    state.apMax = p.ap + staffAP();
    state.ap = state.apMax;
    if (p.kind === 'map' || p.kind === 'delivery') {
      // 配送阶段的行动点在步行/骑行中按距离消耗
    }
    if (p.kind === 'counter') rollTakeoutOrders();   // 坐班时平台推外卖单
    emit();
  }

  function spendAP(n) {
    if (state.ap < n) return false;
    state.ap -= n;
    emit();
    return true;
  }

  function gainAP(n) {
    state.ap = Math.min(state.apMax, state.ap + n);
    emit();
  }

  /* 结束当前阶段 → 下一阶段 / 跨天 */
  function endPhase() {
    const p = phase();
    settleTakeout();          // 收班：骑手取餐、平台抽成、没赶上的单子作数
    if (p && p.kind === 'map') courierShift();   // 配送员替你跑掉一单
    // 阶段结束的元气消耗
    if (p.kind === 'map') state.energy = clamp(state.energy - 8, 0, 100);
    else if (p.kind === 'counter') state.energy = clamp(state.energy - 5, 0, 100);

    if (isLastPhase()) {
      endDay();
      return;
    }
    startPhase(state.phaseIdx + 1);
    const np = phase();
    log(`进入 ${np.name}（${np.span}）`, 'phase');
    save();
  }

  function endDay() {
    // 打烊结算
    const unsold = totalStockUnits();
    // 过期订单
    const expired = state.orders.filter(o => o.deadline < state.day + 1);
    expired.forEach(o => {
      state.reputation = clamp(state.reputation - 2, 0, 100);
      bumpCred('fulfill', -D.CRED.expireHit);
      log(`订单 #${o.id} 超过交付期限，${o.customer} 很不高兴。信誉 -2`, 'bad');
    });
    state.orders = state.orders.filter(o => o.deadline >= state.day + 1);

    /* 每日固定开销：家用 + 水电 + 工钱，年检那天再加一笔执照费。
       房子是母亲的，没有房租。**钱不够不会结束游戏**——账上直接变负数，
       负数期间买不了原料、升不了级、雇不了人、也赊不了账，只能卖货回血。 */
    const bill = billsPreview();
    state.billsToday = bill;
    const cashBefore = state.money;
    const couldPay = cashBefore >= bill.total;
    state.money -= bill.total;
    if (couldPay) {
      log(`按家规交了家用 ${bill.home}G、水电 ${bill.utility}G、工钱 ${bill.wage}G`
        + `${bill.lic ? `、执照年检 ${bill.lic}G` : ''}，共 -${bill.total}G`, 'info');
    } else {
      bumpCred('compliance', -D.COSTS.overdrawHit);
      log(`账上不够（账单 ${bill.total}G，手上 ${cashBefore}G），透支 ${bill.total - cashBefore}G。透支期间只能卖货回血。`, 'bad');
    }
    state.billLog.unshift({ day: state.day, ...bill });
    if (state.billLog.length > 10) state.billLog.length = 10;
    state.dayMade = 0;

    /* 执照年检：交得出钱就算通过，交不出就挂「待检」——不关门，只是掉合规。 */
    if (licenseDue()) {
      if (couldPay) {
        bumpCred('compliance', 4);
        state.license.due = state.day + D.COSTS.licenseEvery;
        log(`执照年检通过（含在账单里），经营合规 +4。下次 ${state.license.due} 号。`, 'good');
      } else {
        bumpCred('compliance', -15);
        state.license.due = state.day + D.COSTS.licenseRetry;
        log(`年检费凑不出来，执照挂上「待检」。合规 -15，${D.COSTS.licenseRetry} 天后补检。`, 'bad');
      }
    }

    /* 供应商赊账到期 */
    settlePayables();

    /* 三条线每天自然回一点（只回到初始值，不白嫖） */
    CRED_KEYS.forEach(k => {
      if (credVal(k) < D.CRED.start[k]) bumpCred(k, D.CRED.recover);
    });

    /* 周考核：每七天一次，决定评级升降 */
    if (state.day % 7 === 0) weeklyReview();

    // 睡眠恢复：夜间 + 午睡缺一样，第二天都缓不过来
    nightRecovery();

    state.day += 1;
    state.dayDelivered = 0;
    state.daySold = 0;
    state.dayRevenue = 0;

    // 新一天电话订单（数量随信誉涨）
    generatePhoneOrders(phoneOrderCount());

    // 学徒开工前先干一点
    staffMorningShift();

    log(`—— 第 ${state.day} 天 ——`, 'phase');
    startPhase(0);
    save();
  }

  /* ---------------- 配方线 ----------------
   * 成品按「线」组织，一条线对应一本配方书。classic 是母亲留下的那几页，开局就有。
   * 没解锁的品不会出现在制作台，也不会有人点——否则六十多个方子一开局全摊开，
   * 玩家既做不过来也记不住。
   */
  function classicKeys() {
    return Object.keys(D.PRODUCTS).filter(k => (D.PRODUCTS[k].line || 'classic') === 'classic');
  }
  function isUnlocked(key) {
    const p = D.PRODUCTS[key];
    if (!p) return false;
    if ((p.line || 'classic') === 'classic') return true;
    return state.recipes.indexOf(key) >= 0;
  }
  /* 已解锁的成品 key：订单、顾客点单、制作台都用这个池子 */
  function productKeys() { return Object.keys(D.PRODUCTS).filter(isUnlocked); }
  function lineKeys(line) {
    return Object.keys(D.PRODUCTS).filter(k => (D.PRODUCTS[k].line || 'classic') === line);
  }
  function lineUnlocked(line) {
    if (line === 'classic') return true;
    return lineKeys(line).every(k => isUnlocked(k));
  }
  function lineList() {
    return Object.keys(D.LINES).map(id => {
      const L = D.LINES[id];
      const ks = lineKeys(id);
      return {
        id, name: L.name, book: L.book, desc: L.desc,
        total: ks.length,
        owned: ks.filter(k => isUnlocked(k)).length,
        unlocked: lineUnlocked(id),
        goods: ks
      };
    });
  }
  /* 一本配方书值多少「脸面」：贵书不是有钱就能拿到，还得评级够。 */
  function bookRank(line) {
    const b = (D.LINES[line] || {}).book || 0;
    if (b >= 1200) return 'B';
    if (b >= 800) return 'C';
    return 'D';
  }

  function buyBook(line) {
    const L = D.LINES[line];
    if (!L) return { ok: false, msg: '没有这本配方书。' };
    if (lineUnlocked(line)) return { ok: false, msg: '这本你早就会了。' };
    /* 越贵的书越「不是谁都能买」——这是评级的第一道门。 */
    const need = bookRank(line);
    if (!rankAtLeast(need)) {
      return { ok: false, msg: `这本要 ${need} 级才借得到（现在是 ${state.rank} 级）。` };
    }
    if (state.money < L.book) return { ok: false, msg: `还差 ${L.book - state.money}G。` };
    state.money -= L.book;
    const ks = lineKeys(line);
    ks.forEach(k => { if (state.recipes.indexOf(k) < 0) state.recipes.push(k); });
    log(`买下《${L.name}》配方书（-${L.book}G），多了 ${ks.length} 个方子。`, 'good');
    emit(); save();
    return { ok: true, msg: `学会《${L.name}》：${ks.length} 个方子` };
  }

  /* ---------------- 订单 ---------------- */

  /* ---------------- 熟人档案 ----------------
   * 每个 NPC 在存档里占一行，第一次打交道时才建。信任不再读模板常数，
   * 而是这一行里累积出来的数——所以第 30 天的奥托和第 1 天的不是同一个人。
   */
  const TRUST_MIN = 0, TRUST_MAX = 5;

  function tmplOf(name) {
    return D.CUSTOMERS.find(c => c.name === name) || null;
  }

  function personOf(name) {
    let p = state.people[name];
    if (!p) {
      const t = tmplOf(name);
      p = state.people[name] = {
        name,
        orders: 0,     // 下过多少单
        done: 0,       // 准时或按期交付
        late: 0,       // 超时交付
        refused: 0,    // 被婉拒 / 退单
        spent: 0,      // 累计在你这儿花了多少
        tips: 0,       // 累计给过多少小费
        trust: t ? (t.trust || 2) : 2,
        lastDay: 0
      };
    }
    // 老档里可能有缺字段的行，补齐
    if (typeof p.orders !== 'number') p.orders = 0;
    if (typeof p.done !== 'number') p.done = 0;
    if (typeof p.late !== 'number') p.late = 0;
    if (typeof p.refused !== 'number') p.refused = 0;
    if (typeof p.spent !== 'number') p.spent = 0;
    if (typeof p.tips !== 'number') p.tips = 0;
    if (typeof p.trust !== 'number') { const t = tmplOf(name); p.trust = t ? (t.trust || 2) : 2; }
    if (typeof p.lastDay !== 'number') p.lastDay = 0;
    return p;
  }

  function bumpTrust(name, d) {
    const p = personOf(name);
    p.trust = clamp(p.trust + d, TRUST_MIN, TRUST_MAX);
    return p.trust;
  }

  /* 关系档位：熟人页上直接显示，也用来决定给不给小费加成 */
  function trustTier(trust) {
    if (trust >= 4.2) return { key: 'old', name: '老主顾', color: '#ffd257' };
    if (trust >= 3.0) return { key: 'regular', name: '熟客', color: '#ff9ec4' };
    if (trust >= 1.8) return { key: 'known', name: '认识', color: '#a99ab5' };
    return { key: 'new', name: '生客', color: '#7d7689' };
  }

  /* 熟人列表：按信任从高到低，只列打过交道的 */
  function peopleList() {
    return Object.keys(state.people)
      .map(n => {
        const p = personOf(n);
        const t = tmplOf(n);
        return {
          name: n,
          tag: t ? t.tag : '',
          fav: (t && t.fav) || [],
          loc: t ? t.loc : '',
          orders: p.orders, done: p.done, late: p.late, refused: p.refused,
          spent: p.spent, tips: p.tips, trust: p.trust, lastDay: p.lastDay,
          tier: trustTier(p.trust)
        };
      })
      .sort((a, b) => b.trust - a.trust || b.spent - a.spent);
  }

  function makeOrder(opts) {
    let cust = opts.customer || pick(D.CUSTOMERS);
    /* 自提单固定落在糖果屋；普通单的目的地必须在送货白名单里
       （住店里的玛德琳太太原本走柜台，现在她的自提单也走柜台）。 */
    let loc = opts.loc || cust.loc;
    if (opts.pickup) {
      loc = 'shop';
    } else if (D.DELIVER_LOCS.indexOf(loc) < 0) {
      cust = pick(phoneCustomers());
      loc = cust.loc;
    }

    const p = personOf(cust.name);
    p.orders++;
    p.lastDay = state.day;

    /* 地点画像：这片地方要什么品类、一次买多少，全看这里。
       fav 里可能有你还没学会的方子，先过一遍解锁状态——
       客人不会点你做不出来的东西。全被筛掉就退回到你现有的品类。 */
    const dm = D.DEMAND[loc] || { fav: [], ticket: 1, strict: 0 };
    let favPool = (dm.fav && dm.fav.length) ? dm.fav.filter(k => D.PRODUCTS[k] && isUnlocked(k)) : [];
    if (!favPool.length) favPool = productKeys();
    const ticket = typeof dm.ticket === 'number' ? dm.ticket : 1;

    /* 信任高的人会越买越多：多品类概率从 40% 往上抬，上限 75% */
    const extraChance = Math.min(0.75, 0.4 + Math.max(0, p.trust - 1.5) * 0.1);
    const nKinds = 1 + (Math.random() < extraChance ? 1 : 0);

    const items = {};
    for (let i = 0; i < nKinds; i++) {
      const k = pick(favPool);
      const pr = D.PRODUCTS[k].price;
      let q = pr >= 88 ? 1 + rand(2) : (pr >= 60 ? 1 + rand(2) : 1 + rand(3));
      q = Math.max(1, Math.round(q * ticket));
      items[k] = (items[k] || 0) + q;
    }

    /* 单笔不能超过一辆车的运力（旧摩托 6 单位），否则新玩家第一天就送不动。
       多了就往下削，先削数量再删品类。 */
    const unitCap = 6;
    let units = Object.values(items).reduce((a, b) => a + b, 0);
    while (units > unitCap) {
      const keys = Object.keys(items);
      const k = pick(keys);
      if (items[k] > 1) { items[k]--; units--; }
      else if (keys.length > 1) { delete items[k]; units--; }
      else break;
    }

    let value = 0;
    for (const k in items) value += D.PRODUCTS[k].price * items[k];

    const trust = p.trust;
    /* 慕名而来的单：价高、时限紧，是信誉攒出来的回报。 */
    const fame = !!opts.fame;
    let pay = Math.round(value * (1.15 + trust * 0.03) + 12);
    if (fame) pay = Math.round(pay * 1.45);
    const deadline = state.day + (fame ? 2 : (opts.long ? 5 + rand(3) : 1 + rand(3)));
    const o = {
      id: state.orderSeq++,
      customer: cust.name,
      loc,
      items,
      pay,
      deadline,
      trust,
      strict: dm.strict || 0,
      type: opts.type || (fame ? 'fame' : 'phone'),
      pickup: !!opts.pickup,
      fame,
      createdDay: state.day,
      delivered: false
    };
    state.orders.push(o);
    return o;
  }

  /* 能接电话订单的客人：得住在一个真的能收货的地方（住店里的玛德琳太太走柜台） */
  function phoneCustomers() {
    return D.CUSTOMERS.filter(c => D.DELIVER_LOCS.indexOf(c.loc) >= 0);
  }

  /* 一天来几笔电话单：看信誉。口碑好，电话就多——
   * 这是信誉从「价格系数」升级成「获客能力」的地方。 */
  function phoneOrderCount() {
    const rep = state.reputation;
    let n = 2;
    if (rep >= 58) n = 3;
    if (rep >= 72) n = 4;
    if (rep >= 86) n = 5;
    return n + (Math.random() < 0.35 ? 1 : 0);
  }

  /* 慕名单的概率：信誉 62 起步，最高 45%。
     —— 但门面不够，人家根本不知道你：评级不到 C，慕名单一律不出现。 */
  function fameChance() {
    if (!rankAtLeast('C')) return 0;
    const rep = state.reputation;
    if (rep < 62) return 0;
    return Math.min(0.45, (rep - 62) / 70);
  }

  /* 订单簿能挂多少笔：信誉越高、评级越高，越多人等着你。 */
  function orderCap() {
    return clamp(8 + Math.floor((state.reputation - 50) / 10) + rankIndex(state.rank), 8, 16);
  }

  function generatePhoneOrders(n) {
    const cap = orderCap();
    if (state.orders.length >= cap) return;
    let famous = 0;
    for (let i = 0; i < n; i++) {
      if (state.orders.length >= cap) break;
      /* 一部分客人不住在送货点：他们打电话预订，然后自己上门拿。
         自提单不进配送池，做出来放柜台就行。 */
      if (Math.random() < D.PICKUP.chance) {
        const inHouse = D.CUSTOMERS.filter(c => D.DELIVER_LOCS.indexOf(c.loc) < 0);
        if (inHouse.length) {
          makeOrder({ customer: pick(inHouse), loc: 'shop', type: 'pickup', pickup: true });
          continue;
        }
      }
      // 先挑人再定地址：谁下的单就送到谁那儿，名字和地点不会对不上
      const cust = pick(phoneCustomers());
      const isFame = famous === 0 && Math.random() < fameChance();
      if (isFame) famous++;
      makeOrder({ loc: cust.loc, customer: cust, type: isFame ? 'fame' : 'phone', fame: isFame });
    }
    log(`电话响了几次，记下了几笔新订单。`, 'info');
    if (famous) log(`有人是专程打听到你的：一笔慕名而来的单子，价开得比平常高。`, 'good');
  }

  function orderUnits(o) {
    return Object.values(o.items).reduce((a, b) => a + b, 0);
  }

  /* ---------------- 载具改装 ----------------
   * 装上就对所有自有载具生效：货架加运力、电机省行动点、电池加速度。
   * map.js 从 modApMul / modSpeed 读加成，不自己翻 state。 */
  function modsOwned() { return Array.isArray(state.mods) ? state.mods : []; }
  function modBonus(key) {
    return D.VEHICLE_MODS.reduce((a, m) =>
      a + (modsOwned().indexOf(m.id) >= 0 ? ((m.effect || {})[key] || 0) : 0), 0);
  }
  function modApMul() { return modBonus('apMul'); }
  function modSpeed() { return modBonus('speed'); }
  function buyMod(id) {
    const m = D.VEHICLE_MODS.find(x => x.id === id);
    if (!m) return { ok: false, msg: '娜娜没听过这个改装。' };
    if (modsOwned().indexOf(id) >= 0) return { ok: false, msg: '已经装过了。' };
    if (m.rank && !rankAtLeast(m.rank)) {
      return { ok: false, msg: `要 ${m.rank} 级才接这活（现在是 ${state.rank} 级）。` };
    }
    if (state.money < m.price) return { ok: false, msg: '钱不够。' };
    state.money -= m.price;
    state.mods.push(id);
    log(`修车铺给车装了${m.name}（-${m.price}G）。`, 'good');
    emit(); save();
    return { ok: true, msg: `${m.name}装好了。` };
  }

  function capacity() {
    return D.VEHICLES[state.vehicle].cap + modBonus('cap');
  }

  /* ---------------- 基地 / 厂房 ----------------
   * 用钱换「不用自己动手的产量」：仓库送原料、厂房产成品，按阶段结算。 */
  function basesOwned() { return Array.isArray(state.bases) ? state.bases : []; }
  function buyBase(id) {
    const b = D.BASES[id];
    if (!b) return { ok: false, msg: '没这处产业。' };
    if (basesOwned().indexOf(id) >= 0) return { ok: false, msg: '已经盘下来了。' };
    if (b.rank && !rankAtLeast(b.rank)) {
      return { ok: false, msg: `要 ${b.rank} 级才谈得下来（现在是 ${state.rank} 级）。` };
    }
    if (state.money < b.price) return { ok: false, msg: '钱不够。' };
    state.money -= b.price;
    state.bases.push(id);
    log(`盘下了${b.name}（-${b.price}G）。以后每个阶段它自己会动。`, 'good');
    emit(); save();
    return { ok: true, msg: `${b.name}到手，下一阶段开始产出。` };
  }
  function baseProduce() {
    if (!basesOwned().length) return { raw: 0, made: 0 };
    let raw = 0, made = 0;
    if (basesOwned().indexOf('warehouse') >= 0) {
      const g = D.BASES.warehouse.give || {};
      Object.keys(g).forEach(k => { addInv(k, g[k]); raw += g[k]; });
    }
    if (basesOwned().indexOf('factory') >= 0) {
      const keys = productKeys();
      if (keys.length) {
        made = D.BASES.factory.units || 1;
        addStock(pick(keys), made);
      }
    }
    /* 每个阶段都产，但只在早晨写一条日志，免得日记被刷屏 */
    if (state.phaseIdx === 0 && (raw || made)) {
      log(`自动线开工：仓库送 ${raw} 份原料、厂房做 ${made} 件成品。`, 'good');
    }
    return { raw, made };
  }

  /* 车辆升级 */
  function buyVehicle(key) {
    const v = D.VEHICLES[key];
    if (state.ownedVehicles.includes(key)) return { ok: false, msg: '已经拥有了。' };
    if (v.rank && !rankAtLeast(v.rank)) {
      return { ok: false, msg: `${v.name}要 ${v.rank} 级才卖给你（现在是 ${state.rank} 级）。` };
    }
    if (state.money < v.price) return { ok: false, msg: '钱不够。' };
    state.money -= v.price;
    state.ownedVehicles.push(key);
    state.vehicle = key;
    log(`买下了${v.name}。`, 'good');
    emit(); save();
    return { ok: true, msg: `新车到手：${v.name}` };
  }

  function selectVehicle(key) {
    if (!state.ownedVehicles.includes(key)) return false;
    state.vehicle = key;
    emit(); save();
    return true;
  }

  /* ---------------- 店铺升级 ---------------- */
  function buyUpgrade(key) {
    const info = upInfo(key);
    if (!info.next) return { ok: false, msg: `${info.name}已经到顶了。` };
    const cost = info.next.cost;
    if (state.money < cost) return { ok: false, msg: `还差 ${cost - state.money}G。` };
    state.money -= cost;
    if (!state.shop) state.shop = { counter: 1, case: 1, oven: 1 };
    state.shop[key] = info.lv + 1;
    log(`店铺升级：${info.name} → ${info.next.label}（${info.next.effect}，-${cost}G）`, 'good');
    emit(); save();
    return { ok: true, msg: `${info.next.label}：${info.next.effect}` };
  }

  /* ---------------- 学徒 ---------------- */
  const STAFF_MAX = 2;

  /* 剧情带来的帮工：第四章之前不出现在店铺页，也不让提前雇。
     标记写在 state.story.flags 里（由 GameStory.setFlag 落盘）——
     engine 只认这份状态，不去反向依赖剧情模块。 */
  function apprenticeUnlocked(idOrObj) {
    const t = typeof idOrObj === 'string'
      ? D.APPRENTICES.find(x => x.id === idOrObj) : idOrObj;
    if (!t) return false;
    if (!t.storyOnly) return true;
    const s = state.story;
    return !!(s && s.flags && s.flags.yuanJoined);
  }

  /* 剧情节点把人直接带进店：解锁 + 有空位就自动上工，不收安家费。
     阁楼满了也不硬塞，只解锁，让玩家腾出空位后自己到店铺页请他。 */
  function joinStoryApprentice(id) {
    const t = D.APPRENTICES.find(x => x.id === id);
    if (!t) return { ok: false, msg: '没有这个人。' };
    if (!state.story) state.story = { chapter: null, step: 0, flags: {}, done: [], items: {}, clues: [] };
    if (!state.story.flags) state.story.flags = {};
    state.story.flags.yuanJoined = 1;
    if (state.staff.indexOf(id) < 0 && state.staff.length < STAFF_MAX) {
      state.staff.push(id);
      log(`${t.name}回糖果屋上工了。每阶段 +${t.ap} AP，每天工钱 ${t.wage}G。`, 'good');
      emit(); save();
      return { ok: true, hired: true, msg: `${t.name}回店里帮忙了` };
    }
    emit(); save();
    return {
      ok: true, hired: false,
      msg: state.staff.indexOf(id) >= 0 ? `${t.name}已经在店里了`
        : `阁楼住满了，${t.name}先记在帮工名单上，腾出空位再到店铺页请他`
    };
  }

  function apprenticeList() {
    return D.APPRENTICES.filter(t => apprenticeUnlocked(t)).map(t => ({
      id: t.id, name: t.name, tag: t.tag, wage: t.wage, hire: t.hire,
      ap: t.ap, desc: t.desc, craft: t.craft.slice(),
      hired: state.staff.indexOf(t.id) >= 0,
      roomLeft: state.staff.length < STAFF_MAX,
      storyOnly: !!t.storyOnly
    }));
  }

  function hireApprentice(id) {
    const t = D.APPRENTICES.find(x => x.id === id);
    if (!t) return { ok: false, msg: '没有这个人。' };
    if (!apprenticeUnlocked(t)) return { ok: false, msg: '时候还没到。' };
    if (state.staff.indexOf(id) >= 0) return { ok: false, msg: `${t.name}已经在店里了。` };
    if (state.staff.length >= STAFF_MAX) return { ok: false, msg: '阁楼只住得下两个人。' };
    if (state.money < t.hire) return { ok: false, msg: `安家费还差 ${t.hire - state.money}G。` };
    state.money -= t.hire;
    state.staff.push(id);
    log(`雇了${t.name}（${t.tag}）。安家费 -${t.hire}G，每天工钱 ${t.wage}G。`, 'good');
    emit(); save();
    return { ok: true, msg: `${t.name}明天上工` };
  }

  function fireApprentice(id) {
    const t = D.APPRENTICES.find(x => x.id === id);
    if (!t || state.staff.indexOf(id) < 0) return { ok: false, msg: '店里没有这个人。' };
    state.staff = state.staff.filter(x => x !== id);
    if (state.staffPost) state.staffPost[id] = null;
    state.reputation = clamp(state.reputation - 1, 0, 100);
    log(`${t.name}收拾东西走了。信誉 -1`, 'bad');
    emit(); save();
    return { ok: true, msg: `${t.name}走了` };
  }

  /* ---------------- 岗位安排 ----------------
   * 柜台：把学徒留在店里，米莉坐班时间能出门；她招呼得便宜，也记不住熟客。
   * 配送：得有一辆空闲车（除米莉的摩托外），配送阶段替你送一单，没有小费。
   * 一个人只能站一个岗位，但柜台和配送可以同时有人。 */
  function staffOnCounter() {
    const post = state.staffPost || {};
    for (const id of state.staff) if (post[id] === 'counter') return id;
    return null;
  }
  function staffPostOf(id) {
    return (state.staffPost || {})[id] || null;
  }
  function assignStaff(id, post) {
    if (state.staff.indexOf(id) < 0) return { ok: false, msg: '店里没这个人。' };
    const t = D.APPRENTICES.find(x => x.id === id);
    if (!state.staffPost) state.staffPost = {};
    if (post === 'counter' || post === 'courier') {
      if (post === 'courier' && (state.ownedVehicles || []).length < 2) {
        return { ok: false, msg: '得先买第二辆车给她跑配送——摩托你还自己骑着。' };
      }
      if (post === 'counter') {
        // 柜台只能站一个人，但别把别人已经排好的配送岗位一起清掉
        state.staff.forEach(x => { if (state.staffPost[x] === 'counter') state.staffPost[x] = null; });
      }
      state.staffPost[id] = post;
      log(post === 'counter'
        ? `${t.name}调到柜台，以后你不在店里也有人招呼客人。`
        : `${t.name}开着车去跑配送，配送阶段会替你送一单。`, 'good');
    } else {
      state.staffPost[id] = null;
      log(`${t.name}回后场干活了。`, 'info');
    }
    emit(); save();
    return { ok: true, msg: post === 'counter' ? `${t.name}今天看柜台`
      : post === 'courier' ? `${t.name}今天跑配送` : `${t.name}回后场` };
  }

  /* 玩家不在的那一班：助手自己把柜台撑起来。
     卖得比米莉便宜（×0.9）、不涨熟人信任，但钱是真进来了。 */
  function staffCounterShift() {
    const id = staffOnCounter();
    if (!id) return null;
    const t = D.APPRENTICES.find(x => x.id === id);
    const cap = Math.max(2, (t.ap || 1) * 2 + 2);
    let units = 0, income = 0;
    const keys = productKeys()
      .filter(k => stockOf(k) > 0)
      .sort((a, b) => D.PRODUCTS[b].price - D.PRODUCTS[a].price);
    for (const k of keys) {
      if (units >= cap) break;
      const take = Math.min(stockOf(k), cap - units);
      if (take <= 0) continue;
      addStock(k, -take);
      const price = Math.round(D.PRODUCTS[k].price * 0.9 * caseMul());
      units += take;
      income += price * take;
    }
    if (!units) {
      log(`${t.name}在柜台站了一整个班，货架空着，只能一直跟客人道歉。`, 'bad');
      state.reputation = clamp(state.reputation - 0.5, 0, 100);
      emit(); save();
      return { who: t.name, units: 0, income: 0 };
    }
    state.money += income;
    state.stats.sold += units;
    state.stats.earned += income;
    state.daySold += income;
    state.dayRevenue += income;
    if (state.week) state.week.revenue += income;
    state.reputation = clamp(state.reputation + 0.4, 0, 100);
    log(`你不在店里，${t.name}招呼了 ${units} 件，柜上收了 ${income}G。`, 'good');
    emit(); save();
    return { who: t.name, units, income };
  }

  /* 配送员岗位：每个配送阶段，每位学徒替你送掉一单。
     和第三方平台的区别是——她是你的人，不抽成，但也没有小费（客人只记得糖好吃）。 */
  function staffCouriers() {
    const post = state.staffPost || {};
    return state.staff.filter(id => post[id] === 'courier');
  }
  function courierShift() {
    const list = staffCouriers();
    if (!list.length || (state.ownedVehicles || []).length < 2) return { count: 0, earned: 0 };
    let count = 0, earned = 0;
    for (const id of list) {
      const o = state.orders.find(x => !x.delivered && !x.pickup &&
        !(state.tutorial && state.tutorial.on && x.id === state.tutorial.orderId) &&
        Object.keys(x.items || {}).every(k => stockOf(k) >= x.items[k]));
      if (!o) break;
      Object.keys(o.items).forEach(k => addStock(k, -o.items[k]));
      state.money += o.pay;
      state.dayRevenue += o.pay;
      state.stats.earned += o.pay;
      state.stats.delivered++;
      state.dayDelivered++;
      if (state.week) { state.week.revenue += o.pay; state.week.delivered++; state.week.onTime++; }
      state.reputation = clamp(state.reputation + 0.4, 0, 100);
      bumpCred('fulfill', 0.3);
      bumpTrust(o.customer, 0.05);
      o.delivered = true;
      earned += o.pay;
      count++;
      const t = D.APPRENTICES.find(x => x.id === id);
      const place = (D.LOCATIONS.find(l => l.id === o.loc) || {}).name || o.loc;
      log(`${t ? t.name : '学徒'}替你送到${place}：+${o.pay}G（她不收小费）。`, 'good');
    }
    if (count) {
      state.orders = state.orders.filter(o => !o.delivered);
      emit(); save();
    }
    return { count, earned };
  }

  /* ---------------- 第三方配送 ----------------
   * 平台替你跑腿：准时、安全、不用你出门，代价是抽走尾款的一大截。
   * 货还是得你自己做出来——平台只送，不做糖。
   */
  function thirdPartyFee(o) {
    return Math.max(D.COSTS.platformMin, Math.round(o.pay * D.COSTS.platformRate));
  }
  function thirdPartyList() {
    return state.orders.filter(o => !o.delivered).map(o => {
      const fee = thirdPartyFee(o);
      const ready = Object.keys(o.items).every(k => stockOf(k) >= o.items[k]);
      return { id: o.id, customer: o.customer, loc: o.loc, pay: o.pay, fee, net: o.pay - fee, ready };
    });
  }
  function thirdParty(id) {
    const o = state.orders.find(x => x.id === id);
    if (!o) return { ok: false, msg: '这单已经不在了。' };
    for (const k in o.items) {
      if (stockOf(k) < o.items[k]) {
        return { ok: false, msg: `${D.PRODUCTS[k].name} 不够，平台只送不做。` };
      }
    }
    const fee = thirdPartyFee(o);
    if (state.money < fee) return { ok: false, msg: `平台要 ${fee}G，手上不够。` };
    for (const k in o.items) addStock(k, -o.items[k]);
    state.money += o.pay - fee;
    state.stats.earned += o.pay;
    state.stats.delivered++;
    state.dayRevenue += o.pay;
    if (state.week) {
      state.week.revenue += o.pay;
      state.week.delivered++;
      state.week.onTime++;
    }
    state.orders = state.orders.filter(x => x.id !== id);
    state.reputation = clamp(state.reputation + 0.8, 0, 100);
    bumpCred('fulfill', 0.4);
    /* 客人只记得「糖果屋按时送到了」，记不住是谁跑的腿 */
    const p = personOf(o.customer);
    p.orders++;
    p.done++;
    p.spent += o.pay;
    bumpTrust(o.customer, 0.05);
    const loc = D.LOCATIONS.find(l => l.id === o.loc);
    log(`叫第三方把 #${id} 送去${loc ? loc.name : o.loc}：平台抽 ${fee}G，到账 ${o.pay - fee}G。`, 'info');
    emit(); save();
    return { ok: true, fee, net: o.pay - fee };
  }

  /* 每天开工前学徒自己干点活：从他会做的东西里挑一件，吃你的原料，七成二能成。 */
  function staffMorningShift() {
    const out = [];
    state.staff.forEach(id => {
      const t = D.APPRENTICES.find(x => x.id === id);
      if (!t) return;
      const pool = t.craft.filter(k => canCraft(k));
      if (!pool.length) return;
      const key = pick(pool);
      const p = D.PRODUCTS[key];
      for (const k in p.recipe) addInv(k, -p.recipe[k]);
      state.dayMade++;
      if (Math.random() <= 0.72) {
        addStock(key, 1);
        state.stats.made++;
        out.push(`${t.name}做了 ${p.name}`);
      } else {
        out.push(`${t.name}把 ${p.name} 做糊了`);
      }
    });
    if (out.length) log('开工前：' + out.join('，') + '。', 'info');
    return out;
  }

  /* ---------------- 新岛安检 ----------------
   * 地铁站的 X 光机会翻箱：含烈酒 / 魔法糖浆的成品过不去。
   * 货车道（跨海大桥）只验证件不拆箱，所以「送新岛」的敏感货只能骑车带。
   * 买了铅衬行李袋之后可以照常坐地铁。
   */
  function sensitiveGoods() {
    const flag = D.SECURITY.flaggedRaw;
    return Object.keys(D.PRODUCTS).filter(k => {
      const r = D.PRODUCTS[k].recipe || {};
      return Object.keys(r).some(x => flag.indexOf(x) >= 0);
    });
  }
  function hasGear(key) {
    return !!(state.gear && state.gear[key || D.SECURITY.gearKey]);
  }
  function gearInfo() {
    const S = D.SECURITY;
    return {
      key: S.gearKey, name: S.gearName, price: S.gearPrice, desc: S.gearDesc,
      owned: hasGear(S.gearKey)
    };
  }
  function buyGear() {
    const g = gearInfo();
    if (g.owned) return { ok: false, msg: '已经有了。' };
    if (state.money < g.price) return { ok: false, msg: `还差 ${g.price - state.money}G。` };
    state.money -= g.price;
    if (!state.gear) state.gear = {};
    state.gear[g.key] = true;
    log(`买下了${g.name}（-${g.price}G）。以后带敏感货也能坐地铁了。`, 'good');
    emit(); save();
    return { ok: true, msg: `${g.name}到手` };
  }
  /* 传进来的是「随身的成品 key」；返回会不会被安检拦下 */
  function securityCheck(keys) {
    const flag = sensitiveGoods();
    const hit = (keys || []).filter(k => flag.indexOf(k) >= 0);
    const uniq = hit.filter((k, i) => hit.indexOf(k) === i);
    const shielded = hasGear();
    return {
      items: uniq,
      names: uniq.map(k => D.PRODUCTS[k] ? D.PRODUCTS[k].name : k),
      shielded,
      blocked: uniq.length > 0 && !shielded
    };
  }

  /* ---------------- 地铁 ----------------
   * 线路图在 D.METRO.graph，这里只算「几段」。
   * 邻接一律按无向处理（一端写了就算通）——线上不该有单向铁轨，
   * 之前就是因为有向表写漏了一边，导致同一条路来回收费不同。
   */
  function metroAdj() {
    const g = D.METRO.graph;
    const adj = {};
    Object.keys(D.METRO.stations).forEach(k => { adj[k] = []; });
    Object.keys(g).forEach(a => {
      (g[a] || []).forEach(b => {
        if (!adj[a]) adj[a] = [];
        if (!adj[b]) adj[b] = [];
        if (adj[a].indexOf(b) < 0) adj[a].push(b);
        if (adj[b].indexOf(a) < 0) adj[b].push(a);
      });
    });
    return adj;
  }
  /* 从某站出发到各站的段数（BFS），到不了的不出现在结果里 */
  function metroDist(from) {
    const adj = metroAdj();
    const dist = { [from]: 0 };
    const q = [from];
    while (q.length) {
      const cur = q.shift();
      (adj[cur] || []).forEach(n => {
        if (dist[n] == null) { dist[n] = dist[cur] + 1; q.push(n); }
      });
    }
    return dist;
  }
  function metroCost(from, to) {
    const d = metroDist(from);
    return d[to] == null ? null : d[to];
  }

  /* 地铁不是白坐的：车票按段收，首末班按当前阶段的钟点判断。
     早起准备（05:00）站台还没开，配送阶段才坐得上。 */
  function clockText() {
    const p = phase();
    return p ? p.time : '05:00';
  }
  function metroOpen() {
    const h = parseInt(String(clockText()).split(':')[0], 10);
    return h >= D.METRO.first && h <= D.METRO.last;
  }
  function metroFare(from, to) {
    const seg = metroCost(from, to);
    return seg == null ? null : seg * (D.METRO.farePerStop || 0);
  }
  function rideMetro(from, to) {
    const seg = metroCost(from, to);
    if (seg == null) return { ok: false, msg: '这两站之间不通。' };
    if (!metroOpen()) return { ok: false, msg: `地铁 ${D.METRO.first}:00 发车，${D.METRO.last}:00 收班。` };
    const fare = seg * (D.METRO.farePerStop || 0);
    if (state.ap < seg) return { ok: false, msg: `要 ${seg} 点行动点，不够了。` };
    if (state.money < fare) return { ok: false, msg: `车票 ${fare}G，钱不够。` };
    state.ap -= seg;
    state.money -= fare;
    log(`坐了 ${seg} 段地铁，车票 ${fare}G。`, 'info');
    emit(); save();
    return { ok: true, ap: seg, fare };
  }

  /* 公交 / 渡船：地铁之外的快速跨区，同样收车票、扣行动点 */
  function rideTransit(kind, loc) {
    const cfg = D.TRANSIT[kind];
    if (!cfg) return { ok: false, msg: '没有这条线。' };
    const r = cfg.routes.find(x => x.loc === loc);
    if (!r) return { ok: false, msg: '这趟车不去那儿。' };
    if (state.ap < r.ap) return { ok: false, msg: `要 ${r.ap} 点行动点，不够了。` };
    if (state.money < r.fare) return { ok: false, msg: `票价 ${r.fare}G，钱不够。` };
    state.ap -= r.ap;
    state.money -= r.fare;
    log(`搭${kind === 'boat' ? '渡船' : '公交'}去了${r.note}（-${r.ap} AP，${r.fare}G）。`, 'info');
    emit(); save();
    return { ok: true, ap: r.ap, fare: r.fare, name: r.note };
  }

  /* ---------------- 地下管网 ----------------
   * 和地铁走两套账：地铁收钱、过安检；管网不收钱、不过安检，改收元气。
   * 「探明」只决定能不能从那个出口出来，路径本身允许穿过没探明的结构。 */
  function tunnelState() {
    if (!state.tunnels || typeof state.tunnels !== 'object') {
      state.tunnels = { seen: ['snail'], uses: 0, last: null };
    }
    if (!Array.isArray(state.tunnels.seen)) state.tunnels.seen = ['snail'];
    return state.tunnels;
  }
  function tunnelSeen() { return tunnelState().seen.slice(); }
  function tunnelNodeIds() { return Object.keys(D.TUNNELS.nodes); }
  function tunnelEntryOf(locId) {
    return tunnelNodeIds().find(k => D.TUNNELS.nodes[k].loc === locId) || null;
  }
  function discoverTunnel(id) {
    if (!D.TUNNELS.nodes[id]) return { ok: false, msg: '这里没有井盖。' };
    const t = tunnelState();
    if (t.seen.indexOf(id) >= 0) return { ok: false, msg: '这个出口已经记在图上了。' };
    t.seen.push(id);
    log(`记下了${D.TUNNELS.nodes[id].name}的位置。管网图又多了一个出口。`, 'good');
    emit(); save();
    return { ok: true, msg: `记下 ${D.TUNNELS.nodes[id].name}` };
  }

  /* 无向 BFS：返回 from 到各节点穿过的结构数（段数） */
  function tunnelDist(from) {
    if (!D.TUNNELS.links[from]) return {};
    const dist = {}; dist[from] = 0;
    const q = [from];
    while (q.length) {
      const cur = q.shift();
      (D.TUNNELS.links[cur] || []).forEach(n => {
        if (dist[n] == null) { dist[n] = dist[cur] + 1; q.push(n); }
      });
    }
    return dist;
  }
  function tunnelCost(from, to) {
    const d = tunnelDist(from);
    return d[to] == null ? null : d[to];
  }
  function tunnelTrip(from, to) {
    const hop = tunnelCost(from, to);
    if (hop == null) return null;
    return {
      hop,
      ap: (D.TUNNELS.entryAp || 0) + hop * (D.TUNNELS.apPerHop || 0),
      energy: hop * (D.TUNNELS.energyPerHop || 0)
    };
  }
  function useTunnel(from, to) {
    const t = tunnelState();
    if (!D.TUNNELS.nodes[from] || !D.TUNNELS.nodes[to]) return { ok: false, msg: '图上没有这个出口。' };
    if (t.seen.indexOf(from) < 0) return { ok: false, msg: '你还没摸清这个井盖通到哪儿。' };
    if (t.seen.indexOf(to) < 0) return { ok: false, msg: '那个出口还没探明，摸黑过去会迷路。' };
    if (from === to) return { ok: false, msg: '已经在这儿了。' };
    const trip = tunnelTrip(from, to);
    if (!trip) return { ok: false, msg: '这两处管网不连通。' };
    if (state.ap < trip.ap) return { ok: false, msg: `下井要 ${trip.ap} 点行动点，不够了。` };
    state.ap -= trip.ap;
    /* 元气不够也放行：管网是保命的退路，不该把人锁在城外，只扣到见底 */
    state.energy = clamp(state.energy - trip.energy, 0, 100);
    t.uses++;
    t.last = { from, to, day: state.day };
    log(`从${D.TUNNELS.nodes[from].name}下井，穿过 ${trip.hop} 段旧管网，`
      + `从${D.TUNNELS.nodes[to].name}钻出来（-${trip.ap} AP，元气 -${trip.energy}）。`, 'info');
    emit(); save();
    return { ok: true, ...trip, name: D.TUNNELS.nodes[to].name };
  }

  /* ---------------- 三条软失败线 ----------------
   * 设计前提：糖果屋是母亲留下的安全网，永远不会关门。
   * 所以惩罚不能是「活不下去」，只能是「配不上更好的机会」——
   * 三张执照会掉分，掉分不扣钱、不结束游戏，只是把门一扇扇关上。
   */
  const CRED_KEYS = ['fulfill', 'compliance', 'supply'];

  function credVal(k) {
    const c = state.cred || {};
    const v = typeof c[k] === 'number' ? c[k] : D.CRED.start[k];
    return clamp(v, 0, 100);
  }
  function credAvg() {
    return CRED_KEYS.reduce((a, k) => a + credVal(k), 0) / CRED_KEYS.length;
  }
  function credList() {
    return CRED_KEYS.map(k => ({
      key: k, label: D.CRED.labels[k], value: Math.round(credVal(k)),
      low: credVal(k) < D.CRED.floor
    }));
  }
  /* 掉分/加分都不刷日志（一天几十单会淹掉），只在跨过关键线时提醒。 */
  function bumpCred(k, d) {
    if (!CRED_KEYS.includes(k)) return 0;
    if (!state.cred) state.cred = { ...D.CRED.start };
    const before = credVal(k);
    state.cred[k] = clamp(before + d, 0, 100);
    const after = state.cred[k];
    if (before >= D.CRED.floor && after < D.CRED.floor) {
      log(`${D.CRED.labels[k]}跌破 ${D.CRED.floor}——这类活了。`, 'bad');
    } else if (before < D.CRED.floor && after >= D.CRED.floor) {
      log(`${D.CRED.labels[k]}回到 ${D.CRED.floor} 以上。`, 'good');
    }
    return after - before;
  }

  /* ---------------- 评级 ---------------- */
  function rankIndex(id) {
    const i = D.RANKS.findIndex(r => r.id === id);
    return i < 0 ? 0 : i;
  }
  function rankAtLeast(id) { return rankIndex(state.rank) >= rankIndex(id); }
  function rankInfo() {
    const idx = rankIndex(state.rank);
    const cur = D.RANKS[idx];
    const next = D.RANKS[idx + 1] || null;
    return {
      id: cur.id, name: cur.name, note: cur.note, idx,
      max: D.RANKS.length - 1, cur, next,
      credAvg: Math.round(credAvg()),
      weekRevenue: Math.round(state.week ? state.week.revenue : 0),
      /* 距离下一级还差多少，两个都达标才升 */
      credGap: next ? Math.max(0, next.cred - credAvg()) : 0,
      weekGap: next ? Math.max(0, next.week - (state.week ? state.week.revenue : 0)) : 0,
      daysToReview: 7 - ((state.day - 1) % 7)
    };
  }
  /* 每周考核：三张执照的均值 + 这一周赚的钱，都够才升级；
     连当前级别的底都守不住，就掉一级。掉级不会掉到 D 以下。 */
  function weeklyReview() {
    const idx = rankIndex(state.rank);
    const cur = D.RANKS[idx];
    const next = D.RANKS[idx + 1];
    const avg = credAvg();
    const rev = (state.week && state.week.revenue) || 0;
    if (next && avg >= next.cred && rev >= next.week) {
      state.rank = next.id;
      log(`周考核通过：评级 ${cur.id} → ${next.id}「${next.name}」。`, 'good');
    } else if (idx > 0 && avg < Math.max(0, cur.cred - 12)) {
      state.rank = D.RANKS[idx - 1].id;
      log(`周考核没守住：三张执照的均值只有 ${Math.round(avg)}，评级掉回 ${state.rank}。`, 'bad');
    } else if (next) {
      const a = avg >= next.cred ? '✓' : `差 ${Math.ceil(next.cred - avg)}`;
      const b = rev >= next.week ? '✓' : `差 ${next.week - Math.round(rev)}G`;
      log(`周考核：离 ${next.id}「${next.name}」还差一点（执照 ${a}、本周流水 ${b}）。`, 'info');
    }
    state.week = { start: state.day + 1, revenue: 0, delivered: 0, onTime: 0 };
  }

  /* ---------------- 设备磨损 ----------------
   * 设备状态是一条「你不理它就变差」的线：每做一件都磨一点，
   * 磨到满成功率打六五折。保养不贵，但一直拖就会同时吃掉产能和合规。
   */
  function wearRate() { return D.COSTS.wearSlow[upLv('oven') - 1] || 1; }
  function wearPenalty() { return 1 - (state.wear || 0) / 100 * D.COSTS.wearPenalty; }
  function maintainCost() {
    return Math.round(D.COSTS.maintainBase + (state.wear || 0) * D.COSTS.maintainPerWear);
  }
  function maintain() {
    if ((state.wear || 0) < 1) return { ok: false, msg: '设备还挺干净，不用保养。' };
    if (state.money < 0) return { ok: false, msg: '账上还透支着，先做回正数。' };
    const cost = maintainCost();
    if (state.money < cost) return { ok: false, msg: `保养要 ${cost}G，不够。` };
    const wear = Math.round(state.wear);
    state.money -= cost;
    state.wear = 0;
    bumpCred('compliance', 1);
    log(`把炉子和冰箱彻底清了一遍（-${cost}G，磨损归零）。`, 'good');
    emit(); save();
    return { ok: true, msg: `保养完成，磨损已清（原 ${wear}）` };
  }

  /* ---------------- 执照年检 ----------------
   * 每 28 天一次。交得出来合规 +4；交不出来不是倒闭，是「待检」：
   * 合规 -15，七天后补检。执照一直挂着，好单会绕着走。
   */
  function licenseDue() {
    const l = state.license;
    return !!l && typeof l.due === 'number' && state.day >= l.due;
  }
  function licenseDays() {
    const l = state.license;
    return l && typeof l.due === 'number' ? Math.max(0, l.due - state.day) : 0;
  }

  /* ---------------- 批发采购 ----------------
   * 不用自己跑市场：给批发商下单，他按批发价备货，满量再打一层折扣，
   * 代价是一笔跑腿搬运费，而且货不会立刻到——至少隔一个阶段。
   * 用「阶段线性序号」算到货时间，跨天也不会错。
   */
  function phaseLinear() { return state.day * D.PHASES.length + state.phaseIdx; }

  function bulkQuote(items) {
    let units = 0, retail = 0;
    Object.keys(items || {}).forEach(k => {
      const q = Math.max(0, Math.floor(items[k] || 0));
      if (!q || !D.RAW[k]) return;
      units += q;
      retail += D.RAW[k].price * q;
    });
    const whole = retail * D.PURCHASE.wholeMul;
    let off = 0;
    D.PURCHASE.tiers.forEach(t => { if (units >= t.qty) off = t.off; });
    const discount = Math.round(whole * off);
    const fee = units
      ? Math.max(D.PURCHASE.feeMin, D.PURCHASE.feeBase + Math.round((whole - discount) * D.PURCHASE.feeRate))
      : 0;
    return {
      units, retail: Math.round(retail), whole: Math.round(whole),
      off, discount, fee, total: Math.max(0, Math.round(whole - discount + fee))
    };
  }

  function purchaseDue() { return phaseLinear() + D.PURCHASE.delayPhases; }

  function placePurchase(items) {
    const clean = {};
    Object.keys(items || {}).forEach(k => {
      const q = Math.max(0, Math.floor(items[k] || 0));
      if (q && D.RAW[k]) clean[k] = q;
    });
    const q = bulkQuote(clean);
    if (!q.units) return { ok: false, msg: '还没选要买的东西。' };
    if (state.money < q.total) return { ok: false, msg: `这次要 ${q.total}G，钱不够。` };
    state.money -= q.total;
    if (!state.purchases) state.purchases = [];
    state.purchases.push({ id: state.purchaseSeq++, items: clean, total: q.total, due: purchaseDue(), day: state.day });
    const list = Object.keys(clean).map(k => `${D.RAW[k].name}×${clean[k]}`).join('、');
    log(`向批发商下单：${list}，共 ${q.total}G。${D.PURCHASE.delayPhases} 个阶段后送到。`, 'info');
    emit(); save();
    return { ok: true, total: q.total, due: purchaseDue() - D.PURCHASE.delayPhases };
  }

  /* 还没到的货：给界面用的清单（带剩余阶段数） */
  function pendingPurchases() {
    const now = phaseLinear();
    return (state.purchases || []).map(p => ({
      id: p.id,
      items: { ...p.items },
      total: p.total,
      label: Object.keys(p.items).map(k => `${D.RAW[k].name}×${p.items[k]}`).join('、'),
      phasesLeft: Math.max(0, p.due - now)
    }));
  }

  /* 每个阶段开头检查一次：到点了就卸货进仓库 */
  function arrivePurchases() {
    const now = phaseLinear();
    const ready = (state.purchases || []).filter(p => now >= p.due);
    if (!ready.length) return 0;
    ready.forEach(p => {
      Object.keys(p.items).forEach(k => addInv(k, p.items[k]));
      const list = Object.keys(p.items).map(k => `${D.RAW[k].name}×${p.items[k]}`).join('、');
      log(`批发商的货到了：${list}。`, 'good');
    });
    state.purchases = state.purchases.filter(p => now < p.due);
    emit(); save();
    return ready.length;
  }

  /* ---------------- 新手教学 ----------------
   * 序章收尾之后才开始第一天：先给一小把料，挂一张固定的订单（报摊大爷要三支棒棒糖），
   * 让玩家照着「做糖 → 装车 → 送到」走一遍完整闭环。给的材料刚好够，不多不少。
   */
  function startTutorial() {
    if (state.tutorial && state.tutorial.on) return { ok: false, msg: '教学还在进行。' };
    addInv('sugar', 8);
    addInv('flour', 4);
    addInv('butter', 2);
    /* 要 5 支，而开局货架上只有 3 支——逼玩家真的开一炉 */
    const o = {
      id: state.orderSeq++, type: 'phone', customer: '报摊大爷',
      loc: 'busstop', items: { lollipop: 5 }, pay: 150,
      deadline: state.day + 2, trust: 2, createdDay: state.day
    };
    state.orders.push(o);
    state.tutorial = { on: true, step: 0, orderId: o.id };
    log('开张第一天：报摊大爷订了三支星星棒棒糖。先做，再装车送过去。', 'good');
    emit(); save();
    return { ok: true, orderId: o.id };
  }

  /* ---------------- 巷口零工 ----------------
   * 母亲失散多年——主线就是在找她，所以「跟妈开口」这种事不存在。
   * 现金见底、赊账额度也用光时，还有一条路：去巷口出半天力，换一炉基础料。
   * 一天一次，花 1 点行动点。不是施舍，是蜗牛巷的规矩：出力就有饭吃。
   */
  function canOddJob() {
    return state.flags.oddJobDay !== state.day && state.ap >= D.COSTS.oddJobAp;
  }
  function oddJob() {
    if (state.flags.oddJobDay === state.day) return { ok: false, msg: '今天已经帮过一次了。' };
    if (state.ap < D.COSTS.oddJobAp) return { ok: false, msg: '没力气了，明天再来。' };
    state.ap -= D.COSTS.oddJobAp;
    state.flags.oddJobDay = state.day;
    const give = D.COSTS.oddJobGive;
    Object.keys(give).forEach(k => addInv(k, give[k]));
    const names = Object.keys(give).map(k => `${D.RAW[k].name}×${give[k]}`).join('、');
    log(`在巷口帮水果摊卸了一车货，老板娘塞给你 ${names}。`, 'good');
    emit(); save();
    return { ok: true, msg: `拿到 ${names}` };
  }

  /* ---------------- 供应商赊账 ----------------
   * 现金不够时可以向供应商赊，但账期只有 3 天，且额度吃供应链信用。
   * 逾期不结：额度缩、信用掉，直到没人再赊给你。
   */
  function payableTotal() {
    return (state.payables || []).reduce((a, p) => a + p.amt, 0);
  }
  function creditRoom() {
    const cap = Math.round(D.COSTS.creditCap * (credVal('supply') / 100));
    return Math.max(0, cap - payableTotal());
  }
  /* 到期结清：钱够就付，供应链信用 +3；不够就推两天账期，信用 -10。 */
  function settlePayables() {
    const list = state.payables || [];
    const due = list.filter(p => p.due <= state.day);
    if (!due.length) return { paid: 0, late: 0 };
    const sum = due.reduce((a, p) => a + p.amt, 0);
    if (state.money >= sum) {
      state.money -= sum;
      state.payables = list.filter(p => p.due > state.day);
      bumpCred('supply', 3);
      log(`结清供应商货款 ${sum}G，供应链信用 +3。`, 'good');
      return { paid: sum, late: 0 };
    }
    state.payables = list.map(p => (p.due <= state.day
      ? { ...p, due: state.day + 2, late: (p.late || 0) + 1 }
      : p));
    bumpCred('supply', -10);
    log(`供应商的 ${sum}G 没结上，账期再推两天。供应链信用 -10。`, 'bad');
    return { paid: 0, late: sum };
  }

  function creditInfo() {
    return {
      cap: Math.round(D.COSTS.creditCap * (credVal('supply') / 100)),
      used: payableTotal(),
      room: creditRoom(),
      list: (state.payables || []).map(p => ({ ...p, daysLeft: p.due - state.day }))
    };
  }

  /* ---------------- 账本 ---------------- */
  function dailyWage() {
    return state.staff.reduce((a, id) => {
      const t = D.APPRENTICES.find(x => x.id === id);
      return a + (t ? t.wage : 0);
    }, 0);
  }

  /* 家用：房子是母亲的，不收租，只按「柜上进项」抽一成。
     小费不进这个数——那是客人塞给米莉自己的。 */
  function homeShare() {
    return Math.max(D.COSTS.homeMin, Math.round((state.dayRevenue || 0) * D.COSTS.homeRate));
  }

  function billsPreview() {
    const home = homeShare();
    const wage = dailyWage();
    const utility = (state.dayMade || 0) * D.COSTS.utilityPerUnit;
    /* 年检那天的执照费并进账单，玩家在「今晚结算」里就能看见，不会突然少钱。 */
    const lic = licenseDue() ? D.COSTS.licenseFee : 0;
    return { home, wage, utility, lic, total: home + wage + utility + lic };
  }

  /* ---------------- 采购 ---------------- */
  /* 采购：现金不够时可以赊。赊账额度 = 供应链信用 × 上限，
     账期 3 天，到期自动从账上扣；扣不出就掉信用、缩额度。
     这是「钱不够也能开工」的那口气，也是供应链信任这条线的主要消耗处。 */
  function buyRaw(key, qty, mult) {
    const unit = Math.round(D.RAW[key].price * (mult || 1));
    const cost = unit * qty;
    if (state.money < 0) return { ok: false, msg: '账上还透支着，先把现金做回正数。' };
    if (state.money < cost) {
      const gap = cost - state.money;
      const room = creditRoom();
      if (gap > room) {
        return { ok: false, msg: `钱不够，赊账额度也只剩 ${room}G。` };
      }
      state.money = 0;
      state.payables.push({ day: state.day, amt: gap, due: state.day + D.COSTS.creditDays, late: 0 });
      addInv(key, qty);
      log(`现金不够，向供应商赊了 ${gap}G 进 ${D.RAW[key].name}（${D.COSTS.creditDays} 天内结清）。`, 'info');
    } else {
      state.money -= cost;
      addInv(key, qty);
      log(`采购 ${D.RAW[key].name} ×${qty}（-${cost}G）`, 'info');
    }
    emit(); save();
    return { ok: true, msg: `买下 ${D.RAW[key].name} ×${qty}` };
  }

  /* ---------------- 制作 ---------------- */
  /* 店铺等级（1 起）。老档没有 shop 字段时按 1 级算，等于维持原样。 */
  function upLv(key) {
    const u = D.SHOP_UPGRADES[key];
    if (!u) return 1;
    return clamp((state.shop && state.shop[key]) || 1, 1, u.levels.length);
  }
  function upInfo(key) {
    const u = D.SHOP_UPGRADES[key];
    const lv = upLv(key);
    return {
      key, name: u.name, tag: u.tag, desc: u.desc, icon: u.icon,
      lv, max: u.levels.length,
      cur: u.levels[lv - 1],
      next: u.levels[lv] || null
    };
  }
  function upAll() { return Object.keys(D.SHOP_UPGRADES).map(upInfo); }
  /* 展示柜的零售加价 / 烤炉的高档品省 AP 与糊锅救料 */
  function caseMul() { return D.SHOP_UPGRADES.case.levels[upLv('case') - 1].priceMul; }
  function ovenSalvage() { return D.SHOP_UPGRADES.oven.levels[upLv('oven') - 1].salvage || 0; }
  function apCutOf(p) {
    const cut = D.SHOP_UPGRADES.oven.levels[upLv('oven') - 1].apCut || 0;
    return (cut && p.ap >= 2) ? cut : 0;
  }
  function apCostOf(key) {
    const p = D.PRODUCTS[key];
    return Math.max(1, p.ap - apCutOf(p));
  }
  /* 当前成功率：只看元气（烤炉不再动成功率，改成糊了退原料）。
   * 满元气就是 100%，界面上的数字和这里保持一致。 */
  function successRate() {
    /* 元气决定手感，磨损决定机器还准不准。两者都满才是 100%。 */
    return clamp((0.55 + (state.energy / 100) * 0.45) * wearPenalty(), 0, 1);
  }

  function canCraft(key) {
    const p = D.PRODUCTS[key];
    for (const k in p.recipe) if (invOf(k) < p.recipe[k]) return false;
    return true;
  }

  function craft(key, times) {
    times = times || 1;
    const p = D.PRODUCTS[key];
    const apCost = apCostOf(key);
    const rate = successRate();
    const results = { made: 0, failed: 0, ap: 0 };
    for (let i = 0; i < times; i++) {
      if (state.ap < apCost) break;
      if (!canCraft(key)) break;
      for (const k in p.recipe) addInv(k, -p.recipe[k]);
      if (Math.random() <= rate) {
        addStock(key, 1);
        results.made++;
        state.stats.made++;
      } else {
        results.failed++;
        /* 好炉子能把糊掉的那锅救回来一部分原料，越贵的品越值。 */
        const back = ovenSalvage();
        if (back > 0) {
          for (const k in p.recipe) {
            const n = Math.floor(p.recipe[k] * back);
            if (n > 0) addInv(k, n);
          }
          results.salvaged = (results.salvaged || 0) + 1;
        }
      }
      state.dayMade++;
      state.wear = clamp((state.wear || 0) + D.COSTS.wearPerUnit * wearRate(), 0, 100);
      state.ap -= apCost;
      state.energy = clamp(state.energy - 1.6, 0, 100);
      results.ap += apCost;
    }
    if (results.made || results.failed) {
      let msg = `制作 ${p.name}：成功 ${results.made}`;
      if (results.failed) msg += `，糊了 ${results.failed}`;
      if (results.salvaged) msg += `（炉子救回 ${results.salvaged} 锅的原料）`;
      log(msg, results.failed ? 'bad' : 'good');
    }
    emit(); save();
    return results;
  }

  /* ---------------- 销售 ---------------- */
  function sell(key, qty) {
    qty = Math.min(qty, stockOf(key));
    if (qty <= 0) return { ok: false, msg: '没货了。' };
    addStock(key, -qty);
    const income = D.PRODUCTS[key].price * qty;
    state.money += income;
    state.stats.sold += qty;
    state.stats.earned += income;
    state.daySold += income;
    state.dayRevenue += income;
    if (state.week) state.week.revenue += income;
    state.reputation = clamp(state.reputation + 0.4, 0, 100);
    emit(); save();
    return { ok: true, msg: `卖出 ${D.PRODUCTS[key].name} ×${qty}  +${income}G` };
  }

  /* ---------------- 交付 ---------------- */
  function deliverOrders(orders, locId) {
    let gained = 0, count = 0, tips = 0;
    orders.forEach(o => {
      if (o.loc !== locId) return;
      // 检查库存
      for (const k in o.items) {
        if (stockOf(k) < o.items[k]) return;
      }
      for (const k in o.items) addStock(k, -o.items[k]);

      const onTime = state.day <= o.deadline;
      const strict = o.strict || 0;
      let pay = o.pay;
      if (onTime && o.deadline === state.day) pay = Math.round(pay * 1.05);

      /* 小费：准时送到 + 送的是他爱吃的那口，才给。
         信任越高越舍得给，不喜欢的品类打折给。 */
      let tip = 0;
      if (onTime) {
        const t = tmplOf(o.customer);
        const fav = (t && t.fav) || [];
        const hitFav = fav.some(k => o.items[k] > 0);
        let rate = 0.04 + Math.max(0, o.trust - 2) * 0.015;
        if (!hitFav) rate *= 0.4;
        tip = Math.round(pay * rate);
      }

      state.money += pay + tip;
      /* 营业额只算尾款。小费是客人塞给米莉自己的，不进家里的账。 */
      state.dayRevenue += pay;
      if (state.week) {
        state.week.revenue += pay;
        state.week.delivered++;
        if (onTime) state.week.onTime++;
      }
      bumpCred('fulfill', onTime ? D.CRED.onTimeUp : -D.CRED.lateHit);
      state.stats.earned += pay + tip;
      state.stats.delivered++;
      state.dayDelivered++;
      o.delivered = true;
      state.reputation = clamp(state.reputation + (onTime ? 1.2 : 0.4), 0, 100);

      const p = personOf(o.customer);
      p.spent += pay + tip;
      p.tips += tip;
      if (onTime) {
        p.done++;
        bumpTrust(o.customer, 0.14);
      } else {
        p.late++;
        // strict=2 的地方迟到会明显掉信任
        bumpTrust(o.customer, -0.15 * (1 + strict * 0.5));
      }

      gained += pay + tip;
      tips += tip;
      count++;
      log(`交付给 ${o.customer}：+${pay}G${tip ? ` + 小费 ${tip}G` : ''}${onTime ? '' : '（超时）'}`,
        onTime ? 'good' : 'bad');
    });
    if (count) {
      state.orders = state.orders.filter(o => !o.delivered);
      state.energy = clamp(state.energy - 2, 0, 100);
    }
    emit(); save();
    return { count, gained, tips };
  }

  /* ---------------- 到店自提 ----------------
   * 客人自己上门拿：不进配送池、不占运力、不用出门，也没有小费。
   * 货得先做出来放柜台，缺货就交不了。 */
  function pickupOrder(id) {
    const o = state.orders.find(x => x.id === id && x.pickup && !x.delivered);
    if (!o) return { ok: false, msg: '这张自提单已经不在了。' };
    if (!Object.keys(o.items || {}).every(k => stockOf(k) >= o.items[k])) {
      return { ok: false, msg: '货架上还缺东西，先去制作台。' };
    }
    Object.keys(o.items).forEach(k => addStock(k, -o.items[k]));
    state.money += o.pay;
    state.dayRevenue += o.pay;
    if (state.week) { state.week.revenue += o.pay; state.week.delivered++; state.week.onTime++; }
    state.stats.earned += o.pay;
    state.stats.delivered++;
    state.dayDelivered++;
    state.reputation = clamp(state.reputation + 0.8, 0, 100);
    bumpCred('fulfill', 0.4);
    bumpTrust(o.customer, 0.1);
    state.orders = state.orders.filter(x => x.id !== id);
    log(`${o.customer}到店把 #${o.id} 取走了：+${o.pay}G（自提，没有小费）。`, 'good');
    emit(); save();
    return { ok: true, msg: `${o.customer}拎着糖走了，+${o.pay}G。` };
  }

  function cancelOrder(id, reason) {
    const o = state.orders.find(x => x.id === id);
    if (!o) return;
    state.orders = state.orders.filter(x => x.id !== id);
    state.reputation = clamp(state.reputation - 2, 0, 100);
    bumpCred('fulfill', -D.CRED.refuseHit);
    const p = personOf(o.customer);
    p.refused++;
    bumpTrust(o.customer, -0.35);
    log(`取消了订单 #${id}${reason ? '（' + reason + '）' : ''}，信誉 -2，${o.customer} 记下了`, 'bad');
    emit(); save();
  }

  /* 延长交付期 */
  function extendOrder(id) {
    const o = state.orders.find(x => x.id === id);
    if (!o) return { ok: false, msg: '订单不存在。' };
    if (state.flags['ext_' + id]) return { ok: false, msg: '这个客户已经宽限过一次了。' };
    const cut = Math.round(o.pay * (0.08 + (5 - o.trust) * 0.04));
    o.pay = Math.max(10, o.pay - cut);
    o.deadline += 1;
    state.flags['ext_' + id] = true;
    log(`联系了 ${o.customer} 请求延期，尾款 -${cut}G。`, 'info');
    emit(); save();
    return { ok: true, msg: `${o.customer} 同意延期一天，尾款少了 ${cut}G。` };
  }

  /* ---------------- 半路没力气了 ----------------
   * 行动点归零不该是一堵墙。给两条回家的路：花钱叫车，或者推车走回去掉元气。
   */
  function callCab() {
    const fee = (D.TUNE && D.TUNE.cabFee) || 40;
    if (state.money < fee) return { ok: false, msg: `叫车要 ${fee}G，身上的钱不够。` };
    state.money -= fee;
    log(`在路边拦了辆车回蜗牛巷，车费 ${fee}G。`, 'info');
    emit(); save();
    return { ok: true, fee };
  }

  function walkHome() {
    const cost = (D.TUNE && D.TUNE.walkHomeEnergy) || 12;
    state.energy = clamp(state.energy - cost, 0, 100);
    log(`推着车一路走回蜗牛巷，腿都软了。元气 -${cost}`, 'bad');
    emit(); save();
    return { ok: true, cost };
  }

  /* ---------------- 元气 / 睡眠 ---------------- */
  function sleep(nap) {
    if (nap) {
      state.energy = clamp(state.energy + 22, 0, 100);
      log('午睡了半小时，元气恢复了一些。', 'good');
    } else {
      state.energy = 100;
      state.flags.sleptEarly = true;
      log('关灯。明天五点还要起床。', 'good');
    }
    emit(); save();
  }

  function rest() {
    state.energy = clamp(state.energy + 14, 0, 100);
    log('泡了杯茶，坐在柜台后面发呆。', 'good');
    emit(); save();
  }

  /* ---------------- 睡眠规则 ----------------
   * 需求文档：夜间 7 小时（22 点睡到 5 点）+ 午间 1 小时午睡才满元气，
   * 加班或漏了午睡，第二天就带着疲劳上工。 */
  function restNap() {
    state.flags.napped = true;
    state.energy = clamp(state.energy + 22, 0, 100);
    log('趴在柜台后睡了半小时，下午撑得住。', 'good');
    emit(); save();
    return { ok: true, msg: '元气 +22，今天午睡过了' };
  }
  function overtime() {
    if (state.flags.overtimeDay === state.day) return { ok: false, msg: '今晚已经加过班了。' };
    state.flags.overtimeDay = state.day;
    state.ap += 2;                    // 加班是「透支时间」，允许超过这一阶段的上限
    state.flags.sleptEarly = false;
    state.energy = clamp(state.energy - 6, 0, 100);
    log('多开了两小时灯赶工，明早会有点起不来。', 'info');
    emit(); save();
    return { ok: true, msg: '多了 2 点行动点，明早元气会差一点' };
  }
  function nightRecovery() {
    const slept = state.flags.sleptEarly !== false;
    const napped = state.flags.napped === true;
    let e = slept ? 100 : 78;
    if (!napped) e -= 12;
    state.energy = clamp(e, 0, 100);
    if (!slept && !napped) log('昨晚睡得晚，中午也没合眼，元气没缓过来。', 'bad');
    else if (!slept) log('昨晚睡得太晚，元气没有完全恢复。', 'bad');
    else if (!napped) log('中午没睡，第二天有点扛不住。', 'bad');
    state.flags.sleptEarly = true;
    state.flags.napped = false;
    return { slept, napped, energy: state.energy };
  }

  /* ---------------- 柜台 ---------------- */
  function counterServe(key, qty, customer) {
    if (stockOf(key) < qty) return { ok: false, msg: '库存不足。' };
    if (state.ap < 1) return { ok: false, msg: '没力气了。' };
    addStock(key, -qty);
    /* 展示柜等级直接乘在零售价上——同一个品，柜子越好卖得越贵。 */
    const income = Math.round(D.PRODUCTS[key].price * qty * caseMul() * (1 + (state.reputation - 50) / 500));
    state.money += income;
    state.stats.sold += qty;
    state.stats.earned += income;
    state.daySold += income;
    state.dayRevenue += income;
    if (state.week) state.week.revenue += income;
    state.reputation = clamp(state.reputation + 0.6, 0, 100);
    state.ap -= 1;
    state.energy = clamp(state.energy - 1.2, 0, 100);
    /* 柜台也是熟人来源：来店里买过，就算认识。信任涨得比送货慢。 */
    if (customer) {
      const p = personOf(customer);
      p.spent += income;
      p.lastDay = state.day;
      const t = tmplOf(customer);
      const hitFav = !!(t && t.fav && t.fav.indexOf(key) >= 0);
      bumpTrust(customer, hitFav ? 0.09 : 0.04);
    }
    log(`柜台卖出 ${D.PRODUCTS[key].name} ×${qty}，+${income}G`, 'good');
    emit(); save();
    return { ok: true, msg: `+${income}G`, income };
  }

  function counterRefuse(customer) {
    if (state.ap < 1) return { ok: false };
    state.ap -= 1;
    state.reputation = clamp(state.reputation - 0.8, 0, 100);
    state.energy = clamp(state.energy - 0.6, 0, 100);
    if (customer) {
      const p = personOf(customer);
      p.refused++;
      p.lastDay = state.day;
      bumpTrust(customer, -0.18);
    }
    log('婉拒了一位客人。', 'bad');
    emit(); save();
    return { ok: true };
  }

  /* 柜台现做：客人站在面前等着，没法回后场开制作台，只能当场做。
   * 必定成功（熟手动作），代价是配方本身的行动点——不像批量制作那样一次能出好几份。
   * 只补 1 份，够交这一单就行。 */
  function counterMake(key) {
    const p = D.PRODUCTS[key];
    if (!p) return { ok: false, msg: '没有这个配方。' };
    const apCost = apCostOf(key);
    if (state.ap < apCost) return { ok: false, msg: `现做要 ${apCost} 行动点，不够了。` };
    if (!canCraft(key)) return { ok: false, msg: `原料不够，做不出${p.name}。` };
    for (const k in p.recipe) addInv(k, -p.recipe[k]);
    addStock(key, 1);
    state.ap -= apCost;
    state.dayMade++;
    state.energy = clamp(state.energy - 1.4, 0, 100);
    state.stats.made++;
    log(`当着客人的面现做 ${p.name}×1（-${apCost} AP）`, 'info');
    emit(); save();
    return { ok: true, ap: apCost, msg: `现做 ${p.name}×1` };
  }

  function useAP(n) {
    if (state.ap < n) return false;
    state.ap -= n;
    emit(); save();
    return true;
  }

  /* ---------------- 外卖平台 ----------------
   * 独立订单池：不进 state.orders、不占运力、不用米莉出门。
   * 坐班时平台推单；备齐货放进取餐口，阶段收班时骑手来取、平台抽成后到账。
   * 雇了学徒，她会在收班前把备得出来的单自己装好——这就是自动化收入。 */
  function takeoutState() {
    if (!state.takeout || typeof state.takeout !== 'object') {
      state.takeout = { enabled: false, orders: [], seq: 1, stats: { done: 0, earned: 0 }, last: null };
    }
    const t = state.takeout;
    if (!Array.isArray(t.orders)) t.orders = [];
    if (typeof t.seq !== 'number') t.seq = 1 + t.orders.length;
    if (!t.stats || typeof t.stats !== 'object') t.stats = { done: 0, earned: 0 };
    return t;
  }

  function takeoutUnlocked() {
    return state.day >= D.TAKEOUT.unlockDay && state.reputation >= D.TAKEOUT.unlockRep;
  }
  function takeoutHas(items) {
    return Object.keys(items || {}).every(k => stockOf(k) >= items[k]);
  }
  function takeoutConsume(items) {
    Object.keys(items || {}).forEach(k => addStock(k, -items[k]));
  }
  function takeoutUnits(items) {
    return Object.values(items || {}).reduce((a, n) => a + n, 0);
  }

  function openTakeout() {
    const t = takeoutState();
    if (t.enabled) return { ok: false, msg: '终端早就装好了。' };
    if (!takeoutUnlocked()) {
      return { ok: false, msg: `平台要第 ${D.TAKEOUT.unlockDay} 天以后、信誉 ${D.TAKEOUT.unlockRep} 才给接入。` };
    }
    if (state.money < D.TAKEOUT.setupFee) return { ok: false, msg: '钱不够装终端。' };
    state.money -= D.TAKEOUT.setupFee;
    t.enabled = true;
    log(`装好外卖终端（-${D.TAKEOUT.setupFee}G）。骑手在巷口等着，不用自己出门了。`, 'good');
    emit(); save();
    return { ok: true, msg: '外卖终端接上了。坐班时会有单子进来。' };
  }

  function rollTakeoutOrders() {
    const t = takeoutState();
    if (!t.enabled) return 0;
    const p = phase();
    if (!p || p.kind !== 'counter') return 0;
    const room = D.TAKEOUT.slots - t.orders.length;
    if (room <= 0) return 0;
    const keys = productKeys().filter(k => (D.PRODUCTS[k] || {}).price);
    if (!keys.length) return 0;
    const n = Math.min(room, 1 + rand(2));
    for (let i = 0; i < n; i++) {
      const k = pick(keys);
      const qty = 1 + rand(2);
      const pay = Math.round(D.PRODUCTS[k].price * qty * D.TAKEOUT.priceMul);
      t.orders.push({
        id: t.seq++, items: { [k]: qty }, pay, day: state.day,
        status: 'new', byStaff: false
      });
    }
    if (n) log(`外卖终端响了 ${n} 声：来了 ${n} 张单子。`, 'info');
    save();
    return n;
  }

  function packTakeout(id) {
    const t = takeoutState();
    const o = t.orders.find(x => x.id === id && x.status === 'new');
    if (!o) return { ok: false, msg: '这张单已经不在了。' };
    if (state.ap < D.TAKEOUT.packAp) return { ok: false, msg: '没行动点装取餐口了。' };
    if (!takeoutHas(o.items)) return { ok: false, msg: '货架上还缺东西，先去制作台。' };
    useAP(D.TAKEOUT.packAp);
    takeoutConsume(o.items);
    o.status = 'ready';
    const names = Object.entries(o.items)
      .map(([k, q]) => `${(D.PRODUCTS[k] || {}).name || k}×${q}`).join('、');
    log(`把 ${names} 放进取餐口，等骑手来拿。`, 'good');
    emit(); save();
    return { ok: true, msg: `${names} 放进取餐口了，收班时结算。` };
  }

  function settleTakeout() {
    const t = takeoutState();
    const empty = { done: 0, earned: 0, expired: 0, auto: 0, shown: true };
    if (!t.enabled) return empty;
    let done = 0, earned = 0, expired = 0, auto = 0, units = 0;
    /* 有学徒：收班前她自己把备得出来的单装好，最多 autoCap 张 */
    if (state.staff.length) {
      t.orders.filter(o => o.status === 'new').slice(0, D.TAKEOUT.autoCap).forEach(o => {
        if (takeoutHas(o.items)) {
          takeoutConsume(o.items);
          o.status = 'ready';
          o.byStaff = true;
          auto++;
        }
      });
    }
    t.orders.forEach(o => {
      if (o.status === 'ready') {
        const fee = Math.round(o.pay * D.TAKEOUT.platformRate);
        const net = o.pay - fee;
        state.money += net;
        state.dayRevenue += net;
        state.stats.earned += net;
        units += takeoutUnits(o.items);
        earned += net;
        done++;
        o.status = 'done';
      } else if (o.status === 'new') {
        o.status = 'expired';
        expired++;
        /* 没雇人就得自己盯：漏单掉信誉和履约；有学徒顶着就只是平台撤单 */
        if (!state.staff.length) {
          state.reputation = clamp(state.reputation - 1, 0, 100);
          bumpCred('fulfill', -0.6);
        }
      }
    });
    state.stats.sold += units;
    t.stats.done += done;
    t.stats.earned += earned;
    t.orders = t.orders.filter(o => o.status !== 'done' && o.status !== 'expired');
    if (done || expired) {
      log(`外卖收班：${done} 单取走 +${earned}G（平台抽 ${Math.round(D.TAKEOUT.platformRate * 100)}%）`
        + `${auto ? `，其中 ${auto} 单是学徒备的` : ''}${expired ? `，${expired} 单没赶上` : ''}。`,
        expired && !state.staff.length ? 'bad' : 'good');
    }
    t.last = { done, earned, expired, auto, shown: false };
    return t.last;
  }

  /* ---------------- 送货路上的随机事件 ----------------
   * 常规配送不该只是「骑过去按 E」：每烧 1 点行动点掷一次骰子，
   * 危险城区概率更高。这一层只管筛选、结算、落盘；弹窗和暂停地图在 UI。 */
  function regionAt(x, y) {
    const tx = x / D.TILE, ty = y / D.TILE;
    const k = Object.keys(D.REGIONS).find(id => {
      const r = D.REGIONS[id].rect;
      return tx >= r[0] && tx < r[0] + r[2] && ty >= r[1] && ty < r[1] + r[3];
    });
    return k || 'snail';
  }

  /* 车上能用的成品：优先看这一趟装了什么，没装就退而求其次看货架。
     「货物失窃」要从这里拿走一件，交付时才会真的缺货。 */
  function cargoKeys() {
    const out = [];
    const trip = state.trip && Array.isArray(state.trip.loaded) ? state.trip.loaded : [];
    trip.forEach(id => {
      const o = state.orders.find(x => x.id === id && !x.delivered);
      if (o && o.items) Object.keys(o.items).forEach(k => {
        if (stockOf(k) > 0 && out.indexOf(k) < 0) out.push(k);
      });
    });
    if (!out.length) Object.keys(state.stock).forEach(k => { if (stockOf(k) > 0) out.push(k); });
    return out;
  }

  function rollRoadEvent(ctx) {
    const cfg = D.ROAD_EVENTS;
    if (!cfg || !cfg.list || !cfg.list.length) return null;
    if (!state.roadEvent || typeof state.roadEvent !== 'object') {
      state.roadEvent = { key: '', count: 0 };
    }
    /* 一个阶段最多两回：按 day-phaseIdx 记窗口，换阶段自动清零 */
    const key = `${state.day}-${state.phaseIdx}`;
    if (state.roadEvent.key !== key) { state.roadEvent.key = key; state.roadEvent.count = 0; }
    if (state.roadEvent.count >= cfg.maxPerTrip) return null;
    const region = regionAt(ctx && ctx.x != null ? ctx.x : 0, ctx && ctx.y != null ? ctx.y : 0);
    const danger = (D.REGIONS[region] || {}).danger || 1;
    if (Math.random() > cfg.chance * (0.7 + danger * 0.3)) return null;
    const cargo = cargoKeys();
    const pool = cfg.list.filter(e =>
      (!e.regions || !e.regions.length || e.regions.indexOf(region) >= 0) &&
      (!e.minDay || state.day >= e.minDay) &&
      (!e.needCargo || cargo.length > 0)
    );
    if (!pool.length) return null;
    const total = pool.reduce((a, e) => a + (e.w || 1), 0);
    let r = Math.random() * total;
    let ev = pool[pool.length - 1];
    for (const e of pool) { r -= (e.w || 1); if (r <= 0) { ev = e; break; } }
    state.roadEvent.count++;
    return ev;
  }

  /* 路上事件和深夜事件共用同一套「选项效果」结算。
     除了数值增减，还能把玩家推进一场战斗、探明一个管网出口、或者记成熬夜。 */
  function applyFx(f, result) {
    f = f || {};
    let stolen = '';
    if (f.ap) state.ap = clamp(state.ap + f.ap, 0, Math.max(state.apMax || 0, state.ap));
    if (f.energy) state.energy = clamp(state.energy + f.energy, 0, 100);
    if (f.money) state.money += f.money;
    if (f.rep) state.reputation = clamp(state.reputation + f.rep, 0, 100);
    if (f.cred) Object.keys(f.cred).forEach(k => bumpCred(k, f.cred[k]));
    if (f.raw) Object.keys(f.raw).forEach(k => addInv(k, f.raw[k]));
    if (f.stock) Object.keys(f.stock).forEach(k => addStock(k, f.stock[k]));
    if (f.steal) {
      const keys = cargoKeys();
      if (keys.length) {
        const k = pick(keys);
        addStock(k, -1);
        stolen = (D.PRODUCTS[k] || {}).name || k;
      } else {
        state.money -= 20;
        stolen = '一盒没备着的糖';
      }
    }
    let tunnel = null;
    if (f.tunnel) tunnel = discoverTunnel(f.tunnel);
    if (f.late) state.flags.sleptEarly = false;   // 熬到半夜：次日元气不满
    const tunnelName = f.tunnel && D.TUNNELS.nodes[f.tunnel] ? D.TUNNELS.nodes[f.tunnel].name : '那个出口';
    const text = String(result || '')
      .replace(/\{stolen\}/g, stolen)
      .replace(/\{tunnel\}/g, tunnelName);
    return { text, battle: f.battle || null, tunnel: f.tunnel || null, tunnelName };
  }

  function applyRoadEvent(id, idx) {
    const cfg = D.ROAD_EVENTS;
    const ev = (cfg.list || []).find(e => e.id === id);
    if (!ev) return { ok: false, text: '那件事已经过去了。' };
    const ch = ev.choices[idx];
    if (!ch) return { ok: false, text: '你愣了一下，什么也没做。' };
    const out = applyFx(ch.fx, ch.result);
    log(`${ev.title}：${out.text}`, ch.good ? 'good' : 'info');
    emit(); save();
    return { ok: true, text: out.text, good: !!ch.good, battle: out.battle, tunnel: out.tunnel };
  }

  /* ---------------- 深夜特殊事件 ----------------
   * 白天跑路靠掷骰，夜里是「打烊之后有人敲门」：只在睡前阶段来一回，
   * 按天计冷却。和路上事件互不占用次数，也不会在自测页 / ?noevent 下弹出。 */
  function rollNightEvent(force) {
    const cfg = D.NIGHT_EVENTS;
    if (!cfg || !cfg.list || !cfg.list.length) return null;
    if (!phase() || phase().id !== 'night') return null;
    if (!state.nightEvent || typeof state.nightEvent !== 'object') {
      state.nightEvent = { key: '', count: 0 };
    }
    const key = String(state.day);
    if (state.nightEvent.key !== key) { state.nightEvent.key = key; state.nightEvent.count = 0; }
    if (state.nightEvent.count >= (cfg.maxPerNight || 1)) return null;
    /* force 给睡前那个「再听一听」的主动动作：跳过概率，但一晚仍然至多一回 */
    if (!force && Math.random() > (cfg.chance || 0)) return null;
    const pool = cfg.list.filter(e => !e.minDay || state.day >= e.minDay);
    if (!pool.length) return null;
    const total = pool.reduce((a, e) => a + (e.w || 1), 0);
    let r = Math.random() * total;
    let ev = pool[pool.length - 1];
    for (const e of pool) { r -= (e.w || 1); if (r <= 0) { ev = e; break; } }
    state.nightEvent.count++;
    return ev;
  }

  function applyNightEvent(id, idx) {
    const cfg = D.NIGHT_EVENTS || {};
    const ev = (cfg.list || []).find(e => e.id === id);
    if (!ev) return { ok: false, text: '门外已经没人了。' };
    const ch = ev.choices[idx];
    if (!ch) return { ok: false, text: '你站了一会儿，什么也没发生。' };
    const out = applyFx(ch.fx, ch.result);
    log(`${ev.title}：${out.text}`, ch.good ? 'good' : 'info');
    emit(); save();
    return { ok: true, text: out.text, good: !!ch.good, battle: out.battle, tunnel: out.tunnel };
  }

  /* ---------------- 回合制战斗 ----------------
   * 没有经验值，也没有装备栏：一场冲突从 state.energy 推出血量，
   * 打完把损耗折回去。糖是唯一的道具——扔出去砸晕一回合，吃掉回气回血。
   * 战斗对象整个进存档，半途读档能接着打；打完留一页结果，点收起才清掉。 */
  function combatStats() {
    if (!state.combat || typeof state.combat !== 'object') state.combat = { wins: 0, losses: 0, fled: 0 };
    ['wins', 'losses', 'fled'].forEach(k => {
      if (typeof state.combat[k] !== 'number' || state.combat[k] < 0) state.combat[k] = 0;
    });
    return state.combat;
  }
  function battleMaxHp() {
    return Math.round(D.COMBAT.hpBase + state.energy * D.COMBAT.hpPerEnergy);
  }
  function startBattle(enemyId) {
    const C = D.COMBAT, en = C.enemies[enemyId];
    if (!en) return { ok: false, msg: '这儿没架可打。' };
    if (state.battle && !state.battle.over) return { ok: false, msg: '眼前这场还没打完。' };
    const mhp = battleMaxHp();
    state.battle = {
      enemy: enemyId, hp: mhp, maxHp: mhp,
      ehp: en.hp, eMaxHp: en.hp,
      turn: 1, guard: false, stun: 0, over: false, win: false,
      text: '', lines: [en.intro]
    };
    log(`遇上${en.name}。${en.intro}`, 'bad');
    emit(); save();
    return { ok: true };
  }
  function battlePush(b, s) { b.lines.push(s); if (b.lines.length > 6) b.lines.shift(); }

  function finishBattle(win, b) {
    const C = D.COMBAT, en = C.enemies[b.enemy];
    const lost = b.maxHp - b.hp;
    state.energy = clamp(state.energy - lost * C.hpToEnergy, 0, 100);
    b.over = true;
    b.win = win;
    if (win) {
      const rw = en.reward || {};
      if (rw.money) state.money += rw.money;
      if (rw.rep) state.reputation = clamp(state.reputation + rw.rep, 0, 100);
      if (rw.raw) Object.keys(rw.raw).forEach(k => addInv(k, rw.raw[k]));
      if (rw.cred) Object.keys(rw.cred).forEach(k => bumpCred(k, rw.cred[k]));
      combatStats().wins++;
      b.text = `${en.win} 到手 ${rw.money || 0}G${rw.rep ? `、信誉 +${rw.rep}` : ''}。`;
      log(`打赢了${en.name}：${b.text}`, 'good');
    } else {
      state.money -= C.loseMoney;
      state.reputation = clamp(state.reputation - C.loseRep, 0, 100);
      const keys = cargoKeys();
      if (keys.length) addStock(pick(keys), -1);
      combatStats().losses++;
      b.text = `${en.lose} 丢了 ${C.loseMoney}G、信誉 -${C.loseRep}，元气按伤势折了 ${Math.round(lost * C.hpToEnergy)} 点。`;
      log(`没打过${en.name}：${b.text}`, 'bad');
    }
    battlePush(b, b.text);
  }

  function battleAct(move) {
    const b = state.battle;
    if (!b || b.over) return { ok: false, msg: '这场已经结束了。' };
    const C = D.COMBAT, en = C.enemies[b.enemy];
    b.guard = false;

    if (move === 'attack') {
      const dmg = Math.max(1, C.atkBase + Math.floor(state.energy / C.atkEnergyDiv)
        + rand(C.atkRand) - en.def);
      b.ehp = Math.max(0, b.ehp - dmg);
      battlePush(b, `第 ${b.turn} 回合：你抡过去，${dmg} 点伤害。`);
    } else if (move === 'guard') {
      b.guard = true;
      b.hp = Math.min(b.maxHp, b.hp + C.guardHeal);
      battlePush(b, `第 ${b.turn} 回合：你架起货箱，缓了口气（+${C.guardHeal}）。`);
    } else if (move === 'candy' || move === 'eat') {
      const keys = cargoKeys();
      if (!keys.length) return { ok: false, msg: '车上一颗糖都没有。' };  // 不白耗一回合
      const k = keys[0], pname = (D.PRODUCTS[k] || {}).name || '糖';
      addStock(k, -1);
      if (move === 'candy') {
        const dmg = Math.max(1, C.candyBonus + Math.floor(state.energy / C.atkEnergyDiv)
          + rand(2) - en.def);
        b.ehp = Math.max(0, b.ehp - dmg);
        b.stun = 1;
        battlePush(b, `第 ${b.turn} 回合：一盒${pname}砸过去，${dmg} 点伤害，它愣住了。`);
      } else {
        b.hp = Math.min(b.maxHp, b.hp + C.eatHeal);
        state.energy = clamp(state.energy + C.eatEnergy, 0, 100);
        battlePush(b, `第 ${b.turn} 回合：就着${pname}喘了口气，回了些气力。`);
      }
    } else if (move === 'flee') {
      if (Math.random() < C.fleeChance) {
        combatStats().fled++;
        state.energy = clamp(state.energy - 6, 0, 100);
        b.over = true; b.win = false;
        b.text = '你掉头钻进巷子，车链子哗啦响了一路。元气 -6。';
        battlePush(b, b.text);
        log(`从${en.name}手底脱身。`, 'info');
        emit(); save();
        return { ok: true, over: true, win: false, fled: true };
      }
      battlePush(b, `第 ${b.turn} 回合：没跑掉，脚下一滑被堵了回来。`);
    } else {
      return { ok: false, msg: '没这个动作。' };
    }

    if (b.ehp <= 0) {
      finishBattle(true, b);
    } else if (b.stun > 0) {
      b.stun--;
      battlePush(b, `${en.name}还晕着，这一回合没动。`);
      b.turn++;
    } else {
      const raw = Math.max(1, en.atk + rand(3) - 1);
      const dmg = Math.max(1, Math.round(raw * (b.guard ? 1 - C.guardCut : 1)));
      b.hp = Math.max(0, b.hp - dmg);
      battlePush(b, `${en.taunt} 你挨了 ${dmg} 点${b.guard ? '（架住大半）' : ''}。`);
      if (b.hp <= 0) finishBattle(false, b);
      else b.turn++;
    }
    emit(); save();
    return { ok: true, over: b.over, win: b.win };
  }

  function closeBattle() { state.battle = null; emit(); save(); }
  function battleInfo() { return state.battle; }

  /* ---------------- 存档 ----------------
   * 自动存档（SAVE_KEY）：每次动作后写一份，标题页「继续上次」读它。
   * 手动存档（SLOT_PREFIX + 1..3）：随时存、随时读，三个槽互不干扰。
   * 存档格式 { v:2, savedAt, data }；读取时兼容旧版裸 state，方便老档继续用。
   */
  const SLOT_MAX = 3;

  function blankState() {
    return {
      day: 1, phaseIdx: 0, ap: 0, apMax: 0,
      money: 320, energy: 100, reputation: 50,
      inv: {}, stock: {}, orders: [],
      vehicle: 'bike', ownedVehicles: ['bike'],
      recipes: classicKeys(),
      stats: { sold: 0, delivered: 0, made: 0, earned: 0 },
      flags: { intro: false, metro: true },
      log: [], orderSeq: 1, dayDelivered: 0, daySold: 0, dayRevenue: 0, lastSleepDay: 0,
      people: {},
      shop: { counter: 1, case: 1, oven: 1 },
      staff: [], staffPost: {}, dayMade: 0,
      billsToday: { home: 0, utility: 0, wage: 0, lic: 0, total: 0 }, billLog: [],
      cred: { fulfill: D.CRED.start.fulfill, compliance: D.CRED.start.compliance, supply: D.CRED.start.supply },
      rank: 'D', wear: 0, week: { start: 1, revenue: 0, delivered: 0, onTime: 0 },
      license: { due: D.COSTS.licenseEvery }, payables: [], gear: {},
      tutorial: { on: false, step: 0, orderId: 0 }, purchases: [], purchaseSeq: 1,
      story: { chapter: null, step: 0, flags: {}, done: [], items: {}, clues: [] },
      trip: { loaded: [], mode: null, wentOut: false, onMap: false },
      roadEvent: { key: '', count: 0 },
      takeout: { enabled: false, orders: [], seq: 1, stats: { done: 0, earned: 0 }, last: null },
      mods: [],
      bases: [],
      tunnels: { seen: ['snail'], uses: 0, last: null },
      nightEvent: { key: '', count: 0 },
      battle: null,
      combat: { wins: 0, losses: 0, fled: 0 }
    };
  }

  /* ---------------- 结档 ----------------
   * 结档不是「失败」：店还在，只是这一档到此为止，留一张成绩单。
   * 主线没走完也能结——母亲留下的那家小店，已经不是她离开时那家店了。
   * 记录存在 localStorage 里（最多 10 条），当前进度清空后开新的一档。
   */
  const RETIRE_KEY = 'candyhouse_retired_v1';

  function retireSummary() {
    const rk = rankInfo();
    const verdict = {
      D: '糖果屋还亮着灯。蜗牛巷的人记得你，仅此而已。',
      C: '巷口的招牌擦干净了。有人专门绕路过来买糖。',
      B: '新都的评价单上出现了「糖果屋」三个字。',
      A: '城里人开始把你的糖当礼物送人。',
      S: '别人拿糖果屋当坐标。母亲若回来，会先看到这块招牌。'
    }[state.rank] || '';
    return {
      at: Date.now(),
      day: state.day,
      rank: state.rank,
      rankName: rk.name,
      reputation: Math.round(state.reputation),
      earned: Math.round(state.stats.earned || 0),
      delivered: state.stats.delivered || 0,
      sold: state.stats.sold || 0,
      made: state.stats.made || 0,
      people: peopleList().length,
      cred: {
        fulfill: Math.round(credVal('fulfill')),
        compliance: Math.round(credVal('compliance')),
        supply: Math.round(credVal('supply'))
      },
      verdict
    };
  }
  function retireList() {
    try { return JSON.parse(localStorage.getItem(RETIRE_KEY) || '[]'); } catch (e) { return []; }
  }
  function retire() {
    const rec = retireSummary();
    try {
      const list = retireList();
      list.unshift(rec);
      if (list.length > 10) list.length = 10;
      localStorage.setItem(RETIRE_KEY, JSON.stringify(list));
    } catch (e) { /* 存不下也不能拦着玩家结档 */ }
    wipeSave();
    newGame();
    return { ok: true, rec, count: retireList().length };
  }

  function snapshot() { return JSON.parse(JSON.stringify(state)); }

  function envelope() {
    return JSON.stringify({ v: 2, savedAt: Date.now(), data: snapshot() });
  }

  /* 解出 { data, savedAt }；旧版直接存 state 的档案也能认 */
  function unwrap(raw) {
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return null;
      if (o.data && typeof o.data === 'object') return { data: o.data, savedAt: o.savedAt || 0 };
      return { data: o, savedAt: 0 };
    } catch (e) { return null; }
  }

  function writeKey(key) {
    try { localStorage.setItem(key, envelope()); return true; } catch (e) { return false; }
  }

  /* 先铺一份干净的默认值，再盖存档——老档缺字段时不会残留上一局的数据 */
  function applyData(data) {
    Object.assign(state, blankState());
    Object.assign(state, data);
    if (!state.stats) state.stats = { sold: 0, delivered: 0, made: 0, earned: 0 };
    if (!state.flags) state.flags = { intro: false, metro: true };
    if (!Array.isArray(state.orders)) state.orders = [];
    if (!Array.isArray(state.log)) state.log = [];
    if (!Array.isArray(state.ownedVehicles) || !state.ownedVehicles.length) state.ownedVehicles = ['bike'];
    if (!state.people || typeof state.people !== 'object' || Array.isArray(state.people)) state.people = {};
    // 配方：老档是全量数组，过滤掉已经不存在的 key；缺字段就退回基础线
    if (!Array.isArray(state.recipes)) state.recipes = classicKeys();
    else state.recipes = state.recipes.filter(k => !!D.PRODUCTS[k]);
    // 老档没有店铺字段：补成 lv1（等于没升级），账本清零，行为与升级前一致
    if (!state.shop || typeof state.shop !== 'object') state.shop = { counter: 1, case: 1, oven: 1 };
    Object.keys(D.SHOP_UPGRADES).forEach(k => {
      const max = D.SHOP_UPGRADES[k].levels.length;
      const v = Math.round(state.shop[k] || 1);
      state.shop[k] = Math.max(1, Math.min(max, v));
    });
    if (!Array.isArray(state.staff)) state.staff = [];
    state.staff = state.staff.filter(id => D.APPRENTICES.some(t => t.id === id));
    /* 老档的「欠账」折成透支：现金直接减掉，字段从此不用了。
       这是从「欠房东」模型搬到「现金可为负」模型唯一的迁移动作。 */
    if (typeof state.arrear === 'number' && state.arrear > 0) {
      state.money -= state.arrear;
    }
    state.arrear = 0;
    if (typeof state.dayMade !== 'number' || !(state.dayMade >= 0)) state.dayMade = 0;
    if (typeof state.dayRevenue !== 'number' || !(state.dayRevenue >= 0)) state.dayRevenue = 0;
    if (!state.billsToday || typeof state.billsToday !== 'object') {
      state.billsToday = { home: 0, utility: 0, wage: 0, lic: 0, total: 0 };
    }
    if (typeof state.billsToday.lic !== 'number') state.billsToday.lic = 0;
    /* 三条软失败线 / 评级 / 磨损 / 周考核窗口 / 执照 / 赊账：老档一律补默认值 */
    if (!state.cred || typeof state.cred !== 'object') state.cred = { ...D.CRED.start };
    CRED_KEYS.forEach(k => {
      if (typeof state.cred[k] !== 'number' || !isFinite(state.cred[k])) {
        state.cred[k] = D.CRED.start[k];
      }
      state.cred[k] = clamp(state.cred[k], 0, 100);
    });
    if (!D.RANKS.some(r => r.id === state.rank)) state.rank = 'D';
    if (typeof state.wear !== 'number' || !(state.wear >= 0)) state.wear = 0;
    state.wear = clamp(state.wear, 0, 100);
    if (!state.week || typeof state.week !== 'object') {
      state.week = { start: state.day, revenue: 0, delivered: 0, onTime: 0 };
    }
    if (!state.license || typeof state.license.due !== 'number') {
      state.license = { due: state.day + D.COSTS.licenseEvery };
    }
    if (!state.staffPost || typeof state.staffPost !== 'object') state.staffPost = {};
    if (!state.gear || typeof state.gear !== 'object') state.gear = {};
    if (!state.tutorial || typeof state.tutorial !== 'object') {
      state.tutorial = { on: false, step: 0, orderId: 0 };
    }
    if (!Array.isArray(state.purchases)) state.purchases = [];
    if (typeof state.purchaseSeq !== 'number') state.purchaseSeq = 1 + state.purchases.length;
    if (!Array.isArray(state.payables)) state.payables = [];
    state.payables = state.payables
      .filter(p => p && typeof p.amt === 'number' && p.amt > 0)
      .map(p => ({ day: p.day || state.day, amt: Math.round(p.amt), due: p.due || state.day + D.COSTS.creditDays, late: p.late || 0 }));
    if (!Array.isArray(state.billLog)) state.billLog = [];
    /* 老档的账本记的是「房租」（rent）——现在改成「家用」（home）。
       旧条目原样搬过来，免得历史行显示 undefined 和 NaN。 */
    state.billLog = state.billLog.map(b => {
      if (!b || typeof b !== 'object') return null;
      if (b.home === undefined && b.rent !== undefined) {
        return { day: b.day, home: b.rent, utility: b.utility || 0, wage: b.wage || 0, total: b.total || 0 };
      }
      return b;
    }).filter(Boolean);
    if (!D.VEHICLES[state.vehicle]) state.vehicle = 'bike';
    if (!D.PHASES[state.phaseIdx]) state.phaseIdx = 0;
    // 老档没有 story 字段：补成「不跑主线」，免得读到一半崩在 GameStory 里
    if (!state.story || typeof state.story !== 'object') {
      state.story = { chapter: null, step: 0, flags: {}, done: [], items: {}, clues: [] };
    } else {
      const s = state.story;
      if (typeof s.step !== 'number') s.step = 0;
      if (!s.flags) s.flags = {};
      if (!Array.isArray(s.done)) s.done = [];
      if (!s.items) s.items = {};
      if (!Array.isArray(s.clues)) s.clues = [];
    }
    /* 配送现场：老档没有这个字段就当「还没出门」。
       loaded 只留还没送达、并且确实存在的订单，免得读到半途的旧档带出一串幽灵单。 */
    if (!state.trip || typeof state.trip !== 'object') {
      state.trip = { loaded: [], mode: null, wentOut: false, onMap: false };
    }
    const tr = state.trip;
    if (!Array.isArray(tr.loaded)) tr.loaded = [];
    tr.loaded = tr.loaded.filter(id => state.orders.some(o => o.id === id && !o.delivered));
    if (tr.mode !== 'delivery' && tr.mode !== 'walk') tr.mode = null;
    tr.wentOut = !!tr.wentOut;
    tr.onMap = !!tr.onMap;
    if (!state.roadEvent || typeof state.roadEvent !== 'object') state.roadEvent = { key: '', count: 0 };
    if (typeof state.roadEvent.count !== 'number' || state.roadEvent.count < 0) state.roadEvent.count = 0;
    if (typeof state.roadEvent.key !== 'string') state.roadEvent.key = '';
    /* 老档补出外卖字段；订单只留还没处理完的，免得读到幽灵单 */
    const t = takeoutState();
    t.enabled = !!t.enabled;
    t.orders = t.orders.filter(o => o && typeof o.id === 'number' &&
      (o.status === 'new' || o.status === 'ready') && o.items && typeof o.items === 'object');
    if (t.last && typeof t.last !== 'object') t.last = null;
    if (!Array.isArray(state.mods)) state.mods = [];
    state.mods = state.mods.filter(id => D.VEHICLE_MODS.some(m => m.id === id));
    if (!Array.isArray(state.bases)) state.bases = [];
    state.bases = state.bases.filter(id => !!D.BASES[id]);
    /* 管网：老档没有就只认家门口那个井盖；非法 id 一律丢掉 */
    if (!state.tunnels || typeof state.tunnels !== 'object') {
      state.tunnels = { seen: ['snail'], uses: 0, last: null };
    }
    if (!Array.isArray(state.tunnels.seen)) state.tunnels.seen = ['snail'];
    state.tunnels.seen = state.tunnels.seen.filter(id => !!D.TUNNELS.nodes[id]);
    if (state.tunnels.seen.indexOf('snail') < 0) state.tunnels.seen.unshift('snail');
    if (typeof state.tunnels.uses !== 'number' || state.tunnels.uses < 0) state.tunnels.uses = 0;
    if (!state.nightEvent || typeof state.nightEvent !== 'object') {
      state.nightEvent = { key: '', count: 0 };
    }
    if (typeof state.nightEvent.count !== 'number' || state.nightEvent.count < 0) state.nightEvent.count = 0;
    if (typeof state.nightEvent.key !== 'string') state.nightEvent.key = '';
    if (!state.combat || typeof state.combat !== 'object') state.combat = { wins: 0, losses: 0, fled: 0 };
    ['wins', 'losses', 'fled'].forEach(k => {
      if (typeof state.combat[k] !== 'number' || state.combat[k] < 0) state.combat[k] = 0;
    });
    /* 半途读档：战斗对象不合法就当没打过，别把玩家卡在一个空弹窗里 */
    if (state.battle && (!D.COMBAT || !D.COMBAT.enemies[state.battle.enemy] ||
        typeof state.battle.hp !== 'number' || typeof state.battle.ehp !== 'number')) {
      state.battle = null;
    }
  }

  function save() { return writeKey(SAVE_KEY); }

  function load() {
    const s = unwrap(localStorage.getItem(SAVE_KEY));
    if (!s) return false;
    applyData(s.data);
    return true;
  }

  function hasSave() { return !!unwrap(localStorage.getItem(SAVE_KEY)); }
  function wipeSave() { localStorage.removeItem(SAVE_KEY); }

  /* ---- 槽位 ---- */
  function slotKey(n) { return SLOT_PREFIX + n; }

  function infoOf(key, n) {
    const s = unwrap(localStorage.getItem(key));
    if (!s) return { n, exists: false, savedAt: 0, day: 0, phase: '', money: 0, rep: 0, energy: 0 };
    const d = s.data || {};
    return {
      n, exists: true, savedAt: s.savedAt || 0,
      day: d.day || 1,
      phase: (D.PHASES[d.phaseIdx] || {}).name || '',
      money: Math.round(d.money || 0),
      rep: Math.round(d.reputation || 0),
      energy: Math.round(d.energy || 0)
    };
  }

  function slotInfo(n) { return infoOf(slotKey(n), n); }

  function slotList() {
    const out = [];
    for (let i = 1; i <= SLOT_MAX; i++) out.push(slotInfo(i));
    return out;
  }

  function autoInfo() { return infoOf(SAVE_KEY, 0); }

  function saveSlot(n) {
    if (!(n >= 1 && n <= SLOT_MAX)) return { ok: false, msg: '没有这个槽位。' };
    if (!writeKey(slotKey(n))) return { ok: false, msg: '写不进去，浏览器存储可能满了。' };
    return { ok: true, msg: `已保存到槽位 ${n}` };
  }

  function loadSlot(n) {
    const s = unwrap(localStorage.getItem(slotKey(n)));
    if (!s) return { ok: false, msg: '这个槽位还是空的。' };
    applyData(s.data);
    emit();
    return { ok: true, msg: `已读取槽位 ${n}` };
  }

  function deleteSlot(n) {
    localStorage.removeItem(slotKey(n));
    return { ok: true, msg: `槽位 ${n} 已清空` };
  }

  return {
    state, onChange, emit, log, clamp, rand, pick,
    phase, isLastPhase, startPhase, spendAP, gainAP, endPhase, endDay, newGame,
    invOf, stockOf, addInv, addStock, totalStockUnits,
    isUnlocked, productKeys, lineKeys, lineList, lineUnlocked, buyBook,
    makeOrder, generatePhoneOrders, phoneCustomers, orderUnits, capacity, orders: () => state.orders,
    phoneOrderCount, fameChance, orderCap,
    personOf, peopleList, bumpTrust, trustTier,
    upLv, upInfo, upAll, buyUpgrade, caseMul, ovenSalvage, apCostOf, successRate,
    apprenticeList, hireApprentice, fireApprentice, staffAP, dailyWage, STAFF_MAX,
    apprenticeUnlocked, joinStoryApprentice,
    staffOnCounter, staffPostOf, assignStaff, staffCounterShift, staffCouriers, courierShift, startTutorial,
    bulkQuote, placePurchase, pendingPurchases, arrivePurchases, phaseLinear,
    thirdPartyList, thirdPartyFee, thirdParty,
    billsPreview, homeShare,
    credVal, credAvg, credList, bumpCred, CRED_KEYS,
    rankInfo, rankAtLeast, rankIndex, weeklyReview, bookRank,
    wearRate, wearPenalty, maintainCost, maintain,
    licenseDue, licenseDays, creditInfo, creditRoom, settlePayables, canOddJob, oddJob,
    retire, retireSummary, retireList, metroAdj, metroDist, metroCost,
    clockText, metroOpen, metroFare, rideMetro, rideTransit,
    tunnelState, tunnelSeen, tunnelNodeIds, tunnelEntryOf, discoverTunnel,
    tunnelDist, tunnelCost, tunnelTrip, useTunnel,
    sensitiveGoods, hasGear, gearInfo, buyGear, securityCheck,
    regionAt, cargoKeys, rollRoadEvent, applyRoadEvent,
    rollNightEvent, applyNightEvent,
    combatStats, battleMaxHp, startBattle, battleAct, closeBattle, battleInfo,
    takeoutState, takeoutUnlocked, takeoutHas, openTakeout,
    rollTakeoutOrders, packTakeout, settleTakeout,
    takeoutOrders: () => takeoutState().orders,
    buyVehicle, selectVehicle, buyRaw, canCraft, craft, sell,
    modsOwned, modBonus, modApMul, modSpeed, buyMod,
    basesOwned, buyBase, baseProduce,
    counterServe, counterRefuse, counterMake, useAP,
    deliverOrders, pickupOrder, cancelOrder, extendOrder, sleep, rest,
    restNap, overtime, nightRecovery,
    callCab, walkHome,
    save, load, applyData, hasSave, wipeSave,
    SLOT_MAX, slotList, slotInfo, autoInfo, saveSlot, loadSlot, deleteSlot
  };
})();
