/* ============================================================
 *  糖果屋 · 新都蜗牛巷  —  启动
 * ============================================================ */
(function () {
  /* 像素字体的 woff2 是按 unicode-range 切片的，只有页面真正用到某段字符
     浏览器才会去拉对应分片。canvas 里的地名、招牌字不会被 CSS 文本触发，
     所以先把它们铺一遍，免得切到大地图时首帧退回雅黑。 */
  function warmFont() {
    const words = ['糖果屋新都蜗牛巷第天行动点元气信誉金币订单库存车库日记制作台'];
    try {
      window.GameData.LOCATIONS.forEach(l => words.push(l.name));
      Object.values(window.GameData.REGIONS).forEach(r => words.push(r.name));
      words.push(window.GameData.PHASES.map(p => p.name).join(''));
      words.push(window.GameData.PRODUCTS ? Object.values(window.GameData.PRODUCTS).map(p => p.name).join('') : '');
    } catch (e) { /* 数据未就绪则只预热基础字 */ }
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;' +
      'overflow:hidden;opacity:0;pointer-events:none';
    el.textContent = words.join('');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  function boot() {
    warmFont();
    window.UI.init();
    window.UI.refreshTitleBtn();

    window.addEventListener('error', e => {
      if (window.UI && window.UI.toast) {
        window.UI.toast('出了点问题：' + (e.message || '未知错误'), 'bad');
      }
    });

    /* ---- 调试参数：?autostart&nostory&phase=1 ---- */
    const q = location.search;
    // ?noevent：关掉送货路上的随机事件（调数值、跑无头截图时用）
    if (q.indexOf('noevent') >= 0) window.CANDY_NO_EVENTS = true;
    // ?event=<id>：直接摊开某一条路上事件（调文案 / 截图用）
    const em = q.match(/event=([a-z_]+)/);
    if (em && window.UI && window.UI.debugRoadEvent) {
      setTimeout(() => window.UI.debugRoadEvent(em[1]), 700);
    }
    // ?battle=<id>：直接开一场冲突；?tunnel=<locId>：直接摊开管网图
    const bm = q.match(/battle=([a-z_]+)/);
    if (bm && window.UI && window.UI.debugBattle) {
      setTimeout(() => window.UI.debugBattle(bm[1]), 700);
    }
    const tm = q.match(/tunnel=([a-z_]+)/);
    if (tm && window.UI && window.UI.debugTunnelModal) {
      setTimeout(() => window.UI.debugTunnelModal(tm[1]), 700);
    }
    if (q.indexOf('autostart') >= 0) {
      window.Engine.newGame();
      if (q.indexOf('nostory') < 0 && window.UI.playStory) {
        // 保留开场
      }
      const m = q.match(/phase=(\d+)/);
      if (m) {
        const idx = parseInt(m[1], 10);
        window.Engine.startPhase(Math.max(0, Math.min(window.GameData.PHASES.length - 1, idx)));
      }
      document.getElementById('title-screen').style.display = 'none';
      if (q.indexOf('noorder') >= 0) window.Engine.state.orders = [];
      // ?free：跳过主线，按以前那样直接开店（调数值和截图时用）
      if (q.indexOf('free') >= 0) {
        window.Engine.state.story.chapter = null;
        window.Engine.emit();          // 让 HUD / 左上角指引跟着刷新
      }
      // ?far：把第一单挪到新岛，用来验证「行动点不够」的红色提示
      if (q.indexOf('far') >= 0 && window.Engine.state.orders.length) {
        window.Engine.state.orders[0].loc = 'council';
      }
      window.UI.enterPhase();
      // ?sneak：直接进序章的雨夜潜入（调守卫路径、截图都用它）
      if (q.indexOf('sneak') >= 0) {
        const preset = window.GameStory.SNEAKS.prologue_rain;
        window.UI.setView('map');
        window.MapView.enter({
          x: preset.start.x, y: preset.start.y, riding: false,
          onSneak: () => window.Engine.emit()
        });
        window.MapView.startSneak(preset);
        window.Engine.emit();
        // headless 里 rAF 不跑，手动推几帧再画一帧，截图才有内容
        setTimeout(() => {
          window.MapView.stepForTest(0.016, 40);
          window.MapView.renderOnce();
        }, 300);
      }
      // ?tabstory：直接翻到委托页；?tab=people 之类可以翻到任意页
      if (q.indexOf('tabstory') >= 0) {
        setTimeout(() => {
          const b = document.querySelector('[data-act="tab"][data-tab="story"]');
          if (b) b.click();
        }, 350);
      }
      const tm = q.match(/tab=([a-z]+)/);
      if (tm) {
        setTimeout(() => {
          const b = document.querySelector('[data-act="tab"][data-tab="' + tm[1] + '"]');
          if (b) b.click();
        }, 350);
      }
      // ?prologue：重新开一局，看序章开场剧情
      if (q.indexOf('prologue') >= 0) {
        setTimeout(() => {
          const b = document.querySelector('[data-act="new-game"]');
          if (b) b.click();
        }, 200);
      }
      // ?seedpeople：塞几条熟人档案，专门用来看熟人页排版（配合 &tab=people）
      if (q.indexOf('seedpeople') >= 0) {
        const seed = [
          ['玛德琳太太', 4.6, 18, 17, 1, 0, 2380, 186, 9],
          ['面包师奥托', 3.8, 12, 11, 1, 0, 1560, 92, 9],
          ['咖啡师诺亚', 3.1, 7, 6, 1, 0, 980, 54, 8],
          ['学生莉莉', 2.2, 5, 4, 1, 0, 320, 8, 8],
          ['邮差小跑', 1.6, 3, 1, 1, 1, 210, 0, 7],
          ['跑腿小六', 0.8, 2, 0, 2, 0, 150, 0, 6]
        ];
        seed.forEach(([name, trust, orders, done, late, refused, spent, tips, lastDay]) => {
          window.Engine.state.people[name] = {
            name, orders, done, late, refused, spent, tips, trust, lastDay
          };
        });
      }
      // ?seedbook：把所有配方书都买下来，看后期「十四条线全开」的制作台（配合 &tab=craft）
      if (q.indexOf('seedbook') >= 0) {
        const S = window.Engine.state;
        S.money = 99999;
        window.Engine.lineList().forEach(l => {
          if (!l.unlocked) window.Engine.buyBook(l.id);
        });
        S.money = 4800;
      }
      // ?seedshop：把店铺塞成「经营了一阵子」的样子，看店铺页排版用（配合 &tab=shop）
      if (q.indexOf('seedshop') >= 0) {
        const S = window.Engine.state;
        S.money = 2860;
        S.shop = { counter: 2, case: 2, oven: 1 };
        S.staff = ['pip'];
        S.staffPost = { pip: 'counter' };   // 截图时看得到「交给小皮看着」
        S.day = 22;
        S.stats = { sold: 86, delivered: 64, made: 121, earned: 8460 };
        S.dayMade = 14;
        S.dayRevenue = 940;
        S.dayDelivered = 3;
        /* 三条软失败线 / 评级 / 磨损 / 赊账：让店铺页看起来像「开到第三周」的样子 */
        S.cred = { fulfill: 68, compliance: 74, supply: 55 };
        S.rank = 'C';
        S.wear = 38;
        S.week = { start: S.day - 3, revenue: 1640, delivered: 21, onTime: 19 };
        S.license = { due: S.day + 9 };
        S.payables = [{ day: S.day - 1, amt: 180, due: S.day + 2, late: 0 }];
        S.billLog = [
          { day: 9, home: 64, utility: 51, wage: 80, total: 195 },
          { day: 8, home: 78, utility: 63, wage: 80, total: 221 },
          { day: 7, home: 47, utility: 45, wage: 80, total: 172 },
          { day: 6, home: 52, utility: 72, wage: 0, total: 124 }
        ];
        window.Engine.startPhase(S.phaseIdx);
      }
      // ?erin：直接播艾琳上门那段（看说话人与选项标签）
      if (q.indexOf('erin') >= 0) {
        setTimeout(() => {
          window.UI.playStory(window.GameStory.SCRIPTS.ch1_erin_ask, () => {});
          /* &erinchoice：自动点三下，停在选项那一格 */
          if (q.indexOf('erinchoice') >= 0) {
            let n = 0;
            const t = setInterval(() => {
              const node = document.getElementById('story-node');
              if (node) node.click();
              if (++n > 3) clearInterval(t);
            }, 220);
          }
        }, 600);
      }

      // ?grid：在地图上叠加瓦片坐标与实心格（排查走不过去的地方）
      if (q.indexOf('grid') >= 0) {
        setTimeout(() => window.MapView.setGrid(true), 1600);
      }

      // ?solidmap：把玩家周围的实心格打印成字符画（排查走不过去的地方）
      if (q.indexOf('solidmap') >= 0) {
        setTimeout(() => {
          const pre = document.createElement('pre');
          pre.id = 'solid-dump';
          pre.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#000;color:#0f0;font:12px/1.2 monospace;padding:8px;margin:0';
          pre.textContent = window.MapView.dumpSolid(8);
          document.body.appendChild(pre);
        }, 2600);   // 要等 &goto 的传送跑完（它本身延迟约 1.7s）
      }

      // ?purdemo：自动摊开「向批发商下单」窗口（截图核对用）
      if (q.indexOf('purdemo') >= 0) {
        setTimeout(() => {
          const b = document.querySelector('[data-act="pur-open"]');
          if (b) b.click();
        }, 900);
      }

      // ?tutorial：直接开局进新手教学（看指引与那张固定订单）
      if (q.indexOf('tutorial') >= 0) {
        window.Engine.state.story.chapter = null;
        window.Engine.startTutorial();
        window.Engine.emit();
      }

      // ?clickact=guide-close：加载后点一下某个 data-act（截图验证按钮用）
      const ca = q.match(/clickact=([a-z0-9-]+)/);
      if (ca) {
        setTimeout(() => {
          const b = document.querySelector(`[data-act="${ca[1]}"]`);
          if (b) b.click();
        }, 1000);
      }

      // ?scene=ch1_erin_ask&at=9：直接播某一段剧本并推进 N 句（截图核对台词用）
      const sm = q.match(/scene=([a-zA-Z0-9_]+)/);
      if (sm) {
        const at = (q.match(/at=(\d+)/) || [, '0'])[1] | 0;
        setTimeout(() => {
          window.UI.playStory(window.GameStory.SCRIPTS[sm[1]], () => { });
          let n = 0;
          const tick = setInterval(() => {
            const node = document.getElementById('story-node');
            if (!node || n++ >= at) { clearInterval(tick); return; }
            const ch = node.querySelector('.story-choice');
            (ch || node).click();
          }, 160);
        }, 700);
      }

      // ?storylog：把剧情逐句记下来（排查空白行用），最后写进页面的 <pre id="story-log">
      if (q.indexOf('storylog') >= 0) {
        const log = [];
        let last = null, steps = 0, idle = 0;
        const t = setInterval(() => {
          const box = document.getElementById('story-node');
          const tx = document.getElementById('story-text');
          if (++steps > 90) {
            clearInterval(t);
            const pre = document.createElement('pre');
            pre.id = 'story-log';
            pre.textContent = log.map((x, i) => i + ': ' + JSON.stringify(x)).join('\n');
            document.body.appendChild(pre);
            return;
          }
          if (!box) { idle++; return; }
          idle = 0;
          const cur = tx ? tx.textContent : '';
          if (cur !== last) { log.push(cur); last = cur; }
          box.click();
        }, 300);
      }

      // ?sneakdemo：把序章对白自动点完，直接看「雨夜·蜗牛巷」的潜入画面
      if (q.indexOf('sneakdemo') >= 0) {
        let n = 0;
        const tick = setInterval(() => {
          const node = document.getElementById('story-node');
          if (node) node.click();
          if (++n > 40) clearInterval(tick);
        }, 180);
      }

      // ?cancelload：进配送阶段后点「取消」，验证这一阶段不会被跳过
      if (q.indexOf('cancelload') >= 0) {
        setTimeout(() => {
          const c = document.querySelector('#modal-root [data-act="close-modal"]');
          if (c) c.click();
        }, 1200);
      }

      // ?metroopen：站到地铁站门口并自动拉开线路图（配合 &goto=metro_old）。
      // 加 &secdemo 会塞一张含虹彩糖的订单进车厢，用来截「安检拦下」的样子。
      if (q.indexOf('metroopen') >= 0) {
        if (q.indexOf('secdemo') >= 0) {
          setTimeout(() => {
            const E = window.Engine;
            const o = E.state.orders[0] || E.makeOrder({ type: 'phone' });
            if (o && o.id) { o.items = { starcandy: 2 }; window.UI.debugLoad([o.id]); }
          }, 1200);
        }
        /* goto 是延迟执行的，这里轮询等着「乘坐地铁」那颗按钮出现 */
        let tries = 0;
        const tick = setInterval(() => {
          tries++;
          const m = document.querySelector('[data-act="loc-action"][data-id="metro"]');
          if (m) { clearInterval(tick); m.click(); return; }
          const act = document.getElementById('map-act');
          if (act && !act.classList.contains('is-off')) act.click();
          if (tries > 24) clearInterval(tick);
        }, 300);
      }
      // ?retire：自动走一遍「存档 → 结档 → 成绩单」，给截图核对用
      if (q.indexOf('retire') >= 0) {
        setTimeout(() => {
          const a = document.querySelector('[data-act="save-menu"]');
          if (a) a.click();
          setTimeout(() => {
            const b = document.querySelector('[data-act="retire-ask"]');
            if (b) b.click();
            setTimeout(() => {
              const c = document.querySelector('[data-act="retire-confirm"]');
              if (c) c.click();
            }, 200);
          }, 200);
        }, 500);
      }
      if (q.indexOf('&story') >= 0 || q.indexOf('?story') >= 0) {
        window.UI.playStory(window.GameData.DIALOGS.intro.lines, () => { });
      }
      if (q.indexOf('help') >= 0) {
        setTimeout(() => document.querySelector('[data-act="help"]').click(), 200);
      }
      // ?saves：直接摊开存档面板，方便看布局
      if (q.indexOf('saves') >= 0) {
        setTimeout(() => window.UI.openSaveModal(), 400);
      }
      // ?load：出货窗里自动勾一单，用来看预算行
      if (q.indexOf('load') >= 0 && q.indexOf('mapgo') < 0) {
        setTimeout(() => {
          const pick = document.querySelector('[data-act="load-toggle"]');
          if (pick) pick.click();
        }, 600);
      }
      // ?mapgo / ?bigmap / ?cargo：自动确认出货并进地图，方便截图和联调
      if (q.indexOf('bigmap') >= 0 || q.indexOf('cargo') >= 0 || q.indexOf('mapgo') >= 0) {
        setTimeout(() => {
          // 先装一单，否则进地图是空车、也没有导航目标
          const pick = document.querySelector('[data-act="load-toggle"]');
          if (pick) pick.click();
          setTimeout(() => {
            const confirm = document.querySelector('[data-act="confirm-load"]');
            if (confirm) confirm.click();
            setTimeout(() => {
              if (q.indexOf('bigmap') >= 0) window.MapView.openBigMap();
              if (q.indexOf('cargo') >= 0) {
                const c = document.querySelector('[data-act="cargo"]');
                if (c) c.click();
              }
              // ?emptyap：直接看「行动点见底」的三个出路
              if (q.indexOf('emptyap') >= 0) {
                window.Engine.state.ap = 0;
                window.Engine.emit();
                window.UI.simulateAPEmpty();
              }
              // ?homemenu：站在糖果屋门口按 E，看交互菜单
              if (q.indexOf('homemenu') >= 0) {
                window.MapView.teleport('shop');
                setTimeout(() => {
                  const b = document.getElementById('map-act');
                  if (b) b.click();
                }, 300);
              }
              // ?home：配送中途回店，看后场面板的「再出门」
              if (q.indexOf('home') >= 0 && q.indexOf('homemenu') < 0) {
                window.MapView.teleport('shop');
                window.UI.goInside();
                // ?reload：顺着点「再出门」，看装货窗里默认勾上的单
                if (q.indexOf('reload') >= 0) {
                  setTimeout(() => {
                    const b = document.querySelector('[data-act="phase-action"][data-id="go-out"]');
                    if (b) b.click();
                  }, 600);
                }
              }
              // ?goto=地点id：把车直接放到某个地点门口（看新建筑站位用）
              const gm = q.match(/goto=([a-z_0-9]+)/);
              if (gm) setTimeout(() => {
                window.MapView.teleport(gm[1]);
                // headless 里 rAF 不跑，镜头插值不会收敛——手动推几帧再画
                window.MapView.stepForTest(0.016, 30);
                window.MapView.renderOnce();
              }, 420);
            }, 500);
          }, 200);
        }, 400);
      }
    }

    // ?titlesaves：标题页直接摊开存档面板（只看读取，不给存）
    if (q.indexOf('titlesaves') >= 0) {
      setTimeout(() => window.UI.openSaveModal(), 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
