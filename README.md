# Unitale AI 有声书制作工具

[中文](README.md) · [English](README_en.md)

Unitale 是一个在浏览器中制作有声书的工具，支持小说文本分析、多角色配音、音色与音效管理，以及音频、字幕和视频导出。本仓库是 [sdsds222/Unitale](https://github.com/sdsds222/Unitale) 的二次开发版本，目前正在整理界面和工程结构。

## 本地运行

需要 Node.js 24。依次运行：

```bash
npm ci
npm run dev
```

检查构建：

```bash
npm run typecheck
npm run build
npm run preview
```

中文版使用 Vue 3、Vite、TypeScript 模块和构建版 Tailwind；英文版暂时保留独立页面。构建产物位于 `dist/`，包括两种语言的入口及运行所需的 `voice/`、`vendor/` 和本地图标。仓库不再附带示例工程文件；可从应用中导出或导入自己的工程 JSON。

中英文共用应用的准备情况和后续迁移边界见[国际化迁移说明](docs/i18n-migration.md)。

## 数据与发布

项目数据保存在浏览器的 IndexedDB 和 localStorage 中。切换网站来源前，请先导出完整工程文件备份。构建使用 `/Unitale/` 作为 GitHub Pages 路径前缀。

Pages 发布工作流仅支持从 `dev` 分支手动触发。发布前请完成[人工验收清单](docs/acceptance.md)。

## 许可与署名

项目遵循 [MIT 许可证](LICENSE)，保留原作者 sdsds222 的版权声明。界面图标的许可见 [Lucide 许可证](assets/icons/LICENSE-lucide.txt)。
