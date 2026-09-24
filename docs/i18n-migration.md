# 中英文共用应用

## 当前结构

- `index.html` 和 `index_en.html` 是同一 Vue 应用的两个静态入口。英文入口只保留 HTML 壳和现有静态依赖，不再复制组件、状态或业务代码。
- `src/i18n/messages/zh-CN.ts` 与 `en-US.ts` 包含完整且键一致的界面文案。`src/i18n/index.ts` 根据 HTML 的 `lang` 初始化语言，并向组件提供 `$t`。`npm run typecheck` 同时检查键和插值占位符。
- 左侧导航的语言按钮即时切换文案，并同步入口 URL、`<html lang>` 和页面标题。切换时不重载页面，因此正在编辑的内容保持在内存中；刷新后由当前入口 URL 决定界面语言。
- 已保存的小说、台词、角色和素材名称保持原值。内置的“旁白”、系统情绪和默认滤波器只在界面显示时翻译，存储和匹配仍使用现有标识。

## 生成语言与兼容性

Prompt 页面提供独立的“生成内容语言”设置。首次进入时按当前入口设为中文或英文，此后存入 `localStorage` 的 `unitale_generationLanguage`；切换界面语言不会改动它。该设置用于内置的分析 Prompt、音色描述 Prompt 和 Qwen 参考文本。已启用的自定义 Prompt 和自定义文本按用户原文发送。

英文分析仍保留现有 JSON 字段、情绪和强度选项、素材名，以及“旁白”角色标识，避免破坏旧工程的角色音色绑定。英文指令只要求生成的叙述、台词、其他角色名和图片提示词使用英文。内置分析 Prompt 的主体目前沿用中文规则和示例，英文输出的实际质量仍需用所选 LLM 验证。

`UnitaleDB` 版本、既有存储键、API 请求和工程 JSON 格式没有迁移。两个入口位于同一网站来源时共享浏览器存档；不同域名或来源之间仍需导出并导入工程文件。

## 验证

运行 `npm run typecheck` 和 `npm run build`，再用 `npm run preview` 分别打开 `/Unitale/` 与 `/Unitale/index_en.html`。人工验收见 [acceptance.md](acceptance.md)，重点检查旧存档恢复、界面语言切换、生成语言与自定义 Prompt、分析结果中的角色音色绑定，以及导入导出。GitHub Pages 发布仍由手动工作流控制。
