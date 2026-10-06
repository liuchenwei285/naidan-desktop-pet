/* ============================================================================
 *  config.js  ——  蛋形小生物 · 全局配置(唯一需要改的文件)
 * ----------------------------------------------------------------------------
 *  尺寸约定:下面所有“长度”单位都是 **基准像素(scale = 1)**,
 *  实际渲染时统一乘以 `appearance.scale`。
 *  基准(scale=1):窗口 128×128,蛋体宽 96px,蛋高 ≈ 109.6px。
 *
 *  creature 局部坐标系:原点 (0,0) = 蛋体底部中心,y 轴向上为负。
 * ========================================================================== */
(function (root) {
  'use strict';

  var CONFIG = {

    /* ------------------------------------------------------------------ */
    /* 0. 应用信息                                                         */
    /* ------------------------------------------------------------------ */
    app: {
      name: '奶蛋',
      trayTooltip: '奶蛋 —— 右键可以调大小 / 静音 / 置顶 / 退出'
    },

    /* ------------------------------------------------------------------ */
    /* 1. 外观缩放 —— 全局唯一尺寸开关                                     */
    /*    scale 会同时作用于:窗口大小、蛋体、五官、阴影、跳跃高度、         */
    /*    拖拽拉伸、瞳孔偏移…… 所有长度类参数。                            */
    /* ------------------------------------------------------------------ */
    appearance: {
      scale: 1.0,
      presets: [
        { key: 'small',  label: '小(0.75)',  scale: 0.75 },
        { key: 'normal', label: '默认(1.0)', scale: 1.00 },
        { key: 'large',  label: '大(1.5)',   scale: 1.50 }
      ]
    },

    /* ------------------------------------------------------------------ */
    /* 2. 窗口与画布(基准尺寸,会乘以 scale)                              */
    /* ------------------------------------------------------------------ */
    window: {
      // 画布尺寸:蛋宽 96 → 左右各留 32px(33%),上方留 52px(48%),蛋底距下边 8px
      baseCanvasWidth: 160,       // 基准画布宽(px)
      baseCanvasHeight: 170,      // 基准画布高(px)
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      startupMargin: { right: 24, bottom: 56 }   // 距屏幕右下角(任务栏上方)
    },

    layout: {
      eggWidth: 96,               // 基准蛋宽(px)
      aspect: 0.8761,             // 实测 蛋宽/蛋高 = 877/1001
      groundY: 162,               // 蛋底中心 y(基准 px)。下方留 8px 给接触阴影
      originY: '100%',            // transform-origin:50% 100%(缩放锚点 = 蛋底中心)
      originX: '50%',
      supersample: null           // null = 自动等于 devicePixelRatio
    },

    /* ------------------------------------------------------------------ */
    /* 3. 蛋形解析曲线                                                     */
    /*    halfRatio(t) = sin(π · t^p) ^ q     t: 0=蛋顶 → 1=蛋底          */
    /*    顶部/底部均为水平切线 → 圆润且能稳稳坐住,无拐点无裙边。          */
    /*    由参考图剖面拟合(p=1.357,q=0.32,误差 < 2%)。                     */
    /* ------------------------------------------------------------------ */
    eggCurve: { p: 1.357, q: 0.32 },

    /* ------------------------------------------------------------------ */
    /* 4. 颜色 —— 全部来自参考图实测取色(见 docs/color-samples.md)        */
    /* ------------------------------------------------------------------ */
    colors: {
      body:      '#EBC668',       // 主体奶油黄(参考图腰部实测)
      bodyLight: '#F8DD97',       // 左上高光区实测
      bodyWarm:  '#DAA94D',       // 底部暖橙金实测
      bodyShade: '#E2B65B',       // 右下阴影区实测
      bodyDeep:  '#CB8F38',       // 最贴地处实测

      // 蛋体主渐变 = 参考图中轴线 8 点实测均值(五官区间改用左右偏心采样),
      // 再按“饱和度宁可比参考略高”的要求统一 +10% 饱和度。未做任何手调。
      bodyGradient: [
        [0.00, '#F5D874'], [0.08, '#F5D476'], [0.20, '#F3D07A'],
        [0.32, '#F0C665'], [0.44, '#F0C96B'], [0.56, '#ECC35B'],
        [0.68, '#E8BD56'], [0.80, '#E3B54F'], [0.92, '#D59A35'],
        [1.00, '#CD8924']
      ],
      /* ---- 立体感光照(全部靠径向渐变 + 模糊,零描边) ---- */
      /* 位置用「蛋体包围盒比例」表示:(0,0)=左上角,(1,1)=右下角          */
      lighting: {
        // ① 主光:左上方大范围柔和径向渐变。颜色比蛋体亮一档的暖浅黄
        key: {
          x: 0.34, y: 0.26,        // 光源中心(相对蛋体 bbox)
          radius: 0.70,            // 半径(相对蛋高)
          color: '#FBE08A',        // 暖浅黄,绝不是纯白(不会冲淡饱和度)
          /* 第 4 轮曾要求高光 ≤15%(当时是为了压掉偏白的过曝);
             第 5 轮要求「增强立体感」,15% 时蛋体明显发平,故这里放到 0.30。
             想回到旧观感:把 0.30 改回 0.15;
             想更强:可到 0.35,不建议超过(会开始发白)。 */
          alpha: 0.30
        },
        // ② 高光斑:左上肩部长椭圆,长轴沿轮廓倾斜 -30°,大半径融化
        spec: {
          x: 0.30, y: 0.20,
          wRatio: 0.22, hRatio: 0.12,   // 相对蛋宽
          rotDeg: -30,
          color: '#FFF0B8',             // 奶黄
          alpha: 0.30,                  // 上限 30%
          blurRatio: 0.55               // 模糊半径 / 高光长轴
        },
        // ③ 暗部:右下方过渡到更深的暖橙金
        shade: {
          x: 0.90, y: 0.62,
          radius: 0.66,            // 收窄 → 明暗交界更清楚
          color: '#D9A241',
          alpha: 0.72              // 立体感主要由暗部承担(暗部不受高光 15% 限制)
        },
        // ④ 底部反射光:贴近地面一条很窄的“变亮”暖色反光(不是暗带)
        bounce: {
          heightRatio: 0.042,      // 反光带高度 / 蛋高(窄一点,别糊成一片)
          color: '#F6DC96',
          alpha: 0.13,
          radiusRatio: 0.96
        },
        // ⑤ 接触环境遮蔽:最底部极窄、很轻
        contact: {
          heightRatio: 0.030,
          color: '#8A5A18',
          alpha: 0.20
        },
        // 球面边缘光:沿蛋形轮廓的柔和补光(不是竖向条带,是贴着曲面的光斑)
        // 实测参考图左右缘比同高中线亮 10~35,这里按“曲面分布”还原
        rim: {
          color: '#F7DE96',
          alpha: 0.26,
          lx: 0.96, rx: 0.04,    // 左右光斑中心(相对蛋体 bbox 的 x)
          y: 0.56,               // 中心高度(蛋体最宽处附近)
          halfW: 0.30, halfH: 0.34   // 相对蛋高
        },
        // 形变时高光相对蛋体滑动(软胶滞后感)
        lag: { gain: 0.30, tau: 0.06, maxPx: 6 }
      },

      // 巩膜绿色(实测:上 #77A25D / 左上 #729856 / 右 #537E29 / 下 #557927)
      scleraGradient: [
        [0.00, '#7CA45E'], [0.22, '#77A25D'], [0.46, '#729856'],
        [0.66, '#618A38'], [0.84, '#57802A'], [1.00, '#527726']
      ],
      eyeEdgeGradient: [
        [0.00, 'rgba(48,78,16,0)'], [0.60, 'rgba(48,76,16,0.05)'],
        [0.84, 'rgba(44,70,14,0.26)'], [1.00, 'rgba(40,64,12,0.56)']
      ],
      pupil: '#000202',
      pupilGlint: '#FFFFFF',

      // 鼻梁隆起(实测该处比两侧亮)
      bridge: '#F2D883',
      bridgeShade: '#D8AF62',

      // 鸭嘴(实测:上沿 #ECCE84 / 中上 #DAB876 / 左端 #ECC976 / 下缘 #C8A161)
      billGradient: [
        [0.00, '#F2D89A'], [0.30, '#ECCE84'], [0.62, '#DAB876'],
        [0.88, '#CDA96B'], [1.00, '#C8A161']
      ],
      billAO: '#A97330',

      // 地面接触阴影(实测 影正下 #E4D3B9 / 外缘 #F4EEE0)
      shadowCore: '#D9C29C',
      shadowAmbient: '#EADCC4'
    },

    /* ------------------------------------------------------------------ */
    /* 5. 五官几何(基准 px,scale=1 时;实际会再乘 appearance.scale)      */
    /* ------------------------------------------------------------------ */
    features: {
      eye: {
        offsetX: 15.31,          // 眼心到中线的水平距离(实测 33.5@210 → 15.31@96)
        offsetY: -88.27,         // 眼心距蛋底高度(实测 -193.1@240 → -88.27@109.6)
        radius: 6.39,            // 巩膜半径(实测 12.7@210,再放大 10%)
        pupilRatio: 0.528,       // 瞳孔半径 / 巩膜半径
        pupilRestOutward: 0.04,  // 静止时瞳孔朝外偏移(参考图如此)
        glintRadius: 0.16,       // 瞳孔高光半径比
        glintAlpha: 0.42,
        scleraGlint: { alpha: 0.34, w: 0.80, h: 0.26, offsetY: -0.50, offsetX: -0.16 }
      },
      bill: {
        tipY: -79.54,            // 左右嘴角高度
        halfWidth: 8.91,         // 喙半宽
        topRise: 2.10,           // 上沿中点比嘴角高多少
        creaseSag: 2.29,         // 下沿中点比嘴角低多少(微微上扬)
        edgeShadeAlpha: 0.16,    // 下缘加深(用渐变,不是描边)
        shadowOffsetY: 4.11,
        shadowHalfWidth: 9.14,
        shadowHalfHeight: 6.40,
        shadowAlpha: 0.18
      },
      bridge: {
        topY: -90.29,
        bottomY: -81.36,
        topHalfWidth: 1.37,
        bottomHalfWidth: 4.80,
        highlightAlpha: 0.62,
        sideShadeAlpha: 0.13
      }
    },

    /* ------------------------------------------------------------------ */
    /* 6. 接触阴影(基准 px)                                               */
    /* ------------------------------------------------------------------ */
    shadow: {
      coreWidth: 66.7, coreHeight: 9.6,
      coreAlpha: 0.38,
      ambientWidth: 80.4, ambientHeight: 14.6,
      ambientAlpha: 0.22
    },

    /* ------------------------------------------------------------------ */
    /* 7. 物理 / 动画(长度单位 = 基准 px)                                 */
    /* ------------------------------------------------------------------ */
    motion: {
      /* Q 弹弹簧:ωn = 2π·f, k = ωn², c = 2ζ·ωn */
      jelly: {
        stiffness: null, damping: null,
        frequencyHz: 2.5,
        dampingRatio: 0.22,
        clickSquash: 0.15,       // 点击:scaleY → 0.85
        landSquash: 0.075,
        dragSquash: 0.055,
        volumeRatio: 0.8,        // 0.15 压缩 ↔ 0.12 拉伸(scaleX 1.12)
        settleTimeMs: 900,
        restEpsilon: 0.0006,
        bounceCount: 4,
        faceLagGain: 0.35,
        faceLagFrequencyHz: 2.0,
        faceLagDampingRatio: 0.32
      },
      breath: { enabled: true, amplitude: 0.02, periodSec: 3.0, widthCoupling: 0.6 },
      blink: {
        closeMs: 100, holdMs: 35, openMs: 145,
        lidCurve: 0.20, lidShadowAlpha: 0.20,
        naturalMinSec: 2.0, naturalMaxSec: 5.0,
        doubleChance: 0.22, doubleGapMs: 170
      },
      pointer: { maxOffsetRatio: 0.25, responseTau: 0.09, releaseTau: 0.18 },

      /* 眼睛全局跟随鼠标(全屏任意位置) */
      eyeFollow: {
        enabled: true,
        maxOffsetRatio: 0.35,     // 瞳孔最大偏移 / 巩膜半径
        lerp: 0.15,               // 平滑插值系数(追随延迟感)
        nearDistancePx: 140,      // 距离小于此值时偏移按比例缩小,避免跳变
        faceShiftPx: 2.0,         // 五官整体向鼠标偏移的上限(基准 px,随 scale)
        faceShiftRatio: 0.45,     // 五官偏移量 / 瞳孔偏移量
        idleResetSec: 5.0,        // 鼠标静止多久后瞳孔回正 + 恢复待机动作
        pollHzActive: 60,         // 光标轮询频率(鼠标在动)
        pollHzIdle: 10,           // 光标轮询频率(鼠标静止)
        moveEpsilonPx: 1.0        // 位移超过多少像素算“鼠标动了”
      },
      gaze:    { holdMs: 1000, moveMs: 380, returnMs: 520, offsetRatio: 0.22 },
      wobble:  { maxAngleDeg: 4, cycles: 2.6, durationMs: 1500 },
      hop:     { heightPx: 4.0, durationMs: 540, soundVolume: 0.25 },
      stretch: { amount: 0.045, durationMs: 1400 },
      drag:    { liftPx: 4.0, stretch: 0.04, followLag: 0.28 },

      /* 统一限幅:保证任何形变下蛋体包围盒都完整落在画布内 */
      limits: {
        maxScaleY: 1.08,        // 拖拽/回弹的最大纵向拉伸
        minScaleY: 0.82,        // 最大挤压
        maxScaleX: 1.14,
        minScaleX: 0.88,
        maxLiftPx: 6,           // 拖拽“拎起”位移上限
        maxHopPx: 10,           // 小跳最大高度
        safeTopPx: 2            // 蛋顶距画布上边缘至少留多少
      },
      idle: {
        enabled: true, minGapSec: 3, maxGapSec: 8,
        pool: ['gaze', 'wobble', 'hop', 'stretch', 'doubleBlink']
      }
    },

    /* ------------------------------------------------------------------ */
    /* 8. 音效 —— 纯正弦「软萌 duang」,3 套预设                            */
    /* ------------------------------------------------------------------ */
    audio: {
      enabled: true,
      muted: false,

      /* ★ 换素材:把 wav/mp3 丢进项目 audio/ 目录,或改这一行 ★ */
      file: '../../audio/bubble_4.mp3',
      fallbackFiles: ['../../audio/bubble_4.wav', '../../audio/bubble_4.ogg'],

      masterGain: 0.50,          // 默认音量
      voiceGain: 1.0,
      lowpassHz: 0,              // >0 时对素材再叠一层低通(0 = 不叠,保持原音)

      /* 多次弹跳:基础音高逐次降低,音量递减 */
      pitchSeq: [1.00, 0.92, 0.85, 0.78],
      gainSeq:  [1.00, 0.60, 0.35, 0.20],

      pitchJitter: 0.03,         // 每次触发 ±3% 随机音高扰动
      fadeInSec: 0.005,          // 开头 5ms 淡入,防爆音
      fadeOutSec: 0.030,         // 结尾 30ms 淡出
      maxVoices: 4,              // 同时发声上限,超出淡出最早的一个
      minIntervalMs: 40,
      trimLeadingSilence: true,  // 自动裁掉音频开头的静音
      silenceThreshold: 0.010,
      normalize: { enabled: true, targetPeak: 0.90 },   // 素材响度归一

      // 小跳 / 落地回弹:同一素材,音量 0.25、音高 1.15
      lightAction: { volume: 0.25, pitch: 1.15 },

      compressor: { threshold: -8, knee: 4, ratio: 3, attack: 0.003, release: 0.20 }
    },

    /* ------------------------------------------------------------------ */
    /* 9. 性能 / 调试                                                      */
    /* ------------------------------------------------------------------ */
    perf: { activeFps: 60, calmFps: 60, maxDeltaMs: 50 },
    debug: { showHitArea: false, showOutline: false, showGuides: false, logIPC: false }
  };

  root.Naidan = root.Naidan || {};
  root.Naidan.CONFIG = CONFIG;

  /* ---- 派生量:scale 改变时重新计算 ---- */
  CONFIG.recomputeDerived = function () {
    var m = CONFIG.motion, j = m.jelly, a = CONFIG.appearance;
    var wn = 2 * Math.PI * j.frequencyHz;
    var k = (typeof j.stiffness === 'number' && j.stiffness > 0) ? j.stiffness : wn * wn;
    var c = (typeof j.damping === 'number' && j.damping > 0) ? j.damping : 2 * j.dampingRatio * wn;
    var fwn = 2 * Math.PI * j.faceLagFrequencyHz;
    var fk = fwn * fwn, fc = 2 * j.faceLagDampingRatio * fwn;
    CONFIG.derived = {
      jelly: { k: k, c: c, wd: Math.sqrt(Math.max(k - (c * c) / 4, 1e-6)), zetaWn: c / 2 },
      face:  { k: fk, c: fc, wd: Math.sqrt(Math.max(fk - (fc * fc) / 4, 1e-6)) },
      scale: a.scale,
      canvas: CONFIG.window.baseCanvas * a.scale,
      egg: {
        w: CONFIG.layout.eggWidth * a.scale,
        h: CONFIG.layout.eggWidth * a.scale / CONFIG.layout.aspect
      }
    };
    return CONFIG.derived;
  };

  /** 运行时切换尺寸(右键菜单「大小」会调用) */
  CONFIG.applyScale = function (scale) {
    CONFIG.appearance.scale = Math.max(0.25, Number(scale) || 1);
    return CONFIG.recomputeDerived();
  };

  CONFIG.recomputeDerived();

})(typeof window !== 'undefined' ? window : globalThis);
