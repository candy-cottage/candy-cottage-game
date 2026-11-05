/* ============================================================
 *  糖果屋 · 新都蜗牛巷  —  数据层
 * ============================================================ */
window.GameData = (function () {
  const TILE = 16;
  const WORLD = { w: 96, h: 64 };

  /* ---------- 区域 ---------- */
  const REGIONS = {
    snail: {
      id: 'snail', name: '蜗牛巷', rect: [26, 34, 14, 11],
      ground: '#4b4a56', edge: '#5e5b6c', danger: 1,
      light: '#ffd27a', label: '旧城老街，青石板路，深夜有猫'
    },
    oldtown: {
      id: 'oldtown', name: '旧城中心', rect: [28, 18, 20, 14],
      ground: '#55525f', edge: '#686574', danger: 2,
      light: '#ffcf8a', label: '电车叮当，商铺林立，烟火气'
    },
    industry: {
      id: 'industry', name: '城南工业区', rect: [14, 36, 16, 12],
      ground: '#4d463f', edge: '#60564b', danger: 4,
      light: '#c88a5a', label: '废弃仓库，锈迹斑斑，影狼组地盘'
    },
    island: {
      id: 'island', name: '新岛', rect: [72, 16, 18, 14],
      ground: '#5b6472', edge: '#6f798b', danger: 3,
      light: '#9fd0ff', label: '玻璃幕墙，霓虹灯，安检严格'
    },
    docks: {
      id: 'docks', name: '码头区', rect: [3, 14, 16, 14],
      ground: '#4a4f58', edge: '#5c626d', danger: 2,
      light: '#8fb8d8', label: '集装箱，起重机，海风腥咸'
    },
    hill: {
      id: 'hill', name: '北山墓地', rect: [24, 3, 18, 11],
      ground: '#37402f', edge: '#48543c', danger: 1,
      light: '#93b98a', label: '荒僻，松柏，眺望全城'
    },
    academy: {
      id: 'academy', name: '学院区', rect: [44, 40, 14, 12],
      ground: '#4e4862', edge: '#615a80', danger: 2,
      light: '#c3a8ff', label: '钟楼，书卷气，奥术余晖'
    }
  };

  /* ---------- 道路（矩形：[x, y, w, h]）---------- */
  const ROADS = [
    [32, 12, 3, 8],    // 北山盘山路 → 旧城
    [18, 22, 12, 3],   // 码头 → 旧城
    [34, 30, 3, 6],    // 旧城 → 蜗牛巷
    [20, 40, 8, 3],    // 城南 → 蜗牛巷
    [38, 44, 8, 3],    // 蜗牛巷 → 学院
    [48, 22, 26, 3],   // 跨海大桥（旧城 → 新岛）
    [28, 44, 3, 4],    // 城南 → 学院（支路）
    [48, 30, 3, 16],   // 旧城东侧 → 学院
    [10, 26, 3, 12],   // 码头南侧
    [56, 44, 4, 3]     // 学院 → 海堤
  ];

  /* ---------- 地点 ---------- */
  // x,y = 建筑左上角（tile）；w,h = 建筑尺寸；door 自动计算
  const LOCATIONS = [
    /* 蜗牛巷 */
    { id: 'shop', name: '糖果屋', region: 'snail', x: 30, y: 37, w: 6, h: 4, wall: '#8e5470', roof: '#c0607f', kind: 'shop', action: 'shop', desc: '母亲留下的糖果屋，整条巷子最亮的光源。' },
    { id: 'fruitstand', name: '巷口水果摊', region: 'snail', x: 27, y: 41, w: 2, h: 2, wall: '#6f7a4a', roof: '#94a25d', kind: 'stall', action: 'buy', desc: '老周的摊子，水果便宜，偶尔多送两个。' },
    { id: 'tree', name: '老梧桐树', region: 'snail', x: 36, y: 41, w: 2, h: 2, wall: '#3f5a3a', roof: '#4d6b45', kind: 'tree', action: 'mailbox', desc: '树干上钉着绿色信箱，全巷子的信都走这里。' },
    { id: 'backwall', name: '后院矮墙', region: 'snail', x: 35, y: 44, w: 2, h: 1, wall: '#5a5550', roof: '#6b665f', kind: 'wall', action: 'hint', desc: '翻过去是邻居家的院子，据说直通地下井盖。' },
    { id: 'laundry', name: '通宵洗衣店', region: 'snail', x: 37, y: 35, w: 3, h: 2, wall: '#54606b', roof: '#6d7b88', kind: 'shop', action: 'hint', desc: '整夜亮着灯。柜台后的老人只读报纸，不问闲事。' },

    /* 旧城中心 */
    { id: 'market', name: '综合市场', region: 'oldtown', x: 30, y: 20, w: 5, h: 3, wall: '#7a6a52', roof: '#a08a63', kind: 'shop', action: 'buy', desc: '什么都有，什么都贵一点。人声鼎沸。' },
    { id: 'busstop', name: '公交总站', region: 'oldtown', x: 40, y: 20, w: 4, h: 3, wall: '#5c6470', roof: '#78828f', kind: 'shop', action: 'bus', desc: '蓝白配色的电车进进出出，叮当作响。' },
    { id: 'bookstore', name: '旧书店', region: 'oldtown', x: 34, y: 26, w: 3, h: 3, wall: '#6b5544', roof: '#8a6d55', kind: 'shop', action: 'book', desc: '尘味和纸味混在一起，店主在打盹。' },
    { id: 'postoffice', name: '旧城邮局', region: 'oldtown', x: 37, y: 29, w: 4, h: 2, wall: '#5a4a5a', roof: '#7d6b7d', kind: 'shop', action: 'hint', desc: '绿色的铁皮柜台。邮差小跑一天要跑三趟，全靠糖撑着。' },
    { id: 'plaza', name: '中央广场', region: 'oldtown', x: 42, y: 26, w: 4, h: 3, wall: '#5f5a68', roof: '#7d7689', kind: 'plaza', action: 'hint', desc: '喷泉干了半年，鸽子还在。' },
    { id: 'metro_old', name: '旧城中心站', region: 'oldtown', x: 38, y: 23, w: 2, h: 2, wall: '#3f4a63', roof: '#5a6b8c', kind: 'metro', action: 'metro', desc: '1/2/3 号线换乘，永远有人在赶末班车。' },

    /* 城南工业区 */
    { id: 'silverfox', name: '银狐酒吧', region: 'industry', x: 16, y: 38, w: 4, h: 3, wall: '#4a3a4a', roof: '#6b4f6b', kind: 'bar', action: 'bar', desc: '影狼组据点。霓虹灯管坏了一半，还在闪。' },
    { id: 'garage', name: '修车铺', region: 'industry', x: 21, y: 38, w: 4, h: 3, wall: '#4d4a3f', roof: '#6d6754', kind: 'shop', action: 'garage', desc: '机油味。老板娘娜娜能修一切带轮子的东西。' },
    { id: 'bathhouse', name: '城南澡堂', region: 'industry', x: 20, y: 43, w: 3, h: 2, wall: '#4a5a52', roof: '#67806f', kind: 'shop', action: 'hint', desc: '烟囱整天冒白汽。下夜班的人先来泡一泡，再买点甜的回家。' },
    { id: 'warehouse', name: '废弃仓库', region: 'industry', x: 15, y: 43, w: 5, h: 3, wall: '#463f38', roof: '#5c534a', kind: 'ruin', action: 'hint', desc: '门锁被剪断了，里面有人住过的痕迹。' },
    { id: 'tunnel_sc', name: '城南地道口', region: 'industry', x: 23, y: 43, w: 2, h: 2, wall: '#332f2b', roof: '#443e38', kind: 'hole', action: 'hint', desc: '铁栅栏后面是往下的楼梯，风里有铁锈味。' },

    /* 新岛 */
    { id: 'checkpoint', name: '安检站', region: 'island', x: 73, y: 21, w: 3, h: 3, wall: '#5a6a80', roof: '#7d92ad', kind: 'gate', action: 'hint', desc: '魔法监测摄像头缓慢转动，红灯一直亮着。' },
    { id: 'council', name: '议会办公楼', region: 'island', x: 79, y: 18, w: 5, h: 4, wall: '#6b7890', roof: '#8fa0bb', kind: 'tower', action: 'hint', desc: '玻璃幕墙映着整片海。没人知道里面在决定什么。' },
    { id: 'auction', name: '地下拍卖会场', region: 'island', x: 84, y: 25, w: 3, h: 3, wall: '#3b3550', roof: '#544a72', kind: 'ruin', action: 'hint', desc: '招牌写着"仓库出租"。门童的领结比米莉整月收入还贵。' },
    { id: 'cafe', name: '新岛咖啡厅', region: 'island', x: 73, y: 26, w: 3, h: 2, wall: '#4f4a5a', roof: '#726b85', kind: 'shop', action: 'hint', desc: '玻璃柜台里摆着别家的甜点。诺亚一直想换成糖果屋的。' },

    /* 码头区 */
    { id: 'depot7', name: '第七仓库', region: 'docks', x: 5, y: 16, w: 5, h: 3, wall: '#4a5058', roof: '#616a74', kind: 'ruin', action: 'hint', desc: '渡鸦的安全屋。敲门要三长两短。' },
    { id: 'pier', name: '渔船码头', region: 'docks', x: 8, y: 24, w: 4, h: 2, wall: '#4d5a63', roof: '#6b7d88', kind: 'stall', action: 'boat', desc: '可以去新岛，比大桥快，也更贵。' },
    { id: 'containers', name: '集装箱区', region: 'docks', x: 14, y: 18, w: 4, h: 4, wall: '#5a4a3f', roof: '#7a6350', kind: 'ruin', action: 'hint', desc: '堆得像迷宫，编号被人涂改过。' },
    { id: 'shipyard', name: '修船厂', region: 'docks', x: 4, y: 22, w: 3, h: 3, wall: '#454e56', roof: '#5c6871', kind: 'shop', action: 'garage', desc: '大船进不来，小船修不起。老板脾气很差。' },
    { id: 'metro_dock', name: '码头站', region: 'docks', x: 12, y: 25, w: 2, h: 2, wall: '#3f4a63', roof: '#5a6b8c', kind: 'metro', action: 'metro', desc: '1 号线起点。海风灌进站台。' },

    /* 北山墓地 */
    { id: 'church', name: '旧教堂', region: 'hill', x: 30, y: 5, w: 4, h: 4, wall: '#5a5148', roof: '#7a6f63', kind: 'church', action: 'hint', desc: '彩色玻璃碎了一角，光从缺口漏进来。' },
    { id: 'graveyard', name: '墓地', region: 'hill', x: 36, y: 8, w: 4, h: 3, wall: '#3e4438', roof: '#4e5645', kind: 'grave', action: 'hint', desc: '母亲的名字不在这里。米莉查过三次。' },
    { id: 'lookout', name: '观景台', region: 'hill', x: 26, y: 9, w: 3, h: 2, wall: '#4a5244', roof: '#5d6755', kind: 'plaza', action: 'hint', desc: '整座新都摊在脚下，糖果屋的灯小得像一粒糖。' },
    { id: 'teahouse', name: '山下茶馆', region: 'hill', x: 35, y: 11, w: 3, h: 2, wall: '#5a4a3f', roof: '#7a6350', kind: 'shop', action: 'hint', desc: '上山下山的人都在这里歇脚。老板娘秦姨记性极好，谁的口味都记得。' },

    /* 学院区 */
    { id: 'academy', name: '魔法学院', region: 'academy', x: 47, y: 42, w: 5, h: 4, wall: '#5b5280', roof: '#7f72ad', kind: 'tower', action: 'hint', desc: '钟楼每小时敲一次，敲完会有一阵橙花香。' },
    { id: 'metro_acad', name: '学院站', region: 'academy', x: 52, y: 46, w: 2, h: 2, wall: '#3f4a63', roof: '#5a6b8c', kind: 'metro', action: 'metro', desc: '3/4 号线终点。学生把这里当自习室。' },
    { id: 'metro_snail', name: '蜗牛巷站', region: 'snail', x: 27, y: 36, w: 2, h: 2, wall: '#3f4a63', roof: '#5a6b8c', kind: 'metro', action: 'metro', desc: '3 号线。出口在老梧桐树旁，走一分钟到家。' },
    { id: 'metro_ind', name: '城南站', region: 'industry', x: 19, y: 46, w: 2, h: 2, wall: '#3f4a63', roof: '#5a6b8c', kind: 'metro', action: 'metro', desc: '2/4 号线。站厅的灯管一半是灭的。' },
    { id: 'metro_island', name: '新岛站', region: 'island', x: 75, y: 16, w: 2, h: 2, wall: '#3f4a63', roof: '#5a6b8c', kind: 'metro', action: 'metro', desc: '1/4 号线。出站就是安检。' }
  ];

  /* ---------- 送货目的地白名单 ----------
   * 订单只往这里面的地点送。糖果屋（shop）是自己家，绝不能出现"送到自己家"；
   * 地铁站只是换乘点、老梧桐树/矮墙/墓地没有门，也都不算收货地址。
   * 以后加地点想让它能收货，往这里加一个 id 就行。
   */
  const DELIVER_LOCS = [
    'busstop', 'academy', 'pier', 'council', 'garage', 'silverfox', 'market',
    'plaza', 'church', 'warehouse', 'containers', 'lookout', 'bookstore',
    'laundry', 'shipyard', 'auction', 'depot7', 'checkpoint',
    'postoffice', 'bathhouse', 'teahouse', 'cafe'
  ];

  /* ---------- 地点需求画像 ----------
   * 每个能收货的地点都有自己的口味和脾气，送货目的地不再只是"坐标 + 距离"。
   *   fav    ：这里主要要什么（订单品类从这里抽，别的品类很少出现）
   *   ticket ：客单价倍率，直接乘在数量上——热闹的地方一次买得多
   *   strict ：准时要求 0/1/2。超时按这个加倍扣信任，2 表示迟到就退单
   *   note   ：给玩家看的说明（地图菜单/熟人页会引用）
   */
  const DEMAND = {
    busstop:    { fav: ['lollipop', 'caramel', 'plumCola', 'cloudLolli'], ticket: 1.2, strict: 0, note: '赶车的人随手买一包' },
    academy:    { fav: ['lollipop', 'cookie', 'tart', 'oatCookie', 'plumCola'], ticket: 1.1, strict: 0, note: '学生党，量大管饱' },
    pier:       { fav: ['caramel', 'choco', 'saltCroissant', 'nougat'], ticket: 1.3, strict: 0, note: '码头要顶饱的' },
    council:    { fav: ['macaron', 'honeycake', 'starcandy', 'earlGrey', 'darkThin'], ticket: 1.5, strict: 2, note: '摆盘要精致，迟到就退' },
    garage:     { fav: ['choco', 'caramel', 'milkBar', 'garlicStick'], ticket: 1.0, strict: 0, note: '机油味里也要吃甜的' },
    silverfox:  { fav: ['choco', 'macaron', 'whiskyTruffle', 'whiskeyJelly'], ticket: 1.2, strict: 1, note: '夜里要，现金结算' },
    market:     { fav: ['cookie', 'caramel', 'cake', 'milkToast', 'saltCroissant'], ticket: 1.4, strict: 0, note: '同行进货，量最大' },
    plaza:      { fav: ['tart', 'cake', 'tanghulu', 'marshmallowCup'], ticket: 1.0, strict: 0, note: '花店配甜点' },
    church:     { fav: ['cake', 'cookie', 'madeleine', 'oatCookie'], ticket: 1.1, strict: 1, note: '礼拜日的茶点' },
    warehouse:  { fav: ['choco', 'honeycake', 'wafer', 'milkBar'], ticket: 1.2, strict: 0, note: '守夜人要好存放的' },
    containers: { fav: ['caramel', 'cookie', 'wafer', 'oatCookie'], ticket: 1.3, strict: 0, note: '装进箱子带走' },
    lookout:    { fav: ['starcandy', 'macaron', 'cottonCloud', 'cloudLolli'], ticket: 0.7, strict: 0, note: '游客，量小但不还价' },
    bookstore:  { fav: ['cookie', 'tart', 'madeleine', 'bruleeTea'], ticket: 0.9, strict: 0, note: '看书时垫嘴' },
    laundry:    { fav: ['caramel', 'choco', 'dirtyCoffee', 'coffeeCrystal'], ticket: 1.0, strict: 0, note: '通宵的人要提神' },
    shipyard:   { fav: ['choco', 'honeycake', 'garlicStick', 'nougat'], ticket: 1.2, strict: 0, note: '重体力，要热量' },
    auction:    { fav: ['starcandy', 'macaron', 'honeycake', 'whiskyTruffle', 'valentineRecord'], ticket: 1.6, strict: 2, note: '越贵越好，迟到退单' },
    depot7:     { fav: ['starcandy', 'choco', 'darkThin', 'coffeeCrystal'], ticket: 1.1, strict: 1, note: '别多问，准时到' },
    checkpoint: { fav: ['lollipop', 'cookie', 'mintFrost', 'plumCola'], ticket: 0.8, strict: 1, note: '值班室解闷' },
    postoffice: { fav: ['lollipop', 'caramel', 'cloudLolli', 'milkSalt'], ticket: 1.1, strict: 1, note: '按班次走，误点误一天' },
    bathhouse:  { fav: ['honeycake', 'cake', 'soyIcecream', 'milkSalt'], ticket: 1.2, strict: 0, note: '泡完澡要甜的' },
    teahouse:   { fav: ['tart', 'cookie', 'macaron', 'madeleine', 'peachOolong'], ticket: 1.1, strict: 0, note: '配茶的点心' },
    cafe:       { fav: ['macaron', 'cake', 'latteLolli', 'tiramisu'], ticket: 1.3, strict: 1, note: '柜台陈列，不能缺' }
  };

  /* ---------- 原料 ---------- */
  const RAW = {
    sugar: { name: '砂糖', price: 5, tag: '基础' },
    flour: { name: '面粉', price: 7, tag: '基础' },
    salt: { name: '海盐', price: 4, tag: '基础' },
    butter: { name: '黄油', price: 8, tag: '乳品' },
    cream: { name: '奶油', price: 9, tag: '乳品' },
    milk: { name: '牛奶', price: 6, tag: '乳品' },
    cheese: { name: '奶酪', price: 13, tag: '乳品' },
    cocoa: { name: '可可', price: 11, tag: '风味' },
    fruit: { name: '水果', price: 7, tag: '风味' },
    coffee: { name: '咖啡', price: 15, tag: '风味' },
    tea: { name: '茶叶', price: 12, tag: '风味' },
    honey: { name: '蜂蜜', price: 14, tag: '风味' },
    nuts: { name: '坚果', price: 10, tag: '风味' },
    syrup: { name: '魔法糖浆', price: 28, tag: '特殊' },
    wine: { name: '烈酒', price: 32, tag: '特殊' }
  };

  /* ---------- 成品线（配方书） ----------
   * 每条线是一本配方书，买了才解锁里面的品。classic 是母亲留下的那几页，一开始就有。
   * 解锁后这些品才会进「能做什么」和「客人会点什么」两个池子——
   * 否则一开局六十多个品砸在制作台上，玩家根本不知道从哪下手。
   */
  const LINES = {
    classic:      { name: '基础糖果', book: 0,    desc: '母亲留下的那几页纸：棒棒糖、焦糖、曲奇、蛋糕。' },
    bread:        { name: '面包房',   book: 320,  desc: '一炉一炉往外端。盐可颂、生吐司、贝果、蒜香短棍。' },
    pastry:       { name: '挞与派',   book: 460,  desc: '酥皮托着馅。柠檬、红薯、苹果，还有咸口的火腿丹麦。' },
    cake:         { name: '蛋糕柜',   book: 680,  desc: '芝士、戚风、蒙布朗、提拉米苏——冷藏柜里的那一排。' },
    viennoiserie: { name: '起酥与卷', book: 820,  desc: '杏仁可颂、蝴蝶酥、肉桂卷。黄油味最凶的一本。' },
    hardCandy:    { name: '硬糖',     book: 280,  desc: '含很久不化的那种：薄荷、柠檬、青提、咖啡晶球。' },
    softCandy:    { name: '软糖',     book: 380,  desc: '咬破会爆汁的。双莓、血橙、柚子蜜、脏脏咖啡。' },
    gummy:        { name: '果冻',     book: 420,  desc: '杯装和袋装。可吸奶茶冻、西柚杯、威士忌果冻。' },
    choco:        { name: '巧克力',   book: 900,  desc: '排块、薄片、脆球、酒心。原料最贵的一门手艺。' },
    lolli:        { name: '棒棒糖',   book: 300,  desc: '云朵、双色转转乐、拿铁大理石纹、盲盒款。' },
    creative:     { name: '手工糖',   book: 560,  desc: '现拉的棉花糖、糖画、冰糖葫芦、咸蛋黄牛轧糖。' },
    cookie:       { name: '饼干',     book: 340,  desc: '半熔岩曲奇、海盐芝士威化、红糖燕麦提子饼。' },
    drink:        { name: '饮品',     book: 400,  desc: '话梅可乐、烤布蕾奶茶、酱油焦糖海盐冰淇淋。' },
    seasonal:     { name: '节庆限定', book: 1400, desc: '万圣节的血袋软糖，情人节的心跳唱片。一年就做这几回。' }
  };

  /* ---------- 成品 / 配方 ----------
   * price 是零售原价（柜台实际售价还要乘展示柜系数和信誉系数）。
   * ap 是基准行动点，满级烤炉会让 ap>=2 的品省 1 点。
   * tier 只是给界面分档用的：1 入门 / 2 中档 / 3 高档 / 4 限定。
   */
  const PRODUCTS = {
    /* — 基础糖果（开局就有） — */
    lollipop: { name: '星星棒棒糖', price: 26, ap: 1, tier: 1, line: 'classic', recipe: { sugar: 2 }, color: '#ff7fb0' },
    caramel: { name: '海盐焦糖', price: 44, ap: 1, tier: 1, line: 'classic', recipe: { sugar: 2, milk: 1, butter: 1 }, color: '#d9974e' },
    cookie: { name: '黄油曲奇', price: 52, ap: 1, tier: 2, line: 'classic', recipe: { flour: 2, butter: 1, sugar: 1 }, color: '#e0b070' },
    choco: { name: '苦甜巧克力', price: 66, ap: 1, tier: 2, line: 'classic', recipe: { cocoa: 2, cream: 1, sugar: 1 }, color: '#6b4230' },
    tart: { name: '水果挞', price: 62, ap: 2, tier: 2, line: 'classic', recipe: { flour: 1, fruit: 2, cream: 1 }, color: '#e8546e' },
    macaron: { name: '马卡龙', price: 74, ap: 2, tier: 2, line: 'classic', recipe: { flour: 1, sugar: 2, cream: 1, nuts: 1 }, color: '#f2a0c0' },
    cake: { name: '奶油蛋糕', price: 82, ap: 2, tier: 3, line: 'classic', recipe: { flour: 2, cream: 1, sugar: 2, milk: 1 }, color: '#fff0e0' },
    honeycake: { name: '蜂蜜坚果糕', price: 96, ap: 2, tier: 3, line: 'classic', recipe: { flour: 2, honey: 1, nuts: 1, butter: 1 }, color: '#d9a94e' },
    starcandy: { name: '虹彩糖', price: 120, ap: 2, tier: 3, line: 'classic', recipe: { sugar: 3, syrup: 1, honey: 1 }, color: '#9fd8ff' },

    /* — 面包房 — */
    saltCroissant: { name: '日式盐可颂', price: 48, ap: 1, tier: 1, line: 'bread', recipe: { flour: 2, butter: 1, salt: 1 }, color: '#e8b06a' },
    milkToast: { name: '生吐司厚切', price: 56, ap: 1, tier: 2, line: 'bread', recipe: { flour: 2, milk: 1, butter: 1 }, color: '#f6e3c4' },
    sesameBagel: { name: '黑芝麻贝果', price: 68, ap: 2, tier: 2, line: 'bread', recipe: { flour: 2, butter: 1, salt: 1, nuts: 1 }, color: '#8a7156' },
    garlicStick: { name: '蒜香黄油短棍', price: 74, ap: 2, tier: 2, line: 'bread', recipe: { flour: 2, butter: 2, salt: 1 }, color: '#d9a55c' },

    /* — 挞与派 — */
    miniApplePie: { name: '迷你苹果派', price: 66, ap: 2, tier: 2, line: 'pastry', recipe: { flour: 1, fruit: 2, butter: 1 }, color: '#d9773f' },
    lemonTart: { name: '柠檬蛋白挞', price: 72, ap: 2, tier: 2, line: 'pastry', recipe: { flour: 1, fruit: 1, sugar: 2, cream: 1 }, color: '#f4e06a' },
    sweetPotatoTart: { name: '红薯布丁挞', price: 78, ap: 2, tier: 3, line: 'pastry', recipe: { flour: 1, milk: 2, sugar: 2, butter: 1 }, color: '#e0a05a' },
    hamDanish: { name: '火腿芝士丹麦', price: 92, ap: 2, tier: 3, line: 'pastry', recipe: { flour: 2, cheese: 1, butter: 1, salt: 1 }, color: '#e88a6a' },

    /* — 蛋糕柜 — */
    madeleine: { name: '玛德琳', price: 64, ap: 2, tier: 2, line: 'cake', recipe: { flour: 1, butter: 1, sugar: 1, fruit: 1 }, color: '#f0c878' },
    earlGrey: { name: '伯爵茶戚风', price: 106, ap: 2, tier: 3, line: 'cake', recipe: { flour: 2, sugar: 2, tea: 1, cream: 1 }, color: '#e8dcc0' },
    basque: { name: '巴斯克芝士蛋糕', price: 112, ap: 2, tier: 3, line: 'cake', recipe: { cheese: 2, cream: 1, sugar: 1, flour: 1 }, color: '#c98f4e' },
    tiramisu: { name: '提拉米苏切块', price: 132, ap: 2, tier: 3, line: 'cake', recipe: { cheese: 1, coffee: 1, cream: 1, flour: 1, sugar: 1 }, color: '#a87b52' },
    montBlanc: { name: '栗子蒙布朗杯', price: 126, ap: 2, tier: 3, line: 'cake', recipe: { cream: 1, nuts: 1, sugar: 2, flour: 1, butter: 1, milk: 1 }, color: '#c9a06a' },

    /* — 起酥与卷 — */
    palmier: { name: '巧克力蝴蝶酥', price: 88, ap: 2, tier: 3, line: 'viennoiserie', recipe: { flour: 2, butter: 2, cocoa: 1 }, color: '#8a5a3a' },
    almondCroissant: { name: '杏仁可颂', price: 96, ap: 2, tier: 3, line: 'viennoiserie', recipe: { flour: 2, butter: 2, nuts: 1, sugar: 1 }, color: '#dfae72' },
    cinnamonRoll: { name: '肉桂卷', price: 82, ap: 2, tier: 3, line: 'viennoiserie', recipe: { flour: 2, butter: 1, sugar: 2, milk: 1 }, color: '#c98f5a' },

    /* — 硬糖 — */
    mintFrost: { name: '薄荷冰沙糖', price: 38, ap: 1, tier: 1, line: 'hardCandy', recipe: { sugar: 3, salt: 1 }, color: '#c8f0f4' },
    lemonDrop: { name: '海盐柠檬硬糖', price: 44, ap: 1, tier: 1, line: 'hardCandy', recipe: { sugar: 2, fruit: 1, salt: 1 }, color: '#f6e98a' },
    grapeOrb: { name: '青提冰球', price: 52, ap: 1, tier: 2, line: 'hardCandy', recipe: { sugar: 2, fruit: 2, salt: 1 }, color: '#a8e08a' },
    peachOolong: { name: '白桃乌龙脆芯', price: 64, ap: 2, tier: 2, line: 'hardCandy', recipe: { sugar: 2, fruit: 1, tea: 1 }, color: '#ffc0b0' },
    coffeeCrystal: { name: '冷萃咖啡晶球', price: 72, ap: 2, tier: 2, line: 'hardCandy', recipe: { sugar: 2, coffee: 1, cream: 1 }, color: '#9a7050' },

    /* — 软糖 — */
    milkSalt: { name: '厚乳咸奶糖', price: 40, ap: 1, tier: 1, line: 'softCandy', recipe: { milk: 2, salt: 1 }, color: '#f4ead8' },
    brownSugarPearl: { name: '老红糖珍珠奶糖', price: 42, ap: 1, tier: 1, line: 'softCandy', recipe: { sugar: 2, milk: 1 }, color: '#c99a6a' },
    bloodOrange: { name: '血橙小方', price: 58, ap: 2, tier: 2, line: 'softCandy', recipe: { sugar: 2, fruit: 1, salt: 1 }, color: '#e8623a' },
    berryBurst: { name: '双莓爆汁软糖', price: 66, ap: 2, tier: 2, line: 'softCandy', recipe: { sugar: 2, fruit: 2 }, color: '#b8407a' },
    dirtyCoffee: { name: '脏脏咖啡软糖', price: 62, ap: 2, tier: 2, line: 'softCandy', recipe: { sugar: 2, coffee: 1, milk: 1 }, color: '#6b4a34' },
    yuzuHoney: { name: '柚子蜜软糖', price: 72, ap: 2, tier: 3, line: 'softCandy', recipe: { sugar: 1, fruit: 1, honey: 1, tea: 1 }, color: '#e8d070' },

    /* — 果冻 — */
    milkTeaJelly: { name: '可吸奶茶冻', price: 50, ap: 1, tier: 2, line: 'gummy', recipe: { milk: 2, tea: 1 }, color: '#d8b896' },
    grapefruitCup: { name: '西柚果冻杯', price: 56, ap: 2, tier: 2, line: 'gummy', recipe: { fruit: 2, sugar: 1, salt: 1 }, color: '#f08a90' },
    whiskeyJelly: { name: '威士忌柑橘果冻杯', price: 148, ap: 3, tier: 4, line: 'gummy', recipe: { wine: 1, fruit: 2, sugar: 2, honey: 1 }, color: '#d9a34e' },

    /* — 巧克力 — */
    milkBar: { name: '牛奶巧克力排块', price: 78, ap: 2, tier: 3, line: 'choco', recipe: { cocoa: 2, milk: 1, sugar: 1, butter: 1 }, color: '#8a5f42' },
    darkThin: { name: '65% 黑巧薄片', price: 86, ap: 2, tier: 3, line: 'choco', recipe: { cocoa: 3, sugar: 1, butter: 1 }, color: '#4a3020' },
    saltedAlmondChoco: { name: '海盐杏仁牛奶巧', price: 96, ap: 2, tier: 3, line: 'choco', recipe: { cocoa: 2, milk: 1, nuts: 1, salt: 1 }, color: '#7a5238' },
    strawberryBall: { name: '冻干草莓白巧脆球', price: 108, ap: 2, tier: 3, line: 'choco', recipe: { cocoa: 2, cream: 1, fruit: 2, sugar: 1 }, color: '#f0a8b8' },
    whiskyTruffle: { name: '威士忌酒心球', price: 158, ap: 3, tier: 4, line: 'choco', recipe: { cocoa: 2, wine: 1, cream: 1, sugar: 1 }, color: '#5a3828' },
    saltedCaramelBooze: { name: '海盐焦糖酒心巧克力', price: 172, ap: 3, tier: 4, line: 'choco', recipe: { cocoa: 2, wine: 1, sugar: 2, butter: 1, salt: 1 }, color: '#7a4a28' },

    /* — 棒棒糖 — */
    cloudLolli: { name: '云朵棒棒糖', price: 38, ap: 1, tier: 1, line: 'lolli', recipe: { sugar: 2, milk: 1 }, color: '#fdf6f0' },
    twistLolli: { name: '双色转转乐', price: 52, ap: 2, tier: 2, line: 'lolli', recipe: { sugar: 2, milk: 1, fruit: 1 }, color: '#ff9ec4' },
    latteLolli: { name: '咖啡拿铁棒棒糖', price: 58, ap: 2, tier: 2, line: 'lolli', recipe: { sugar: 2, coffee: 1, milk: 1 }, color: '#c4a080' },
    mysteryLolli: { name: '旋转盲盒棒棒糖', price: 94, ap: 2, tier: 3, line: 'lolli', recipe: { sugar: 3, syrup: 1, fruit: 1 }, color: '#a8c8f0' },

    /* — 手工糖 — */
    cottonCloud: { name: '现拉棉花糖串', price: 36, ap: 1, tier: 1, line: 'creative', recipe: { sugar: 3 }, color: '#fde8f4' },
    sugarArt: { name: '城市糖画', price: 78, ap: 2, tier: 2, line: 'creative', recipe: { sugar: 2, syrup: 1 }, color: '#e8c070' },
    tanghulu: { name: '迷你冰糖葫芦', price: 62, ap: 2, tier: 2, line: 'creative', recipe: { fruit: 3, sugar: 2 }, color: '#e04050' },
    marshmallowCup: { name: '火焰棉花糖脆脆杯', price: 84, ap: 2, tier: 3, line: 'creative', recipe: { sugar: 2, cream: 1, flour: 1, butter: 1 }, color: '#f4d0a8' },
    nougat: { name: '咸蛋黄肉松牛轧糖', price: 88, ap: 2, tier: 3, line: 'creative', recipe: { sugar: 2, milk: 1, nuts: 1, salt: 1, butter: 1 }, color: '#e8c890' },

    /* — 饼干 — */
    oatCookie: { name: '红糖燕麦提子饼', price: 46, ap: 1, tier: 1, line: 'cookie', recipe: { flour: 1, sugar: 1, fruit: 1 }, color: '#c9a070' },
    wafer: { name: '海盐芝士威化', price: 62, ap: 2, tier: 2, line: 'cookie', recipe: { flour: 1, cheese: 1, salt: 1, cream: 1 }, color: '#f0dcb0' },
    lavaCookie: { name: '半熔岩巧克力曲奇', price: 68, ap: 2, tier: 2, line: 'cookie', recipe: { flour: 1, butter: 1, cocoa: 1, sugar: 1 }, color: '#7a5030' },

    /* — 饮品 — */
    plumCola: { name: '话梅可乐', price: 30, ap: 1, tier: 1, line: 'drink', recipe: { sugar: 1, fruit: 1, salt: 1 }, color: '#6a3a2a' },
    bruleeTea: { name: '烤布蕾奶茶', price: 58, ap: 1, tier: 2, line: 'drink', recipe: { tea: 1, milk: 2, sugar: 1 }, color: '#d8b080' },
    soyIcecream: { name: '酱油焦糖海盐冰淇淋', price: 76, ap: 2, tier: 2, line: 'drink', recipe: { milk: 2, cream: 1, sugar: 2, salt: 1 }, color: '#e8d8b8' },

    /* — 节庆限定 — */
    halloweenBag: { name: '万圣节血袋软糖', price: 168, ap: 3, tier: 4, line: 'seasonal', recipe: { sugar: 2, fruit: 2, honey: 1, syrup: 1 }, color: '#b02040' },
    valentineRecord: { name: '心跳唱片巧克力', price: 186, ap: 3, tier: 4, line: 'seasonal', recipe: { cocoa: 2, cream: 1, sugar: 1, syrup: 1, fruit: 1 }, color: '#5a2a3a' }
  };

  /* ---------- 载具 ----------
   * apMul：每跑 1 像素实际扣的行动点比例。车越好越省力——同样的行动点能跑更远。
   * 摩托 1.00 / 厢型车 0.85 / 货车 0.72，配合 AP_PER_PX=86，等于每 AP 分别能跑 86 / 101 / 119 像素。
   */
  const VEHICLES = {
    bike: { key: 'bike', name: '旧摩托', cap: 6, speed: 78, apMul: 1.00, price: 0, desc: '母亲那台，坐垫裂了口子，但还能跑。' },
    van: { key: 'van', name: '厢型车', cap: 10, speed: 92, apMul: 0.85, price: 1800, rank: 'C', desc: '二手货，后备箱有股海腥味，能装。' },
    truck: { key: 'truck', name: '小型货车', cap: 20, speed: 104, apMul: 0.72, price: 5000, rank: 'B', desc: '蓝白涂装。开着它送货，整条街都让路。' }
  };

  /* ---------- 全局调参 ----------
   * apPerPx：每消耗 1 行动点能走多少像素（摩托基准）。想让送货松一点就调大。
   *   早间配送 14 AP：110 → 1540px，够去码头跑个来回；86 → 只有 1204px，去新岛必然回不来。
   */
  const TUNE = {
    apPerPx: 110,
    cabFee: 40,          // 半路叫车回店的费用
    walkHomeEnergy: 12   // 推车走回去掉的元气
  };

  /* ---------- 送货路上的随机事件 ----------
   * 每烧掉 1 点行动点掷一次骰子；危险度越高的城区越容易出事。
   * 一个阶段最多碰上两回，免得一路连环弹窗把送货切成碎片。
   *
   * fx 是「增量」：ap / energy / money / rep 为正就是赚到、为负就是付出；
   * cred 对应三条软失败线；raw / stock 直接改原料和成品库存；
   * steal 为 true 时从车厢里顺走一件成品（没货就折成 20G 损失）。
   * 每条选项的 result 里可以写 {stolen}，结算时换成被顺走的那件糖的名字。
   */
  const ROAD_EVENTS = {
    chance: 0.16,
    maxPerTrip: 2,
    list: [
      {
        id: 'gang_fight', w: 3, regions: ['industry', 'docks'],
        title: '巷口不太平', sub: '黑帮火并',
        text: '前面两拨人把路堵死了，有人正拿抹布擦车门的血。影狼组的记号你认得——母亲以前说过，看见那个记号就绕路。',
        choices: [
          { label: '从旧仓库后面绕', hint: '行动点 -2', fx: { ap: -2 }, result: '你从旧仓库后面兜了一圈，多花点时间，糖没撒。', good: true },
          { label: '塞一盒糖借道', hint: '成品 -1', fx: { steal: 1 }, result: '领头的捏着那盒{stolen}打量你一眼，让开半步。' },
          { label: '拧油门冲过去', hint: '元气 -10 · 行动点 +1', fx: { energy: -10, ap: 1, rep: 1 }, result: '你从缝里钻了过去，手心全是汗，倒也快了一点。' }
        ]
      },
      {
        id: 'help_wounded', w: 3, regions: [],
        title: '有人倒在路边', sub: '救助伤员',
        text: '电车轨道旁边蹲着个捂着胳膊的人，血从指缝里渗出来。这一单还有半小时，你捏着车把犹豫了一下。',
        choices: [
          { label: '停下来送他去诊所', hint: '行动点 -2 · 元气 -5 · 信誉 +3', fx: { ap: -2, energy: -5, rep: 3 }, result: '诊所的人接过他，抬头看了眼你车箱上的糖果屋招牌。', good: true },
          { label: '装作没看见', hint: '信誉 -1.5', fx: { rep: -1.5 }, result: '你骑过去了。后视镜里那团影子越来越小。' }
        ]
      },
      {
        id: 'punks', w: 3, regions: ['industry', 'docks', 'oldtown'],
        title: '有人拦车', sub: '混混找茬',
        text: '三个半大孩子横在路中间，最前面那个用指节敲了敲你的货箱：「姐姐，今天带什么好吃的？」',
        choices: [
          { label: '一人分一盒', hint: '成品 -1 · 信誉 +2', fx: { steal: 1, rep: 2 }, result: '他们捧着那盒{stolen}让开路，还替你喊了句「慢走」。', good: true },
          { label: '好说歹说讲道理', hint: '行动点 -1 · 信誉 +1', fx: { ap: -1, rep: 1 }, result: '你讲了五分钟，他们听困了，也就散了。' },
          { label: '拧油门跑', hint: '元气 -8 · 行动点 +1', fx: { energy: -8, ap: 1 }, result: '背后骂声追了半条街，好在没追上。' }
        ]
      },
      {
        id: 'theft', w: 2, regions: [], needCargo: true,
        title: '货箱轻了一点', sub: '货物失窃',
        text: '等红灯时回头看了一眼，箱盖的搭扣被撬开过。街角有个背影走得很快，手里鼓鼓囊囊的。',
        choices: [
          { label: '追上去', hint: '行动点 -2 · 元气 -4', fx: { ap: -2, energy: -4 }, result: '你把人堵在死胡同里，东西要了回来，累得直喘。', good: true },
          { label: '算了，先送货', hint: '成品 -1 · 履约 -1', fx: { steal: 1, cred: { fulfill: -1 } }, result: '少了一盒{stolen}。到地方怕是得跟人家赔个不是。' }
        ]
      },
      {
        id: 'newsstand', w: 2, regions: ['snail', 'oldtown'],
        title: '报摊大爷招手', sub: '街坊',
        text: '「米莉！」大爷举着半张报纸，「你妈以前订的那份，我还留着呢。」摊上摆着刚到的砂糖，袋口没扎紧。',
        choices: [
          { label: '停下来聊两句', hint: '行动点 -1 · 砂糖 +2 · 信誉 +1', fx: { ap: -1, raw: { sugar: 2 }, rep: 1 }, result: '他顺手塞给你两袋砂糖，说「拿着，别跟你妈似的客气」。', good: true },
          { label: '挥挥手赶路', hint: '不耽误时间', fx: {}, result: '你按了两下喇叭算是打招呼，车没停。' }
        ]
      },
      {
        id: 'council_check', w: 2, regions: ['island'], needCargo: true,
        title: '前面在查证件', sub: '议会临检',
        text: '玻璃幕墙下停着一辆白车，穿制服的人正挨个翻箱。新岛今天查得比平时严。',
        choices: [
          { label: '排队出示证件', hint: '行动点 -1 · 合规 +1', fx: { ap: -1, cred: { compliance: 1 } }, result: '证件没问题，箱子里也只是糖。工作人员挥手放行。', good: true },
          { label: '绕远路走货车道', hint: '行动点 -2 · 元气 -3', fx: { ap: -2, energy: -3 }, result: '绕了一大圈，桥上的风把耳朵吹得发疼。' },
          { label: '装急单硬闯', hint: '合规 -6 · 信誉 +2', fx: { cred: { compliance: -6 }, rep: 2 }, result: '你喊着「药！给人送的药！」冲了过去，白车在后面记了车牌。' }
        ]
      },
      {
        id: 'kids', w: 2, regions: [],
        title: '橱窗前的小脑袋', sub: '街边',
        text: '路边几个小孩趴在糖果屋送货箱的贴纸上挪不开眼，最大的那个小声问：「姐姐，这个是给谁的？」',
        choices: [
          { label: '分一颗糖', hint: '成品 -1 · 信誉 +3', fx: { steal: 1, rep: 3 }, result: '那盒{stolen}少了一颗，但这条街明天大概都会知道糖果屋。', good: true },
          { label: '赶路要紧', hint: '信誉 -0.5', fx: { rep: -0.5 }, result: '你笑着摇摇头，把车骑走了。' }
        ]
      },
      {
        id: 'breakdown', w: 2, regions: [],
        title: '车熄火了', sub: '半路抛锚',
        text: '摩托在坡上咳了两声就不动了。踢了两脚，只听见空洞的回响。前头修车铺的灯还亮着。',
        choices: [
          { label: '推去修车铺', hint: '行动点 -3 · 40G', fx: { ap: -3, money: -40 }, result: '师傅换了根皮带，收了 40G，顺手替你把货箱重新绑好。', good: true },
          { label: '自己蹲下来修', hint: '元气 -8', fx: { energy: -8 }, result: '折腾出一手黑油，总算又点着了火。腰有点酸。' }
        ]
      },
      {
        id: 'lost_wallet', w: 2, regions: [],
        title: '地上有个钱包', sub: '捡到东西',
        text: '路灯底下躺着一只旧皮夹，打开是几张零钞和一张过期月票。四下没人。',
        choices: [
          { label: '送到岗亭', hint: '信誉 +2', fx: { rep: 2 }, result: '值班的记下你的名字，说会替你谢谢失主。', good: true },
          { label: '揣进兜里', hint: '35G · 信誉 -1', fx: { money: 35, rep: -1 }, result: '钱能买两袋面粉。只是那天晚上你没什么胃口。' }
        ]
      }
    ]
  };

  /* ---------- 外卖平台 ----------
   * 和常规配送是两套池子：外卖单不进订单簿，也不用米莉出门，骑手自己来取。
   * 没有助手时得自己接单、备货、放进取餐口；雇了人，学徒会替你打理。
   * 「逐步解锁」＝开到第三天、信誉够 55，再花一笔钱装终端。 */
  const TAKEOUT = {
    unlockDay: 3,
    unlockRep: 55,
    setupFee: 680,
    platformRate: 0.20,   // 平台抽成
    priceMul: 1.15,       // 外卖标价比柜台原价高一点
    slots: 3,             // 同时在平台上的单数上限
    autoCap: 2,           // 有助手时每阶段最多自动打理几单
    packAp: 1,            // 自己装取餐口花 1 AP
    desc: '柜台边上多一台小终端，骑手在巷口等着，不用你出门。'
  };

  /* ---------- 阶段 ---------- */
  const PHASES = [
    { id: 'prep', name: '早起准备', time: '05:00', span: '05:00 – 07:00', ap: 8, kind: 'panel', tone: '#8f7bd0', tip: '预制糖果与烘焙。做完就出门。' },
    { id: 'deliveryAM', name: '早间配送', time: '07:00', span: '07:00 – 09:00', ap: 14, kind: 'map', tone: '#ffc46b', tip: '第一批常规配送。装好货再上路。' },
    { id: 'shiftAM', name: '上午坐班', time: '09:00', span: '09:00 – 13:00', ap: 8, kind: 'counter', tone: '#ffd98a', tip: '柜台营业。顾客会陆续上门。' },
    { id: 'noon', name: '午休', time: '13:00', span: '13:00 – 15:00', ap: 3, kind: 'panel', tone: '#a8e6cf', tip: '补个觉，或者看点书。' },
    { id: 'shiftPM', name: '下午坐班', time: '15:00', span: '15:00 – 17:00', ap: 6, kind: 'counter', tone: '#ffb98a', tip: '下午客少，但电话订单会来。' },
    { id: 'deliveryPM', name: '晚间配送', time: '17:00', span: '17:00 – 21:00', ap: 22, kind: 'map', tone: '#8f7bd0', tip: '第二批配送。天黑后街上不太平。' },
    { id: 'night', name: '睡前', time: '21:00', span: '21:00 – 22:00', ap: 3, kind: 'panel', tone: '#6b6bb0', tip: '打烊整理。22 点必须睡。' }
  ];

  /* ---------- 每日固定开销 ----------
   * 钱必须有出口，不然攒到几千 G 之后经营就没有压力了。
   *
   * 注意：这间屋子和铺面是米莉母亲的产业，没有「房租」这回事。
   * 母亲只立了一条家规——柜上进来多少，抽一成给家里。赚得多的月份多分担，
   * 冷清的月份也不会逼你，所以这条成本会随营业额一起长，永远不会变成白菜价。
   *   homeRate / homeMin：那一成的比例，以及生意最差时的保底。
   *   utilityPerUnit：每做出一件成品的水电（炉子、冰箱、灯）。
   *   （没有「欠账」这回事：钱不够时账上直接变负数，只拦进货，不会关门。）
   */
  const COSTS = {
    homeRate: 0.12,
    homeMin: 40,
    utilityPerUnit: 2,     // 低额水电：它不是压力来源，只是「开店就要花」的底噪
    /* —— 真正的现金压力：设备、执照、供应商 —— */
    wearPerUnit: 0.5,      // 每做一件成品的磨损
    wearSlow: [1, 0.8, 0.6],   // 烤炉等级越高越省（对应 SHOP_UPGRADES.oven 三级）
    wearPenalty: 0.35,     // 磨损满时成功率打 65 折
    maintainBase: 30,      // 保养底价
    maintainPerWear: 4,    // 每点磨损加的保养费
    licenseFee: 480,       // 执照年检
    licenseEvery: 28,      // 每 28 天一次
    licenseRetry: 7,       // 交不出钱，七天后补检
    /* 现金见底时的另一条路：在巷口出半天力，换一炉基础料。
       母亲已经失散，没人可开口——蜗牛巷的规矩是出力就有饭吃。 */
    oddJobAp: 1,
    oddJobGive: { flour: 2, sugar: 1, butter: 1 },
    /* 第三方配送：平台替你跑腿，安全准时——抽走尾款的一大截。
       它的意义是「用钱换时间」，所以费率必须让人心疼。 */
    platformRate: 0.45,
    platformMin: 12,
    creditCap: 600,        // 供应链信用满额时的赊账上限
    creditDays: 3,         // 赊账账期
    overdrawHit: 2         // 账上透支一天，合规掉多少
  };

  /* ---------- 三条软失败线 ----------
   * 糖果屋不会倒闭。母亲留下的房子是安全网，所以压力不来自「活不下去」，
   * 而来自三张会掉分的执照——店永远在，但生意会没。
   *   fulfill    履约信誉：说好几点送到就几点送到（超时、退单、过期掉得最快）
   *   compliance 经营合规：执照年检、设备卫生、账目
   *   supply     供应链信用：赊账要还，还不上就没人再赊给你
   * 三条线不直接杀人，它们决定「你配不配接到更好的机会」。
   */
  const CRED = {
    start: { fulfill: 70, compliance: 80, supply: 70 },
    onTimeUp: 0.5,        // 准时送到一次
    lateHit: 1.2,         // 超时
    refuseHit: 2.5,       // 退单（临阵取消）
    expireHit: 2.0,       // 过期没送
    recover: 0.25,        // 每天自然回一点（慢慢养回来，不是一次归零）
    floor: 30,            // 掉到这里就接不到「需要脸面」的单
    labels: {
      fulfill: '履约信誉',
      compliance: '经营合规',
      supply: '供应链信用'
    }
  };

  /* ---------- 评级 ----------
   * 每 7 天考核一次：看三张执照的均值 + 本周营业额。
   * 评级不封死玩法，只封「更好的机会」：高单价单、载具、配方书、新门面。
   * 评级低不是死，是慢。
   */
  const RANKS = [
    { id: 'D', name: '巷口小摊', cred: 0,  week: 0,    note: '街坊知道你在这儿，仅此而已。' },
    { id: 'C', name: '有招牌的店', cred: 52, week: 1200, note: '巷子外面开始有人照着地址找过来。' },
    { id: 'B', name: '新都小有名气', cred: 64, week: 2600, note: '城里的评价单上能找到你。' },
    { id: 'A', name: '城里叫得出名字', cred: 76, week: 4800, note: '议会和拍卖行也愿意给你一次机会。' },
    { id: 'S', name: '新都的糖', cred: 88, week: 8000, note: '别人拿糖果屋当坐标。' }
  ];

  /* ---------- 店铺升级 ----------
   * 三条线各三级，都是「一次性投入换长期效率」：
   *   counter 柜台 → 坐班时能同时招呼几位客人（直接决定坐班收入上限）
   *   case    展示柜 → 柜台零售加价（同样的货卖得更贵）
   *   oven    烤炉 → 成功率，满级还能给高档品省 1 AP
   * levels[0] 是开局自带的，cost 为 0。
   */
  const SHOP_UPGRADES = {
    counter: {
      name: '柜台', tag: '接待', icon: '台',
      desc: '柜台越宽，能同时站下的客人越多，门口补位也越快。',
      levels: [
        { cost: 0, label: '一张旧木柜台', effect: '同时 2 位客人', seats: 2, flow: 1.0 },
        { cost: 1200, label: '双开柜台', effect: '同时 3 位客人，补位更快', seats: 3, flow: 1.7 },
        { cost: 3200, label: '三席长柜台', effect: '同时 3 位，门口几乎不断人', seats: 3, flow: 2.4 }
      ]
    },
    case: {
      name: '展示柜', tag: '门面', icon: '柜',
      desc: '亮堂的柜子让同样的糖卖出更好的价。',
      levels: [
        { cost: 0, label: '玻璃小柜', effect: '零售原价', priceMul: 1.00 },
        { cost: 900, label: '冷光展示柜', effect: '零售 +6%', priceMul: 1.06 },
        { cost: 2600, label: '整墙糖橱', effect: '零售 +14%', priceMul: 1.14 }
      ]
    },
    oven: {
      name: '烤炉', tag: '后厨', icon: '炉',
      desc: '炉子稳，糖不容易糊；好炉子还能在糊的时候救回原料。',
      levels: [
        { cost: 0, label: '老式煤炉', effect: '糊了就白费', apCut: 0, salvage: 0 },
        { cost: 1500, label: '双层风炉', effect: '糊了退回一半原料', apCut: 0, salvage: 0.5 },
        { cost: 3800, label: '石板蒸汽炉', effect: '糊了原料全退，高档品省 1 AP', apCut: 1, salvage: 1 }
      ]
    }
  };

  /* ---------- 学徒 ----------
   * ap：每个「有用行动点」的阶段额外给多少 AP（一天 6 个阶段受益）。
   * craft：他负责的手艺，每天开炉时自动做点什么（消耗你的原料，成功率 72%）。
   * hire：一次性安家费。wage：每天工钱。
   */
  const APPRENTICES = [
    {
      id: 'pip', name: '小皮', tag: '手脚快', wage: 80, hire: 480, ap: 1,
      craft: ['lollipop', 'caramel'],
      desc: '巷口打杂的孩子，熬糖的时候眼睛都不眨。'
    },
    {
      id: 'nana', name: '小娜', tag: '心细', wage: 110, hire: 660, ap: 1,
      craft: ['cookie', 'tart'],
      desc: '烘焙学校退学，说是老师傅的手太脏。裱花一流。'
    },
    {
      id: 'toto', name: '托托', tag: '有一把力气', wage: 140, hire: 840, ap: 2,
      craft: ['cake', 'choco'],
      desc: '码头扛过包，能一个人把整箱原料搬上阁楼。'
    }
  ];

  /* ---------- 客户名池 ----------
   * fav = 这个人偏爱什么。送对品类会给小费，也是熟人页上"他喜欢什么"的依据。
   * trust = 初次见面时的信任底子；之后由交易记录累积（存在存档 state.people 里）。
   */
  const CUSTOMERS = [
    { name: '玛德琳太太', loc: 'shop', tag: '老主顾', trust: 3, fav: ['cookie', 'cake'] },
    { name: '报摊大爷', loc: 'busstop', tag: '健谈', trust: 2, fav: ['lollipop'] },
    { name: '学生莉莉', loc: 'academy', tag: '学生', trust: 1, fav: ['lollipop', 'tart'] },
    { name: '码头工汉克', loc: 'pier', tag: '粗声粗气', trust: 2, fav: ['caramel', 'choco'] },
    { name: '秘书薇拉', loc: 'council', tag: '新岛客', trust: 3, fav: ['macaron', 'starcandy'] },
    { name: '修车铺娜娜', loc: 'garage', tag: '熟人', trust: 3, fav: ['choco'] },
    { name: '酒保灰狐', loc: 'silverfox', tag: '夜里来', trust: 2, fav: ['choco', 'macaron'] },
    { name: '面包师奥托', loc: 'market', tag: '同行', trust: 2, fav: ['cookie', 'caramel'] },
    { name: '花店米娅', loc: 'plaza', tag: '慢热', trust: 1, fav: ['tart', 'cake'] },
    { name: '教会艾德', loc: 'church', tag: '沉默', trust: 2, fav: ['cake', 'cookie'] },
    { name: '仓库守夜人', loc: 'warehouse', tag: '警惕', trust: 1, fav: ['choco', 'honeycake'] },
    { name: '钟楼管理员', loc: 'academy', tag: '古怪', trust: 2, fav: ['starcandy'] },

    /* 第二批：把原本空着的地点填上人，让每个送货点都有张脸 */
    { name: '洗衣店阿婆', loc: 'laundry', tag: '不问闲事', trust: 2, fav: ['caramel'] },
    { name: '书店店主萨姆', loc: 'bookstore', tag: '打盹中', trust: 2, fav: ['cookie', 'tart'] },
    { name: '修船厂老柯', loc: 'shipyard', tag: '脾气差', trust: 1, fav: ['choco', 'honeycake'] },
    { name: '拍卖会文森', loc: 'auction', tag: '挑剔', trust: 3, fav: ['starcandy', 'macaron'] },
    { name: '澡堂桂姐', loc: 'bathhouse', tag: '热络', trust: 2, fav: ['honeycake', 'cake'] },
    { name: '邮差小跑', loc: 'postoffice', tag: '永远在赶时间', trust: 1, fav: ['lollipop', 'caramel'] },
    { name: '茶馆秦姨', loc: 'teahouse', tag: '记性好', trust: 3, fav: ['tart', 'macaron'] },
    { name: '咖啡师诺亚', loc: 'cafe', tag: '讲究', trust: 2, fav: ['macaron', 'cake'] },

    /* 第三批：把最后四个送货点也填上人，让 22 个地址都能真的下单 */
    { name: '装卸工老杜', loc: 'containers', tag: '嗓门大', trust: 1, fav: ['caramel', 'cookie'] },
    { name: '画摊小满', loc: 'lookout', tag: '看风景的', trust: 1, fav: ['starcandy'] },
    { name: '跑腿小六', loc: 'depot7', tag: '不多话', trust: 2, fav: ['starcandy', 'choco'] },
    { name: '值班安检员', loc: 'checkpoint', tag: '照着规程', trust: 1, fav: ['lollipop', 'cookie'] }
  ];

  /* ---------- 对话 ---------- */
  const DIALOGS = {
    intro: {
      speaker: '米莉',
      lines: [
        '新都。清晨五点，雨还没下下来。',
        '蜗牛巷的石板路泛着青灰色，只有糖果屋的橱窗亮着。那是整条巷子最亮的一盏灯——我母亲留下的。',
        '三个月前我接手了这家店。祖传的手艺还在，糖浆的配方还在，只有人不在。',
        '母亲最后一次出现，是留给我这串钥匙和一句"别去找我"。',
        '……所以我当然要去找她。',
        '糖果屋的账本上，白天卖糖，晚上接委托。知情的几个人管它叫——地下万事屋。'
      ]
    },
    tree: [
      { t: '老梧桐树的树皮被刻满了名字，最旧的一行已经看不清了。' },
      { t: '绿色信箱里有张便条：「米莉小姐，周四前想要六盒曲奇，钱照旧。」——玛德琳' }
    ],
    backwall: [{ t: '矮墙后面是邻居家的院子，杂草长到了膝盖。井盖就在墙角，铁锈把花纹糊住了。' }],
    laundry: [
      { t: '洗衣店里温暖而潮湿，空气里是廉价洗衣粉和湿布料的味道。' },
      { t: '柜台后的老人抬起眼皮看了你一眼，又低下头继续读他的报纸。' }
    ],
    checkpoint: [{ t: '安检员扫了一眼你的车牌：「糖果屋？这么晚还过桥？」' }, { t: '「送货。」你说。他挥手放行。' }],
    bar: [
      { t: '银狐酒吧的门口，两个穿黑夹克的人挡住了光。' },
      { opt: '「我找灰狐。」', then: [{ t: '「老板不见生客。」他上下打量你，「除非你带糖来。」' }] },
      { opt: '低头走过去', then: [{ t: '他们没拦你。你能感觉到背后有两道视线。' }] }
    ],
    church: [{ t: '旧教堂的门虚掩着。管风琴的声音断断续续，像是有人在试音。' }, { t: '彩色玻璃上的圣母抱着一个孩子，孩子手里捧着一颗糖。' }],
    graveyard: [{ t: '你数了三遍墓碑。没有"科洛蒂娅"。' }, { t: '母亲没有死。至少没有死在这里。' }],
    garage: [{ t: '娜娜从车底滑出来，扳手还举着：「米莉？你那条后胎该换了。」' }],
    lookout: [{ t: '从这里看下去，新都是一整片会呼吸的灯。' }, { t: '糖果屋的那盏，小得像一粒没化的糖。' }],
    warehouse: [{ t: '仓库里有蜡烛烧过的痕迹，还有一张摊开的城市地图——蜗牛巷被圈了个红圈。' }],
    tunnel_sc: [{ t: '铁栅栏后面是往下的楼梯。风从深处涌上来，带着铁锈和陈年灰尘的味道。' }, { t: '你听见了水声。地下水道在城市的皮肤下面，一直流到看不见的地方。' }],
    auction: [{ t: '门口的告示牌写着"仓库出租"。' }, { t: '但你认识那个记号——三颗叠在一起的糖，母亲账本背面也有一个。' }],
    depot7: [{ t: '三长两短。门开了一条缝。' }, { t: '「糖果屋的小姑娘。」渡鸦的声音像砂纸，「进来，别站在灯下。」' }],
    plaza: [{ t: '喷泉干了半年，鸽子的数量却翻了倍。' }],
    containers: [{ t: '集装箱之间像一座迷宫。每个箱门上的编号都被重新喷过漆。' }],
    temple: [{ t: '学院钟楼敲了一下。空气里飘着橙花的味道。' }]
  };

  /* ---------- 原料供货表 ---------- */
  const SHOPS = {
    fruitstand: {
      name: '巷口水果摊',
      greeting: '老周把一筐苹果往你怀里塞：「挑吧挑吧，给你算便宜点。」',
      mult: 0.88,
      items: ['sugar', 'salt', 'fruit', 'milk', 'honey']
    },
    market: {
      name: '综合市场',
      greeting: '肉铺、菜摊、干货店……空气里全是吆喝声。',
      mult: 1.0,
      items: ['sugar', 'flour', 'salt', 'butter', 'cream', 'milk', 'cheese', 'cocoa', 'fruit', 'coffee', 'tea', 'honey', 'nuts', 'syrup', 'wine']
    }
  };

  /* ---------- 批发采购 ----------
   * 不用自己跑去市场：给批发商下单，他按批发价备货，满量再打一层折扣，
   * 代价是一笔跑腿搬运费，而且货不会立刻到——至少隔一个阶段。
   * 跑一趟市场省的是钱，发一次采购省的是时间和行动点。
   */
  const PURCHASE = {
    wholeMul: 0.85,        // 批发价：单价比门市便宜 15%
    tiers: [               // 满量再折（按总份数算，取最高一档）
      { qty: 10, off: 0.03 },
      { qty: 20, off: 0.06 },
      { qty: 40, off: 0.10 },
      { qty: 60, off: 0.15 }
    ],
    feeBase: 12,           // 跑腿 / 搬运底费
    feeRate: 0.06,         // 按货值收的中间费
    feeMin: 12,
    delayPhases: 2         // 至少隔一个阶段才送到
  };

  /* ---------- 新手教学 ----------
   * 序章一结束就进这三步：做糖 → 装车 → 送到。
   * 每一步只看「状态」不看「点击」，所以玩家换个顺序做完也算数。
   */
  const TUTORIAL = [
    { id: 'craft', title: '新手 · 做够 5 支星星棒棒糖', hint: '后场「制作台」→ 星星棒棒糖，做到 5 支（架子上本来有 3 支）' },
    { id: 'load', title: '新手 · 把糖装上车', hint: '点右下的「出门配送」，在出货窗里勾上报摊大爷那单' },
    { id: 'deliver', title: '新手 · 送到公交总站', hint: '跟着地上跳动的粉色箭头，到门口按 E 交付' }
  ];

  /* ---------- 新岛安检 ----------
   * 新岛是议会的地盘，进岛必须过安检机。地铁站那台 X 光机会翻箱，
   * 货车道（跨海大桥）只验证件不拆箱——所以「敏感货」坐不了地铁，
   * 只能自己骑车带进去。这不是惩罚，是让「送新岛」多一道路线选择。
   * 后期买到铅衬行李袋（屏蔽袋）可以带过去。
   */
  const SECURITY = {
    station: 'metro_island',
    /* 被标红的原料：烈酒、魔法糖浆。含这两样的成品会自动被认成敏感货，
       所以以后加新配方不用再维护一张清单。 */
    flaggedRaw: ['wine', 'syrup'],
    gearKey: 'leadBag',
    gearName: '铅衬行李袋',
    gearPrice: 1400,
    gearDesc: '内衬铅箔，过安检机时看不出里面是什么。城里人都懂，贵也认了。'
  };

  /* ---------- 地铁线路 ---------- */
  const METRO = {
    /* 车票按段收，运营时间按当前阶段的起始钟点判断（首班 06:00 / 末班 23:00）。
       早起准备是 05:00，那会儿站台还没开门。 */
    farePerStop: 6,
    first: 6,
    last: 23,
    stations: {
      metro_dock: { name: '码头站', lines: ['1'] },
      metro_old: { name: '旧城中心站', lines: ['1', '2', '3'] },
      metro_island: { name: '新岛站', lines: ['1', '4'] },
      metro_ind: { name: '城南站', lines: ['2', '4'] },
      metro_snail: { name: '蜗牛巷站', lines: ['3'] },
      metro_acad: { name: '学院站', lines: ['3', '4'] }
    },
    /* 相邻关系：一段 = 相邻两站。必须**双向都写**，
       并且严格按线路拓扑来（1 码头—旧城中心—新岛；2 旧城中心—城南；
       3 蜗牛巷—旧城中心—学院；4 新岛—学院—城南）。
       曾经这里写成有向表，导致「旧城中心 → 新岛」要绕 2 段、
       反方向却只要 1 段——同一条路收费不同。 */
    graph: {
      metro_dock: ['metro_old'],
      metro_old: ['metro_dock', 'metro_island', 'metro_ind', 'metro_snail', 'metro_acad'],
      metro_island: ['metro_old', 'metro_acad'],
      metro_ind: ['metro_old', 'metro_acad'],
      metro_snail: ['metro_old'],
      metro_acad: ['metro_old', 'metro_island', 'metro_ind']
    }
  };

  /* ---------- 公交 / 渡船 ----------
   * 地铁之外的两条快速跨区路：公交便宜、只到几个站；渡船贵，但能直接跨海到新岛。
   * 出发点写成 id，是为了让地点菜单能直接挂上入口。 */
  const TRANSIT = {
    bus: {
      from: 'busstop',
      name: '公交总站',
      title: '公交 · 跨区电车',
      desc: '蓝白电车按站停，比骑车省行动点。货箱太大上不去，只带人。',
      routes: [
        { loc: 'metro_old', ap: 2, fare: 12, note: '旧城中心站' },
        { loc: 'metro_ind', ap: 3, fare: 18, note: '城南站' },
        { loc: 'metro_acad', ap: 4, fare: 24, note: '学院站' }
      ]
    },
    boat: {
      from: 'pier',
      name: '渔船码头',
      title: '渡船 · 跨海',
      desc: '船老大的小艇不走跨海大桥，比骑车快，也比大桥贵。',
      routes: [
        { loc: 'metro_island', ap: 3, fare: 45, note: '新岛站' },
        { loc: 'metro_dock', ap: 1, fare: 8, note: '码头站' }
      ]
    }
  };

  return {
    TILE, WORLD, REGIONS, ROADS, LOCATIONS, RAW, PRODUCTS, VEHICLES,
    PHASES, CUSTOMERS, DIALOGS, SHOPS, METRO, TUNE, DELIVER_LOCS, DEMAND,
    COSTS, CRED, RANKS, SHOP_UPGRADES, APPRENTICES, LINES, SECURITY, TUTORIAL, PURCHASE,
    ROAD_EVENTS, TAKEOUT, TRANSIT
  };
})();
