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

中英文页面共用 Vue 3、Vite、TypeScript 模块和构建版 Tailwind；`index_en.html` 仅提供英文入口。构建产物位于 `dist/`，包括两种语言的入口及运行所需的 `voice/`、`vendor/` 和本地图标。仓库不再附带示例工程文件；可从应用中导出或导入 `formatVersion: 1` 的 ZIP 工程归档。旧 Base64 JSON 工程文件不再支持导入。

中英文共用应用的实现和数据兼容性见[国际化说明](docs/i18n-migration.md)。

## 数据与发布

默认将项目和媒体保存在新的 `UnitaleWorkspaceDB` 中；模型配置仍位于 localStorage。设置页可将项目迁入本地目录，目录模式可在清除网站数据后重新选择该目录打开。旧 `UnitaleDB` 不会自动删除；若不再需要旧开发存档，可在设置页手动清理。切换网站来源或浏览器前，请先导出完整 ZIP 归档。较大的归档会分包下载，导入时需一次选择全部分包。构建使用 `/Unitale/` 作为 GitHub Pages 路径前缀。

存储格式和备份细节见[媒体资产架构说明](docs/media-storage.md)。

Pages 发布工作流仅支持从 `dev` 分支手动触发。发布前请完成[人工验收清单](docs/acceptance.md)。

## 许可与署名

项目遵循 [MIT 许可证](LICENSE)，保留原作者 sdsds222 的版权声明。界面图标的许可见 [Lucide 许可证](assets/icons/LICENSE-lucide.txt)。
