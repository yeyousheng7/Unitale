# Unitale AI Audiobook Maker

[中文](README.md) · [English](README_en.md)

Unitale is a browser based audiobook creation tool with text analysis, character voices, voice and sound libraries, and audio, subtitle, and video export. This repository is a fork of [sdsds222/Unitale](https://github.com/sdsds222/Unitale) and is being updated for long term development.

## Local development

Node.js 24 is required:

```bash
npm ci
npm run dev
```

Check the build with `npm run typecheck` and `npm run build`. Use `npm run preview` to inspect `dist/`.

The Chinese and English pages share one Vue 3 app built with Vite, TypeScript modules, and Tailwind CSS. `index_en.html` is a small English entry page. The build includes both entries and the required `voice/`, `vendor/`, and local icon assets. Sample project files are no longer bundled; import or export your own project JSON in the app.

## Data and deployment

Project data is stored in the browser's IndexedDB and localStorage. Export a full project backup before moving to a different site origin. The build uses `/Unitale/` as its GitHub Pages base path.

The Pages workflow can only be started manually from `dev`. Complete the [acceptance checklist](docs/acceptance.md) before publishing.

## License and attribution

This project is under the [MIT License](LICENSE) and retains the original copyright notice for sdsds222. The icon license is available [here](assets/icons/LICENSE-lucide.txt).
