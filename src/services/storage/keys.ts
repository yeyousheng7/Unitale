// Existing browser storage keys. Keep these stable across deployments.
export const storageKeys = {
  activeTab: 'storyforge_activeTab',
  bgm: 'storyforge_bgm',
  llmConfigs: 'storyforge_configs',
  filters: 'storyforge_filters',
  promptTemplate: 'storyforge_prompt_template',
  qwenVoiceTextTemplate: 'storyforge_qwen_voice_text_template',
  ttsConfigs: 'storyforge_tts_configs',
  legacyConfig: 'storyforge_universal_v2',
  useCustomPrompt: 'storyforge_use_custom_prompt',
  useCustomQwenVoiceText: 'storyforge_use_custom_qwen_voice_text',
  useCustomVoicePrompt: 'storyforge_use_custom_voice_prompt',
  voicePromptTemplate: 'storyforge_voice_prompt_template',
  bgImageCount: 'unitale_bgImageCount',
  llmConfigId: 'unitale_llmConfigId',
  ttsConfigId: 'unitale_ttsConfigId',
} as const
