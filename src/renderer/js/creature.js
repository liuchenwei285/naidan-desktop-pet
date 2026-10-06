/* ============================================================================
 *  creature.js —— 小生物本体:状态机 + 弹簧物理 + 绘制
 * ----------------------------------------------------------------------------
 *  纯逻辑模块,不依赖 Electron,可单独在浏览器中渲染(见 tools/preview.html)。
 *  对外 API:
 *     new Creature(canvas, { sound, dpr, supersample })
 *     creature.update(dt)            // dt 秒
 *     creature.draw()
 *     creature.hitTest(x, y)         // canvas CSS 坐标
 *     creature.poke(withSound, scale)
 *     creature.setPointer(x, y) / clearPointer()
 *     creature.startDrag() / endDrag()
 *     creature.nudge()               // 轻微弹一下(单实例提示等)
 * ========================================================================== */
(function (root) {
  'use strict';

  var CONFIG = root.Naidan.CONFIG;
  var Geometry = root.Naidan.Geometry;

  /* ------------------------------ 工具 ------------------------------------ */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function smoothstep(p) { p = clamp(p, 0, 1); return p * p * (3 - 2 * p); }
  function easeOutQuad(p) { p = clamp(p, 0, 1); return 1 - (1 - p) * (1 - p); }
  function easeInQuad(p) { p = clamp(p, 0, 1); return p * p; }
  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgba(hex, a) { var c = hexToRgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function applyStops(grad, stops) { for (var i = 0; i < stops.length; i++) grad.addColorStop(stops[i][0], stops[i][1]); return grad; }

  /* --------------------------- 弹簧积分器 --------------------------------- */
  function Spring(k, c) { this.k = k; this.c = c; this.x = 0; this.v = 0; this.since = 1e9; }

  /** 给一个冲量,使第一个极点的位移幅值恰好 = amplitude */
  Spring.prototype.impulse = function (amplitude, wd, zetaWn) {
    var t1 = Math.PI / (2 * wd);
    var v0 = amplitude * wd * Math.exp(zetaWn * t1);
    this.v = -v0;
    this.x = 0;
    this.since = 0;
  };

  Spring.prototype.step = function (dt, target, dampBoost) {
    target = target || 0;
    var k = this.k, c = this.c * (dampBoost || 1);
    var steps = Math.max(1, Math.min(8, Math.ceil(dt / (1 / 240))));
    var h = dt / steps;
    for (var i = 0; i < steps; i++) {
      var a = -k * (this.x - target) - c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    this.since += dt;
    if (Math.abs(this.x) < 1e-6 && Math.abs(this.v) < 1e-4) { this.x = 0; this.v = 0; }
  };

  /* =========================================================================
   *  Creature
   * ======================================================================= */
  function Creature(canvas, options) {
    options = options || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.cfg = CONFIG;
    this.sound = options.sound || null;

    var L = CONFIG.layout, F = CONFIG.features;
    // 全局缩放:窗口、蛋体、五官、阴影、跳跃、拖拽……所有长度一起变
    this.k = Math.max(0.25, CONFIG.appearance.scale || 1);
    var k = this.k;
    this.W = Math.round(CONFIG.window.baseCanvasWidth * k);
    this.H = Math.round(CONFIG.window.baseCanvasHeight * k);
    // 缩放锚点 = 蛋体底部中心(transform-origin: 50% 100%)
    this.anchor = { x: this.W / 2, y: Math.round(L.groundY * k) };
    this.dragLift = 0;
    this.lightLag = 0;

    // 把配置里以「基准 px」写的长度统一换算成当前 scale 下的 px
    this.f = {
      eye: {
        offsetX: F.eye.offsetX * k, offsetY: F.eye.offsetY * k, radius: F.eye.radius * k,
        pupilRatio: F.eye.pupilRatio, pupilRestOutward: F.eye.pupilRestOutward,
        glintRadius: F.eye.glintRadius, glintAlpha: F.eye.glintAlpha,
        scleraGlint: F.eye.scleraGlint
      },
      bill: {
        tipY: F.bill.tipY * k, halfWidth: F.bill.halfWidth * k,
        topRise: F.bill.topRise * k, creaseSag: F.bill.creaseSag * k,
        edgeShadeAlpha: F.bill.edgeShadeAlpha,
        shadowOffsetY: F.bill.shadowOffsetY * k, shadowHalfWidth: F.bill.shadowHalfWidth * k,
        shadowHalfHeight: F.bill.shadowHalfHeight * k, shadowAlpha: F.bill.shadowAlpha
      },
      bridge: {
        topY: F.bridge.topY * k, bottomY: F.bridge.bottomY * k,
        topHalfWidth: F.bridge.topHalfWidth * k, bottomHalfWidth: F.bridge.bottomHalfWidth * k,
        highlightAlpha: F.bridge.highlightAlpha, sideShadeAlpha: F.bridge.sideShadeAlpha
      },
      shadow: {
        coreWidth: CONFIG.shadow.coreWidth * k, coreHeight: CONFIG.shadow.coreHeight * k,
        coreAlpha: CONFIG.shadow.coreAlpha,
        ambientWidth: CONFIG.shadow.ambientWidth * k, ambientHeight: CONFIG.shadow.ambientHeight * k,
        ambientAlpha: CONFIG.shadow.ambientAlpha
      },
      hopHeight: CONFIG.motion.hop.heightPx * k
    };

    this.dpr = options.dpr || 1;
    // 烘焙图层的像素密度必须与设备像素密度一致:否则 drawImage 缩小会走
    // 双线性重采样,在蛋体斜边上产生锯齿。ss = dpr 时是 1:1 无重采样。
    this.ss = Math.max(1, options.supersample || this.dpr);
    if (options.supersample === undefined) this.ss = Math.max(1, this.dpr);

    Geometry.init();           // 生成轮廓(幂等)
    this.reset(true);
    this.applyDpr();
    this.buildLayers();
    this.buildShadow();
  }

  Creature.prototype.applyDpr = function () {
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
  };

  Creature.prototype.reset = function (initial) {
    var m = CONFIG.motion, d = CONFIG.derived;
    this.time = 0;

    this.jelly = new Spring(d.jelly.k, d.jelly.c);
    this.faceJelly = new Spring(d.face.k, d.face.c);

    this.breathPhase = initial ? Math.PI : 0;    // 从最扁处开始,不会跳变

    this.blink = {
      active: false, t: 0, queued: 0,
      nextAt: rand(m.blink.naturalMinSec, m.blink.naturalMaxSec)
    };

    this.pointer = { x: 0, y: 0, active: false };
    this.pupil = { x: 0, y: 0 };

    this.action = null; this.actionT = 0; this.lastAction = null;
    this.idleNextAt = rand(m.idle.minGapSec, m.idle.maxGapSec);

    this.dragging = false; this.dragAmt = 0;
    this.hopY = 0; this.wobbleAngle = 0; this.stretchAmt = 0;
    this.gazeOffset = 0; this.hopLanded = false;
    this.cursor = { x: 0, y: 0, active: false, lastMoveAt: -99 };
    this.dragLook = { x: 0, y: 0 };
    this.faceShift = { x: 0, y: 0 };

    this.bodyScale = { x: 1, y: 1 };
  };

  /* ======================================================================
   *  图层烘焙(只做一次;之后每帧只有 drawImage,CPU 占用极低)
   * ==================================================================== */
  Creature.prototype.makeLayer = function () {
    var pad = 12 * this.k, hw = Geometry.halfW, H = Geometry.H;
    var box = { x: -hw - pad, y: -H - pad, w: 2 * (hw + pad), h: H + 2 * pad };
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(box.w * this.ss);
    cv.height = Math.ceil(box.h * this.ss);
    var g = cv.getContext('2d');
    g.scale(this.ss, this.ss);
    g.translate(-box.x, -box.y);       // 后续绘制直接用 creature 局部坐标
    return { canvas: cv, ctx: g, box: box };
  };

  Creature.prototype.buildLayers = function () {
    this.bodyLayer = this.buildBodyLayer();
    this.lightLayer = this.buildLightLayer();
    this.faceLayer = this.buildFaceLayer();
    this.eyeSprite = this.buildEyeSprite();
    this.pupilSprite = this.buildPupilSprite();
  };

  /* ------------------------------ 蛋体 ----------------------------------- */
  Creature.prototype.buildBodyLayer = function () {
    var C = CONFIG, col = C.colors, G = Geometry;
    var L = this.makeLayer(), g = L.ctx;
    var H = G.H, hw = G.halfW, path = G.path;
    var LG = col.lighting || {};

    /* 蛋体包围盒比例 → 局部坐标 */
    function bx(rx) { return (rx - 0.5) * 2 * hw; }
    function by(ry) { return -H + ry * H; }

    // 1) 主体竖向渐变(实测色标)
    var base = g.createLinearGradient(0, -H, 0, 0);
    applyStops(base, col.bodyGradient);
    g.fillStyle = base;
    g.fill(path);

    g.save();
    g.clip(path);

    // 2) 暗部:右下过渡到更深的暖橙金(温暖,不发褐发灰)
    if (LG.shade) {
      var s0 = LG.shade;
      var cx = bx(s0.x), cy = by(s0.y), r = s0.radius * H;
      var sg = g.createRadialGradient(cx, cy, 1, cx, cy, r);
      sg.addColorStop(0.00, rgba(s0.color, s0.alpha));
      sg.addColorStop(0.42, rgba(s0.color, s0.alpha * 0.72));
      sg.addColorStop(0.72, rgba(s0.color, s0.alpha * 0.32));
      sg.addColorStop(1.00, rgba(s0.color, 0));
      g.fillStyle = sg; g.fillRect(-hw, -H, 2 * hw, H);
    }

    // 2b) 球面边缘光:沿轮廓的柔和补光(左右各一块,贴着曲面)
    if (LG.rim) {
      var rm = LG.rim;
      [rm.lx, rm.rx].forEach(function (rxr) {
        var rcx = bx(rxr), rcy = by(rm.y);
        var rx2 = rm.halfW * H, ry2 = rm.halfH * H;
        var rr2 = Math.max(rx2, ry2);
        g.save();
        g.translate(rcx, rcy);
        g.scale(rx2 / rr2, ry2 / rr2);
        var rg2 = g.createRadialGradient(0, 0, rr2 * 0.10, 0, 0, rr2);
        rg2.addColorStop(0.00, rgba(rm.color, rm.alpha));
        rg2.addColorStop(0.40, rgba(rm.color, rm.alpha * 0.66));
        rg2.addColorStop(0.70, rgba(rm.color, rm.alpha * 0.26));
        rg2.addColorStop(1.00, rgba(rm.color, 0));
        g.fillStyle = rg2;
        g.beginPath(); g.arc(0, 0, rr2, 0, Math.PI * 2); g.fill();
        g.restore();
      });
    }

    // 3) 底部反射光:贴近地面一条很窄的“变亮”暖色反光(不是暗带)
    if (LG.bounce) {
      var b0 = LG.bounce;
      var bry = b0.heightRatio * H;
      g.save();
      g.translate(0, 0.004 * H);
      g.scale(1, bry / (0.78 * hw));
      var bg2 = g.createRadialGradient(0, 0, 1, 0, 0, 0.78 * hw);
      bg2.addColorStop(0.00, rgba(b0.color, b0.alpha));
      bg2.addColorStop(0.45, rgba(b0.color, b0.alpha * 0.68));
      bg2.addColorStop(0.78, rgba(b0.color, b0.alpha * 0.22));
      bg2.addColorStop(1.00, rgba(b0.color, 0));
      g.fillStyle = bg2;
      g.beginPath(); g.arc(0, 0, 0.78 * hw, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    // 4) 接触环境遮蔽:最底部极窄、很轻
    if (LG.contact) {
      var k0 = LG.contact;
      var kh = k0.heightRatio * H;
      var cg = g.createLinearGradient(0, -kh, 0, 0.004 * H);
      cg.addColorStop(0.00, rgba(k0.color, 0));
      cg.addColorStop(0.55, rgba(k0.color, k0.alpha * 0.45));
      cg.addColorStop(1.00, rgba(k0.color, k0.alpha));
      g.fillStyle = cg;
      g.fillRect(-hw, -kh, 2 * hw, kh + 0.006 * H);
    }

    g.restore();

    if (C.debug.showOutline) { g.strokeStyle = 'rgba(0,180,255,0.9)'; g.lineWidth = 0.7; g.stroke(path); }
    return L;
  };

  /* --------------------------- 高光层(可滞后滑动) ------------------------- */
  Creature.prototype.buildLightLayer = function () {
    var C = CONFIG, col = C.colors, G = Geometry;
    var L = this.makeLayer(), g = L.ctx;
    var H = G.H, hw = G.halfW, path = G.path;
    var LG = col.lighting || {};

    function bx(rx) { return (rx - 0.5) * 2 * hw; }
    function by(ry) { return -H + ry * H; }

    g.save();
    g.clip(path);      // 只作用在蛋体内部(这不是裁切蛋体,蛋体本身完整)

    // ① 主光:左上方大范围柔和径向渐变(暖浅黄,非纯白)
    if (LG.key) {
      var k = LG.key;
      var kx = bx(k.x), ky = by(k.y), kr = k.radius * H;
      var kg = g.createRadialGradient(kx, ky, 1, kx, ky, kr);
      kg.addColorStop(0.00, rgba(k.color, k.alpha));
      kg.addColorStop(0.38, rgba(k.color, k.alpha * 0.72));
      kg.addColorStop(0.68, rgba(k.color, k.alpha * 0.30));
      kg.addColorStop(1.00, rgba(k.color, 0));
      g.fillStyle = kg; g.fillRect(-hw, -H, 2 * hw, H);
    }

    // ② 高光斑:左上肩部长椭圆,长轴 -30°,边缘用大半径淡出“融化”
    if (LG.spec) {
      var sp = LG.spec;
      var sx = bx(sp.x), sy = by(sp.y);
      var a = sp.wRatio * (2 * hw) / 2, b = sp.hRatio * (2 * hw) / 2;
      g.save();
      g.translate(sx, sy);
      g.rotate(sp.rotDeg * Math.PI / 180);
      g.scale(a / b, 1);
      var sg2 = g.createRadialGradient(0, 0, b * 0.04, 0, 0, b);
      sg2.addColorStop(0.00, rgba(sp.color, sp.alpha));
      sg2.addColorStop(0.28, rgba(sp.color, sp.alpha * 0.88));
      sg2.addColorStop(0.52, rgba(sp.color, sp.alpha * 0.54));
      sg2.addColorStop(0.74, rgba(sp.color, sp.alpha * 0.22));
      sg2.addColorStop(0.90, rgba(sp.color, sp.alpha * 0.06));
      sg2.addColorStop(1.00, rgba(sp.color, 0));
      g.fillStyle = sg2;
      g.beginPath(); g.arc(0, 0, b, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    g.restore();
    return L;
  };

  /* --------------------------- 鼻梁 + 鸭嘴 -------------------------------- */
  Creature.prototype.buildFaceLayer = function () {
    var C = CONFIG, col = C.colors;
    var L = this.makeLayer(), g = L.ctx;
    var br = this.f.bridge, bl = this.f.bill;

    /* 柔光斑:径向渐变缩成椭圆,天然没有边界、没有描边 */
    function softBlob(cx, cy, rx, ry, alpha, hex) {
      var r = Math.max(rx, ry);
      g.save();
      g.translate(cx, cy);
      g.scale(rx / r, ry / r);
      var gr = g.createRadialGradient(0, 0, 1, 0, 0, r);
      gr.addColorStop(0.00, rgba(hex, alpha));
      gr.addColorStop(0.42, rgba(hex, alpha * 0.70));
      gr.addColorStop(0.68, rgba(hex, alpha * 0.36));
      gr.addColorStop(0.86, rgba(hex, alpha * 0.11));
      gr.addColorStop(1.00, rgba(hex, 0));
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    /* ---- 鼻梁:只是两块比周围略亮的径向渐变,没有任何轮廓 ---- */
    var topY = br.topY, botY = br.bottomY, dy = botY - topY;
    softBlob(0, topY + dy * 0.28, br.topHalfWidth * 1.25, dy * 0.48, br.highlightAlpha * 0.52, col.bridge);
    softBlob(0, botY - dy * 0.06, br.bottomHalfWidth * 1.15, dy * 0.54, br.highlightAlpha * 0.62, col.bridge);

    /* ---- 鸭嘴 ---- */
    var hw = bl.halfWidth, tipY = bl.tipY;
    var topMidY = tipY - bl.topRise;
    var creaseMidY = tipY + bl.creaseSag;
    var band = creaseMidY - topMidY;
    var k = 0.56;

    // 喙下方:极淡的柔和投影(≤8% 不透明度,只让下缘有一点点落地感)
    if (bl.shadowAlpha > 0) {
      g.save();
      g.translate(0, creaseMidY + bl.shadowOffsetY);
      g.scale(1, bl.shadowHalfHeight / bl.shadowHalfWidth);
      var aoG = g.createRadialGradient(0, 0, 1, 0, 0, bl.shadowHalfWidth);
      aoG.addColorStop(0.00, rgba(col.billAO, bl.shadowAlpha));
      aoG.addColorStop(0.42, rgba(col.billAO, bl.shadowAlpha * 0.62));
      aoG.addColorStop(0.74, rgba(col.billAO, bl.shadowAlpha * 0.22));
      aoG.addColorStop(1.00, rgba(col.billAO, 0));
      g.fillStyle = aoG;
      g.beginPath(); g.arc(0, 0, bl.shadowHalfWidth, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    // 鸭嘴本体:顶部略圆的上沿 + 微微上扬的下沿,靠渐变表现厚度
    var bill = new Path2D();
    bill.moveTo(-hw, tipY);
    bill.bezierCurveTo(-hw * (1 - k), topMidY, hw * (1 - k), topMidY, hw, tipY);
    bill.bezierCurveTo(hw * (1 - k), creaseMidY, -hw * (1 - k), creaseMidY, -hw, tipY);
    bill.closePath();

    // 喙下缘极淡的柔和过渡(≤7%,只比蛋体深一点点,没有可见斑点)
    if (bl.edgeShadeAlpha > 0) {
      g.save();
      g.clip(bill);
      var sh = g.createLinearGradient(0, creaseMidY - band * 0.45, 0, creaseMidY);
      sh.addColorStop(0.00, rgba(col.bodyShade, 0));
      sh.addColorStop(1.00, rgba(col.bodyShade, bl.edgeShadeAlpha));
      g.fillStyle = sh;
      g.fillRect(-hw * 1.3, creaseMidY - band * 0.5, hw * 2.6, band * 0.5);
      g.restore();
    }

    g.save();
    g.clip(bill);
    var bg = g.createLinearGradient(0, topMidY, 0, creaseMidY);
    applyStops(bg, col.billGradient);
    g.fillStyle = bg;
    g.fillRect(-hw * 1.3, topMidY - 1.5, hw * 2.6, band + 3);
    g.restore();

    return L;
  };

  /* ------------------------------ 眼球贴图 -------------------------------- */
  Creature.prototype.buildEyeSprite = function () {
    var C = CONFIG, col = C.colors, e = this.f.eye;
    var R = e.radius, g0 = e.scleraGlint;
    var pad = R * 0.85 + 3;
    var S = (R + pad) * 2;
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(S * this.ss); cv.height = Math.ceil(S * this.ss);
    var g = cv.getContext('2d');
    g.scale(this.ss, this.ss);
    g.translate(S / 2, S / 2);

    // ① 玻璃球:中心浅 → 边缘深(#3F7A2A)
    var sc = g.createRadialGradient(-R * 0.18, -R * 0.24, R * 0.06, 0, 0, R * 1.02);
    sc.addColorStop(0.00, '#7FB055');
    sc.addColorStop(0.32, '#6E9F49');
    sc.addColorStop(0.62, '#5B8B36');
    sc.addColorStop(0.86, '#4A7F2E');
    sc.addColorStop(1.00, '#3F7A2A');
    g.fillStyle = sc;
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();

    // ② 下沿一圈很淡的亮边(玻璃边缘的折射反光)
    g.save();
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.clip();
    var rim = g.createRadialGradient(0, 0, R * 0.78, 0, 0, R * 1.0);
    rim.addColorStop(0.00, 'rgba(226,244,196,0)');
    rim.addColorStop(0.72, 'rgba(226,244,196,0)');
    rim.addColorStop(0.93, 'rgba(226,244,196,0.34)');
    rim.addColorStop(1.00, 'rgba(226,244,196,0)');
    g.fillStyle = rim;
    g.beginPath(); g.rect(-R, 0, 2 * R, R); g.fill();     // 只保留下半圈
    g.restore();

    // ③ 上方小椭圆白色高光(固定在左上,不随瞳孔移动)
    g.save();
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.clip();
    g.translate(-R * 0.22, -R * 0.34);
    g.rotate(-0.35);
    var gl = g.createRadialGradient(0, 0, R * 0.02, 0, 0, R * 0.30);
    gl.addColorStop(0.00, 'rgba(255,255,255,0.92)');
    gl.addColorStop(0.52, 'rgba(255,255,255,0.52)');
    gl.addColorStop(1.00, 'rgba(255,255,255,0)');
    g.fillStyle = gl;
    g.beginPath(); g.ellipse(0, 0, R * 0.30, R * 0.19, 0, 0, Math.PI * 2); g.fill();
    g.restore();

    // ④ 最外缘压一圈极淡的深色,让球体从蛋体上“立”起来(渐变,不是描边)
    var eg = g.createRadialGradient(0, 0, R * 0.80, 0, 0, R * 1.06);
    eg.addColorStop(0.00, 'rgba(46,74,20,0)');
    eg.addColorStop(0.62, 'rgba(46,74,20,0.16)');
    eg.addColorStop(1.00, 'rgba(46,74,20,0)');
    g.fillStyle = eg;
    g.beginPath(); g.arc(0, 0, R * 1.06, 0, Math.PI * 2); g.fill();

    return { canvas: cv, size: S, R: R };
  };

  /* ------------------------------ 瞳孔贴图 -------------------------------- */
  Creature.prototype.buildPupilSprite = function () {
    var C = CONFIG, e = this.f.eye;
    var Rp = e.radius * e.pupilRatio;
    var pad = Rp * 0.6 + 3;
    var S = (Rp + pad) * 2;
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(S * this.ss); cv.height = Math.ceil(S * this.ss);
    var g = cv.getContext('2d');
    g.scale(this.ss, this.ss); g.translate(S / 2, S / 2);
    var pg = g.createRadialGradient(-Rp * 0.22, -Rp * 0.26, Rp * 0.05, 0, 0, Rp * 1.02);
    pg.addColorStop(0.00, '#1A1A1A');
    pg.addColorStop(0.55, '#070707');
    pg.addColorStop(1.00, '#000000');
    g.fillStyle = pg;
    g.beginPath(); g.arc(0, 0, Rp, 0, Math.PI * 2); g.fill();
    return { canvas: cv, size: S, R: Rp };
  };

  /* ---------------------------- 接触阴影贴图 ------------------------------ */
  Creature.prototype.buildShadow = function () {
    var col = CONFIG.colors, s = this.f.shadow, ss = this.ss;
    var w = s.ambientWidth, h = s.ambientHeight;
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(w * ss); cv.height = Math.ceil(h * ss);
    var g = cv.getContext('2d');
    g.scale(ss, ss);
    g.translate(w / 2, h / 2);
    g.scale(1, h / w);                       // 把圆径向渐变压成椭圆
    ellipseGrad(g, s.ambientWidth / 2, col.shadowAmbient, s.ambientAlpha, 0.0);
    ellipseGrad(g, s.coreWidth / 2, col.shadowCore, s.coreAlpha, 0.0);
    this.shadowSprite = { canvas: cv, w: w, h: h };
  };

  function ellipseGrad(g, r, color, alpha, inner) {
    var rg = g.createRadialGradient(0, 0, r * (inner || 0), 0, 0, r);
    rg.addColorStop(0.00, rgba(color, alpha));
    rg.addColorStop(0.42, rgba(color, alpha * 0.72));
    rg.addColorStop(0.72, rgba(color, alpha * 0.28));
    rg.addColorStop(1.00, rgba(color, 0));
    g.fillStyle = rg;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  }

  /* ======================================================================
   *  更新
   * ==================================================================== */
  Creature.prototype.update = function (dt) {
    var C = CONFIG, m = C.motion, d = C.derived;
    dt = Math.min(dt, C.perf.maxDeltaMs / 1000);
    if (dt <= 0) return;
    this.time += dt;

    /* --- 眨眼 --- */
    this.updateBlink(dt);

    /* --- 待机动作 --- */
    this.updateIdle(dt);

    /* --- 拖拽 --- */
    var dragTarget = this.dragging ? 1 : 0;
    var tau = 0.10;
    this.dragAmt += (dragTarget - this.dragAmt) * (1 - Math.exp(-dt / tau));
    if (Math.abs(this.dragAmt - dragTarget) < 0.002) this.dragAmt = dragTarget;

    /* --- 呼吸(始终运行) --- */
    var breathAmp = 0;
    if (m.breath.enabled) {
      this.breathPhase += dt * (2 * Math.PI / m.breath.periodSec);
      if (this.breathPhase > Math.PI * 2) this.breathPhase -= Math.PI * 2;
      breathAmp = m.breath.amplitude * 0.5 * (1 - Math.cos(this.breathPhase));
    }
    this.breathAmp = breathAmp;

    /* --- 弹簧:主体 + 五官滞后 --- */
    var boost = (this.jelly.since > m.jelly.settleTimeMs / 1000) ? 4.5 : 1;
    this.jelly.step(dt, 0, boost);
    this.faceJelly.step(dt, this.jelly.x, 1);

    /* --- 左右张望 --- */
    this.updateGaze(dt);

    /* --- 瞳孔跟随鼠标 --- */
    this.updatePupils(dt);

    /* --- 汇总形变 --- */
    var j = m.jelly;
    var sy = (1 + this.jelly.x);
    var sx = (1 - this.jelly.x * j.volumeRatio);
    sy *= (1 + breathAmp);
    sx *= (1 - breathAmp * m.breath.widthCoupling);
    sy *= (1 + this.stretchAmt);
    this.dragLift += (m.drag.liftPx * this.dragAmt * this.k - this.dragLift) * (1 - Math.exp(-dt / 0.10));

    // 高光相对蛋体滑动:挤压时高光“来不及”跟上,形成软胶滞后感
    var lagCfg = (C.colors.lighting && C.colors.lighting.lag) || { gain: 0.3, tau: 0.06, maxPx: 6 };
    var lagTarget = clamp(-this.jelly.x * lagCfg.gain * this.k * Geometry.H, -lagCfg.maxPx * this.k, lagCfg.maxPx * this.k);
    this.lightLag += (lagTarget - this.lightLag) * (1 - Math.exp(-dt / lagCfg.tau));
    sy *= (1 + m.drag.stretch * this.dragAmt);
    sx *= (1 - m.drag.stretch * 0.6 * this.dragAmt);
    this.bodyScale.x = sx;
    this.bodyScale.y = sy;
    this.clampDeformation();
  };

  Creature.prototype.updateBlink = function (dt) {
    var b = CONFIG.motion.blink, B = this.blink;
    if (B.active) {
      B.t += dt * 1000;
      var total = b.closeMs + b.holdMs + b.openMs;
      if (B.t >= total) {
        B.active = false;
        B.t = 0;
        B.nextAt = rand(b.naturalMinSec, b.naturalMaxSec);
        if (B.queued > 0) { B.queued--; this.startBlink(); }
      }
    } else {
      B.nextAt -= dt;
      if (B.nextAt <= 0) {
        if (Math.random() < b.doubleChance) B.queued = 1;
        this.startBlink();
      }
    }
  };

  /** 立即眨眼;已经眨到后半段时允许重新开始,避免连点被吞掉 */
  Creature.prototype.startBlink = function () {
    var b = CONFIG.motion.blink, B = this.blink;
    var total = b.closeMs + b.holdMs + b.openMs;
    if (B.active && B.t < total * 0.55) return false;
    B.active = true; B.t = 0;
    return true;
  };

  /** 眼皮闭合程度 0(全开)~ 1(全闭) */
  Creature.prototype.blinkAmount = function () {
    var b = CONFIG.motion.blink, B = this.blink;
    if (!B.active) return 0;
    if (B.t < b.closeMs) return smoothstep(B.t / b.closeMs);
    if (B.t < b.closeMs + b.holdMs) return 1;
    var p = (B.t - b.closeMs - b.holdMs) / b.openMs;
    p = clamp(p, 0, 1);
    return (1 - p) * (1 - p);          // 睁开:起手快、收尾慢
  };

  /* --------------------------- 待机动作调度 ------------------------------- */
  Creature.prototype.updateIdle = function (dt) {
    var m = CONFIG.motion;
    if (this.action) {
      this.actionT += dt * 1000;
      this.stepAction(this.action, this.actionT);
      if (this.actionT >= this.actionDuration) {
        this.endAction(this.action);
        this.action = null;
        this.idleNextAt = rand(m.idle.minGapSec, m.idle.maxGapSec);
      }
      return;
    }
    if (!m.idle.enabled) return;
    this.idleNextAt -= dt;
    if (this.idleNextAt <= 0) this.pickIdleAction();
  };

  Creature.prototype.pickIdleAction = function () {
    var m = CONFIG.motion, pool = m.idle.pool.slice();
    // 鼠标 5 秒内动过 → 暂停「左右张望」(眨眼不受影响)
    if (this.mouseActiveRecently()) pool = pool.filter(function (a) { return a !== 'gaze'; });
    var last = this.lastAction;                   // 注意:回调里的 this 不是实例
    if (pool.length > 1 && last) {
      pool = pool.filter(function (a) { return a !== last; });
    }
    var name = pool[Math.floor(Math.random() * pool.length)];
    this.startAction(name);
  };

  Creature.prototype.startAction = function (name) {
    var m = CONFIG.motion;
    this.action = name; this.actionT = 0; this.lastAction = name;
    this.hopY = 0; this.wobbleAngle = 0; this.stretchAmt = 0; this.gazeOffset = 0;
    this.hopLanded = false;
    switch (name) {
      case 'gaze':      this.actionDuration = m.gaze.moveMs + m.gaze.holdMs + m.gaze.returnMs; this.gazeDir = Math.random() < 0.5 ? -1 : 1; break;
      case 'wobble':    this.actionDuration = m.wobble.durationMs; this.wobbleDir = Math.random() < 0.5 ? -1 : 1; break;
      case 'hop':       this.actionDuration = m.hop.durationMs; break;
      case 'stretch':   this.actionDuration = m.stretch.durationMs; break;
      case 'doubleBlink': this.actionDuration = 700; this.startBlink(); this.blink.queued = 1; break;
      default:          this.actionDuration = 600;
    }
  };

  Creature.prototype.endAction = function () {
    this.hopY = 0; this.wobbleAngle = 0; this.stretchAmt = 0; this.gazeOffset = 0;
  };

  Creature.prototype.stepAction = function (name, t) {
    var m = CONFIG.motion;
    switch (name) {
      case 'gaze': {
        var mv = m.gaze.moveMs, hd = m.gaze.holdMs, rt = m.gaze.returnMs;
        var amp = m.gaze.offsetRatio;
        if (t < mv) this.gazeOffset = this.gazeDir * amp * smoothstep(t / mv);
        else if (t < mv + hd) this.gazeOffset = this.gazeDir * amp;
        else this.gazeOffset = this.gazeDir * amp * (1 - smoothstep((t - mv - hd) / rt));
        break;
      }
      case 'wobble': {
        var dur = m.wobble.durationMs / 1000;
        var ts = t / 1000;
        var freq = m.cycles / dur;
        var decay = Math.exp(-ts / (dur * 0.26));
        var ramp = Math.min(1, ts / 0.12);
        this.wobbleAngle = this.wobbleDir * (m.wobble.maxAngleDeg * Math.PI / 180) * decay * ramp
                           * Math.sin(2 * Math.PI * freq * ts);
        break;
      }
      case 'hop': {
        var p = t / m.hop.durationMs;
        var riseEnd = 0.44, landAt = 0.80;
        if (p < riseEnd) {
          this.hopY = this.f.hopHeight * easeOutQuad(p / riseEnd);
        } else if (p < landAt) {
          var q = (p - riseEnd) / (landAt - riseEnd);
          this.hopY = this.f.hopHeight * (1 - easeInQuad(q));
        } else {
          this.hopY = 0;
          if (!this.hopLanded) {
            this.hopLanded = true;
            this.land(m.jelly.landSquash * 0.7);
            if (this.sound && m.hop.soundVolume > 0) {
              this.sound.duang(0, 1.22, m.hop.soundVolume * 2.5);
            }
          }
        }
        break;
      }
      case 'stretch': {
        var ps = t / m.stretch.durationMs;
        this.stretchAmt = m.stretch.amount * Math.sin(Math.PI * clamp(ps, 0, 1));
        break;
      }
      case 'doubleBlink': {
        if (t > 320 && this.blink.queued === 0 && !this.blink.active && !this._secondBlinkDone) {
          this._secondBlinkDone = true;
          this.startBlink();
        }
        break;
      }
    }
    if (name !== 'doubleBlink') this._secondBlinkDone = false;
  };

  /* --------------------------- 瞳孔 ------------------------------- */
  Creature.prototype.updateGaze = function () { /* 由 stepAction 写入 gazeOffset */ };

  Creature.prototype.updatePupils = function (dt) {
    var e = this.f.eye, m = CONFIG.motion, EF = m.eyeFollow || {};
    var enabled = EF.enabled !== false;
    var maxOff = e.radius * (enabled ? (EF.maxOffsetRatio || 0.35) : m.pointer.maxOffsetRatio);
    var rest = e.radius * e.pupilRestOutward;
    var tx = 0, ty = 0;

    // 面部中心(画布坐标)
    var fx = this.anchor.x;
    var fy = this.anchor.y + e.offsetY * this.bodyScale.y;

    var following = false;

    // 拖拽时:瞳孔朝拖动方向看
    if (this.dragging) {
      var dl = Math.sqrt(this.dragLook.x * this.dragLook.x + this.dragLook.y * this.dragLook.y);
      if (dl > 0.5) {
        tx = this.dragLook.x / dl * maxOff;
        ty = this.dragLook.y / dl * maxOff;
        following = true;
      }
    }

    // 鼠标在屏幕任意位置:瞳孔朝鼠标转
    if (!following && enabled && this.cursor && this.cursor.active) {
      var idle = this.time - this.cursor.lastMoveAt;
      if (idle < (EF.idleResetSec || 5)) {
        var dx = this.cursor.x - fx, dy = this.cursor.y - fy;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var near = EF.nearDistancePx || 140;
        var k = Math.min(1, len / near);          // 近处按距离平滑缩放,不会跳变
        tx = dx / len * k * maxOff;
        ty = dy / len * k * maxOff;
        following = true;
      }
    }

    // 待机「左右张望」只在鼠标没动的时候生效
    if (!following) tx += this.gazeOffset * e.radius;

    var mag = Math.sqrt(tx * tx + ty * ty), cap = maxOff * 1.15;
    if (mag > cap) { tx = tx / mag * cap; ty = ty / mag * cap; }

    // lerp 平滑(系数按 60fps 归一)
    var alpha = 1 - Math.pow(1 - (EF.lerp || 0.15), Math.max(0.01, dt * 60));
    this.pupil.x += (tx - this.pupil.x) * alpha;
    this.pupil.y += (ty - this.pupil.y) * alpha;
    this.pupilRest = rest;

    // 五官整体向鼠标方向偏移(最多 faceShiftPx),让脸像在转向
    var fsMax = (EF.faceShiftPx || 0) * this.k;
    var ftx = this.pupil.x * (EF.faceShiftRatio || 0.45);
    var fty = this.pupil.y * (EF.faceShiftRatio || 0.45);
    var fm = Math.sqrt(ftx * ftx + fty * fty);
    if (fm > fsMax && fm > 1e-6) { ftx = ftx / fm * fsMax; fty = fty / fm * fsMax; }
    this.faceShift.x += (ftx - this.faceShift.x) * alpha;
    this.faceShift.y += (fty - this.faceShift.y) * alpha;

    // 拖拽视线衰减
    var decay = Math.exp(-dt / 0.25);
    this.dragLook.x *= decay; this.dragLook.y *= decay;
  };

  /* ------------------------------------------------------------------ */
  /*  统一限幅:任何形变(拖拽拉长 / 点击回弹 / 小跳 / 摇晃)都不能让      */
  /*  蛋体包围盒超出画布。超了就按「先压抬升,再压纵向缩放」的顺序回收。  */
  /* ------------------------------------------------------------------ */
  Creature.prototype.clampDeformation = function () {
    var lim = CONFIG.motion.limits || {}, k = this.k;
    var maxHop = (lim.maxHopPx === undefined ? 10 : lim.maxHopPx) * k;
    var maxLift = (lim.maxLiftPx === undefined ? 6 : lim.maxLiftPx) * k;
    var safeTop = (lim.safeTopPx === undefined ? 2 : lim.safeTopPx) * k;

    this.hopY = clamp(this.hopY, 0, maxHop);
    this.dragLift = clamp(this.dragLift, 0, maxLift);

    this.bodyScale.y = clamp(this.bodyScale.y,
                             lim.minScaleY === undefined ? 0.82 : lim.minScaleY,
                             lim.maxScaleY === undefined ? 1.08 : lim.maxScaleY);
    this.bodyScale.x = clamp(this.bodyScale.x,
                             lim.minScaleX === undefined ? 0.88 : lim.minScaleX,
                             lim.maxScaleX === undefined ? 1.14 : lim.maxScaleX);

    for (var guard = 0; guard < 6; guard++) {
      var eggH = Geometry.H * this.bodyScale.y;
      var top = this.anchor.y - eggH - this.hopY - this.dragLift;
      if (top >= safeTop) break;
      var over = safeTop - top;
      var cut = Math.min(over, this.hopY + this.dragLift);
      if (cut > 0.01) {
        var total = this.hopY + this.dragLift;
        var ratio = (total - cut) / total;
        this.hopY *= ratio; this.dragLift *= ratio;
      } else {
        this.bodyScale.y = Math.max(lim.minScaleY || 0.82,
          (this.anchor.y - this.hopY - this.dragLift - safeTop) / Geometry.H);
      }
    }
    return this.bodyScale;
  };

  /** 鼠标在屏幕上的位置(已换算成画布坐标)。moving=false 表示只是被动刷新 */
  Creature.prototype.setCursor = function (x, y) {
    var EF = CONFIG.motion.eyeFollow || {};
    var eps = EF.moveEpsilonPx || 1;
    var moved = !this.cursor.active ||
      Math.sqrt((x - this.cursor.x) * (x - this.cursor.x) + (y - this.cursor.y) * (y - this.cursor.y)) > eps;
    this.cursor.x = x; this.cursor.y = y; this.cursor.active = true;
    if (moved) this.cursor.lastMoveAt = this.time;
    return moved;
  };
  Creature.prototype.clearCursor = function () { if (this.cursor) this.cursor.active = false; };
  Creature.prototype.setDragLook = function (dx, dy) {
    this.dragLook.x = dx; this.dragLook.y = dy;
  };
  /** 鼠标 5 秒内动过 → 暂停待机的「左右张望」 */
  Creature.prototype.mouseActiveRecently = function () {
    var EF = CONFIG.motion.eyeFollow || {};
    return !!(this.cursor && this.cursor.active &&
              (this.time - this.cursor.lastMoveAt) < (EF.idleResetSec || 5));
  };

  Creature.prototype.setPointer = function (x, y) { this.pointer.x = x; this.pointer.y = y; this.pointer.active = true; };
  Creature.prototype.clearPointer = function () { this.pointer.active = false; };

  /* --------------------------- 交互 ------------------------------------ */
  Creature.prototype.hitTest = function (x, y, pad) {
    return Geometry.hit(x, y, this.bodyScale.x, this.bodyScale.y,
                        this.anchor.x, this.anchor.y, pad || 0);
  };

  /** 点击反应:眨眼 + 果冻弹跳 + 音效 */
  Creature.prototype.poke = function (withSound, scale) {
    var j = CONFIG.motion.jelly, d = CONFIG.derived.jelly;
    scale = scale === undefined ? 1 : scale;
    this.startBlink();
    this.jelly.impulse(j.clickSquash * scale, d.wd, d.zetaWn);
    if (withSound !== false && this.sound) {
      var times = this.bounceTimes(j.bounceCount, d.wd);
      var ctx = this.sound.ctx;
      var now = ctx ? ctx.currentTime : 0;
      this.sound.unlock();
      this.sound.duangSequence(now, times);
    }
  };

  /** 落地回弹(幅度约为点击的一半) */
  Creature.prototype.land = function (amp) {
    var j = CONFIG.motion.jelly, d = CONFIG.derived.jelly;
    this.jelly.impulse(amp === undefined ? j.landSquash : amp, d.wd, d.zetaWn);
  };

  Creature.prototype.bounceTimes = function (n, wd) {
    var out = [];
    for (var i = 0; i < n; i++) out.push((2 * i + 1) * Math.PI / (2 * wd));
    return out;
  };

  Creature.prototype.nudge = function () { this.poke(true, 0.5); };

  Creature.prototype.startDrag = function () {
    this.dragging = true;
    var j = CONFIG.motion.jelly, d = CONFIG.derived.jelly;
    this.jelly.impulse(j.dragSquash, d.wd, d.zetaWn);
  };

  Creature.prototype.endDrag = function () {
    if (!this.dragging) return;
    this.dragging = false;
    this.land(CONFIG.motion.jelly.landSquash);
  };

  /* ======================================================================
   *  绘制
   * ==================================================================== */
  Creature.prototype.draw = function () {
    var g = this.ctx, C = CONFIG, m = C.motion;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);

    // 再限一次,保证绘制用的值和物理状态一致
    this.clampDeformation();
    var sx = this.bodyScale.x, sy = this.bodyScale.y;
    var lift = this.dragLift;

    /* --- 接触阴影 --- */
    this.drawShadow(g, sy);

    /* --- 主体 --- */
    g.save();
    g.translate(this.anchor.x, this.anchor.y - this.hopY - lift);
    g.rotate(this.wobbleAngle);
    g.scale(sx, sy);

    var b = this.bodyLayer.box;
    g.drawImage(this.bodyLayer.canvas, b.x, b.y, b.w, b.h);

    // 高光层跟随形变,并带一点“软胶滞后滑动”
    if (this.lightLayer) {
      g.save();
      g.translate(0, this.lightLag);
      g.drawImage(this.lightLayer.canvas, b.x, b.y, b.w, b.h);
      g.restore();
    }

    /* --- 五官(带轻微滞后 / 过冲) --- */
    var e = this.f.eye;
    var gain = m.jelly.faceLagGain;
    var fq = this.faceJelly.x * gain;
    g.save();
    // 五官整体朝鼠标方向偏移(最多 faceShiftPx)
    g.translate(this.faceShift.x || 0, this.faceShift.y || 0);
    g.translate(0, e.offsetY);
    g.scale(1 + fq * 0.6, 1 - fq);
    g.translate(0, -e.offsetY);

    g.drawImage(this.faceLayer.canvas, b.x, b.y, b.w, b.h);
    this.drawEyes(g);

    g.restore();

    if (C.debug.showGuides) {
      g.strokeStyle = 'rgba(255,0,0,0.6)'; g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(-Geometry.halfW, 0); g.lineTo(Geometry.halfW, 0); g.stroke();
    }
    g.restore();

    if (C.debug.showHitArea) this.debugHitArea(g);
  };

  Creature.prototype.drawShadow = function (g, sy) {
    var s = this.shadowSprite, C = CONFIG;
    var hopNorm = Math.min(1, this.hopY / Math.max(0.5, this.f.hopHeight));
    var alpha = 1 - 0.42 * hopNorm - C.motion.drag.shadowFade * this.dragAmt;
    alpha = clamp(alpha, 0.12, 1);
    var wide = 1 + (1 - sy) * 0.55 + hopNorm * 0.10;
    var tall = 1 + (1 - sy) * 0.20 - hopNorm * 0.22;
    var w = s.w * wide, h = s.h * Math.max(0.35, tall);
    var cy = this.anchor.y - this.hopY * 0.35;
    g.save();
    g.globalAlpha = alpha;
    g.drawImage(s.canvas, this.anchor.x - w / 2, cy - h / 2, w, h);
    g.restore();
  };

  Creature.prototype.drawEyes = function (g) {
    var C = CONFIG, e = this.f.eye;     // 必须用已按 scale 换算过的几何
    var R = e.radius;
    var cov = this.blinkAmount();
    var rest = this.pupilRest || 0;

    for (var i = 0; i < 2; i++) {
      var sign = i === 0 ? -1 : 1;
      var ex = sign * e.offsetX, ey = e.offsetY;

      // 眼球
      var sp = this.eyeSprite;
      g.drawImage(sp.canvas, ex - sp.size / 2, ey - sp.size / 2, sp.size, sp.size);

      // 瞳孔(全局跟随鼠标 / 外八静止位)
      var px = ex + this.pupil.x + sign * rest;
      var py = ey + this.pupil.y;
      var pp = this.pupilSprite;
      g.save();
      g.beginPath(); g.arc(ex, ey, R, 0, Math.PI * 2); g.clip();
      g.drawImage(pp.canvas, px - pp.size / 2, py - pp.size / 2, pp.size, pp.size);
      // 瞳孔里的小高光点 —— 位置固定在眼球左上,不随瞳孔移动
      var gx = ex - R * 0.16 - sign * rest * 0.4, gy = ey - R * 0.22;
      g.save();
      g.beginPath(); g.arc(px, py, pp.R, 0, Math.PI * 2); g.clip();   // 只在瞳孔内可见
      g.globalAlpha = 0.85;
      g.fillStyle = '#FFFFFF';
      g.beginPath(); g.arc(gx, gy, R * 0.085, 0, Math.PI * 2); g.fill();
      g.restore();
      g.restore();

      // 眼皮
      if (cov > 0.001) this.drawEyelid(g, ex, ey, R, cov);
    }
  };

  Creature.prototype.drawEyelid = function (g, ex, ey, R, cov) {
    var C = CONFIG, b = C.motion.blink;
    var top = ey - R - 2.2 * this.k;
    var edge = ey - R - 1 * this.k + cov * (2 * R + 2 * this.k);
    var sag = b.lidCurve * R * (0.45 + 0.55 * cov);

    g.save();
    g.beginPath();
    g.arc(ex, ey, R + 0.9 * this.k, 0, Math.PI * 2);
    g.clip();

    var lg = g.createLinearGradient(0, ey - R, 0, ey + R);
    lg.addColorStop(0.00, '#F2D278');
    lg.addColorStop(0.55, '#EFCB6E');
    lg.addColorStop(1.00, '#E9C165');
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(ex - R - 2 * this.k, top);
    g.lineTo(ex + R + 2 * this.k, top);
    g.lineTo(ex + R + 2 * this.k, edge);
    g.quadraticCurveTo(ex, edge + sag * 2, ex - R - 2 * this.k, edge);
    g.closePath();
    g.fill();

    // 眼皮下缘的极淡阴影(用渐变带,不描边)
    g.globalAlpha = b.lidShadowAlpha;
    var sh = g.createLinearGradient(0, edge - 1.6 * this.k, 0, edge + sag * 2 + 1.8 * this.k);
    sh.addColorStop(0.00, 'rgba(184,137,60,0)');
    sh.addColorStop(0.55, 'rgba(184,137,60,1)');
    sh.addColorStop(1.00, 'rgba(184,137,60,0)');
    g.fillStyle = sh;
    g.beginPath();
    g.moveTo(ex - R - 2 * this.k, edge);
    g.quadraticCurveTo(ex, edge + sag * 2, ex + R + 2 * this.k, edge);
    g.lineTo(ex + R + 2 * this.k, edge + sag * 2 + 1.8 * this.k);
    g.quadraticCurveTo(ex, edge + sag * 4 + 1.8 * this.k, ex - R - 2 * this.k, edge + sag * 2 + 1.8 * this.k);
    g.closePath();
    g.fill();
    g.restore();
  };

  Creature.prototype.debugHitArea = function (g) {
    var G = Geometry, s = this.bodyScale;
    g.save();
    g.translate(this.anchor.x, this.anchor.y);
    g.scale(s.x, s.y);
    g.strokeStyle = 'rgba(255,0,128,0.85)'; g.lineWidth = 0.8;
    g.setLineDash([3, 3]);
    g.stroke(G.path);
    g.restore();
  };

  root.Naidan.Creature = Creature;
})(typeof window !== 'undefined' ? window : globalThis);
