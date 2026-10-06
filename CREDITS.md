# 第三方组件与素材来源

## 运行时依赖

| 组件 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| [Electron](https://www.electronjs.org/) | ^31.7.7 | MIT | 桌面运行时(透明窗口 / 托盘 / 原生菜单) |
| [electron-builder](https://www.electron.build/) | ^24.13.3 | MIT | 打包与安装包生成(仅开发依赖) |

除 Electron 之外,**运行时不依赖任何第三方库** —— 动画、渲染、弹簧物理、音效全部是本项目自己实现的。

## 音效

音效使用外部素材 **Bubble_4**:

| 项目 | 内容 |
|---|---|
| 名称 | Bubble_4 |
| 作者 | BenParamoreAudio |
| 来源 | Freesound — https://freesound.org/people/BenParamoreAudio/sounds/868712/ |
| 许可证 | **CC0 1.0 Universal(公共领域奉献)** — http://creativecommons.org/publicdomain/zero/1.0/ |
| 仓库内文件 | `audio/bubble_4.mp3`(CDN hq 预览版,约 2.6 KB) |

CC0 表示作者已放弃全部著作权,可自由商用、无需署名。此处仅作记录。

播放方式:启动时 `decodeAudioData` 预解码,点击时用 `AudioBufferSourceNode` 播放,
`playbackRate` 调音高,音量与音高序列见 `src/renderer/js/config.js → audio`。

**想换素材**:把 wav/mp3 放进 `audio/`,或修改 `config.js → audio.file`。

## 图像资源

| 素材 | 来源 | 说明 |
|---|---|---|
| `build/icon-1024.png`、`icon.ico`、`icon.icns`、`icon.png`、`tray.png` | 本项目自绘 | 由 `tools/preview.html?mode=icon` 用 Canvas 渲染蛋体正面生成 |
| `docs/animation-sheet.png`、`deform-check.png`、`eye-follow.png`、`app-screenshot.png`、`background-check.png` | 本项目自绘 | 程序自身渲染截图,不含任何第三方图片 |

## 字体

界面不内嵌任何字体,全部使用系统字体(Microsoft YaHei / 系统 sans-serif)。

## 角色形象

"奶蛋 / Naidan" 的外观参考自网络图片,**仅供学习交流、非商业用途**;
`LICENSE` 中的 MIT 条款**不覆盖**角色形象。如有侵权请联系删除。
