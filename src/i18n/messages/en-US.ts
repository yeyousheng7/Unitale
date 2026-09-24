import type { MessageKey } from './zh-CN'

// English translation is added after the Chinese interface catalog is extracted.
// Until then, missing entries fall back to the original Chinese text.
export const enUS = {
  'app.documentTitle': 'Unitale AI Tool',
  'nav.workspace': 'Workspace navigation',
  'nav.main': 'Main navigation',
  'nav.creation': 'Create',
  'nav.library': 'Library',
  'nav.settings': 'Settings',
  'nav.script': 'Workspace',
  'nav.timbres': 'Voices',
  'nav.effects': 'Sound effects and filters',
  'nav.config': 'Model settings',
  'nav.prompt': 'Prompt templates',
  'brand.caption': 'Audiobook creation workspace',
  'page.script': 'Workspace',
  'page.config': 'Model settings',
  'page.timbres': 'Voice library',
  'page.effects': 'Sound effects and filters',
  'page.prompt': 'Prompt templates',
  'toolbar.wait': 'Please wait...',
  'toolbar.importProject': 'Import project',
  'toolbar.exportProject': 'Export project',
} satisfies Partial<Record<MessageKey, string>>
