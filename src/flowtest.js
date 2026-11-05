/* ============================================================
 *  主线流程测试（仅 flowtest.html 使用）
 *  从「开始新的早晨」一路点到第三章结束，验证每一步的衔接。
 * ============================================================ */
(function () {
  window.CANDY_TEST_MODE = true;   // 主线流程测试不弹路上事件
  const results = [];
  const errors = [];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  function ok(name, cond, extra) {
    results.push({ name, pass: !!cond, extra: extra || '' });
  }

  window.addEventListener('error', e => errors.push((e.message || '') + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));

  /* 把剧情点到底：有选项先选第一个 */
  async function skipStory(max) {
    for (let i = 0; i < (max || 80); i++) {
      const n = document.getElementById('story-node');
      if (!n) return true;
      const opt = n.querySelector('.story-choice');
      if (opt) opt.click(); else n.click();
      await wait(20);
    }
    const n = document.getElementById('story-node');
    if (n) n.remove();
    return false;
  }

  /* 把玩家送到潜入目标点，触发到达 */
  function reachGoal() {
    const info = window.MapView.sneakInfo();
    const M = window.GameStory.SNEAKS;
    const goal = (window.MapView._goal && window.MapView._goal()) || null;
    return goal;
  }

  function panel() {
    const pass = results.filter(r => r.pass).length;
    document.title = 'FLOW ' + pass + '/' + results.length + ' err=' + errors.length;
    const d = document.createElement('div');
    d.id = 'flow-out';
    d.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;background:#101018;color:#dfe;font:12px/1.7 monospace;padding:16px;overflow:auto;white-space:pre-wrap';
    d.textContent = '主线流程 ' + pass + '/' + results.length + '\n\n' +
      results.map(r => (r.pass ? '✔ ' : '✘ ') + r.name + (r.extra ? '  [' + r.extra + ']' : '')).join('\n') +
      (errors.length ? '\n\n!! 异常:\n' + errors.join('\n') : '');
    document.body.appendChild(d);
  }

  async function run() {
    const E = window.Engine, UI = window.UI, G = window.GameStory, MV = window.MapView;
    localStorage.removeItem('candyhouse_save_v1');

    ok('GameStory 存在且带 SNEAKS', !!(G && G.SNEAKS),
      (G ? Object.keys(G).length + 'keys sn=' + typeof G.SNEAKS : 'no G'));

    /* ---- 1. 新游戏 → 序章开场 ---- */
    document.querySelector('[data-act="new-game"]').click();
    await wait(200);
    ok('新游戏后落在序章', G.state().chapter === 'prologue', String(G.state().chapter));
    ok('开场剧情已播放', !!document.getElementById('story-node'));
    await skipStory();
    await wait(700);
    ok('剧情结束后进入潜入', MV.isSneak());
    ok('潜入目标是糖果屋后门', (MV.sneakInfo() || {}).goal === '糖果屋后门', (MV.sneakInfo() || {}).goal);

    /* ---- 2. 走到后门 ---- */
    const g1 = G.SNEAKS.prologue_rain.goal;
    MV.setPosition(g1.x, g1.y);
    MV.stepForTest(0.05, 3);
    await wait(150);
    ok('到门口触发进店剧情', !!document.getElementById('story-node'));
    await skipStory();
    await wait(250);
    ok('序章推进到「打开暗门」', G.isStep('studio'), (G.step() || {}).id);
    ok('回到后场面板', UI.getView() === 'panel', String(UI.getView()));

    /* ---- 3. 委托页打开暗门 ---- */
    UI.setView('panel');
    document.querySelector('[data-act="tab"][data-tab="story"]').click();
    await wait(100);
    const openBtn = document.querySelector('[data-act="open-studio"]');
    ok('委托页出现「按下瓷砖」按钮', !!openBtn);
    if (openBtn) openBtn.click();
    await wait(150);
    ok('暗门剧情已播放', !!document.getElementById('story-node'));
    await skipStory();
    await wait(250);
    ok('序章完成、进入第一章', G.state().chapter === 'ch1', String(G.state().chapter));
    ok('拿到存储盒', G.itemCount('storageBox') >= 1, String(G.itemCount('storageBox')));

    /* ---- 4. 上午坐班：艾琳上门 ---- */
    E.startPhase(2);
    UI.enterPhase();
    await wait(250);
    ok('艾琳上门', !!document.getElementById('story-node'));
    await skipStory();
    await wait(300);
    ok('第一章推进到「看胸针」', G.isStep('brooch'), (G.step() || {}).id);
    ok('拿到雪花胸针', G.itemCount('snowBrooch') >= 1);
    ok('拿到十二颗联络糖', G.itemCount('contactCandy') === 12, String(G.itemCount('contactCandy')));

    /* ---- 5. 回想胸针 ---- */
    UI.setView('panel');
    document.querySelector('[data-act="tab"][data-tab="story"]').click();
    await wait(100);
    const recall = document.querySelector('[data-act="recall-brooch"]');
    ok('委托页出现「回想胸针」', !!recall);
    if (recall) recall.click();
    await wait(150);
    await skipStory();
    await wait(200);
    ok('第一章推进到「潜入」', G.isStep('infil'), (G.step() || {}).id);
    ok('拿到胸针线索', G.hasClue('brooch_vision'));

    /* ---- 6. 潜入银狐酒吧 ---- */
    UI.setView('panel');
    document.querySelector('[data-act="tab"][data-tab="story"]').click();
    await wait(100);
    const goBtn = document.querySelector('[data-act="goto-bar"]');
    ok('委托页出现「出发去酒吧」', !!goBtn);
    if (goBtn) goBtn.click();
    await wait(300);
    ok('进入酒吧潜入', MV.isSneak());
    ok('潜入目标是后巷铁门', (MV.sneakInfo() || {}).goal === '后巷的铁门', (MV.sneakInfo() || {}).goal);

    const g2 = G.SNEAKS.ch1_bar.goal;
    MV.setPosition(g2.x, g2.y);
    MV.stepForTest(0.05, 3);
    await wait(200);
    ok('到铁门触发地下室剧情', !!document.getElementById('story-node'));
    await skipStory();
    await wait(250);
    ok('推进到「带她撤离」', G.isStep('rescue'), (G.step() || {}).id);
    ok('目标改成修车铺', (MV.sneakInfo() || {}).goal === '修车铺门口', (MV.sneakInfo() || {}).goal);

    /* ---- 7. 撤离 ---- */
    MV.setPosition(400, 664);
    MV.stepForTest(0.05, 3);
    await wait(200);
    ok('到修车铺触发撤离剧情', !!document.getElementById('story-node'));
    await skipStory();
    await wait(300);
    ok('推进到「回店安顿」', G.isStep('home'), (G.step() || {}).id);
    ok('撤离后退出潜入', !MV.isSneak());

    /* ---- 8. 回店 ---- */
    UI.goInside();
    await wait(700);
    ok('回店触发安顿剧情', !!document.getElementById('story-node'));
    await skipStory();
    await wait(300);
    ok('推进到「看那封信」', G.isStep('photo'), (G.step() || {}).id);
    ok('拿到蓝色烙印线索', G.hasClue('blueMark'));

    /* ---- 9. 下一阶段：照片 ---- */
    E.endPhase();
    UI.enterPhase();
    await wait(900);
    ok('进入下一阶段送来照片', !!document.getElementById('story-node'));
    await skipStory();
    await wait(700);
    ok('第一章完成', G.state().done.indexOf('ch1') >= 0, JSON.stringify(G.state().done));
    ok('拿到「看客」线索', G.hasClue('watcher'));
    ok('信誉有提升', E.state.reputation > 50, String(Math.round(E.state.reputation)));

    /* ---- 10. 第二章：埃文上门（原文「三天后」） ---- */
    ok('第一章结束后自动接上第二章', G.isStep('visit'), (G.step() || {}).id);
    E.state.day = 3;
    UI.enterPhase();
    await wait(900);
    ok('埃文上门触发剧情', !!document.getElementById('story-node'));
    await skipStory();
    await wait(300);
    ok('第二章推进到「打开金属盒」', G.isStep('decode'), (G.step() || {}).id);
    ok('拿到金属盒与管网素描',
      G.itemCount('encryptedBox') >= 1 && G.itemCount('netSketch') >= 1);

    /* ---- 11. 破解 ---- */
    UI.setView('panel');
    document.querySelector('[data-act="tab"][data-tab="story"]').click();
    await wait(100);
    const boxBtn = document.querySelector('[data-act="ch2-open-box"]');
    ok('委托页出现「打开金属盒」', !!boxBtn);
    if (boxBtn) boxBtn.click();
    await wait(150);
    await skipStory();
    await wait(250);
    ok('破解后推进到「回后巷」', G.isStep('survey'), (G.step() || {}).id);
    ok('拿到七个锚点线索', G.hasClue('sevenAnchors'));
    ok('拿到收获备注', G.hasClue('harvestNote'));

    /* ---- 12. 回后巷潜入取记录 ---- */
    UI.setView('panel');
    document.querySelector('[data-act="tab"][data-tab="story"]').click();
    await wait(100);
    const surveyBtn = document.querySelector('[data-act="ch2-survey"]');
    ok('委托页出现「回后巷」', !!surveyBtn);
    if (surveyBtn) surveyBtn.click();
    await wait(300);
    ok('再次进入后巷潜入', MV.isSneak());
    const g3 = G.SNEAKS.ch1_bar.goal;
    MV.setPosition(g3.x, g3.y);
    MV.stepForTest(0.05, 3);
    await wait(200);
    ok('到铁门触发取记录剧情', !!document.getElementById('story-node'));
    await skipStory();
    await wait(250);
    ok('推进到「叠图比对」', G.isStep('network'), (G.step() || {}).id);
    ok('拿到实验记录', G.itemCount('labLog') >= 1);

    /* ---- 13. 叠图 → 黑信封 ---- */
    UI.setView('panel');
    document.querySelector('[data-act="tab"][data-tab="story"]').click();
    await wait(100);
    const netBtn = document.querySelector('[data-act="ch2-network"]');
    ok('委托页出现「叠图比对」', !!netBtn);
    if (netBtn) netBtn.click();
    await wait(150);
    await skipStory();
    await wait(250);
    ok('推进到「黑信封」', G.isStep('letter'), (G.step() || {}).id);
    UI.enterPhase();
    await wait(900);
    ok('下一阶段送来黑信封', !!document.getElementById('story-node'));
    await skipStory();
    await wait(300);
    ok('推进到「熬薄荷硬糖」', G.isStep('mint'), (G.step() || {}).id);
    ok('拿到渡鸦卡片', G.itemCount('ravenCard') >= 1);

    /* ---- 14. 收尾 ---- */
    UI.setView('panel');
    document.querySelector('[data-act="tab"][data-tab="story"]').click();
    await wait(100);
    const mintBtn = document.querySelector('[data-act="ch2-mint"]');
    ok('委托页出现「熬薄荷硬糖」', !!mintBtn);
    if (mintBtn) mintBtn.click();
    await wait(150);
    await skipStory();
    await wait(250);
    ok('第二章完成', G.state().done.indexOf('ch2') >= 0, JSON.stringify(G.state().done));
    ok('拿到薄荷硬糖', G.itemCount('mintHard') >= 1);
    ok('第二章结束后自动接上第三章', G.state().chapter === 'ch3' && G.isStep('raven'),
      String(G.state().chapter) + '/' + (G.step() || {}).id);

    /* ---- 15. 第三章：赴约（委托页按钮，3 AP） ----
       第三章每个动作都扣 AP；流程测试不跑经营循环，先把 AP 补够再点。 */
    E.state.ap = 10;
    UI.setView('panel');
    document.querySelector('[data-act="tab"][data-tab="story"]').click();
    await wait(100);
    const ravenBtn = document.querySelector('[data-act="ch3-raven"]');
    ok('委托页出现「去第七仓库赴约」', !!ravenBtn);
    if (ravenBtn) ravenBtn.click();
    await wait(150);
    ok('赴约剧情已播放', !!document.getElementById('story-node'));
    await skipStory();
    await wait(300);
    ok('第三章推进到「等维斯孔蒂」', G.isStep('contract'), (G.step() || {}).id);
    ok('拿到母亲的旧档案', G.itemCount('motherFile') >= 1);
    ok('拿到手提箱与银月请柬',
      G.itemCount('ravenCase') >= 1 && G.itemCount('silverMoonInvite') >= 1);
    ok('记下永恒甜蜜之门与母亲还活着', G.hasClue('eternalGate') && G.hasClue('leilaAlive'));

    /* ---- 16. 上午坐班：维斯孔蒂上门签合同 ---- */
    const cashV0 = E.state.money;
    E.startPhase(2);
    UI.enterPhase();
    await wait(900);
    ok('维斯孔蒂上门触发剧情', !!document.getElementById('story-node'));
    await skipStory();
    await wait(300);
    ok('第三章推进到「备料」', G.isStep('prep'), (G.step() || {}).id);
    ok('拿到宴会合同', G.itemCount('silverContract') >= 1);
    ok('预付款 800G 到账', E.state.money === cashV0 + 800,
      `${cashV0}→${E.state.money}`);

    /* ---- 17. 备料 ---- */
    E.state.ap = 10;
    const cashP0 = E.state.money;
    UI.setView('panel');
    document.querySelector('[data-act="tab"][data-tab="story"]').click();
    await wait(100);
    const prepBtn = document.querySelector('[data-act="ch3-prep"]');
    ok('委托页出现「备一箱宴会糖」', !!prepBtn);
    if (prepBtn) prepBtn.click();
    await wait(150);
    await skipStory();
    await wait(250);
    ok('备料扣掉 60G', E.state.money === cashP0 - 60, `${cashP0}→${E.state.money}`);
    ok('拿到特制糖与焦糖布丁',
      G.itemCount('trickCandy') >= 1 && G.itemCount('caramelPudding') >= 1);
    ok('第三章推进到「赴宴」', G.isStep('banquet'), (G.step() || {}).id);

    /* ---- 18. 赴宴 ---- */
    E.state.ap = 10;
    UI.setView('panel');
    document.querySelector('[data-act="tab"][data-tab="story"]').click();
    await wait(100);
    const banquetBtn = document.querySelector('[data-act="ch3-banquet"]');
    ok('委托页出现「前往银月庄园」', !!banquetBtn);
    if (banquetBtn) banquetBtn.click();
    await wait(150);
    await skipStory();
    await wait(250);
    ok('第三章推进到「书房」', G.isStep('study'), (G.step() || {}).id);
    ok('记下香料 / 大收割 / 议会内鬼三条线索',
      G.hasClue('suppressor') && G.hasClue('greatHarvest') && G.hasClue('councilMole'));

    /* ---- 19. 二楼书房取证 ---- */
    E.state.ap = 10;
    UI.setView('panel');
    document.querySelector('[data-act="tab"][data-tab="story"]').click();
    await wait(100);
    const studyBtn = document.querySelector('[data-act="ch3-study"]');
    ok('委托页出现「上二楼书房」', !!studyBtn);
    if (studyBtn) studyBtn.click();
    await wait(150);
    await skipStory();
    await wait(250);
    ok('第三章推进到「收尾」', G.isStep('end'), (G.step() || {}).id);
    ok('拿到新都塔图纸与供应商名单',
      G.itemCount('towerBlueprint') >= 1 && G.itemCount('supplierList') >= 1);
    ok('记下第七锚点', G.hasClue('seventhAnchor'));

    /* ---- 20. 收尾：敲开焦糖脆壳 ---- */
    UI.setView('panel');
    document.querySelector('[data-act="tab"][data-tab="story"]').click();
    await wait(100);
    const endBtn = document.querySelector('[data-act="ch3-end"]');
    ok('委托页出现「敲开焦糖脆壳」', !!endBtn);
    if (endBtn) endBtn.click();
    await wait(150);
    await skipStory();
    await wait(300);
    ok('第三章完成', G.state().done.indexOf('ch3') >= 0, JSON.stringify(G.state().done));
    ok('章节奖励到账', E.state.reputation > 50 && E.state.money > cashV0,
      `信誉 ${Math.round(E.state.reputation)} / 现金 ${Math.round(E.state.money)}`);
    ok('主线回到自由经营', G.state().chapter === null, String(G.state().chapter));
    ok('章节目录列出四章', $$('.chapter').length === G.ORDER.length,
      $$('.chapter').length + ' / ' + G.ORDER.length);
    const panelTxt = (document.getElementById('view-panel') || {}).textContent || '';
    ok('委托页显示「暂时写到这里」', panelTxt.indexOf('暂时写到这里') >= 0);

    panel();
  }

  window.addEventListener('load', () => {
    run().catch(e => { errors.push(String(e && e.stack || e)); panel(); });
  });
})();
