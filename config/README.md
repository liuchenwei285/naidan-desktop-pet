# config

预留目录:用于存放**外部配置覆盖**。

目前所有可调参数集中在 `src/renderer/js/config.js`,
如需按环境覆盖,可在此目录放 JSON 并在 `src/renderer/js/app.js` 里合并加载。
