/* ============================================================================
 *  egg.js —— 蛋形轮廓几何
 * ----------------------------------------------------------------------------
 *  用参考图实测的半宽剖面生成光滑闭合路径。
 *  输出路径位于 creature 局部坐标系:原点 = 蛋体底部中心,y 向上为负。
 *
 *  顶部 = 圆形圆顶;中段 = 实测剖面;底部 = 椭圆弧(与地面相切,所以能
 *  “稳稳坐住”,而不是被削平的一块)。
 * ========================================================================== */
(function (root) {
  'use strict';

  var CONFIG = root.Naidan.CONFIG;

  /* --- 单调三次插值 (Fritsch–Carlson) --- */
  function makeMonotone(xs, ys) {
    var n = xs.length;
    var d = new Array(n - 1), m = new Array(n), i;
    for (i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { var t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return function (x) {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      var lo = 0, hi = n - 1;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
      var h = xs[hi] - xs[lo], s2 = (x - xs[lo]) / h, s3 = s2 * s2, s4 = s3 * s2;
      return (2 * s4 - 3 * s3 + 1) * ys[lo] + (s4 - 2 * s3 + s2) * h * m[lo]
           + (-2 * s4 + 3 * s3) * ys[hi] + (s4 - s3) * h * m[hi];
    };
  }

  var Geometry = {};

  /** scale 变化后需要重建缓存的路径 */
  Geometry.reset = function () { Geometry.path = null; Geometry.points = null; return Geometry; };

  /**
   * 蛋形半宽(相对 halfW)的解析式:
   *     halfRatio(t) = sin(π · t^p) ^ q        t: 0=蛋顶, 1=蛋底
   * 一条连续闭合曲线,顶部与底部都是水平切线(圆润、能坐住),
   * 没有折点、没有台阶、没有裙边。p/q 由参考图剖面拟合得到
   * (拟合误差 < 2%),两个参数都放在 config 里可调。
   */
  Geometry.ratioAt = function (t) {
    var e = CONFIG.eggCurve;
    t = Math.min(1, Math.max(0, t));
    var v = Math.sin(Math.PI * Math.pow(t, e.p));
    if (v <= 0) return 0;
    return Math.pow(v, e.q);
  };

  Geometry.init = function () {
    if (Geometry.path) return Geometry;              // 幂等
    var C = CONFIG, D = C.derived.egg;
    var W = D.w, H = D.h, halfW = W / 2;

    // 按 t 均匀采样(right half),末端加密保证底部圆弧光滑
    var N = 720;
    var pts = [];
    for (var i = 0; i <= N; i++) {
      var t = i / N;
      // 底/顶两端用正弦参数化加密,避免最后一段出现长直线
      var tt = 0.5 - 0.5 * Math.cos(Math.PI * t);
      pts.push({ x: Geometry.ratioAt(tt) * halfW, y: -H * (1 - tt), r: Geometry.ratioAt(tt), t: tt });
    }

    Geometry.W = W; Geometry.H = H; Geometry.halfW = halfW;
    Geometry.points = pts;

    var p2d = new Path2D();
    p2d.moveTo(pts[0].x, pts[0].y);
    for (i = 1; i < pts.length; i++) p2d.lineTo(pts[i].x, pts[i].y);
    for (i = pts.length - 2; i >= 0; i--) p2d.lineTo(-pts[i].x, pts[i].y);
    p2d.closePath();
    Geometry.path = p2d;
    return Geometry;
  };

  Geometry.sampleProfile = function (t) { return Geometry.ratioAt(t); };

  /** 点是否落在蛋体内部(考虑当前形变) */
  Geometry.hit = function (x, y, scaleX, scaleY, anchorX, anchorY, pad) {
    pad = pad || 0;
    var G = Geometry;
    var lx = (x - anchorX) / (scaleX || 1);
    var ly = (y - anchorY) / (scaleY || 1);
    if (ly > pad || ly < -G.H - pad) return false;
    var t = Math.min(1, Math.max(0, -ly / G.H));
    return Math.abs(lx) <= G.ratioAt(t) * G.halfW + pad;
  };

  Geometry.yAt = function (t) { return -Geometry.H * (1 - t); };
  Geometry.tAt = function (y) { return Math.min(1, Math.max(0, -y / Geometry.H)); };

  root.Naidan.Geometry = Geometry;
})(typeof window !== 'undefined' ? window : globalThis);
