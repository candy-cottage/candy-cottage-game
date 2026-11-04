/* ============================================================
 *  糖果屋 · 新都蜗牛巷  —  大地图（像素渲染 / 移动 / 交互）
 * ============================================================ */
window.MapView = (function () {
  const D = window.GameData;
  const T = D.TILE;
  const WW = D.WORLD.w * T;
  const WH = D.WORLD.h * T;
  let VIEW_W = 480, VIEW_H = 340;   // 逻辑视口（随窗口比例变化）
  const AP_PER_PX = (D.TUNE && D.TUNE.apPerPx) || 86;   // 摩托每 86 像素消耗 1 行动点

  let canvas, ctx, sctx, staticCanvas, miniCanvas;
  let scale = 1, dpr = 1;
  let cam = { x: 0, y: 0 };
  let running = false;
  let rafId = 0;
  let lastTs = 0;

  const player = { x: 0, y: 0, dir: 'down', moving: false, anim: 0, riding: false };
  const keys = {};

  /* ---------------- 行动点换算 ----------------
   * 距离 → 行动点。载具 apMul 越低越省力，所以换车不只是装得多，还能跑得更远。
   */
  function apMul() {
    const S = window.Engine && window.Engine.state;
    const v = D.VEHICLES[(S && S.vehicle) || 'bike'] || D.VEHICLES.bike;
    return v.apMul || 1;
  }
  function apOfPx(px) { return Math.max(1, Math.ceil(px * apMul() / AP_PER_PX)); }
  function pxPerAp() { return Math.round(AP_PER_PX / apMul()); }
  let distAcc = 0;
  let apEmptyFired = false;   // 这一趟是否已经提示过「行动点见底」
  let paused = false;         // 路上事件弹窗开着时，人和行动点都停住
  let solid = new Uint8Array(D.WORLD.w * D.WORLD.h);
  let dbgGrid = false;   // ?grid：调试用的瓦片网格叠加

  let markers = [];        // 订单交付标记 {locId, label, color}
  let hooks = {};          // { onInteract, onEmpty, onMove }
  let nearLoc = null;
  let toastText = '';
  let toastTimer = 0;
  let frames = 0;

  /* 导航：目标地点 + 用 solid 网格跑 BFS 得到的折线路径 */
  let navTarget = null;    // { locId, x, y, name }
  let navPath = null;      // [{x,y}] 世界坐标
  let navPathLen = 0;
  let navBackLen = 0;      // 从目标回到店里的距离，用来判断「去得了回不来」
  let navFrom = { x: -1e9, y: -1e9 };
  let bigMapOpen = false;  // 全城地图覆盖层

  // 小地图位置固定在这儿，绘制和点击判定共用一份
  const MINI = { w: 132, top: 54, right: 14, h: Math.round(132 * D.WORLD.h / D.WORLD.w) };

  /* ---------------- 确定性随机 ---------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ---------------- 初始化 ---------------- */
  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    staticCanvas = document.createElement('canvas');
    staticCanvas.width = WW; staticCanvas.height = WH;
    sctx = staticCanvas.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    D.LOCATIONS.forEach(l => {
      l.doorX = (l.x + l.w / 2) * T;
      l.doorY = (l.y + l.h) * T + 6;
    });
    buildStatic();
    resize();
    window.addEventListener('resize', resize);
    bindKeys();
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('mousemove', e => {
      if (!bigMapOpen) { bigMapHover = null; return; }
      const rect = canvas.getBoundingClientRect();
      const sx = (e.clientX - rect.left) / rect.width * (canvas.width / dpr);
      const sy = (e.clientY - rect.top) / rect.height * (canvas.height / dpr);
      const hit = bigMapHit(sx, sy);
      if (hit === bigMapHover) return;
      bigMapHover = hit;
      hoverCost = null;
      if (hit) {
        const home = storePoint();
        const there = fieldSteps(distField(player.x, player.y), hit.doorX, hit.doorY);
        const back = fieldSteps(distField(hit.doorX, hit.doorY), home.x, home.y);
        hoverCost = {
          ap: there > 0 ? apOfPx(there * T) : null,
          backAp: back > 0 ? apOfPx(back * T) : null
        };
      }
    });
    canvas.addEventListener('mouseleave', () => { bigMapHover = null; hoverCost = null; });
  }

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(320, rect.width);
    const h = Math.max(240, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    VIEW_H = 340;
    VIEW_W = Math.round(340 * (w / h));
    scale = (canvas.height / dpr) / VIEW_H;
    if (running) {
      player.x = Math.max(12, Math.min(WW - 12, player.x));
      player.y = Math.max(12, Math.min(WH - 12, player.y));
    }
  }

  /* ---------------- 世界构建 ---------------- */
  function isSea(tx, ty) {
    if (tx < 60) return false;
    // 岛屿
    const ir = D.REGIONS.island.rect;
    if (tx >= ir[0] - 1 && tx <= ir[0] + ir[2] && ty >= ir[1] - 1 && ty <= ir[1] + ir[3]) return false;
    // 桥
    if (tx >= 58 && tx <= 76 && ty >= 21 && ty <= 25) return false;
    return true;
  }

  function setSolid(tx, ty, v) {
    if (tx < 0 || ty < 0 || tx >= D.WORLD.w || ty >= D.WORLD.h) return;
    solid[ty * D.WORLD.w + tx] = v;
  }

  function buildStatic() {
    const rnd = mulberry32(20261101);
    sctx.clearRect(0, 0, WW, WH);

    /* 1. 基础地面 */
    for (let ty = 0; ty < D.WORLD.h; ty++) {
      for (let tx = 0; tx < D.WORLD.w; tx++) {
        const n = rnd();
        let c;
        if (isSea(tx, ty)) {
          c = n > 0.7 ? '#2b4a63' : (n > 0.35 ? '#274258' : '#22394d');
        } else {
          c = n > 0.75 ? '#2f3538' : (n > 0.4 ? '#2a2f33' : '#262b2f');
        }
        sctx.fillStyle = c;
        sctx.fillRect(tx * T, ty * T, T, T);
      }
    }

    /* 2. 海面波纹 */
    sctx.strokeStyle = 'rgba(150,205,235,0.16)';
    sctx.lineWidth = 1;
    for (let i = 0; i < 260; i++) {
      const x = 60 * T + Math.floor(rnd() * (36 * T - 20));
      const y = Math.floor(rnd() * WH);
      const w = 6 + Math.floor(rnd() * 14);
      sctx.beginPath();
      sctx.moveTo(x, y); sctx.lineTo(x + w, y);
      sctx.stroke();
    }

    /* 3. 区域地面 */
    Object.values(D.REGIONS).forEach(r => {
      const [rx, ry, rw, rh] = r.rect;
      sctx.fillStyle = r.ground;
      sctx.fillRect(rx * T, ry * T, rw * T, rh * T);
      // 区域色彩倾向
      sctx.save();
      sctx.globalAlpha = 0.10;
      sctx.fillStyle = r.light;
      sctx.fillRect(rx * T, ry * T, rw * T, rh * T);
      sctx.restore();
      // 边缘
      sctx.fillStyle = r.edge;
      sctx.fillRect(rx * T, ry * T, rw * T, 3);
      sctx.fillRect(rx * T, (ry + rh) * T - 3, rw * T, 3);
      sctx.fillRect(rx * T, ry * T, 3, rh * T);
      sctx.fillRect((rx + rw) * T - 3, ry * T, 3, rh * T);
      // 边缘暖光
      sctx.save();
      sctx.globalAlpha = 0.28;
      sctx.fillStyle = r.light;
      sctx.fillRect(rx * T, ry * T, rw * T, 1);
      sctx.fillRect(rx * T, (ry + rh) * T - 1, rw * T, 1);
      sctx.fillRect(rx * T, ry * T, 1, rh * T);
      sctx.fillRect((rx + rw) * T - 1, ry * T, 1, rh * T);
      sctx.restore();
      // 石板格
      sctx.strokeStyle = 'rgba(0,0,0,0.13)';
      sctx.lineWidth = 1;
      for (let gx = rx; gx <= rx + rw; gx += 2) {
        sctx.beginPath();
        sctx.moveTo(gx * T + 0.5, ry * T); sctx.lineTo(gx * T + 0.5, (ry + rh) * T);
        sctx.stroke();
      }
      for (let gy = ry; gy <= ry + rh; gy += 2) {
        sctx.beginPath();
        sctx.moveTo(rx * T, gy * T + 0.5); sctx.lineTo((rx + rw) * T, gy * T + 0.5);
        sctx.stroke();
      }
    });

    /* 4. 道路 */
    D.ROADS.forEach(([rx, ry, rw, rh]) => {
      sctx.fillStyle = '#3b3b46';
      sctx.fillRect(rx * T, ry * T, rw * T, rh * T);
      sctx.fillStyle = '#4a4a57';
      sctx.fillRect(rx * T, ry * T, rw * T, 2);
      sctx.fillRect(rx * T, (ry + rh) * T - 2, rw * T, 2);
      // 中心虚线
      sctx.fillStyle = 'rgba(230,205,140,0.35)';
      if (rw > rh) {
        const cy = (ry + rh / 2) * T - 1;
        for (let x = rx * T + 6; x < (rx + rw) * T; x += 16) sctx.fillRect(x, cy, 7, 2);
      } else {
        const cx = (rx + rw / 2) * T - 1;
        for (let y = ry * T + 6; y < (ry + rh) * T; y += 16) sctx.fillRect(cx, y, 2, 7);
      }
    });

    /* 5. 桥 */
    (function drawBridge() {
      const y0 = 21 * T, y1 = 25 * T;
      sctx.fillStyle = '#5a5f6b';
      sctx.fillRect(58 * T, y0, 19 * T, y1 - y0);
      sctx.fillStyle = '#727888';
      sctx.fillRect(58 * T, y0, 19 * T, 3);
      sctx.fillRect(58 * T, y1 - 3, 19 * T, 3);
      sctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let x = 58 * T; x < 77 * T; x += 12) sctx.fillRect(x, y0 + 8, 1, y1 - y0 - 16);
      // 桥塔
      [61, 70, 76].forEach(tx => {
        sctx.fillStyle = '#8a90a0';
        sctx.fillRect(tx * T, y0 - 6, 4, 8);
        sctx.fillRect(tx * T, y1 - 2, 4, 8);
      });
    })();

    /* 6. 树木（北山 / 墓地 / 街角） */
    const treeSpots = [];
    for (let i = 0; i < 90; i++) {
      const r = D.REGIONS.hill.rect;
      treeSpots.push([
        r[0] + 1 + Math.floor(rnd() * (r[2] - 2)),
        r[1] + 1 + Math.floor(rnd() * (r[3] - 2))
      ]);
    }
    for (let i = 0; i < 14; i++) {
      treeSpots.push([26 + Math.floor(rnd() * 13), 34 + Math.floor(rnd() * 10)]);
    }
    treeSpots.forEach(([tx, ty]) => {
      if (isSea(tx, ty)) return;
      if (D.LOCATIONS.some(l => tx >= l.x - 1 && tx <= l.x + l.w && ty >= l.y - 1 && ty <= l.y + l.h + 1)) return;
      drawTree(sctx, tx * T + 8, ty * T + 8, rnd());
      if (rnd() > 0.45) setSolid(tx, ty, 1);
    });

    /* 7. 建筑 */
    D.LOCATIONS.forEach((l, i) => drawLocation(sctx, l, mulberry32(1000 + i * 77)));

    /* 8. 小地图缩略图 */
    miniCanvas = document.createElement('canvas');
    miniCanvas.width = D.WORLD.w;
    miniCanvas.height = D.WORLD.h;
    const mctx = miniCanvas.getContext('2d');
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(staticCanvas, 0, 0, WW, WH, 0, 0, D.WORLD.w, D.WORLD.h);
  }

  function drawTree(c, x, y, r) {
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.fillRect(x - 6, y + 6, 14, 5);
    c.fillStyle = '#4a3b2e';
    c.fillRect(x - 2, y - 2, 4, 12);
    const g1 = r > 0.5 ? '#3f6b45' : '#355c3c';
    const g2 = r > 0.5 ? '#578a56' : '#4a7a4c';
    c.fillStyle = g1;
    c.fillRect(x - 9, y - 10, 18, 12);
    c.fillRect(x - 6, y - 14, 12, 6);
    c.fillStyle = g2;
    c.fillRect(x - 7, y - 13, 5, 4);
    c.fillRect(x - 10, y - 8, 4, 4);
    c.fillRect(x + 3, y - 6, 4, 3);
  }

  function drawLocation(c, l, rnd) {
    const x = l.x * T, y = l.y * T, w = l.w * T, h = l.h * T;

    if (l.kind === 'tree') {
      drawTree(c, x + w / 2, y + h / 2, 0.8);
      return;
    }
    if (l.kind === 'grave') {
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(x + 2, y + h - 12, w - 2, 8);
      for (let i = 0; i < 6; i++) {
        const gx = x + 4 + (i % 3) * 14, gy = y + 6 + Math.floor(i / 3) * 14;
        c.fillStyle = '#6b6f66';
        c.fillRect(gx, gy, 7, 11);
        c.fillStyle = '#84897d';
        c.fillRect(gx, gy, 7, 3);
      }
      // 地面碰撞不用全铺
      return;
    }
    if (l.kind === 'plaza') {
      c.fillStyle = 'rgba(255,255,255,0.06)';
      c.fillRect(x, y, w, h);
      c.strokeStyle = 'rgba(255,255,255,0.13)';
      c.strokeRect(x + 2, y + 2, w - 4, h - 4);
      c.fillStyle = '#6f6a7a';
      c.fillRect(x + w / 2 - 6, y + h / 2 - 6, 12, 12);
      c.fillStyle = '#8d879c';
      c.fillRect(x + w / 2 - 4, y + h / 2 - 4, 8, 8);
      return;
    }
    if (l.kind === 'wall') {
      c.fillStyle = '#5c564f';
      c.fillRect(x, y + h - 10, w, 10);
      c.fillStyle = '#6d665e';
      for (let i = 0; i < w; i += 8) c.fillRect(x + i + 1, y + h - 10, 6, 4);
      setSolid(l.x, l.y, 1);
      return;
    }

    /* 通用建筑 */
    const isTower = l.kind === 'tower' || l.kind === 'church';
    const bodyH = isTower ? h + 14 : h;
    const by = isTower ? y - 14 : y;

    // 影子
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fillRect(x + 3, by + 5, w, bodyH);

    // 墙
    c.fillStyle = l.wall;
    c.fillRect(x, by + 5, w, bodyH - 5);
    // 墙脚
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.fillRect(x, by + bodyH - 4, w, 4);

    // 屋顶
    c.fillStyle = l.roof;
    c.fillRect(x - 2, by, w + 4, 7);
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fillRect(x - 2, by, w + 4, 2);

    // 窗户
    const cols = Math.max(1, Math.floor(w / 14));
    const rows = Math.max(1, Math.floor((bodyH - 12) / 13));
    const lit = l.kind === 'ruin' || l.kind === 'bar' ? 'rgba(255,190,90,0.55)' : 'rgba(255,232,170,0.9)';
    for (let r = 0; r < rows; r++) {
      for (let cc = 0; cc < cols; cc++) {
        const wx = x + 5 + cc * ((w - 10) / cols);
        const wy = by + 12 + r * 13;
        if (wy + 7 > by + bodyH - 6) continue;
        if (rnd() < 0.18 && l.kind !== 'shop') continue;
        c.fillStyle = 'rgba(0,0,0,0.4)';
        c.fillRect(wx, wy, 6, 7);
        c.fillStyle = lit;
        c.fillRect(wx + 1, wy + 1, 4, 5);
      }
    }

    // 门
    const dx = x + w / 2 - 5;
    const dy = by + bodyH - 15;
    c.fillStyle = '#2a2230';
    c.fillRect(dx, dy, 10, 15);
    c.fillStyle = 'rgba(255,214,140,0.75)';
    c.fillRect(dx + 1, dy + 1, 8, 6);

    // 招牌
    if (l.kind === 'shop' || l.kind === 'stall' || l.kind === 'bar' || l.kind === 'metro') {
      const sc = l.kind === 'metro' ? '#3f6ea8' : (l.kind === 'bar' ? '#a03a6a' : '#d2568a');
      c.fillStyle = sc;
      c.fillRect(x + 2, by + bodyH - 22, w - 4, 5);
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.fillRect(x + 4, by + bodyH - 21, w - 8, 1);
    }
    if (l.kind === 'metro') {
      c.fillStyle = '#e8eef8';
      c.fillRect(x + 4, by + 6, 8, 8);
      c.fillStyle = '#2b3d5c';
      c.fillRect(x + 6, by + 8, 4, 4);
    }
    if (l.kind === 'church') {
      // 尖顶
      c.fillStyle = l.roof;
      c.beginPath();
      c.moveTo(x + w / 2, by - 16);
      c.lineTo(x + w / 2 - 7, by + 1);
      c.lineTo(x + w / 2 + 7, by + 1);
      c.closePath();
      c.fill();
      c.fillStyle = '#e8d8a0';
      c.fillRect(x + w / 2 - 1, by - 20, 2, 6);
      c.fillRect(x + w / 2 - 4, by - 18, 8, 2);
    }
    if (l.kind === 'stall') {
      // 遮阳棚条纹
      for (let i = 0; i < w; i += 6) {
        c.fillStyle = i % 12 === 0 ? '#e8845a' : '#f2e6d0';
        c.fillRect(x + i, by + 1, 6, 5);
      }
    }
    if (l.kind === 'ruin') {
      c.fillStyle = 'rgba(0,0,0,0.35)';
      for (let i = 0; i < 5; i++) {
        c.fillRect(x + 2 + rnd() * (w - 10), by + 8 + rnd() * (bodyH - 20), 4 + rnd() * 8, 3);
      }
    }

    // 碰撞
    for (let ix = l.x; ix < l.x + l.w; ix++)
      for (let iy = l.y; iy < l.y + l.h; iy++) setSolid(ix, iy, 1);
  }

  /* ---------------- 导航 ---------------- */
  const NW = D.WORLD.w, NH = D.WORLD.h;

  function walkable(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= NW || ty >= NH) return false;
    return !solid[ty * NW + tx];
  }

  // 门口有时贴着建筑边缘，落到实心格上就往回找一格
  function nearestWalkable(tx, ty) {
    if (walkable(tx, ty)) return { tx, ty };
    for (let r = 1; r <= 5; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          if (walkable(tx + dx, ty + dy)) return { tx: tx + dx, ty: ty + dy };
        }
      }
    }
    return null;
  }

  // 四邻域 BFS：步长等权，BFS 出来的就是最短路径；96x64 的图跑满也就 6k 格
  function findPath(sx, sy, ex, ey) {
    const s = nearestWalkable(Math.floor(sx / T), Math.floor(sy / T));
    const e = nearestWalkable(Math.floor(ex / T), Math.floor(ey / T));
    if (!s || !e) return null;
    const start = s.ty * NW + s.tx, goal = e.ty * NW + e.tx;
    if (start === goal) return [{ x: sx, y: sy }, { x: ex, y: ey }];

    const prev = new Int32Array(NW * NH).fill(-1);
    const seen = new Uint8Array(NW * NH);
    const queue = new Int32Array(NW * NH);
    let head = 0, tail = 0;
    queue[tail++] = start; seen[start] = 1;
    let found = false;

    while (head < tail) {
      const cur = queue[head++];
      if (cur === goal) { found = true; break; }
      const cx = cur % NW, cy = (cur - cx) / NW;
      // 上下左右
      const nb = [cur - NW, cur + NW, cx > 0 ? cur - 1 : -1, cx < NW - 1 ? cur + 1 : -1];
      for (let i = 0; i < 4; i++) {
        const n = nb[i];
        if (n < 0 || seen[n]) continue;
        const nx = n % NW, ny = (n - nx) / NW;
        if (!walkable(nx, ny)) continue;
        seen[n] = 1; prev[n] = cur; queue[tail++] = n;
      }
    }
    if (!found) return null;

    const pts = [];
    for (let cur = goal; cur !== -1; cur = prev[cur]) {
      pts.push({ x: (cur % NW + 0.5) * T, y: (Math.floor(cur / NW) + 0.5) * T });
    }
    pts.reverse();
    pts[0] = { x: sx, y: sy };
    pts[pts.length - 1] = { x: ex, y: ey };

    // 只留拐点，少画一堆没用的点
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(cross) > 0.01) out.push(b);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function pathLength(pts) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) {
      d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    return d;
  }

  /* ---------------- 里程估算 ----------------
   * 一次 BFS 铺满全场，得到「从某点出发到每格几步」，之后查任意地点都是 O(1)。
   * 96x64 的图一趟才几毫秒，出发前算预算是够用的。
   */
  function distField(sx, sy) {
    const dist = new Int32Array(NW * NH).fill(-1);
    const s = nearestWalkable(Math.floor(sx / T), Math.floor(sy / T));
    if (!s) return dist;
    const start = s.ty * NW + s.tx;
    const queue = new Int32Array(NW * NH);
    let head = 0, tail = 0;
    queue[tail++] = start; dist[start] = 0;
    while (head < tail) {
      const cur = queue[head++];
      const cx = cur % NW, cy = (cur - cx) / NW;
      const nb = [cur - NW, cur + NW, cx > 0 ? cur - 1 : -1, cx < NW - 1 ? cur + 1 : -1];
      for (let i = 0; i < 4; i++) {
        const n = nb[i];
        if (n < 0 || dist[n] >= 0) continue;
        const nx = n % NW, ny = (n - nx) / NW;
        if (!walkable(nx, ny)) continue;
        dist[n] = dist[cur] + 1; queue[tail++] = n;
      }
    }
    return dist;
  }

  function fieldSteps(field, x, y) {
    const w = nearestWalkable(Math.floor(x / T), Math.floor(y / T));
    return w ? field[w.ty * NW + w.tx] : -1;
  }

  function storePoint() {
    const l = D.LOCATIONS.find(x => x.id === 'shop');
    return l ? { x: l.doorX, y: l.doorY } : { x: WW / 2, y: WH / 2 };
  }

  /* 从店门口出发，按最近邻把一串地点串起来，给出总里程 / 去程 AP / 回程 AP */
  function estimateRoute(locIds) {
    const from = storePoint();
    const targets = (locIds || []).map(id => D.LOCATIONS.find(l => l.id === id)).filter(Boolean);
    if (!targets.length) return { ap: 0, backAp: 0, px: 0, backPx: 0, order: [], unreachable: [] };

    let cur = from, px = 0;
    const remain = targets.slice(), order = [], unreachable = [];
    while (remain.length) {
      const field = distField(cur.x, cur.y);
      let best = null, bd = Infinity;
      remain.forEach(l => {
        const st = fieldSteps(field, l.doorX, l.doorY);
        if (st > 0 && st < bd) { bd = st; best = l; }
      });
      if (!best) { unreachable.push(...remain.map(l => l.id)); break; }
      px += bd * T;
      order.push(best.id);
      cur = { x: best.doorX, y: best.doorY };
      remain.splice(remain.indexOf(best), 1);
    }
    const backSteps = fieldSteps(distField(cur.x, cur.y), from.x, from.y);
    const backPx = backSteps > 0 ? backSteps * T : 0;
    return {
      ap: px > 0 ? apOfPx(px) : 0,
      backAp: backPx > 0 ? apOfPx(backPx) : 0,
      px: Math.round(px),
      backPx: Math.round(backPx),
      order, unreachable
    };
  }

  function rebuildNav() {
    if (!navTarget) { navPath = null; navPathLen = 0; return; }
    navPath = findPath(player.x, player.y, navTarget.x, navTarget.y);
    navPathLen = navPath ? pathLength(navPath) : 0;
    navFrom = { x: player.x, y: player.y };
  }

  function setGuide(locId) {
    let loc = null;
    if (typeof locId === 'string') loc = D.LOCATIONS.find(l => l.id === locId);
    else if (locId && locId.x != null) loc = locId;
    if (!loc) { clearGuide(); return null; }
    navTarget = {
      locId: loc.id || null,
      name: loc.name || '目标',
      x: loc.doorX != null ? loc.doorX : loc.x,
      y: loc.doorY != null ? loc.doorY : loc.y
    };
    rebuildNav();
    // 回程只和目的地有关，跟人在哪儿无关，设目标时算一次就够
    const home = storePoint();
    const backSteps = fieldSteps(distField(navTarget.x, navTarget.y), home.x, home.y);
    navBackLen = backSteps > 0 ? backSteps * T : 0;
    if (!navPath) showToast('这条路走不通，换条路试试');
    return navTarget;
  }

  function clearGuide() {
    navTarget = null; navPath = null; navPathLen = 0;
  }

  function openBigMap() {
    if (!running) return;
    bigMapOpen = true;
    bigMapHover = null;
    Object.keys(keys).forEach(k => { keys[k] = false; });
    stopWalk(true);          // 摊图时先站住，免得关图后沿着旧折线继续漂
    if (hooks.onBigMap) hooks.onBigMap(true);
  }

  function closeBigMap() {
    if (!bigMapOpen) return;
    bigMapOpen = false;
    bigMapHover = null;
    if (hooks.onBigMap) hooks.onBigMap(false);
  }

  function toggleBigMap() {
    if (bigMapOpen) closeBigMap(); else openBigMap();
  }

  function guideInfo() {
    if (!navTarget) return null;
    if (!navPath) rebuildNav();
    const S = window.Engine ? window.Engine.state : { ap: 0 };
    const ap = apOfPx(navPathLen);
    const backAp = navBackLen > 0 ? apOfPx(navBackLen) : 0;
    return {
      locId: navTarget.locId,
      name: navTarget.name,
      dist: Math.round(navPathLen),
      ap,
      backAp,
      totalAp: ap + backAp,
      haveAp: S.ap,
      // 去得了回不来：只剩的钱不够回家
      tight: ap <= S.ap && ap + backAp > S.ap,
      short: ap > S.ap,
      pxPerAp: pxPerAp(),
      x: navTarget.x, y: navTarget.y
    };
  }

  /* ---------------- 输入 ---------------- */
  function bindKeys() {
    window.addEventListener('keydown', e => {
      if (!running) return;
      const k = e.key.toLowerCase();
      if (k === 'm') { e.preventDefault(); toggleBigMap(); return; }
      if (k === 'escape') {
        if (bigMapOpen) { e.preventDefault(); closeBigMap(); }
        return;
      }
      if (bigMapOpen) return;   // 摊开全城图时不响应走位
      // 潜入：Shift 蹲、Q 扔糖
      if (sneak) {
        if (k === 'shift') { setCrouch(true); }
        if (k === 'q') { e.preventDefault(); throwCandy(); }
      }
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'e', ' '].includes(k)) {
        keys[k] = true;
        if (k === 'e' || k === ' ') { e.preventDefault(); tryInteract(); }
        if (k.startsWith('arrow')) e.preventDefault();
      }
    });
    window.addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      keys[k] = false;
      if (k === 'shift') setCrouch(false);
    });
  }

  function blocked(x, y) {
    const hs = 5;
    const pts = [[x - hs, y], [x + hs, y], [x, y - 4], [x, y + 4]];
    for (const [px, py] of pts) {
      const tx = Math.floor(px / T), ty = Math.floor(py / T);
      if (tx < 0 || ty < 0 || tx >= D.WORLD.w || ty >= D.WORLD.h) return true;
      if (solid[ty * D.WORLD.w + tx]) return true;
    }
    return false;
  }

  function findNearest() {
    let best = 1e9, found = null;
    D.LOCATIONS.forEach(l => {
      const d = Math.hypot(l.doorX - player.x, l.doorY - player.y);
      if (d < 28 && d < best) { best = d; found = l; }
    });
    return found;
  }

  function tryInteract() {
    const near = findNearest();
    if (!near) {
      showToast('附近没有可以互动的地方');
      return;
    }
    nearLoc = near;
    if (hooks.onInteract) hooks.onInteract(near);
  }

  function onClick(e) {
    if (!running) return;
    const rect = canvas.getBoundingClientRect();
    const W = canvas.width / dpr, H = canvas.height / dpr;
    const sx = (e.clientX - rect.left) / rect.width * W;
    const sy = (e.clientY - rect.top) / rect.height * H;
    handleTap(sx, sy);
  }

  // 屏幕坐标（CSS px）上的点击分发；测试也能直接塞世界坐标进来
  function handleTap(sx, sy) {
    if (!running) return;
    const W = canvas.width / dpr, H = canvas.height / dpr;

    /* 全城地图打开时，点击只用来选目标或关闭 */
    if (bigMapOpen) {
      if (Math.hypot(sx - (W - 44), sy - (H - 44)) < 22) { closeBigMap(); return; }
      const hit = bigMapHit(sx, sy);
      if (hit) {
        // 只设目标，不替玩家走路——误点一下直接烧掉行动点太亏。
        // 想走就点屏幕边缘的粉色箭头，或者导航卡上的「自动走」。
        closeBigMap();
        setGuide(hit.id);
        if (hooks.onGuide) hooks.onGuide(guideInfo());
        showToast(`目标：${hit.name} · 点粉色箭头或「自动走」出发`);
      }
      return;
    }

    /* 点小地图 = 摊开全城图 */
    if (sx >= W - MINI.w - MINI.right - 8 && sx <= W - MINI.right + 8 &&
      sy >= MINI.top - 8 && sy <= MINI.top + MINI.h + 8) {
      openBigMap();
      return;
    }

    /* 点屏幕边缘的粉色箭头 = 开始自动寻路（箭头只在目标出屏时出现） */
    if (edgeArrowHit &&
      Math.abs(sx - edgeArrowHit.x) <= edgeArrowHit.w / 2 &&
      Math.abs(sy - edgeArrowHit.y) <= edgeArrowHit.h / 2) {
      const g0 = guideInfo();
      if (g0) walkTo(g0.locId || { x: g0.x, y: g0.y });
      return;
    }

    const mx = sx / W * VIEW_W + cam.x;
    const my = sy / H * VIEW_H + cam.y;

    /* 再点一次已经设好的目标 = 确认出发，不用去够那个小箭头 */
    if (navTarget) {
      const tx = navTarget.x - cam.x, ty = navTarget.y - cam.y;
      if (Math.hypot(sx * VIEW_W / W - tx, sy * VIEW_H / H - ty) < 22) {
        const g0 = guideInfo();
        if (g0) walkTo(g0.locId || { x: g0.x, y: g0.y });
        return;
      }
    }

    let best = null, bd = 1e9;
    D.LOCATIONS.forEach(l => {
      const d = Math.hypot(l.doorX - mx, l.doorY - my);
      if (d < bd) { bd = d; best = l; }
    });
    if (best && bd < 34) {
      // 点门口只换目标，不消费行动点；出发由箭头 / 「自动走」按钮决定
      setGuide(best.id);
      if (hooks.onGuide) hooks.onGuide(guideInfo());
      showToast(`目标：${best.name} · 点粉色箭头或「自动走」出发`);
      return;
    }

    // 空地：吸附到最近的可走格，否则点在楼顶/海里会一直贴着墙推
    const w = nearestWalkable(Math.floor(mx / T), Math.floor(my / T));
    if (!w) {
      showToast('那边过不去');
      clickTarget = null;
      clickPath = null;
      return;
    }
    clickTarget = { x: (w.tx + 0.5) * T, y: (w.ty + 0.5) * T, loc: null };
    if (!repathClick()) {
      showToast('找不到过去的路');
      clickTarget = null;
      return;
    }
    autoWalk = true;        // 点空地也自己走一段，到了不弹「到了 xx」
    autoWalkName = '';
    if (hooks.onAutoWalk) hooks.onAutoWalk(true);
  }

  let clickTarget = null;
  let clickPath = null;        // 鼠标点击后的 BFS 折线：跟着拐点走，而不是直着怼墙
  let clickRepathCd = 0;       // 撞墙重算的冷却，免得每帧跑一遍 BFS
  let autoWalk = false;        // 正在自动寻路：一路自己走，按方向键或点「停下」接管
  let autoWalkName = '';
  let edgeArrowHit = null;     // 屏幕边缘箭头的可点区域（含 AP 标签），点它＝出发

  function repathClick() {
    if (!clickTarget) { clickPath = null; return false; }
    const p = findPath(player.x, player.y, clickTarget.x, clickTarget.y);
    if (!p || !p.length) { clickPath = null; return false; }
    clickPath = p;
    return true;
  }

  /* 自动寻路：设好目标的同时把路算出来，人自己沿折线走过去。
   * 只画指引线不走路的话，手机上还得一路点方向，等于没省事。 */
  function walkTo(t, opts) {
    const quiet = !!(opts && opts.quiet);
    let loc = null;
    if (typeof t === 'string') loc = D.LOCATIONS.find(l => l.id === t) || null;
    else if (t && t.x != null) loc = t;
    if (!loc) { showToast('先在地图上点一个目的地'); return false; }

    const isSite = loc.doorX != null;
    const gx = isSite ? loc.doorX : loc.x;
    const gy = isSite ? loc.doorY + 6 : loc.y;
    setGuide(isSite ? (loc.id || { name: loc.name || '目标', x: gx, y: gy })
      : { name: loc.name || '目标', x: gx, y: gy });

    if (bigMapOpen) closeBigMap();
    if (!running) return false;

    const path = findPath(player.x, player.y, gx, gy);
    if (!path || !path.length) {
      showToast('这条路走不通，换条路试试');
      if (hooks.onAutoWalk) hooks.onAutoWalk(false);
      return false;
    }
    const S = window.Engine.state;
    const need = apOfPx(pathLength(path));
    if (S.ap <= 0) {
      showToast('没行动点了，先想办法回店里');
      if (hooks.onAutoWalk) hooks.onAutoWalk(false);
      return false;
    }
    if (need > S.ap) {
      // 走到半路行动点就见底，会直接弹出「回不了家」的三选一，不如先讲清楚
      showToast(`行动点不够：过去要 ${need} AP，现在只有 ${S.ap}`);
      if (hooks.onAutoWalk) hooks.onAutoWalk(false);
      return false;
    }

    autoWalkName = loc.name || '';
    clickPath = path;
    clickTarget = { x: gx, y: gy, loc: isSite ? loc : null };
    autoWalk = true;
    if (!quiet) showToast(`自动寻路：${autoWalkName || '目的地'} · ${need} AP（按 WASD 或点「停下」接管）`);
    if (hooks.onAutoWalk) hooks.onAutoWalk(true);
    return true;
  }

  function stopWalk(quiet) {
    if (!autoWalk && !clickPath && !clickTarget) return false;
    autoWalk = false;
    autoWalkName = '';
    clickPath = null;
    clickTarget = null;
    clickRepathCd = 0;
    if (!quiet) showToast('停下来了，导航线还留着');
    if (hooks.onAutoWalk) hooks.onAutoWalk(false);
    return true;
  }

  function finishWalk() {
    if (!autoWalk) return;
    const n = autoWalkName;
    autoWalk = false;
    autoWalkName = '';
    if (n) showToast(`到了：${n}，按 E 或点「进入」`);
    if (hooks.onAutoWalk) hooks.onAutoWalk(false);
  }

  /* ============================================================
   *  潜入
   * ============================================================
   *  复用这张格子地图，加一层「守卫 + 视野扇形 + 警觉度」。
   *  设计上不做硬失败：被看见只是警觉度涨，涨满才被抓；被抓由
   *  剧情层决定代价（扣信誉、退回门口重来），不在这里写死。
   *
   *  - 守卫沿 path 两点往返，到点停 wait 秒再转身
   *  - 视野是个扇形，被 solid 格子挡住就看不见
   *  - 蹲伏（Shift）走得慢，但被看见的距离缩短
   *  - 藏匿点里警觉掉得快
   *  - 扔糖（Q）把附近的守卫引过去几秒
   * ============================================================ */

  let sneak = null;
  let sneakHookT = 0;

  const HIDES_R = 26;

  function startSneak(cfg) {
    cfg = cfg || {};
    const gs = (cfg.guards || []).map(g => {
      const path = (g.path || []).slice();
      return {
        path,
        seg: 1,
        dir: 1,
        waitT: 0,
        wait: g.wait == null ? 1.0 : g.wait,
        x: path[0] ? path[0].x : 0,
        y: path[0] ? path[0].y : 0,
        speed: g.speed || 46,
        range: g.range || 104,
        fov: ((g.fov || 64) * Math.PI) / 180,
        angle: 0,
        look: 0,          // 0..1，这一帧有多清楚看见玩家
        investigate: null // { x, y, t }
      };
    });

    sneak = {
      title: cfg.title || '潜入',
      tip: cfg.tip || '',
      goal: cfg.goal ? { ...cfg.goal } : null,
      guards: gs,
      hides: (cfg.hides || []).slice(),
      alarm: 0,
      candies: cfg.candies == null ? 2 : cfg.candies,
      crouch: false,
      noise: null,        // { x, y, t }
      hold: false,        // 触发回调后暂停，等剧情层接手
      arrived: false,
      caught: false,
      t: 0,
      cfg
    };

    if (cfg.start) { player.x = cfg.start.x; player.y = cfg.start.y; }
    player.riding = false;
    cam.x = player.x - VIEW_W / 2;
    cam.y = player.y - VIEW_H / 2;
    cam.x = Math.max(0, Math.min(WW - VIEW_W, cam.x));
    cam.y = Math.max(0, Math.min(WH - VIEW_H, cam.y));

    clickTarget = null;
    clickPath = null;
    autoWalk = false;
    autoWalkName = '';
    navTarget = null; navPath = null;
    distAcc = 0;

    showToast(cfg.tip || '避开视线，走到目标点');
    emitSneak(true);
    return true;
  }

  function endSneak() {
    sneak = null;
    sneakHookT = 0;
    if (hooks.onSneak) hooks.onSneak(null);
  }

  /* 换目标：也可以顺手换掉到达时的回调（潜入分两段走时要用） */
  function setSneakGoal(g, onArrive) {
    if (!sneak || !g) return false;
    sneak.goal = { ...g };
    sneak.arrived = false;
    sneak.hold = false;
    if (onArrive) sneak.cfg.onArrive = onArrive;
    emitSneak(true);
    return true;
  }

  function sneakInfo() {
    if (!sneak) return null;
    return {
      title: sneak.title,
      alarm: Math.round(sneak.alarm),
      candies: sneak.candies,
      crouch: sneak.crouch,
      goal: sneak.goal ? sneak.goal.label || '目标' : '',
      arrived: sneak.arrived,
      caught: sneak.caught
    };
  }

  function emitSneak(force) {
    if (hooks.onSneak) hooks.onSneak(sneakInfo());
  }

  function setCrouch(v) {
    if (!sneak) return;
    sneak.crouch = !!v;
    emitSneak(true);
  }

  /* 往身前扔一颗糖，附近守卫会被引过去 */
  function throwCandy() {
    if (!sneak || sneak.candies <= 0) return false;
    sneak.candies -= 1;
    const ang = player.dir === 'left' ? Math.PI
      : player.dir === 'right' ? 0
        : player.dir === 'up' ? -Math.PI / 2 : Math.PI / 2;
    const nx = player.x + Math.cos(ang) * 46;
    const ny = player.y + Math.sin(ang) * 46;
    sneak.noise = { x: nx, y: ny, t: 4.5 };
    sneak.guards.forEach(g => {
      if (Math.hypot(g.x - nx, g.y - ny) < 220) {
        g.investigate = { x: nx, y: ny, t: 4.5 };
      }
    });
    showToast(`糖扔出去了，还剩 ${sneak.candies} 颗`);
    emitSneak(true);
    return true;
  }

  /* 视线是否被实心格挡住 */
  function losBlocked(x1, y1, x2, y2) {
    const d = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(2, Math.ceil(d / 7));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const tx = Math.floor((x1 + (x2 - x1) * t) / T);
      const ty = Math.floor((y1 + (y2 - y1) * t) / T);
      if (tx < 0 || ty < 0 || tx >= NW || ty >= NH) return true;
      if (solid[ty * NW + tx]) return true;
    }
    return false;
  }

  /* 返回 0..1：越近越清楚，0 表示看不见 */
  function guardSees(g, px, py, rangeMul) {
    const dx = px - g.x, dy = py - g.y;
    const d = Math.hypot(dx, dy);
    const range = g.range * (rangeMul || 1);
    if (d > range || d < 1) return 0;
    let diff = Math.atan2(dy, dx) - g.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > g.fov / 2) return 0;
    if (losBlocked(g.x, g.y, px, py)) return 0;
    return 1 - d / range;
  }

  function inHide() {
    if (!sneak) return false;
    return sneak.hides.some(h => Math.hypot(player.x - h.x, player.y - h.y) <= HIDES_R);
  }

  function moveGuard(g, dt) {
    // 被糖引走：先过去看看，到点了停一会儿
    let tx, ty;
    if (g.investigate) {
      g.investigate.t -= dt;
      tx = g.investigate.x; ty = g.investigate.y;
      if (g.investigate.t <= 0) g.investigate = null;
    } else {
      if (g.waitT > 0) { g.waitT -= dt; return; }
      const tgt = g.path[g.seg];
      if (!tgt) return;
      tx = tgt.x; ty = tgt.y;
    }

    const dx = tx - g.x, dy = ty - g.y;
    const d = Math.hypot(dx, dy);
    if (d < 3) {
      if (!g.investigate) {
        g.waitT = g.wait;
        // 到点后掉头
        g.seg += g.dir;
        if (g.seg >= g.path.length) { g.seg = Math.max(0, g.path.length - 2); g.dir = -1; }
        else if (g.seg < 0) { g.seg = Math.min(1, g.path.length - 1); g.dir = 1; }
      }
      return;
    }
    const vx = dx / d, vy = dy / d;
    const nx = g.x + vx * g.speed * dt;
    const ny = g.y + vy * g.speed * dt;
    // 撞墙就停在原地等一下，免得守卫穿建筑
    const gtx = Math.floor(nx / T), gty = Math.floor(ny / T);
    if (gtx >= 0 && gty >= 0 && gtx < NW && gty < NH && !solid[gty * NW + gtx]) {
      g.x = nx; g.y = ny;
    }
    g.angle = Math.atan2(vy, vx);
  }

  function updateSneak(dt) {
    if (!sneak || sneak.hold) return;
    sneak.t += dt;

    sneak.guards.forEach(g => moveGuard(g, dt));

    if (sneak.noise) {
      sneak.noise.t -= dt;
      if (sneak.noise.t <= 0) sneak.noise = null;
    }

    // 蹲 + 藏匿都会缩短守卫的发现距离
    const hide = inHide();
    const mul = (sneak.crouch ? 0.62 : 1) * (hide ? 0.68 : 1);
    let best = 0;
    sneak.guards.forEach(g => {
      g.look = guardSees(g, player.x, player.y, mul);
      if (g.look > best) best = g.look;
    });

    if (best > 0) {
      // 站得越正、离得越近涨得越快；给玩家留出退回墙角的反应时间
      sneak.alarm = Math.min(100, sneak.alarm + (20 + 44 * best) * dt);
    } else {
      const decay = hide ? 36 : (sneak.crouch ? 20 : 15);
      sneak.alarm = Math.max(0, sneak.alarm - decay * dt);
    }

    // 警觉条每 0.12 秒喂给界面一次就够了，别每帧动 DOM
    sneakHookT -= dt;
    if (sneakHookT <= 0) { sneakHookT = 0.12; emitSneak(); }

    if (sneak.alarm >= 100 && !sneak.caught) {
      sneak.caught = true;
      sneak.hold = true;
      if (sneak.cfg.onCaught) sneak.cfg.onCaught();
      return;
    }

    if (sneak.goal && !sneak.arrived) {
      const d = Math.hypot(player.x - sneak.goal.x, player.y - sneak.goal.y);
      if (d <= (sneak.goal.r || 20)) {
        sneak.arrived = true;
        sneak.hold = true;
        emitSneak(true);
        if (sneak.cfg.onArrive) sneak.cfg.onArrive();
      }
    }
  }

  function drawSneak(t) {
    if (!sneak) return;

    // 藏匿点：一圈暗色，进去警觉掉得快
    sneak.hides.forEach(h => {
      const x = h.x - cam.x, y = h.y - cam.y;
      if (x < -40 || x > VIEW_W + 40 || y < -40 || y > VIEW_H + 40) return;
      const on = Math.hypot(player.x - h.x, player.y - h.y) <= HIDES_R;
      ctx.save();
      ctx.globalAlpha = on ? 0.30 : 0.16;
      ctx.fillStyle = '#0e1018';
      ctx.beginPath();
      ctx.arc(x, y, HIDES_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // 目标点
    if (sneak.goal) {
      const x = sneak.goal.x - cam.x, y = sneak.goal.y - cam.y;
      const r = sneak.goal.r || 20;
      const pulse = 1 + Math.sin(sneak.t * 3.4) * 0.12;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#ff9ec4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#ff9ec4';
      ctx.beginPath();
      ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 守卫视野扇形
    sneak.guards.forEach(g => {
      const x = g.x - cam.x, y = g.y - cam.y;
      if (x < -220 || x > VIEW_W + 220 || y < -220 || y > VIEW_H + 220) return;
      const t2 = Math.min(1, sneak.alarm / 100);
      const rr = 255;
      const gg = Math.round(208 - 98 * t2);
      const bb = Math.round(122 - 22 * t2);
      const a = 0.09 + t2 * 0.15;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, g.range, g.angle - g.fov / 2, g.angle + g.fov / 2);
      ctx.closePath();
      const grd = ctx.createRadialGradient(x, y, 6, x, y, g.range);
      grd.addColorStop(0, `rgba(${rr},${gg},${bb},${a + 0.10})`);
      grd.addColorStop(0.65, `rgba(${rr},${gg},${bb},${a * 0.7})`);
      grd.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
      ctx.fillStyle = grd;
      ctx.fill();
      // 描一圈边，不然深色地面上几乎看不出扇形的边界
      ctx.strokeStyle = `rgba(${rr},${gg},${bb},${0.22 + t2 * 0.3})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // 守卫本人
      ctx.save();
      const seenNow = g.look > 0;
      ctx.fillStyle = seenNow ? '#c2405a' : '#2b2438';
      ctx.fillRect(x - 5, y - 7, 10, 14);
      ctx.fillStyle = '#f2c9a0';
      ctx.fillRect(x - 4, y - 13, 8, 7);
      // 朝向
      ctx.fillStyle = 'rgba(255,240,220,0.75)';
      ctx.fillRect(x + Math.cos(g.angle) * 8 - 1.5, y - 3 + Math.sin(g.angle) * 8 - 1.5, 3, 3);
      ctx.restore();
    });

    // 扔出去的糖
    if (sneak.noise) {
      const n = sneak.noise;
      const x = n.x - cam.x, y = n.y - cam.y;
      ctx.save();
      ctx.globalAlpha = Math.min(1, n.t);
      ctx.fillStyle = '#ffd8e8';
      ctx.beginPath();
      ctx.arc(x, y, 4 + Math.sin(sneak.t * 12) * 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /* ---------------- 会话 ---------------- */
  function enter(opts) {
    hooks = opts || {};
    markers = opts.markers || [];
    player.x = opts.x != null ? opts.x : D.LOCATIONS.find(l => l.id === 'shop').doorX;
    player.y = opts.y != null ? opts.y : D.LOCATIONS.find(l => l.id === 'shop').doorY + 10;
    player.riding = !!opts.riding;
    distAcc = 0;
    clickTarget = null;
    clickPath = null;
    clickRepathCd = 0;
    autoWalk = false;
    autoWalkName = '';
    apEmptyFired = false;
    paused = false;
    cam.x = player.x - VIEW_W / 2;
    cam.y = player.y - VIEW_H / 2;
    running = true;
    lastTs = 0;
    resize();
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  function exit() {
    running = false;
    paused = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    clickTarget = null;
    clickPath = null;
    clickRepathCd = 0;
    autoWalk = false;
    autoWalkName = '';
    bigMapOpen = false;
    bigMapHover = null;
    navTarget = null; navPath = null; navPathLen = 0;
    sneak = null;
    sneakHookT = 0;
    Object.keys(keys).forEach(k => keys[k] = false);
    if (nearLoc && hooks.onNear) hooks.onNear(null);
    nearLoc = null;
  }

  function setMarkers(m) { markers = m || []; }

  function showToast(t) { toastText = t; toastTimer = 2.2; }

  /* ---------------- 主循环 ---------------- */
  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (!running) return;
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
    lastTs = ts;
    frames++;
    update(dt);
    draw(ts / 1000);
  }

  function update(dt) {
    const S = window.Engine.state;
    // 路上事件弹窗开着：暂停移动、按键、行动点，等玩家选完再继续
    if (paused) {
      player.moving = false;
      Object.keys(keys).forEach(k => { keys[k] = false; });
      if (toastTimer > 0) toastTimer -= dt;
      return;
    }
    // 摊开全城图时人站住，也不吃走位键
    if (bigMapOpen) {
      player.moving = false;
      Object.keys(keys).forEach(k => { keys[k] = false; });
      if (toastTimer > 0) toastTimer -= dt;
      return;
    }
    // 行动点见底就骑不动了，站在原地等玩家处理（叫车 / 走回去 / 收工）
    // 不管是骑到没力气，还是坐地铁花光的，都从这儿统一触发一次
    // （潜入时不吃这条：那一趟的行动点在进入时就一次性扣过了）
    if (!sneak && S.ap <= 0) {
      player.moving = false;
      Object.keys(keys).forEach(k => { keys[k] = false; });
      clickTarget = null;
      clickPath = null;
      if (autoWalk) { autoWalk = false; autoWalkName = ''; if (hooks.onAutoWalk) hooks.onAutoWalk(false); }
      if (toastTimer > 0) toastTimer -= dt;
      if (hooks.onMove) hooks.onMove(player.x, player.y);
      if (!apEmptyFired) { apEmptyFired = true; if (hooks.onEmpty) hooks.onEmpty(); }
      return;
    }
    apEmptyFired = false;
    let dx = 0, dy = 0;
    const kb = keys;
    const speedBase = sneak
      ? (sneak.crouch ? 40 : 72)
      : (player.riding ? D.VEHICLES[S.vehicle].speed : 66);
    const fatigue = S.energy < 35 ? 0.78 : 1;
    const speed = speedBase * fatigue;

    if (kb['a'] || kb['arrowleft']) dx -= 1;
    if (kb['d'] || kb['arrowright']) dx += 1;
    if (kb['w'] || kb['arrowup']) dy -= 1;
    if (kb['s'] || kb['arrowdown']) dy += 1;
    // 手一碰方向键就由玩家接管，别让自动寻路跟人抢摇杆
    if ((dx || dy) && autoWalk) stopWalk(true);

    if (!dx && !dy && clickPath) {
      // 沿折线走：先跳过脚底下那个点，再朝下一个拐点直线移动
      while (clickPath.length > 1 && Math.hypot(clickPath[0].x - player.x, clickPath[0].y - player.y) < 7) {
        clickPath.shift();
      }
      const wp = clickPath[0];
      const ddx = wp.x - player.x, ddy = wp.y - player.y;
      const dist = Math.hypot(ddx, ddy);
      if (dist < 6) {
        clickPath.shift();
        if (!clickPath.length) { clickPath = null; clickTarget = null; finishWalk(); }
      } else {
        dx = ddx / dist; dy = ddy / dist;
      }
    } else if (!dx && !dy && clickTarget) {
      // 兜底：没有路径点时还是朝目标推一把（正常情况下不会走到这儿）
      const ddx = clickTarget.x - player.x, ddy = clickTarget.y - player.y;
      const dist = Math.hypot(ddx, ddy);
      if (dist < 6) { clickTarget = null; }
      else { dx = ddx / dist; dy = ddy / dist; }
    }

    player.moving = !!(dx || dy);
    if (player.moving) {
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      if (Math.abs(dx) > Math.abs(dy)) player.dir = dx > 0 ? 'right' : 'left';
      else player.dir = dy > 0 ? 'down' : 'up';

      const nx = player.x + dx * speed * dt;
      const ny = player.y + dy * speed * dt;
      let moved = 0;
      let bumped = false;
      if (!blocked(nx, player.y)) { moved += Math.abs(nx - player.x); player.x = nx; }
      else bumped = true;
      if (!blocked(player.x, ny)) { moved += Math.abs(ny - player.y); player.y = ny; }
      else bumped = true;
      // 撞墙了别直接放弃：按当前位置重算一条路，下次循环就能绕过去
      if (bumped && clickTarget) {
        if (clickRepathCd <= 0) {
          clickRepathCd = 0.35;
          if (!repathClick()) {
            clickPath = null; clickTarget = null;
            if (autoWalk) {
              autoWalk = false; autoWalkName = '';
              showToast('前面过不去，停下来了');
              if (hooks.onAutoWalk) hooks.onAutoWalk(false);
            }
          }
        }
      }

      player.anim += dt * 8;

      // 行动点消耗：好车 apMul 更低，同样的距离扣得更少。
      // 潜入时不算里程——那一趟的行动点在进入场景时就扣掉了。
      if (!sneak) {
        distAcc += moved * apMul();
        while (distAcc >= AP_PER_PX) {
          distAcc -= AP_PER_PX;
          if (S.ap > 0) {
            S.ap -= 1;
            window.Engine.emit();
            // 每烧掉 1 点行动点给界面一次掷路上事件的机会
            if (hooks.onAPTick) hooks.onAPTick({ x: player.x, y: player.y, ap: S.ap });
          }
        }
      }
    } else {
      player.anim = 0;
    }

    // 相机
    const tx = player.x - VIEW_W / 2;
    const ty = player.y - VIEW_H / 2;
    cam.x += (tx - cam.x) * Math.min(1, dt * 9);
    cam.y += (ty - cam.y) * Math.min(1, dt * 9);
    cam.x = Math.max(0, Math.min(WW - VIEW_W, cam.x));
    cam.y = Math.max(0, Math.min(WH - VIEW_H, cam.y));

    // 最近可交互：变化时通知界面层刷新「进入 xx」按钮
    const prevNear = nearLoc;
    nearLoc = findNearest();
    if (nearLoc !== prevNear && hooks.onNear) hooks.onNear(nearLoc);

    // 走远了就重算一次路线，免得指引停在原地
    if (navTarget && Math.hypot(player.x - navFrom.x, player.y - navFrom.y) > 26) rebuildNav();

    if (toastTimer > 0) toastTimer -= dt;
    if (clickRepathCd > 0) clickRepathCd -= dt;

    if (sneak) updateSneak(dt);

    if (hooks.onMove) hooks.onMove(player.x, player.y);
  }

  /* ---------------- 绘制 ---------------- */
  function draw(t) {
    const S = window.Engine.state;
    const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#14161c';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.scale(scale * dpr, scale * dpr);

    // 静态地图
    ctx.drawImage(staticCanvas, cam.x, cam.y, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);

    /* 调试网格：?grid 时打开，红线是实心格，青色是瓦片坐标 */
    if (dbgGrid) {
      ctx.save();
      const tx0 = Math.floor(cam.x / T), ty0 = Math.floor(cam.y / T);
      for (let ty = ty0; ty < (cam.y + VIEW_H) / T; ty++) {
        for (let tx = tx0; tx < (cam.x + VIEW_W) / T; tx++) {
          const sx = tx * T - cam.x, sy = ty * T - cam.y;
          if (solid[ty * D.WORLD.w + tx]) {
            ctx.fillStyle = 'rgba(255,0,0,.3)';
            ctx.fillRect(sx, sy, T, T);
          }
          ctx.fillStyle = 'rgba(0,255,255,.85)';
          ctx.font = '5px monospace';
          ctx.fillText(tx + ',' + ty, sx + 1, sy + 6);
          ctx.strokeStyle = 'rgba(0,255,255,.18)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(sx, sy, T, T);
        }
      }
      ctx.restore();
    }

    // 海面闪光
    ctx.save();
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 14; i++) {
      const gx = 60 * T + ((i * 137 + t * 18) % (34 * T));
      const gy = ((i * 291) % WH);
      if (gx < cam.x - 20 || gx > cam.x + VIEW_W + 20) continue;
      ctx.fillStyle = '#a8d8f0';
      ctx.fillRect(gx - cam.x, gy - cam.y, 6, 1);
    }
    ctx.restore();

    // 区域边界外的柔和光
    drawRegisterLights(t);

    // 导航路径与目标（贴地，画在建筑和玩家之间）
    drawNavPath(t);
    drawNavGoal(t);

    // 潜入层：视野扇形、藏匿点、目标、守卫（都在玩家下面）
    drawSneak(t);

    // 订单标记
    markers.forEach(m => {
      const l = D.LOCATIONS.find(x => x.id === m.locId);
      if (!l) return;
      const px = l.doorX - cam.x, py = l.doorY - cam.y - 16;
      if (px < -40 || px > VIEW_W + 40 || py < -40 || py > VIEW_H + 40) return;
      const pulse = 1 + Math.sin(t * 4) * 0.25;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = m.color || '#ffd257';
      ctx.beginPath();
      ctx.arc(px, py - 8, 5 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2a2230';
      ctx.beginPath();
      ctx.arc(px, py - 8, 2, 0, Math.PI * 2);
      ctx.fill();
      // 小尖
      ctx.fillStyle = m.color || '#ffd257';
      ctx.beginPath();
      ctx.moveTo(px - 3, py - 4); ctx.lineTo(px + 3, py - 4); ctx.lineTo(px, py + 1);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    });

    // 玩家
    drawPlayer(t);

    // 交互提示：门口上方那个小十字
    if (nearLoc) {
      const px = nearLoc.doorX - cam.x;
      const py = nearLoc.doorY - cam.y - 26;
      ctx.save();
      ctx.globalAlpha = 0.9 + Math.sin(t * 5) * 0.1;
      ctx.fillStyle = '#fff4d8';
      ctx.fillRect(px - 5, py - 5, 10, 10);
      ctx.fillStyle = '#2a2230';
      ctx.fillRect(px - 3, py - 2, 6, 2);
      ctx.fillRect(px - 1, py - 3, 2, 6);
      ctx.restore();
    }

    drawTint(S);
    ctx.restore();

    // 世界文字（屏幕空间，清晰）
    drawLabels();
    drawHudOverlay(S);

    // 全城地图盖在最上层
    if (bigMapOpen) drawBigMap(t);
  }

  /* ---------------- 导航绘制 ---------------- */
  function drawNavPath(t) {
    if (!navPath || navPath.length < 2) return;
    const S = window.Engine ? window.Engine.state : { ap: 0 };
    // 剩下的行动点还能骑多远：超出去的那段压暗，玩家一眼就知道能到哪儿
    const budget = Math.max(0, S.ap) * AP_PER_PX / apMul();
    const phase = (t * 30) % 10;
    let walked = 0, cutPoint = null;
    ctx.save();
    for (let i = 1; i < navPath.length; i++) {
      const a = navPath[i - 1], b = navPath[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.5) continue;
      const ax = a.x - cam.x, ay = a.y - cam.y;
      const bx = b.x - cam.x, by = b.y - cam.y;
      const visible = !(Math.max(ax, bx) < -24 || Math.min(ax, bx) > VIEW_W + 24 ||
        Math.max(ay, by) < -24 || Math.min(ay, by) > VIEW_H + 24);
      if (visible) {
        const ux = (bx - ax) / len, uy = (by - ay) / len;
        // 沿线段均匀撒点，相位随时间推移形成"流动"感
        for (let d = phase - 10; d < len; d += 10) {
          if (d < 0) continue;
          const x = ax + ux * d, y = ay + uy * d;
          if (walked + d > budget) {
            ctx.fillStyle = '#9a8ba6';
            ctx.globalAlpha = 0.26;
          } else {
            ctx.fillStyle = '#ff9dc8';
            ctx.globalAlpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin((d - phase) * 0.35));
          }
          ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
        }
      }
      if (cutPoint === null && walked + len > budget) {
        const r = Math.max(0, Math.min(1, (budget - walked) / len));
        cutPoint = { x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r };
      }
      walked += len;
    }
    if (cutPoint) {
      const kx = cutPoint.x - cam.x, ky = cutPoint.y - cam.y;
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#ff5f7a';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(kx - 4, ky - 4); ctx.lineTo(kx + 4, ky + 4);
      ctx.moveTo(kx + 4, ky - 4); ctx.lineTo(kx - 4, ky + 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawNavGoal(t) {
    if (!navTarget) return;
    const px = navTarget.x - cam.x, py = navTarget.y - cam.y;
    if (px < -46 || px > VIEW_W + 46 || py < -46 || py > VIEW_H + 46) return;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.6);
    ctx.save();
    ctx.strokeStyle = '#ff9dc8';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.35 + 0.45 * (1 - pulse);
    ctx.beginPath(); ctx.arc(px, py - 10, 10 + pulse * 8, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = '#ff9dc8';
    ctx.beginPath(); ctx.arc(px, py - 10, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /* ---------------- 全城地图 ---------------- */
  let bigMapHover = null;
  let hoverCost = null;    // 悬停地点的去/回行动点估算，跟着 hover 变

  // 世界图 96x64，但城市只占其中一块，右侧和下方全是空海。
  // 全城图按内容包围盒裁一刀，能省下不少空白。
  const BOUNDS = (() => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    Object.values(D.REGIONS).forEach(r => {
      const [x, y, w, h] = r.rect;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
    });
    const pad = 2;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(D.WORLD.w, x1 + pad); y1 = Math.min(D.WORLD.h, y1 + pad);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  })();

  function bigMapLayout() {
    const W = canvas.width / dpr, H = canvas.height / dpr;
    const padX = 26, top = 72, bottom = 54;
    const availW = W - padX * 2, availH = H - top - bottom;
    const bw = BOUNDS.w * T, bh = BOUNDS.h * T;
    const s = Math.min(availW / bw, availH / bh);
    return {
      W, H, s,
      ox: (W - bw * s) / 2,
      oy: top + (availH - bh * s) / 2,
      bw: bw * s, bh: bh * s
    };
  }

  // 世界坐标 -> 全城图上的屏幕坐标
  function w2m(wx, wy, L) {
    return {
      x: L.ox + (wx - BOUNDS.x * T) * L.s,
      y: L.oy + (wy - BOUNDS.y * T) * L.s
    };
  }

  function bigMapHit(mx, my) {
    const L = bigMapLayout();
    let best = null, bd = 24;
    D.LOCATIONS.forEach(l => {
      const p = w2m(l.doorX, l.doorY, L);
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < bd) { bd = d; best = l; }
    });
    return best;
  }

  function drawBigMap(t) {
    const L = bigMapLayout();
    const { W, H, s, ox, oy, bw, bh } = L;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // 压暗背景
    ctx.fillStyle = 'rgba(9,6,14,0.96)';
    ctx.fillRect(0, 0, W, H);

    // 城市本体（只取有效区域）
    ctx.globalAlpha = 0.94;
    ctx.drawImage(
      staticCanvas,
      BOUNDS.x * T, BOUNDS.y * T, BOUNDS.w * T, BOUNDS.h * T,
      ox, oy, bw, bh
    );
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,244,216,0.32)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox, oy, bw, bh);

    // 区域名：加一块半透明底板，压在建筑上也读得出来
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '24px "PoxiaoPixel", sans-serif';
    Object.values(D.REGIONS).forEach(r => {
      const [rx, ry, rw, rh] = r.rect;
      const cx = ox + ((rx + rw / 2) - BOUNDS.x) * T * s;
      const cy = oy + ((ry + rh / 2) - BOUNDS.y) * T * s;
      const tw = ctx.measureText(r.name).width;
      ctx.fillStyle = 'rgba(14,10,20,0.62)';
      ctx.fillRect(cx - tw / 2 - 9, cy - 14, tw + 18, 28);
      ctx.fillStyle = 'rgba(255,244,216,0.78)';
      ctx.fillText(r.name, cx, cy + 1);
    });

    // 导航目标到玩家的连线
    if (navTarget) {
      const a = w2m(player.x, player.y, L);
      const b = w2m(navTarget.x, navTarget.y, L);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,157,200,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 地点
    D.LOCATIONS.forEach(l => {
      const p = w2m(l.doorX, l.doorY, L);
      const isOrder = markers.some(m => m.locId === l.id);
      const isTarget = navTarget && navTarget.locId === l.id;
      const isHover = bigMapHover === l;
      const r = isHover ? 4 : 3;

      ctx.fillStyle = isTarget ? '#ff9dc8'
        : isOrder ? '#ffd257'
          : isHover ? '#ffffff'
            : 'rgba(255,244,216,0.55)';
      ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);

      if (isHover) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x - r - 4, p.y - r - 4, r * 2 + 8, r * 2 + 8);
      }

      if (isOrder || isTarget || isHover) {
        ctx.font = '12px "PoxiaoPixel", sans-serif';
        ctx.strokeStyle = 'rgba(12,9,18,0.8)';
        ctx.lineWidth = 3;
        ctx.strokeText(l.name, p.x, p.y - 13);
        ctx.fillStyle = isTarget ? '#ffc8de' : isOrder ? '#ffe3a0' : '#fff4d8';
        ctx.fillText(l.name, p.x, p.y - 13);
      }
    });

    // 玩家位置
    const pp = w2m(player.x, player.y, L);
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    ctx.fillStyle = '#ff5f96';
    ctx.beginPath(); ctx.arc(pp.x, pp.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(pp.x, pp.y, 5 + pulse * 5, 0, Math.PI * 2); ctx.stroke();

    // 标题
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '24px "PoxiaoPixel", sans-serif';
    ctx.fillStyle = '#ffe9c9';
    ctx.fillText('新 都 · 全 城 图', 28, 42);

    ctx.font = '12px "PoxiaoPixel", sans-serif';
    if (bigMapHover) {
      const S = window.Engine.state;
      const c = hoverCost;
      let line = `${bigMapHover.name}　${bigMapHover.desc || ''}`;
      let enough = true;
      if (c && c.ap != null) {
        const total = c.ap + (c.backAp || 0);
        enough = total <= S.ap;
        line += `　｜　去 ${c.ap} AP · 回 ${c.backAp || 0} AP`;
        line += enough ? `（还够）` : `（差 ${total - S.ap}）`;
      } else if (c) {
        enough = false;
        line += '　｜　走不过去';
      }
      ctx.fillStyle = enough ? 'rgba(200,235,210,0.95)' : 'rgba(255,150,175,0.98)';
      ctx.fillText(line, 28, 62);
    } else {
      const S = window.Engine.state;
      ctx.fillStyle = 'rgba(190,170,205,0.9)';
      ctx.fillText(`点任意地点：自动寻路过去　·　M 或 ESC 关闭　·　还有 ${S.ap} AP（每 1 AP 约 ${pxPerAp()} 像素）`, 28, 62);
    }

    // 图例
    const legend = [
      ['#ff5f96', '你'],
      ['#ffd257', '待送订单'],
      ['#ff9dc8', '导航目标']
    ];
    let lx = W - 28;
    ctx.textAlign = 'right';
    for (let i = legend.length - 1; i >= 0; i--) {
      const [color, label] = legend[i];
      ctx.fillStyle = 'rgba(200,182,215,0.85)';
      ctx.fillText(label, lx, 42);
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = color;
      ctx.fillRect(lx - tw - 12, 33, 6, 6);
      lx -= tw + 34;
    }

    // 关闭按钮
    const bx = W - 44, by = H - 44;
    ctx.strokeStyle = 'rgba(255,244,216,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - 15, by - 15, 30, 30);
    ctx.strokeStyle = 'rgba(255,244,216,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx - 5, by - 5); ctx.lineTo(bx + 5, by + 5);
    ctx.moveTo(bx + 5, by - 5); ctx.lineTo(bx - 5, by + 5);
    ctx.stroke();
  }

  function drawRegisterLights(t) {
    // 糖果屋与商业区的暖光
    const glows = D.LOCATIONS.filter(l => ['shop', 'bar', 'metro', 'market', 'stall'].includes(l.kind) || l.kind === 'shop');
    glows.forEach((l, i) => {
      const gx = l.doorX - cam.x, gy = l.doorY - cam.y;
      if (gx < -60 || gx > VIEW_W + 60 || gy < -60 || gy > VIEW_H + 60) return;
      const r = 26 + Math.sin(t * 1.6 + i) * 2;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
      g.addColorStop(0, 'rgba(255,196,120,0.22)');
      g.addColorStop(1, 'rgba(255,196,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
    });
  }

  function drawPlayer(t) {
    const px = Math.round(player.x - cam.x);
    const py = Math.round(player.y - cam.y);
    const bob = player.moving ? Math.round(Math.sin(player.anim * 2) * 1) : 0;
    const x = px, y = py + bob;

    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(px, py + 8, 7, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // 地面光圈（让主角更显眼）
    const pulse = 0.5 + Math.sin(t * 3) * 0.5;
    ctx.strokeStyle = 'rgba(255,140,185,' + (0.22 + pulse * 0.28) + ')';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(px, py + 8, 9 + pulse * 1.5, 4.5 + pulse * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (player.riding) {
      // 摩托
      ctx.fillStyle = '#20202a';
      ctx.fillRect(x - 9, y + 5, 6, 5);
      ctx.fillRect(x + 4, y + 5, 6, 5);
      ctx.fillStyle = '#8a8f9c';
      ctx.fillRect(x - 7, y + 4, 3, 3);
      ctx.fillRect(x + 5, y + 4, 3, 3);
      ctx.fillStyle = '#c0507a';
      ctx.fillRect(x - 8, y - 1, 16, 6);
      ctx.fillStyle = '#e8e0d0';
      ctx.fillRect(x - 6, y - 3, 12, 3);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillRect(x + 8, y - 1, 3, 3);
      // 骑手
      ctx.fillStyle = '#3b2a3f';
      ctx.fillRect(x - 3, y - 14, 8, 8);
      ctx.fillStyle = '#f7d6bd';
      ctx.fillRect(x - 2, y - 11, 6, 5);
      ctx.fillStyle = '#ff9dbb';
      ctx.fillRect(x - 3, y - 8, 8, 7);
      ctx.fillStyle = '#fff3e0';
      ctx.fillRect(x - 2, y - 6, 6, 4);
      return;
    }

    // 站立小人
    const dir = player.dir;
    const step = player.moving ? (Math.floor(player.anim * 2) % 2 ? 1 : -1) : 0;

    // 腿
    ctx.fillStyle = '#3a2f45';
    ctx.fillRect(x - 3, y + 2 + (step > 0 ? 0 : 1), 2, 6);
    ctx.fillRect(x + 1, y + 2 + (step > 0 ? 1 : 0), 2, 6);
    // 裙/围裙
    ctx.fillStyle = '#ffc2d6';
    ctx.fillRect(x - 4, y - 5, 8, 8);
    ctx.fillStyle = '#fff3e0';
    ctx.fillRect(x - 2, y - 5, 4, 6);
    // 手臂
    ctx.fillStyle = '#f7d6bd';
    if (dir === 'left') { ctx.fillRect(x - 6, y - 4, 2, 4); }
    else if (dir === 'right') { ctx.fillRect(x + 4, y - 4, 2, 4); }
    else { ctx.fillRect(x - 5, y - 4, 2, 4); ctx.fillRect(x + 3, y - 4, 2, 4); }
    // 头
    ctx.fillStyle = '#f7d6bd';
    ctx.fillRect(x - 3, y - 13, 7, 8);
    // 头发
    ctx.fillStyle = '#4a2f3d';
    ctx.fillRect(x - 4, y - 15, 9, 4);
    ctx.fillRect(x - 5, y - 13, 2, 7);
    ctx.fillRect(x + 4, y - 13, 2, 6);
    if (dir === 'up') {
      ctx.fillRect(x - 4, y - 13, 9, 7);
    }
    // 发饰
    ctx.fillStyle = '#ff6f9c';
    ctx.fillRect(x + 3, y - 15, 3, 2);
    // 眼睛
    if (dir !== 'up') {
      ctx.fillStyle = '#2a2230';
      ctx.fillRect(x - 2, y - 10, 1, 2);
      ctx.fillRect(x + 1, y - 10, 1, 2);
    }
  }

  function drawTint(S) {
    const p = window.Engine.phase();
    if (!p) return;
    const map = {
      prep: ['#3a2a6b', 0.34],
      deliveryAM: ['#ffb066', 0.13],
      shiftAM: ['#ffe6a8', 0.05],
      noon: ['#fff2c0', 0.03],
      shiftPM: ['#ff9a5a', 0.11],
      deliveryPM: ['#2a1d4a', 0.36],
      night: ['#14102a', 0.5]
    };
    const cfg = map[p.id] || ['#000', 0];
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 1;
    ctx.fillStyle = cfg[0];
    ctx.globalAlpha = cfg[1] / 2;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }

  /* ---------------- 屏幕空间：地名标签 ---------------- */
  function drawLabels() {
    const W = canvas.width / dpr, H = canvas.height / dpr;
    const sc = W / VIEW_W;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    /* 名牌挤在一起时会互相压住（澡堂和地道口就是一对），
       后画的那块会把前一块盖掉半个字。所以这里做一次简单的避让：
       跟已经放下的牌子撞上，就往上挪一行，最多挪三行。 */
    const placed = [];
    const hits = r => placed.some(q =>
      r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y);

    D.LOCATIONS.forEach(l => {
      const sx = (l.doorX - cam.x) * sc;
      let sy = (l.doorY - cam.y) * sc - 20 * sc;
      if (sx < -60 || sx > W + 60 || sy < -20 || sy > H + 40) return;
      const isNear = nearLoc === l;
      // 像素字体只认 12 的整数倍，否则字形会被重采样糊掉
      const fs = 12;
      ctx.font = `${isNear ? 'bold ' : ''}${fs}px "PoxiaoPixel", sans-serif`;
      const tw = ctx.measureText(l.name).width;
      const padX = 5, padY = 3;
      const bw = tw + padX * 2, bh = fs + padY * 2;
      let box = { x: sx - bw / 2, y: sy - fs / 2 - padY, w: bw, h: bh };
      for (let k = 0; k < 3 && hits(box); k++) {
        sy -= bh + 2;
        box = { x: sx - bw / 2, y: sy - fs / 2 - padY, w: bw, h: bh };
      }
      placed.push(box);
      ctx.fillStyle = isNear ? 'rgba(255,244,216,0.94)' : 'rgba(22,18,32,0.62)';
      roundRect(ctx, box.x, box.y, box.w, box.h, 2);
      ctx.fill();
      ctx.fillStyle = isNear ? '#3a2b3d' : 'rgba(255,240,220,0.85)';
      ctx.fillText(l.name, sx, sy + 0.5);
    });

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  function drawHudOverlay(S) {
    const W = canvas.width / dpr, H = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 当前区域
    const region = Object.values(D.REGIONS).find(r => {
      const [rx, ry, rw, rh] = r.rect;
      const tx = player.x / T, ty = player.y / T;
      return tx >= rx && tx <= rx + rw && ty >= ry && ty <= ry + rh;
    });
    if (region) {
      ctx.font = 'bold 12px "PoxiaoPixel", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(20,16,28,0.55)';
      const nm = region.name;
      const tw = ctx.measureText(nm).width;
      roundRect(ctx, 12, 12, tw + 22, 26, 4); ctx.fill();
      ctx.fillStyle = region.light;
      ctx.fillText(nm, 22, 18);
      // 危险度
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i < region.danger ? '#ff6f8f' : 'rgba(255,255,255,0.18)';
        ctx.fillRect(22 + tw + 4 + i * 6, 22, 4, 6);
      }
    }

    // 提示 toast
    if (toastTimer > 0 && toastText) {
      ctx.textAlign = 'center';
      ctx.font = '12px "PoxiaoPixel", sans-serif';
      const tw = ctx.measureText(toastText).width;
      // 底栏在窄屏会折行变高，toast 往上让，不然会被压住看不见
      const bar = document.getElementById('map-bottombar');
      const barH = bar ? bar.offsetHeight : 0;
      const ty = W >= 640 ? H - 54 : H - Math.max(54, barH + 30) - 40;
      ctx.fillStyle = 'rgba(20,16,28,0.75)';
      roundRect(ctx, W / 2 - tw / 2 - 12, ty, tw + 24, 26, 4); ctx.fill();
      ctx.fillStyle = '#ffe9b8';
      ctx.fillText(toastText, W / 2, ty + 13);
    }

    // 交互提示改由 DOM 按钮承担（地图上的「进入 xx」），手机上才点得到

    /* 小地图 */
    if (miniCanvas) {
      const mw = MINI.w, mh = MINI.h;
      const mx = W - mw - MINI.right, my = MINI.top;
      ctx.save();
      ctx.fillStyle = 'rgba(16,12,22,0.85)';
      ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6);
      ctx.globalAlpha = 0.95;
      ctx.drawImage(miniCanvas, mx, my, mw, mh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,244,216,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(mx - 0.5, my - 0.5, mw + 1, mh + 1);
      // 视框
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.strokeRect(
        mx + cam.x / WW * mw, my + cam.y / WH * mh,
        Math.min(mw, VIEW_W / WW * mw), Math.min(mh, VIEW_H / WH * mh)
      );
      // 目标连线
      if (navTarget) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,157,200,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mx + player.x / WW * mw, my + player.y / WH * mh);
        ctx.lineTo(mx + navTarget.x / WW * mw, my + navTarget.y / WH * mh);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#ff9dc8';
        ctx.fillRect(mx + navTarget.x / WW * mw - 2, my + navTarget.y / WH * mh - 2, 4, 4);
      }
      // 订单标记
      markers.forEach(m => {
        const l = D.LOCATIONS.find(x => x.id === m.locId);
        if (!l) return;
        ctx.fillStyle = '#ffd257';
        ctx.fillRect(mx + l.doorX / WW * mw - 1.5, my + l.doorY / WH * mh - 1.5, 3, 3);
      });
      // 玩家
      ctx.fillStyle = '#ff5f96';
      ctx.beginPath();
      ctx.arc(mx + player.x / WW * mw, my + player.y / WH * mh, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 可点击提示
      ctx.font = '12px "PoxiaoPixel", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,244,216,0.72)';
      ctx.fillText('M 全城图', mx + mw / 2, my + mh + 16);
      ctx.restore();
    }

    /* 目标在视口外时，屏幕边缘给个指向箭头 */
    edgeArrowHit = null;
    if (navTarget) {
      const relX = navTarget.x - cam.x, relY = navTarget.y - cam.y;
      const out = relX < 40 || relX > VIEW_W - 40 || relY < 40 || relY > VIEW_H - 40;
      if (out) {
        const cx = VIEW_W / 2, cy = VIEW_H / 2;
        const ang = Math.atan2(relY - cy, relX - cx);
        const ax = W / 2 + Math.cos(ang) * (W / 2 - 58);
        const ay = H / 2 + Math.sin(ang) * (Math.min(H, W) / 2 - 58);
        // 这块能点：点一下就从「看方向」变成「真的走过去」
        edgeArrowHit = { x: ax, y: ay + 10, w: 60, h: 62 };
        if (!autoWalk) {
          ctx.save();
          ctx.strokeStyle = 'rgba(255,157,200,0.55)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.arc(ax, ay + 8, 22, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(ang);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#ff9dc8';
        ctx.beginPath();
        ctx.moveTo(10, 0); ctx.lineTo(-7, -7); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7);
        ctx.closePath(); ctx.fill();
        ctx.restore();

        // 距离
        const info = guideInfo();
        if (info) {
          ctx.save();
          ctx.font = '12px "PoxiaoPixel", sans-serif';
          ctx.textAlign = 'center';
          const label = autoWalk ? `${info.name} · 前往中` : `${info.name} · ${info.ap} AP`;
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = 'rgba(20,16,28,0.75)';
          roundRect(ctx, ax - tw / 2 - 7, ay + 12, tw + 14, 20, 3); ctx.fill();
          ctx.fillStyle = '#ffc8de';
          ctx.fillText(label, ax, ay + 26);
          if (!autoWalk) {
            const tip = '点我出发';
            ctx.font = '12px "PoxiaoPixel", sans-serif';
            const tw2 = ctx.measureText(tip).width;
            ctx.fillStyle = 'rgba(20,16,28,0.55)';
            roundRect(ctx, ax - tw2 / 2 - 5, ay + 34, tw2 + 10, 17, 3); ctx.fill();
            ctx.fillStyle = 'rgba(255,214,229,0.9)';
            ctx.fillText(tip, ax, ay + 46);
          }
          ctx.restore();
        }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* ---------------- 对外 ---------------- */
  return {
    init, enter, exit, setMarkers, showToast,
    setPaused: v => { paused = !!v; },
    setGuide, clearGuide, getGuide: guideInfo,
    walkTo, stopWalk,
    isAutoWalk: () => autoWalk,
    openBigMap, closeBigMap, toggleBigMap,
    isBigMapOpen: () => bigMapOpen,
    // ---- 潜入 ----
    startSneak, endSneak, setSneakGoal, sneakInfo, throwCandy, setCrouch,
    isSneak: () => !!sneak,
    setGrid: v => { dbgGrid = !!v; },
    getPlayer: () => ({ ...player }),
    setPosition: (x, y) => { player.x = x; player.y = y; },
    teleport: (locId) => {
      const l = D.LOCATIONS.find(x => x.id === locId);
      if (l) { player.x = l.doorX; player.y = l.doorY + 8; }
    },
    isRunning: () => running,
    // 世界坐标 ↔ 画布 CSS 坐标：自测里要点准某个地点时用
    screenOf: (x, y) => ({ x: (x - cam.x) * scale, y: (y - cam.y) * scale }),
    tapWorld: (x, y) => handleTap((x - cam.x) * scale, (y - cam.y) * scale),
    arrowHit: () => (edgeArrowHit ? { ...edgeArrowHit } : null),
    estimateRoute, apOfPx, pxPerAp, apMul,
    // 手机端没有 E 键：界面层的按钮直接调这个
    interact: () => tryInteract(),
    nearLoc: () => (nearLoc ? { id: nearLoc.id, name: nearLoc.name } : null),
    // 调试：点击寻路的状态（路径点数量 / 目标）
    clickDebug: () => ({
      path: clickPath ? clickPath.length : 0,
      target: clickTarget ? { x: Math.round(clickTarget.x), y: Math.round(clickTarget.y), loc: clickTarget.loc && clickTarget.loc.id } : null
    }),
    debug: () => ({ near: nearLoc && nearLoc.id, frames, running, px: Math.round(player.x), py: Math.round(player.y) }),
    /* 调试：把玩家周围 15×15 的实心格打印成字符画（排查「走不过去」） */
    dumpSolid: (r) => {
      r = r || 7;
      const ptx = Math.floor(player.x / T), pty = Math.floor(player.y / T);
      const rows = [];
      for (let ty = pty - r; ty <= pty + r; ty++) {
        let line = '';
        for (let tx = ptx - r; tx <= ptx + r; tx++) {
          if (tx < 0 || ty < 0 || tx >= D.WORLD.w || ty >= D.WORLD.h) { line += ' '; continue; }
          const here = (tx === ptx && ty === pty);
          const cell = solid[ty * D.WORLD.w + tx];
          line += here ? '@' : (cell ? '#' : '.');
        }
        rows.push(String(ty).padStart(3) + ' ' + line);
      }
      const head = 'x ' + Array.from({ length: r * 2 + 1 }, (_, i) => (ptx - r + i) % 10).join('');
      return `player tile ${ptx},${pty}\n` + head + '\n' + rows.join('\n');
    },
    // 测试用：手动推进若干帧，不依赖 requestAnimationFrame（headless 下 rAF 不一定跑）
    stepForTest: (dt, n) => { for (let i = 0; i < (n || 1); i++) update(dt || 0.016); },
    // 测试用：headless 里 rAF 不跑，手动画一帧出来截图
    renderOnce: () => { if (running) draw((performance.now() || 0) / 1000); }
  };
})();
