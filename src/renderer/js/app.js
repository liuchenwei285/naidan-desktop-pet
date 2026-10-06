/* ============================================================================
 *  app.js —— 渲染进程入口:输入、主循环、与主进程通信
 * ========================================================================== */
(function () {
  'use strict';

  var C = window.Naidan.CONFIG;
  var api = window.petAPI || null;

  var canvas = document.getElementById('stage');
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  var sound = new window.Naidan.SoundEngine();
  sound.load();          // 预加载 + 解码 Bubble_4(低延迟)

  function buildPet() {
    window.Naidan.Geometry.reset();          // scale 变了要重建轮廓缓存
    C.recomputeDerived();
    return new window.Naidan.Creature(canvas, {
      sound: sound, dpr: dpr, supersample: C.layout.supersample || undefined
    });
  }
  var pet = buildPet();

  /** 右键菜单「大小」→ 主进程改窗口尺寸后通知渲染进程重建 */
  function applyScale(scale) {
    C.applyScale(scale);
    pet = buildPet();
    console.log('[scale] requested=' + scale + ' applied=' + C.appearance.scale +
      ' k=' + pet.k + ' W=' + pet.W + ' anchorY=' + pet.anchor.y +
      ' eyeOffsetY=' + pet.f.eye.offsetY + ' eyeCanvasY=' + (pet.anchor.y + pet.f.eye.offsetY) +
      ' canvas=' + canvas.width + 'x' + canvas.height + ' css=' + canvas.style.width +
      ' dpr=' + dpr + ' ss=' + pet.ss);
    window.__pet.creature = pet;
    ignoring = null;                          // 强制重新同步一次穿透状态
    setIgnore(true);
  }

  /* ------------------------------------------------------------------ */
  /* 1. 透明区域鼠标穿透                                                 */
  /* ------------------------------------------------------------------ */
  var ignoring = null;                 // null 表示尚未与主进程同步
  var forceInteractive = false;        // 拖拽中强制可交互

  function setIgnore(ignore) {
    if (ignore === ignoring) return;
    ignoring = ignore;
    if (api) api.setIgnoreMouse(ignore);
    else canvas.style.pointerEvents = ignore ? 'none' : 'auto';
  }

  function canvasPos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function refreshInteractivity(x, y) {
    var interactive = forceInteractive || pet.hitTest(x, y, 1.5);
    setIgnore(!interactive);
    return interactive;
  }

  /* ------------------------------------------------------------------ */
  /* 2. 指针:悬停 / 点击 / 拖拽                                          */
  /* ------------------------------------------------------------------ */
  var drag = { armed: false, active: false, sx: 0, sy: 0, px: 0, py: 0 };
  function dx2(e) { var d = e.clientX - drag.px; drag.px = e.clientX; return d; }
  function dy2(e) { var d = e.clientY - drag.py; drag.py = e.clientY; return d; }

  function onMove(e) {
    var p = canvasPos(e);
    pet.setPointer(p.x, p.y);
    pet.setCursor(p.x, p.y);          // 窗口内移动时立刻响应(与主进程轮询互补)

    if (drag.armed && !drag.active) {
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (dx * dx + dy * dy > 9) {          // 超过 3px 才算拖拽
        drag.active = true;
        forceInteractive = true;
        pet.startDrag();
        if (api) api.dragStart();
      }
    }
    if (drag.active) {
      pet.setDragLook(e.movementX || dx2(e), e.movementY || dy2(e));   // 瞳孔朝拖动方向看
      if (api) api.dragMove();
    }

    refreshInteractivity(p.x, p.y);
  }

  function onDown(e) {
    var p = canvasPos(e);
    if (e.button === 2) {                    // 右键交给 contextmenu,不做任何反应
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    if (!pet.hitTest(p.x, p.y, 2)) return;

    e.preventDefault();
    sound.unlock();                          // 用户手势里解锁 AudioContext
    pet.setPointer(p.x, p.y);
    pet.poke(true);                          // ★ 点击:眨眼 + 果冻 + duang

    drag.armed = true; drag.active = false;
    drag.sx = e.clientX; drag.sy = e.clientY;
    drag.px = e.clientX; drag.py = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }

  function onUp(e) {
    if (drag.active) {
      drag.active = false; forceInteractive = false;
      pet.endDrag();
      if (api) api.dragEnd();
    }
    drag.armed = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    var p = canvasPos(e);
    refreshInteractivity(p.x, p.y);
  }

  function onLeave() {
    if (!drag.active) { pet.clearPointer(); setIgnore(true); }
  }

  canvas.addEventListener('pointermove', onMove);
  window.addEventListener('mousemove', function (e) {
    // 某些平台在“鼠标穿透(forward)”状态下只派发 mousemove
    if (e.target === canvas || drag.active) onMove(e);
  });
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', function () {
    if (drag.active) { drag.active = false; forceInteractive = false; pet.endDrag(); if (api) api.dragEnd(); }
    drag.armed = false;
  });

  /* ------------------------------------------------------------------ */
  /* 3. 右键菜单(原生系统菜单,由主进程弹出)                             */
  /* ------------------------------------------------------------------ */
  canvas.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    if (api) api.contextMenu({ muted: sound.isMuted() });
  });

  /* ------------------------------------------------------------------ */
  /* 4. 主进程 → 渲染进程                                                */
  /* ------------------------------------------------------------------ */
  if (api) {
    api.onMuted(function (m) { sound.setMuted(m); });
    api.onNudge(function () { sound.unlock(); pet.nudge(); });
    api.onConfig(function (cfg) {
      if (!cfg) return;
      if (typeof cfg.muted === 'boolean') sound.setMuted(cfg.muted);
      if (typeof cfg.eyeFollow === 'boolean' && C.motion.eyeFollow) C.motion.eyeFollow.enabled = cfg.eyeFollow;
      if (typeof cfg.scale === 'number' && cfg.scale !== C.appearance.scale) applyScale(cfg.scale);
    });
    api.onScale(function (scale) { applyScale(scale); });
    api.onEyeFollow(function (on) {
      if (C.motion.eyeFollow) C.motion.eyeFollow.enabled = !!on;
      if (!on) pet.clearCursor();
    });
    // 主进程轮询整个屏幕的光标位置 → 瞳孔跟着转
    api.onCursor(function (c) {
      if (!c || !c.w || !c.h) return;
      if (C.motion.eyeFollow && C.motion.eyeFollow.enabled === false) return;
      var cx = c.x * (pet.W / c.w);
      var cy = c.y * (pet.H / c.h);
      pet.setCursor(cx, cy);
    });
  }

  /* ------------------------------------------------------------------ */
  /* 5. requestAnimationFrame 主循环                                     */
  /* ------------------------------------------------------------------ */
  var last = 0, acc = 0, running = true;

  function isCalm() {
    return !drag.active && !pet.action && !pet.blink.active &&
           Math.abs(pet.jelly.x) < 0.0012 && Math.abs(pet.jelly.v) < 0.02;
  }

  function frame(ts) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (!last) last = ts;
    var raw = (ts - last) / 1000;
    last = ts;
    if (raw < 0) raw = 0;

    var fps = isCalm() ? C.perf.calmFps : C.perf.activeFps;
    if (fps < 59) {                            // 低功耗档:降帧
      acc += raw;
      if (acc < 1 / fps) return;
      raw = acc; acc = 0;
    }

    var dt = Math.min(raw, C.perf.maxDeltaMs / 1000);
    pet.update(dt);
    pet.draw();
  }

  document.addEventListener('visibilitychange', function () { last = 0; });
  requestAnimationFrame(frame);

  /* ------------------------------------------------------------------ */
  /* 6. 调试出口(供自动化测试使用)                                      */
  /* ------------------------------------------------------------------ */
  window.__pet = {
    creature: pet, sound: sound,
    applyScale: applyScale,
    poke: function () { pet.poke(true); },
    nudge: function () { pet.nudge(); },
    hit: function (x, y) { return pet.hitTest(x, y); },
    blinkNow: function () { pet.startBlink(); },
    play: function (name) { pet.startAction(name); },
    config: C
  };

  // 退出前释放音频上下文 / 定时器
  window.addEventListener('beforeunload', function () {
    running = false;
    try { sound.dispose(); } catch (e) { /* ignore */ }
  });

  // 启动时先让窗口整体穿透,之后由 mousemove 判定蛋体区域
  setIgnore(true);
  if (api) api.ready();
})();
