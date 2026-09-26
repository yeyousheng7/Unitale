import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useI18n } from '../i18n'
import { indexedDbAssetStore, openWorkspaceDB, saveWorkspaceProject, loadWorkspaceProject, removeWorkspaceScript, removeWorkspaceProject, getActiveWorkspace, setActiveWorkspace, setActiveProjectId, storeRecentDirectory, loadRecentDirectory, DEFAULT_PROJECT_ID } from '../services/storage/workspaceDb'
import { DirectoryProjectStore, ensureDirectoryPermission } from '../services/storage/directoryStore'
import { referencedAssetIds, auditAssetRecords } from '../services/storage/audit'
import { collectOrphanAssets } from '../services/storage/garbageCollect'
import { ObjectUrlManager } from '../services/storage/objectUrls'
import { createProjectSnapshot, createProjectSaveSnapshot } from '../services/storage/snapshot'
import { storageKeys } from '../services/storage/keys'
import { exportArchiveParts, exportArchiveToStream, importArchiveParts } from '../services/project/archive'
import { ensureFFmpegLoaded, runFFmpegTask, getMp4Muxer } from '../services/audio/legacyAdapters'
import { DecodedAudioCache, audioBufferBytes } from '../services/audio/decodedCache'
import { makeWavHeader, frameRanges, WAV_MAX_DATA_BYTES, AUDIO_EXPORT_PART_SECONDS } from '../services/audio/wav'
import { getAudioBlobFromUrl, getFileExtensionFromBlob, buildDialogueAudioFilter } from '../services/audio/processing'
import { clipAudioEvent, totalTimelineDuration } from '../services/audio/timeline'
import { createAudioDecodeQueue } from '../services/audio/decodeQueue'
import { matchLibraryId } from '../services/audio/libraryRefs'
import { requestService } from '../services/api/client'
import { buildNovelImport } from '../services/novel/novelImport'
import { analyzeNovelChapter } from '../services/novel/novelAnalysis'
import { missingNovelVoices, synthesizeNovelLine } from '../services/novel/novelTts'

export function useUnitaleWorkspace() {
                  const { locale, t: translateMessage } = useI18n();
                  const savedGenerationLanguage = localStorage.getItem(storageKeys.generationLanguage);
                  const generationLanguage = ref(
                      savedGenerationLanguage === 'zh' || savedGenerationLanguage === 'en'
                          ? savedGenerationLanguage
                          : locale.value === 'en-US' ? 'en' : 'zh'
                  );
                  watch(generationLanguage, value => {
                      localStorage.setItem(storageKeys.generationLanguage, value);
                  }, { immediate: true });
                  // --- System Emotions Definition ---
                  const SYSTEM_EMOTIONS = [
                      { id: 'sys_1', name: '高兴', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
                      { id: 'sys_2', name: '生气', vector: [0, 1, 0, 0, 0, 0, 0, 0] },
                      { id: 'sys_3', name: '伤心', vector: [0, 0, 1, 0, 0, 0, 0, 0] },
                      { id: 'sys_4', name: '害怕', vector: [0, 0, 0, 1, 0, 0, 0, 0] },
                      { id: 'sys_5', name: '厌恶', vector: [0, 0, 0, 0, 1, 0, 0, 0] },
                      { id: 'sys_6', name: '低落', vector: [0, 0, 0, 0, 0, 1, 0, 0] },
                      { id: 'sys_7', name: '惊喜', vector: [0, 0, 0, 0, 0, 0, 1, 0] },
                      { id: 'sys_8', name: '平静', vector: [0, 0, 0, 0, 0, 0, 0, 1] }
                  ];
                  const isSystemEmotion = (name) => SYSTEM_EMOTIONS.some(e => e.name === name);

                  // IndexedDB access lives in the storage service.
                  const dirtyScriptIds = new Set();
                  const deletedScriptIds = new Set();
                  let collectOrphansAfterSave = false;
                  const pendingAssetIds = new Set();
                  let activeScriptTasks = 0;
                  let orphanSweepTimer = null;
                  let saveQueue = Promise.resolve();
                  const activeProjectId = ref(DEFAULT_PROJECT_ID);
                  const storageBackend = ref('indexeddb');
                  const directoryName = ref('');
                  const directoryError = ref('');
                  const lastStorageError = ref('');
                  let activeAssetStore = indexedDbAssetStore;
                  let directoryStore = null;
                  let storageAccessBlocked = false;
                  const saveProjectToDB = () => saveQueue = saveQueue.catch(() => {}).then(async () => {
                      if (storageAccessBlocked) throw new Error('Project directory permission is required');
                      await openWorkspaceDB();

                      syncCurrentScriptState(); // 确保当前状态同步到列表
                      dirtyScriptIds.add(currentScriptId.value);
                      const changed = new Set(dirtyScriptIds);
                      const projectData = createProjectSaveSnapshot({
                          characters: characters.value,
                          scriptList: scriptList.value,
                          novels: novels.value,
                          currentScriptId: novelEditorId.value ? previousStandaloneScriptId : currentScriptId.value,
                          libraries: {
                              sfx: sfxLibrary.value,
                              bgm: bgmLibrary.value,
                              timbres: timbres.value,
                              filters: filterLibrary.value,
                              emotions: emotionPresets.value
                          }
                      }, changed);
                      const deleted = new Set(deletedScriptIds);
                      const shouldCollectOrphans = collectOrphansAfterSave;
                      for (const id of changed) dirtyScriptIds.delete(id);
                      for (const id of deleted) deletedScriptIds.delete(id);
                      collectOrphansAfterSave = false;
                      try {
                          if (directoryStore) {
                              await directoryStore.saveProject(projectData, changed);
                          } else {
                              await saveWorkspaceProject(projectData, changed, activeProjectId.value);
                              for (const id of deleted) await removeWorkspaceScript(id, activeProjectId.value);
                          }
                      } catch (error) {
                          for (const id of changed) dirtyScriptIds.add(id);
                          for (const id of deleted) deletedScriptIds.add(id);
                          collectOrphansAfterSave ||= shouldCollectOrphans;
                          throw error;
                      }
                      if (shouldCollectOrphans && dirtyScriptIds.size) collectOrphansAfterSave = true;
                      if (shouldCollectOrphans && !dirtyScriptIds.size && !collectOrphansAfterSave) {
                          await collectOrphanAssets(activeAssetStore, activeProjectId.value, projectData, protectedAssetIds());
                          if (orphanSweepTimer) clearTimeout(orphanSweepTimer);
                          const projectId = activeProjectId.value;
                          const store = activeAssetStore;
                          orphanSweepTimer = setTimeout(() => {
                              if (activeProjectId.value !== projectId || isGeneratingAll.value ||
                                  characters.value.some(char => char.isGeneratingVoice) || scriptLines.value.some(line => line.isGenerating)) return;
                              collectOrphanAssets(store, projectId, projectSnapshot(), protectedAssetIds()).catch(error => {
                                  lastStorageError.value = error.message || String(error);
                              });
                          }, 121000);
                      }
                      lastStorageError.value = '';
                  });

                  let saveTimeout = null;
                  const triggerAutoSave = () => {
                      if (saveTimeout) clearTimeout(saveTimeout);
                      saveTimeout = setTimeout(() => {
                          saveProjectToDB().catch(e => {
                              lastStorageError.value = e.message || String(e);
                              console.warn('Auto-save failed', e);
                          });
                      }, 1000);
                  };

                  // 状态
                  const activeTab = ref('script');

                  watch(activeTab, (newValue) => {
                      localStorage.setItem(storageKeys.activeTab, newValue);
                  });
                  const llmConfigs = ref(/** @type {any[]} */ ([]));
                  const currentConfigId = ref('');

                  watch(currentConfigId, (newId) => {
                      if (newId) localStorage.setItem(storageKeys.llmConfigId, newId);
                  });

                  // 表单状态
                  const form = ref({ id: '', name: '', baseUrl: '', model: '', key: '', params: '' });
                  const isEditing = ref(false);

                  // TTS 配置状态
                  const ttsConfigs = ref(/** @type {any[]} */ ([]));
                  const ttsForm = ref({ id: '', name: '', baseUrl: '' });
                  const isEditingTts = ref(false);

                  // 角色库状态
                  const characters = ref(/** @type {any[]} */ ([]));

                  // 音色库状态
                  const timbres = ref(/** @type {any[]} */ ([]));
                  const timbreForm = ref({ id: '', name: '', description: '', refPath: '' });
                  const isEditingTimbre = ref(false);
                  const selectedTimbreId = ref('');
                  const timbreFile = ref(null); // ADDED: To store the selected timbre file object

                  // 情绪预设状态
                  const emotionPresets = ref(/** @type {any[]} */ ([]));
                  const emotionForm = ref({ id: '', name: '', vector: [0, 0, 0, 0, 0, 0, 0, 0] });
                  const isEditingEmotion = ref(false);
                  // 音效库状态
                  const sfxLibrary = ref(/** @type {any[]} */ ([]));
                  const sfxForm = ref({ id: '', name: '', description: '', filename: '', assetId: '', trimStart: 0, trimEnd: 1, volume: 0.3 });
                  const isEditingSfx = ref(false);

                  // BGM库状态
                  const bgmLibrary = ref(/** @type {any[]} */ ([]));
                  const bgmForm = ref({ id: '', name: '', description: '', filename: '', assetId: '', trimStart: 0, trimEnd: 1, volume: 0.3 });
                  const isEditingBgm = ref(false);

                  // 滤波器库状态
                  const filterLibrary = ref(/** @type {any[]} */ ([]));
                  const filterForm = ref({ id: '', name: '', description: '', type: 'lowpass', frequency: 1000, Q: 1, gain: 0 });
                  const isEditingFilter = ref(false);

                  // 聊天状态
                  const prompt = ref('');
                  const result = ref('');
                  const reasoning = ref('');
                  const error = ref('');
                  const loading = ref(false);
                  const abortController = ref(null);

                  // TTS 状态
                  const currentTtsConfigId = ref('');

                  watch(currentTtsConfigId, (newId) => {
                      if (newId) localStorage.setItem(storageKeys.ttsConfigId, newId);
                  });

                  const ttsRefFile = ref(null);
                  const ttsRefPath = ref('uploaded/ref.wav'); // 默认路径示例
                  const ttsEmoText = ref('中立');
                  const audioUrl = ref('');
                  const ttsLoading = ref(false);
                  const ttsError = ref('');
                  const ttsAbortController = ref(null);

                  // 脚本制作状态
                  const rawScript = ref('');
                  const scriptLines = ref(/** @type {any[]} */ ([]));
                  const isAnalyzingScript = ref(false);
                  const rawAnalysisResult = ref('');
                  const analysisAbortController = ref(null);
                  const selectedLineIndex = ref(-1);

                  // --- 多脚本管理逻辑 ---
                  const scriptList = ref(/** @type {import('../types/project').ScriptDocument[]} */ ([
                      { id: 'default', name: translateMessage('data.defaultScriptName', { number: 1 }),
                          data: { rawScript: '', scriptLines: [], rawAnalysisResult: '', characters: [] } }
                  ]));
                  const novels = ref(/** @type {any[]} */ ([]));
                  const novelBatch = ref({ running: false, novelId: '', phase: '', current: 0, total: 0, failed: 0 });
                  let novelBatchController = null;
                  const currentScriptId = ref('default');
                  const novelEditorId = ref(null);
                  let previousStandaloneScriptId = null;
                  const editingScriptId = ref(null);
                  const scriptNameInputRefs = ref(/** @type {Record<string, any>} */ ({}));

                  const syncCurrentScriptState = () => {
                      const current = scriptList.value.find(s => s.id === currentScriptId.value);
                      if (current) {
                          current.data.rawScript = rawScript.value;
                          current.data.scriptLines = scriptLines.value;
                          current.data.rawAnalysisResult = rawAnalysisResult.value;
                          // 修复：同步时清理角色运行时状态，防止切换脚本或保存时带入 "loading" 状态
                          current.data.characters = characters.value.map(c => {
                              const { isAnalyzing, isGeneratingVoice, abortController, ...rest } = c;
                              return JSON.parse(JSON.stringify(rest));
                          });
                      }
                  };

                  const switchScript = (id) => {
                      if (hasActiveMediaTask()) {
                          return alert(translateMessage("请先停止当前的生成或播放任务，再切换脚本。"));
                      }
                      if (id === currentScriptId.value) return;
                      syncCurrentScriptState();
                      dirtyScriptIds.add(currentScriptId.value);

                      const target = scriptList.value.find(s => s.id === id);
                      if (target) {
                          const previous = scriptList.value.find(s => s.id === currentScriptId.value);
                          if (previous) releaseScriptMedia(previous);
                          currentScriptId.value = id;
                          rawScript.value = target.data.rawScript || '';
                          scriptLines.value = target.data.scriptLines || [];
                          rawAnalysisResult.value = target.data.rawAnalysisResult || '';
                          characters.value = target.data.characters || [];
                          characters.value.forEach(c => { if (c.volume === undefined) c.volume = 1.0; });
                          selectedLineIndex.value = -1;
                          void hydrateScriptMedia(target).catch(error => console.warn('Media restore failed', error));
                          triggerAutoSave();
                      }
                  };

                  const addScript = () => {
                      if (hasActiveMediaTask()) {
                          return alert(translateMessage("请先停止当前的生成或播放任务，再添加脚本。"));
                      }
                      syncCurrentScriptState();
                      const newId = Date.now().toString();
                      const num = scriptList.value.filter(script => script.kind !== 'novelChapter').length + 1;
                      const newScript = {
                          id: newId,
                          name: translateMessage('data.defaultScriptName', { number: num }),
                          data: { rawScript: '', scriptLines: [], rawAnalysisResult: '', characters: [] }
                      };
                      scriptList.value.push(newScript);
                      switchScript(newId);
                  };

                  const startEditingScript = (id) => {
                      editingScriptId.value = id;
                      setTimeout(() => {
                          const el = scriptNameInputRefs.value[id];
                          if (el) el.focus();
                      }, 0);
                  };

                  const stopEditingScript = () => {
                      if (editingScriptId.value) dirtyScriptIds.add(editingScriptId.value);
                      editingScriptId.value = null;
                      triggerAutoSave();
                  };

                  const deleteScriptTab = (id) => {
                      if (hasActiveMediaTask()) {
                          return alert(translateMessage("请先停止当前的生成或播放任务，再删除脚本。"));
                      }
                      if (scriptList.value.length <= 1) return alert(translateMessage("至少保留一个脚本"));
                      if (!confirm(translateMessage("确定删除此脚本吗？"))) return;

                      const idx = scriptList.value.findIndex(s => s.id === id);
                      if (idx === -1) return;
                      if (scriptList.value[idx].kind === 'novelChapter') return;

                      releaseScriptMedia(scriptList.value[idx]);
                      if (id === currentScriptId.value) {
                          const nextIdx = idx === 0 ? 1 : idx - 1;
                          switchScript(scriptList.value[nextIdx].id);
                      }
                      scriptList.value.splice(idx, 1);
                      deletedScriptIds.add(id);
                      collectOrphansAfterSave = true;
                      triggerAutoSave();
                  };

                  const isGeneratingAll = ref(false);
                  const isSequencePlaying = ref(false);
                  const currentSequenceIndex = ref(-1);
                  const lineRefs = ref(/** @type {any[]} */ ([]));
                  const scriptListContainer = ref(null);
                  let sequenceAbortController = null;
                  const isExportingAudio = ref(false);
                  const importFileRef = ref(null);
                  const importTxtRef = ref(null);
                  const isExportingProject = ref(false);
                  const exportStatus = ref('');
                  const hasMoreArchiveParts = ref(false);
                  let pendingArchiveParts = null;
                  const isGeneratingVideo = ref(false);
                  const videoResolution = ref('1920x1080');
                  let bgmAudioNode = null;
                  let bgmGainNode = null;
                  const playbackProgress = ref(0);
                  const stageBgUrl = ref(''); // 播放/导出时的背景图片展示
                  const bgImageCount = ref(0); // 背景图片块数量（bgImage 对象个数）
                  const stageBgFadePrevUrl = ref(''); // 上一张背景，用于淡入
                  const stageBgFadeStartTs = ref(0);
                  const stageBgFadeDurationMs = 250; // 快速淡入时长
                  const bgImagePickerRef = ref(null);
                  const previewImageUrl = ref('');
                  const pendingBgImageLineIndex = ref(-1);
                  let playbackAnimationFrame = null;
                  const isRestoring = ref(true); // 启动到存档恢复结束前禁止自动保存

                  const setStageBgUrlWithFade = (url) => {
                      const next = url || '';
                      const prev = stageBgUrl.value || '';
                      if (prev === next) return;
                      stageBgFadePrevUrl.value = prev;
                      stageBgFadeStartTs.value = performance.now();
                      stageBgUrl.value = next;
                  };

                  const clearStageBgWithFade = () => {
                      stageBgFadePrevUrl.value = '';
                      stageBgFadeStartTs.value = 0;
                      stageBgUrl.value = '';
                  };

                  const openImagePreview = (url) => {
                      if (!url) return;
                      previewImageUrl.value = url;
                  };

                  const closeImagePreview = () => {
                      previewImageUrl.value = '';
                  };

                  // 剪辑拖拽状态
                  const draggingTrimState = ref(null);

                  // 计算当前选中的配置
                  const currentConfig = computed(() => {
                      return llmConfigs.value.find(c => c.id === currentConfigId.value) || null;
                  });

                  // Prompt Template
                  const defaultPromptTemplate = `你的任务是将给定小说内容拆分为台词和旁白，并自动识别每一句台词的角色和情绪。
  **注意：生成的结果将直接用于 IndexTTS 语音合成系统，请严格从指定的情绪列表中选择，不要自行生成情绪描述文本。**

  \${sfxSection}

  \${bgmSection}

  \${filterSection}

  # 情绪与强度设置 (Emotion & Intensity)
  请为每一句台词（包括旁白）选择一个最合适的情绪和强度。

  1. **可选情绪 (Emotion)**: \${emotionList}
     - **注意**: 必须严格从上述列表中选择，**严禁**编造列表之外的情绪名称。
     - 旁白通常选择 "平静"，也可根据氛围选择其他情绪。

  2. **可选强度 (Intensity)**: 微弱, 稍弱, 中等, 较强, 强烈
     - 请根据上下文判断情绪的强烈程度。
     - **旁白强度**: 如果旁白有情绪（如伤心、害怕），强度必须很弱（建议选择 "微弱" 或 "稍弱"）。如果旁白是 "平静" 情绪，强度应为 "中等"。

  # 规则

  ## 1. 拆分与识别
  - **完整保留**: 必须完整保留原文内容，不得遗漏、删改或省略任何字句。
  - **严禁删改**: **绝对禁止**删除原文中的说话人提示语（如“他低声说”、“笑着问道”）。这些内容必须作为“旁白”单独提取出来。
  - **内容提取**: 提取对话内容和所有非对话的旁白。
  - **角色识别**: 根据小说内容分析说话人。旁白的角色名统一标记为“旁白”。
  - **长度控制**: 文本拆分长度要适中。**避免过碎**（不要把每一句短句都拆成独立一行），也**避免过长**（单行文本建议不超过 50-80 字，过长的旁白请在句号处适当拆分）。
  - **旁白处理**: 连续的旁白内容应优先合并，除非中间需要插入音效、有明显的时间跳跃，或合并后长度过长。

  ## 3. 音效插入 (sfx)
  - 如果情节需要（如“摔门而去”、“雷声大作”），且音效库中有对应素材，请在 JSON 对象中添加 \`sfx\` 字段。
  - **严格限制**: 只能使用【音效库】中列出的名称。如果库为空或没有匹配项，**绝对不要**添加此字段。
  - **禁止混用**: **绝对禁止**在 \`sfx\` 字段中使用【背景音乐库】中的名称。SFX 只能使用【音效库】的内容。
  - **支持多音效**: 一句台词中可以插入多个音效，只要位置合理（如开头关门，中间脚步声）。
  - 格式: \`"sfx": [{"name": "音效名称", "position": 0.5}, {"name": "另一音效", "position": 0.9}]\`
  - \`position\`: 0.0-1.0 之间的浮点数，表示音效在**台词念白时长内**的插入位置（例如 0.0 为开始，1.0 为念白结束）。
  - **重要**: \`position\` 计算**不包含** \`break_duration\`（停顿时间）。即 1.0 代表台词说完的那一刻，而不是停顿结束的那一刻。
  - **间隔音效**: 如果音效发生在台词后的停顿期间，请将其加入该台词的 \`sfx\` 列表，位置设为 1.0。
  - **特别重要** 尽量给每句都配上合适的SFX音效，如果有的话

  ## 4. 背景音乐控制 (BGM Control)
  - **开头BGM**: 请**务必**在脚本的最开始尝试匹配并插入一个适合当前氛围的 BGM。只要【背景音乐库】中有合适的，就**必须**插入。
  - 当剧情氛围发生变化，需要切换或停止背景音乐时，请插入一个独立的 BGM 控制对象。
  - **格式**: \`{"type": "bgm", "action": "play", "name": "BGM名称"}\` 或 \`{"type": "bgm", "action": "stop"}\`
  - **严格限制**:
    - \`name\` 字段**必须完全等于**【背景音乐库】中列出的某一个名称。
    - **禁止混用**: **绝对禁止**在 BGM 控制块中使用【音效库】中的名称。BGM 只能使用【背景音乐库】的内容。
    - 如果【背景音乐库】为空，或者没有匹配的音乐，**绝对不要**生成 action="play" 的控制块。
    - 禁止使用 "MysteriousBGM", "SadPiano" 等示例中出现但库里没有的名称。
  - **注意**: 不要将 bgm 字段放在台词对象中。
  - 请多切换BGM，体现多样性

  - **停顿时间**: 分析台词后的剧情节奏，设置该台词结束后的停顿时间（秒）。
  - 默认为 0。如果有动作描写或心理活动暗示停顿，请设置相应时长（如 0.5, 1.0, 2.0）。
  - 示例: 两人对话间的尴尬沉默，或动作描写（如“他喝了一口茶”）需要的时间。

  ## 5. 音频滤波器 (Filter)
  - 如果剧情环境特殊（如“在水下说话”、“电话通话中”、“回忆/内心独白”），且【滤波器库】中有对应效果，请在台词对象中添加 \`filter\` 字段。
  - **格式**: \`"filter": "滤波器名称"\`
  - **严格限制**: 必须使用【滤波器库】中存在的名称。如果没有匹配项，**不要**生成此字段。
  - **特别提醒**: 如果角色是“旁白”，**千万不要**使用滤波器功能。

  ## 6. 输出格式
  - **严格 JSON**: 输出格式必须是严格的 JSON 数组，不包含任何额外说明或代码块标记。
  - **数组元素**: 必须是以下两种对象之一：
    1. **台词对象**: \`{"type": "dialogue", "role_name": "...", "text_content": "...", "emotion": "...", "intensity": "...", "break_duration": 0, "filter": "...", "sfx": [...]}\`
    2. **BGM对象**: \`{"type": "bgm", "action": "play", "name": "..."}\` 或 \`{"type": "bgm", "action": "stop"}\`
    - **严禁生成** \`{"type": "sfx", ...}\` 这种独立音效块。音效必须包含在台词对象的 \`sfx\` 字段中。


  ## 7. 背景图片块 (bgImage)
  - **插入时机**: 当场景氛围、地点、时间（白天/夜晚）、或叙事视角发生变化时，请在相邻的台词对象之间插入一个背景图片对象。
  - **插入位置**: 背景图片对象必须出现在“某个台词对象之后”并且“紧接着下一个台词对象之前”（不要插到台词组的内部）。
  - **对象格式**: \`{"type":"bgImage","image_prompt":"..."}\`
    - \`image_prompt\` 必须是用于生成图片的**中文提示词**，并且必须根据当前小说上下文生成（包含：场景/地点、人物外观与表情（如果画面中需要人物）、衣着风格、光线、画面构图、镜头感、氛围与情绪、画风偏好等）。
    - **提示词质量**: \`image_prompt\` 只输出中文、不要输出任何 JSON/代码/多余解释，尽量是一段可直接用于“生成图片”的提示文本（越具体越好，避免“可能/也许/看起来”之类不确定词）。
    - **人物一致性（严格统一）**: 如果 \`image_prompt\` 中出现人物（包括面部/身体/衣着等可识别外观），则必须对每个出现人物给出“统一人物外观设定”，并且同一人物在所有 \`bgImage\` 块中必须保持完全一致：性别、年龄（或年龄段）、服装款式/颜色/材质、发型（发色/发长）、标志性特征/配饰（如有）。为保证一致性，你必须把人物外观设定写成同一种中文短句模板，并且对同名人物要求“逐字不变”（不要同义改写）：
      - 模板示例：\`人物外观设定：{角色名}（性别=...，年龄=...，服装=...，发型=...，标志=...，主要配色=...）\`
    - 角色名判定规则：\`{角色名}\` 必须使用当前背景图片所处场景中最近一次出现的 \`dialogue\` 对象的 \`role_name\`（例如“老李”“我”“旁白”等），同一 \`role_name\` 即视为同一人物。
    - 除非当场景完全不出现该人物，否则不要省略其外观设定；否则可能导致不同图片出现“同一个人物外观不一致”。
    - 提示词只需要中文，不需要输出图片数据或链接。
  - **字段限制**: \`bgImage\` 对象只输出上述必要字段（至少必须有 \`type\` 与 \`image_prompt\`）。
  - **与第 6 点兼容**: 即使第 6 点列出了两种对象，本规则要求你额外输出 \`type":"bgImage"\` 的第三种对象；最终仍然是一个严格 JSON 数组。
  - **type 字段严格性**: \`type\` 字段必须严格等于 \`bgImage\`（大小写不要改）。
  - **数量约束（严格遵守）**: 请在整个 JSON 数组中严格插入且仅插入 \${bgImageCount} 个 \`type":"bgImage"\` 对象，并且它们必须全部与剧情相关（不能随便凑数）。
  - **开场强制**: 第一个 \`bgImage\` 对象必须出现在“第一个 dialogue 对象之前”，用于视频开场背景；允许开头存在 \`bgm\` 控制块，但 \`bgImage\` 仍必须早于第一个 \`dialogue\`。
  - **分布要求**: 除开场第一张外，其余 \`bgImage\` 必须按照剧情节奏插入在台词之间（至少间隔一个 \`dialogue\`），避免连续出现多个 \`bgImage\`。
  - **例外开场**: 允许第一个 \`bgImage\` 作为开场背景，放在第一个 \`dialogue\` 之前；其余 \`bgImage\` 仍按“某个台词对象之后并紧接着下一个台词对象之前”的相邻插入规则执行。


  ## 小说原文:
  <novel_content>
  “别接那个电话！”老李猛地按住了我的手，脸色惨白，“那是昨晚值班的小张打来的。”
  我愣住了，看着办公桌上疯狂震动的座机：“可是……小张不是今早已经确认死亡了吗？”
  “对，”老李的声音在发抖，“所以，别接。如果你接了，他会问你为什么不救他。”
  </novel_content>

  ## 输出:
  [
  \${bgmExampleLine}
    {"type": "dialogue", "role_name": "老李", "text_content": "别接那个电话！", "emotion": "害怕", "intensity": "强烈", "break_duration": 0},
    {"type": "dialogue", "role_name": "旁白", "text_content": "老李猛地按住了我的手，脸色惨白，", "emotion": "平静", "intensity": "中等", "break_duration": 0},
    {"type": "dialogue", "role_name": "老李", "text_content": "那是昨晚值班的小张打来的。", "emotion": "害怕", "intensity": "较强", "break_duration": 0.5},
    {"type": "dialogue", "role_name": "旁白", "text_content": "我愣住了，看着办公桌上疯狂震动的座机：", "emotion": "平静", "intensity": "中等", "break_duration": 0\${sfxExample}},
    {"type": "dialogue", "role_name": "我", "text_content": "可是……小张不是今早已经确认死亡了吗？", "emotion": "惊喜", "intensity": "微弱", "break_duration": 0.5},
    {"type": "dialogue", "role_name": "老李", "text_content": "对，", "emotion": "低落", "intensity": "中等", "break_duration": 0},
    {"type": "dialogue", "role_name": "旁白", "text_content": "老李的声音在发抖，", "emotion": "平静", "intensity": "中等", "break_duration": 0},
    {"type": "dialogue", "role_name": "老李", "text_content": "所以，别接。如果你接了，他会问你为什么不救他。", "emotion": "害怕", "intensity": "强烈", "break_duration": 0}
  ]

  # 输入内容

  ## 小说原文:
  <novel_content>
  \${rawScript}
  </novel_content>`;

                  const englishAnalysisDirective = `# Final output-language rule for this run
Write the generated narration, dialogue, character names, and image_prompt values in English. Translate non-English source content faithfully without omitting lines, speaker cues, or meaning. For narration, keep the role_name exactly "旁白" so existing voice assignments remain compatible; the interface displays it as "Narrator". Keep JSON keys, type/action values, emotion and intensity option names, and the names of listed BGM, SFX, and filter assets exactly as specified elsewhere in this prompt. This language rule takes precedence over Chinese-language examples, while all structural and block-count rules still apply.`;
                  const getDefaultPromptTemplate = () => generationLanguage.value === 'en'
                      ? `${defaultPromptTemplate}\n\n${englishAnalysisDirective}`
                      : defaultPromptTemplate;
                  const customPromptTemplate = ref(getDefaultPromptTemplate());
                  const useCustomPrompt = ref(false);

                  const defaultVoicePromptTemplate = `请根据以下小说片段，简要描述角色“\${charName}”的音色特征。\n要求：必须要带上性别，对音色的描述文本非常精炼，控制在20字以内。重点描述声音的物理质感（如声线粗细、年龄感、沙哑/清脆等），不要包含过多的性格或情绪描写。直接输出描述，不要废话。\n\n小说片段：\n\${rawScript}`;
                  const englishVoicePromptTemplate = `Describe the physical voice qualities of character "\${charName}" in the following novel excerpt. Include gender, approximate age, pitch, texture, and any rasp or clarity. Keep the description concise, within 20 English words. Do not add personality traits, emotions, or commentary.\n\nNovel excerpt:\n\${rawScript}`;
                  const getDefaultVoicePromptTemplate = () => generationLanguage.value === 'en'
                      ? englishVoicePromptTemplate : defaultVoicePromptTemplate;

                  const customVoicePromptTemplate = ref(getDefaultVoicePromptTemplate());
                  const useCustomVoicePrompt = ref(false);

                  const defaultQwenVoiceTextTemplate = "我是${charName}，初次见面，请多多指教。正在进行声线校准测试，一，二，三。这段音频将作为我的基准音色，希望能完美演绎接下来的故事，请多关照。";
                  const englishQwenVoiceTextTemplate = "I am ${charName}. It's a pleasure to meet you, and I look forward to working with you. I am currently conducting a voice calibration test: one, two, three. This audio will serve as my baseline voice, and I hope to bring the upcoming stories to life.";
                  const getDefaultQwenVoiceTextTemplate = () => generationLanguage.value === 'en'
                      ? englishQwenVoiceTextTemplate : defaultQwenVoiceTextTemplate;
                  const customQwenVoiceTextTemplate = ref(getDefaultQwenVoiceTextTemplate());
                  const useCustomQwenVoiceText = ref(false);

                  // --- 音频引擎与缓存 (Audio Engine & Cache) ---
                  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                  let videoRecordingAudioDestination = null;
                  const getAudioOutputNode = () => videoRecordingAudioDestination || audioContext.destination;
                  const decodedCache = new DecodedAudioCache();
                  const queueAudioDecode = createAudioDecodeQueue();
                  const objectUrls = new ObjectUrlManager();
                  const mediaOwner = (scriptId, line, field) => `${scriptId}:${line.id}:${field}`;
                  let mediaGeneration = 0;
                  let isWorkspaceUnmounted = false;
                  const audioBufferCache = {
                      has: key => decodedCache.has(`source:${key}`),
                      get: key => decodedCache.get(`source:${key}`),
                      set: (key, buffer) => decodedCache.set(`source:${key}`, buffer, audioBufferBytes(buffer)),
                      delete: key => decodedCache.delete(`source:${key}`),
                      clear: () => decodedCache.deletePrefix('source:'),
                      values: () => decodedCache.values('source:')
                  };
                  const processedDialogueAssetCache = {
                      has: key => decodedCache.has(`processed:${key}`),
                      get: key => decodedCache.get(`processed:${key}`),
                      set: (key, asset) => decodedCache.set(`processed:${key}`, asset,
                          audioBufferBytes(asset.buffer), old => {
                              if (old.ownsUrl) {
                                  audioBufferCache.delete(old.url);
                                  objectUrls.release(old.owner);
                              }
                          }),
                      deletePrefix: prefix => decodedCache.deletePrefix(`processed:${prefix}`),
                      clear: () => decodedCache.deletePrefix('processed:'),
                      values: () => decodedCache.values('processed:')
                  };
                  const processedDialogueBufferPromiseCache = new Map();
                  const hydrateScriptMedia = async (script) => {
                      const store = activeAssetStore;
                      for (const line of script?.data?.scriptLines || []) {
                          if (isWorkspaceUnmounted || script.id !== currentScriptId.value || !scriptList.value.includes(script)) return;
                          const id = line.type === 'bgImage' ? line.bgImageAssetId : null;
                          if (!id) continue;
                          const urlField = line.type === 'dialogue' ? 'audioUrl' : 'imageUrl';
                          if (line[urlField]) continue;
                          const blob = await store.get(id);
                          if (isWorkspaceUnmounted || store !== activeAssetStore || script.id !== currentScriptId.value ||
                              !scriptList.value.includes(script) ||
                              !script.data.scriptLines.includes(line) || line[urlField] ||
                              (line.type === 'dialogue' ? line.audioAssetId : line.bgImageAssetId) !== id) return;
                          if (blob) line[urlField] = objectUrls.create(mediaOwner(script.id, line, urlField), blob);
                      }
                  };
                  const releaseLineMedia = (scriptId, line) => {
                      mediaGeneration++;
                      if (line.audioAssetId) audioBufferCache.delete(`asset:${line.audioAssetId}`);
                      processedDialogueAssetCache.deletePrefix(`${scriptId}|${line.id}|`);
                      objectUrls.releasePrefix(`processed:${scriptId}|${line.id}|`);
                      for (const field of ['audioUrl', 'imageUrl']) {
                          if (field === 'audioUrl' && line[field]) audioBufferCache.delete(line[field]);
                          objectUrls.release(mediaOwner(scriptId, line, field));
                          line[field] = '';
                      }
                  };
                  const ensureLineAudioUrl = async line => {
                      if (!line?.audioAssetId) return null;
                      if (line.audioUrl) return line.audioUrl;
                      const scriptId = currentScriptId.value;
                      const assetId = line.audioAssetId;
                      const store = activeAssetStore;
                      const generation = mediaGeneration;
                      const blob = await store.get(assetId);
                      if (!blob || isWorkspaceUnmounted || generation !== mediaGeneration ||
                          scriptId !== currentScriptId.value || store !== activeAssetStore ||
                          line.audioAssetId !== assetId || !scriptLines.value.includes(line)) return null;
                      if (!line.audioUrl) line.audioUrl = objectUrls.create(mediaOwner(scriptId, line, 'audioUrl'), blob);
                      return line.audioUrl;
                  };
                  const releaseScriptMedia = (script) => {
                      if (!script) return;
                      const lines = new Set(script.data?.scriptLines || []);
                      if (script.id === currentScriptId.value) for (const line of scriptLines.value) lines.add(line);
                      for (const line of lines) releaseLineMedia(script.id, line);
                      mediaGeneration++;
                  };
                  const storageAudit = ref(/** @type {any} */ (null));
                  const refreshStorageAudit = async () => {
                      try {
                          syncCurrentScriptState();
                          const snapshot = createProjectSnapshot({
                              characters: characters.value,
                              scriptList: scriptList.value,
                              novels: novels.value,
                              currentScriptId: currentScriptId.value,
                              libraries: { sfx: sfxLibrary.value, bgm: bgmLibrary.value, timbres: timbres.value,
                                  filters: filterLibrary.value, emotions: emotionPresets.value }
                          });
                          const records = await activeAssetStore.list(activeProjectId.value);
                          const referenced = referencedAssetIds(snapshot);
                          const audit = auditAssetRecords(records.map(ref => ({ key: ref.id, byteLength: ref.byteLength })), referenced);
                          const available = new Set(records.map(ref => ref.id));
                          const missingIds = [...referenced].filter(id => !available.has(id));
                          const decodedBytes = decodedCache.byteLength;
                          const estimate = await navigator.storage?.estimate?.();
                          storageAudit.value = { ...audit, missingCount: missingIds.length, missingIds, decodedBytes,
                              originUsage: estimate?.usage ?? null, originQuota: estimate?.quota ?? null, error: '' };
                      } catch (error) {
                          storageAudit.value = { error: String(error?.message || error) };
                      }
                  };

                  // FFmpeg lifecycle and queue live in the audio adapter.
                  // Audio conversion helpers live in the audio service.
                  const getProcessedDialogueAsset = async (line) => {
                      if (!line?.audioAssetId) return null;
                      const scriptId = currentScriptId.value;
                      const sourceUrl = await ensureLineAudioUrl(line);
                      if (!sourceUrl) return null;
                      const generation = mediaGeneration;
                      const isCurrent = () => generation === mediaGeneration &&
                          !isWorkspaceUnmounted && scriptId === currentScriptId.value && line.audioUrl === sourceUrl && scriptLines.value.includes(line);
                      const sourceBuffer = await loadAudioBuffer(sourceUrl);
                      if (!sourceBuffer || !isCurrent()) return null;

                      const trimStart = line.trimStart || 0;
                      const trimEnd = line.trimEnd || 1;
                      const speed = line.speed || 1.0;
                      const cacheKey = [
                          scriptId,
                          line.id,
                          sourceUrl,
                          sourceBuffer.length,
                          sourceBuffer.sampleRate,
                          trimStart,
                          trimEnd,
                          speed
                      ].join('|');

                      if (processedDialogueAssetCache.has(cacheKey)) {
                          return processedDialogueAssetCache.get(cacheKey);
                      }
                      processedDialogueAssetCache.deletePrefix(`${scriptId}|${line.id}|`);
                      if (processedDialogueBufferPromiseCache.has(cacheKey)) {
                          return processedDialogueBufferPromiseCache.get(cacheKey);
                      }

                      const processPromise = (async () => {
                          const safeSpeed = Math.max(0.2, Math.min(2, Number(speed) || 1));
                          const startSec = sourceBuffer.duration * trimStart;
                          const endSec = Math.max(startSec + 0.01, sourceBuffer.duration * trimEnd);

                          if (Math.abs(safeSpeed - 1) < 0.001 && trimStart <= 0.0001 && trimEnd >= 0.9999) {
                              const originalBlob = await getAudioBlobFromUrl(sourceUrl);
                              if (!isCurrent()) return null;
                              const processedBuffer = sourceBuffer;
                              const asset = {
                                  buffer: processedBuffer,
                                  blob: originalBlob,
                                  url: sourceUrl,
                                  ownsUrl: false,
                                  duration: processedBuffer.duration
                              };
                              processedDialogueAssetCache.set(cacheKey, asset);
                              return asset;
                          }

                          const ffmpeg = await ensureFFmpegLoaded();
                          const sourceBlob = await getAudioBlobFromUrl(sourceUrl);
                          if (!isCurrent()) return null;
                          const sourceExt = getFileExtensionFromBlob(sourceBlob);
                          const inputName = `line_${line.id}_${Date.now()}.${sourceExt}`;
                          const outputName = `line_${line.id}_${Date.now()}_processed.wav`;

                          const processedBytes = await runFFmpegTask(async () => {
                              await ffmpeg.writeFile(inputName, new Uint8Array(await sourceBlob.arrayBuffer()));
                              await ffmpeg.exec([
                                  '-i', inputName,
                                  '-af', buildDialogueAudioFilter(startSec, endSec, safeSpeed),
                                  '-vn',
                                  '-acodec', 'pcm_s16le',
                                  outputName
                              ]);
                              const data = await ffmpeg.readFile(outputName);
                              await ffmpeg.deleteFile(inputName);
                              await ffmpeg.deleteFile(outputName);
                              return data;
                          });

                          const processedBlob = new Blob([processedBytes.buffer.slice(processedBytes.byteOffset, processedBytes.byteOffset + processedBytes.byteLength)], { type: 'audio/wav' });
                          if (!isCurrent()) return null;
                          const owner = `processed:${cacheKey}`;
                          const processedUrl = objectUrls.create(owner, processedBlob);
                          const processedBuffer = await loadAudioBuffer(processedUrl);
                          if (!processedBuffer || !isCurrent()) {
                              audioBufferCache.delete(processedUrl);
                              objectUrls.release(owner);
                              return null;
                          }
                          const asset = {
                              buffer: processedBuffer,
                              blob: processedBlob,
                              url: processedUrl,
                              owner,
                              ownsUrl: true,
                              duration: processedBuffer.duration
                          };
                          processedDialogueAssetCache.set(cacheKey, asset);
                          return asset;
                      })();

                      processedDialogueBufferPromiseCache.set(cacheKey, processPromise);
                      try {
                          return await processPromise;
                      } finally {
                          processedDialogueBufferPromiseCache.delete(cacheKey);
                      }
                  };

                  const getProcessedDialogueBuffer = async (line) => {
                      const asset = await getProcessedDialogueAsset(line);
                      return asset?.buffer || null;
                  };

                  const getDialogueTimingInfo = async (line) => {
                      const asset = await getProcessedDialogueAsset(line);
                      if (!asset) return null;
                      const sourceBuffer = await loadAudioBuffer(line.audioUrl);
                      const trimStart = Math.max(0, Math.min(1, Number(line.trimStart) || 0));
                      const trimEnd = Math.max(trimStart, Math.min(1, Number(line.trimEnd) || 1));
                      const safeSpeed = Math.max(0.2, Math.min(2, Number(line.speed) || 1));

                      return {
                          trimStart,
                          trimEnd,
                          safeSpeed,
                          trimmedDuration: sourceBuffer ? sourceBuffer.duration * Math.max(0.0001, trimEnd - trimStart) : asset.duration,
                          effectiveDuration: asset.duration,
                          processedBuffer: asset.buffer
                      };
                  };

                  const loadAudioBuffer = (filename, shouldLoad = () => true, queueKey = filename) => {
                      if (!filename) return null;
                      if (audioBufferCache.has(filename)) return audioBufferCache.get(filename);
                      return queueAudioDecode(queueKey, async () => {
                      if (!shouldLoad()) return null;
                      const generation = mediaGeneration;

                      try {
                          let arrayBuffer;
                          if (filename.startsWith('asset:')) {
                              const blob = await activeAssetStore.get(filename.slice(6));
                              if (!blob) throw new Error(`Missing asset ${filename}`);
                              arrayBuffer = await blob.arrayBuffer();
                          } else if (filename.match(/^(https?:\/\/|blob:)/)) {
                              const res = await fetch(filename);
                              if (!res.ok) throw new Error(`Failed to fetch ${filename}`);
                              arrayBuffer = await res.arrayBuffer();
                          } else {
                              // 兜底：尝试从本地相对路径（如 voice 目录）加载
                              try {
                                  const localRes = await fetch(`voice/${filename}`);
                                  if (!localRes.ok) {
                                      // 尝试根目录
                                      const rootRes = await fetch(filename);
                                      if (!rootRes.ok) throw new Error('Not found');
                                      arrayBuffer = await rootRes.arrayBuffer();
                                  } else {
                                      arrayBuffer = await localRes.arrayBuffer();
                                  }
                              } catch (e) {
                                  throw new Error(`Audio file not found in memory or local path: ${filename}`);
                              }
                          }
                          if (!shouldLoad()) return null;
                          const buffer = await audioContext.decodeAudioData(arrayBuffer);
                          if (generation === mediaGeneration) audioBufferCache.set(filename, buffer);
                          return buffer;
                      } catch (e) {
                          console.warn(`Failed to load audio: ${filename}`, e);
                          return null;
                      }
                      });
                  };

                  // --- 预览播放逻辑 ---
                  const previewPlayingFile = ref(null);
                  let previewSource = null;
                  let releasePreviewBuffer = () => {};
                  let previewGeneration = 0;

                  const playPreview = async (item) => {
                      const request = ++previewGeneration;
                      if (audioContext.state === 'suspended') await audioContext.resume();

                      if (previewSource) {
                          try { previewSource.stop(); } catch (e) { }
                          previewSource = null;
                          releasePreviewBuffer();
                      }
                      if (playbackAnimationFrame) {
                          cancelAnimationFrame(playbackAnimationFrame);
                          playbackAnimationFrame = null;
                      }

                      let filename, volume, trimStart, trimEnd;

                      if (typeof item === 'string') {
                          filename = item;
                          volume = 1.0;
                          trimStart = 0;
                          trimEnd = 1;
                      } else if (typeof item === 'object' && item !== null) {
                          filename = item.assetId ? `asset:${item.assetId}` : item.filename || item.refPath;
                          volume = item.volume ?? 1.0;
                          trimStart = item.trimStart ?? 0;
                          trimEnd = item.trimEnd ?? 1;
                      } else {
                          return;
                      }

                      if (previewPlayingFile.value === filename) {
                          previewPlayingFile.value = null;
                          playbackProgress.value = 0;
                          return;
                      }

                      if (!filename) return;

                      const buffer = await loadAudioBuffer(filename);
                      if (request !== previewGeneration || isWorkspaceUnmounted) return;
                      if (buffer) {
                          releasePreviewBuffer = decodedCache.pinBuffer(buffer);
                          previewSource = audioContext.createBufferSource();
                          previewSource.buffer = buffer;

                          const gainNode = audioContext.createGain();
                          gainNode.gain.setValueAtTime(volume, audioContext.currentTime);

                          previewSource.connect(gainNode);
                          gainNode.connect(audioContext.destination);

                          const duration = buffer.duration;
                          const startTimeOffset = duration * trimStart;
                          const playDuration = duration * (trimEnd - trimStart);

                          const now = audioContext.currentTime;

                          const source = previewSource;
                          previewSource.onended = () => {
                              if (previewSource !== source) return;
                              previewSource = null;
                              releasePreviewBuffer();
                              if (previewPlayingFile.value === filename) {
                                  previewPlayingFile.value = null;
                                  playbackProgress.value = 0;
                              }
                              if (playbackAnimationFrame) {
                                  cancelAnimationFrame(playbackAnimationFrame);
                                  playbackAnimationFrame = null;
                              }
                          };
                          previewSource.start(now, startTimeOffset, playDuration);
                          previewPlayingFile.value = filename;

                          // Progress bar logic
                          const updateProgress = () => {
                              if (previewPlayingFile.value !== filename) return;
                              const elapsed = audioContext.currentTime - now;
                              if (elapsed >= 0) {
                                  const progress = trimStart + (elapsed / duration);
                                  playbackProgress.value = Math.min(progress, trimEnd);
                              } else {
                                  playbackProgress.value = trimStart;
                              }

                              if (audioContext.currentTime < now + playDuration) {
                                  playbackAnimationFrame = requestAnimationFrame(updateProgress);
                              } else {
                                  playbackProgress.value = trimEnd;
                              }
                          };
                          playbackAnimationFrame = requestAnimationFrame(updateProgress);
                      }
                  };

                  // --- 波形绘制与剪辑逻辑 ---
                  const waveformCanvases = new Map();
                  const waveformItems = new Map();
                  let waveformObserver = null;
                  let nextWaveformCanvasId = 0;
                  let waveformFallbackListening = false;
                  const fallbackWaveformVisible = canvas => {
                      if (!canvas.isConnected || !canvas.getClientRects?.().length) return false;
                      const rect = canvas.getBoundingClientRect?.();
                      if (!rect) return true;
                      const width = window.innerWidth || document.documentElement?.clientWidth || 0;
                      const height = window.innerHeight || document.documentElement?.clientHeight || 0;
                      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
                          rect.top < height && rect.left < width;
                  };
                  const isWaveformVisible = (canvas, state) =>
                      (!waveformObserver || state.visible) && fallbackWaveformVisible(canvas);
                  const unregisterWaveform = canvas => {
                      const state = waveformCanvases.get(canvas);
                      if (!state) return;
                      state.version++;
                      waveformObserver?.unobserve(canvas);
                      if (waveformItems.get(state.item) === canvas) waveformItems.delete(state.item);
                      waveformCanvases.delete(canvas);
                  };
                  const renderWaveform = async canvas => {
                      const state = waveformCanvases.get(canvas);
                      if (!state || state.loading || state.drawnPath === state.path || !isWaveformVisible(canvas, state)) return;
                      const path = state.path;
                      const version = state.version;
                      state.loading = true;
                      const stillVisible = () => waveformCanvases.get(canvas) === state &&
                          state.version === version && state.path === path &&
                          (state.item.audioAssetId ? `asset:${state.item.audioAssetId}` :
                              state.item.assetId ? `asset:${state.item.assetId}` :
                              state.item.audioUrl || state.item.filename || state.item.refPath) === path &&
                          (state.item.audioAssetId ? scriptLines.value.includes(state.item) :
                              state.item === sfxForm.value || state.item === bgmForm.value) &&
                          isWaveformVisible(canvas, state);
                      const buffer = await loadAudioBuffer(path, stillVisible, `waveform:${state.id}:${path}`);
                      state.loading = false;
                      if (!stillVisible()) {
                          if (waveformCanvases.get(canvas) === state && isWaveformVisible(canvas, state)) void renderWaveform(canvas);
                          return;
                      }
                      const ctx = canvas.getContext('2d');
                      const width = canvas.width;
                      const height = canvas.height;
                      ctx.clearRect(0, 0, width, height);
                      if (buffer) {
                          const data = buffer.getChannelData(0);
                          const step = Math.ceil(data.length / width);
                          const amp = height / 2;
                          ctx.fillStyle = '#94a3b8';
                          for (let i = 0; i < width; i++) {
                              let min = 1;
                              let max = -1;
                              for (let j = 0; j < step; j++) {
                                  const datum = data[(i * step) + j];
                                  if (datum < min) min = datum;
                                  if (datum > max) max = datum;
                              }
                              ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
                          }
                      }
                      state.drawnPath = path;
                  };
                  const drawWaveform = (canvas, item) => {
                      if (!canvas) {
                          const oldCanvas = waveformItems.get(item);
                          if (oldCanvas) unregisterWaveform(oldCanvas);
                          return;
                      }
                      const path = item.audioAssetId ? `asset:${item.audioAssetId}` :
                          item.assetId ? `asset:${item.assetId}` : item.audioUrl || item.filename || item.refPath;
                      if (!path) { unregisterWaveform(canvas); return; }
                      let state = waveformCanvases.get(canvas);
                      if (!state) {
                          const oldCanvas = waveformItems.get(item);
                          if (oldCanvas) unregisterWaveform(oldCanvas);
                          state = { id: ++nextWaveformCanvasId, item, path, version: 0, drawnPath: '', loading: false, visible: false };
                          waveformCanvases.set(canvas, state);
                          waveformItems.set(item, canvas);
                          if (!waveformObserver && typeof IntersectionObserver !== 'undefined') {
                              waveformObserver = new IntersectionObserver(entries => {
                                  for (const entry of entries) {
                                      if (!entry.target.isConnected) {
                                          unregisterWaveform(entry.target);
                                      } else {
                                          const observed = waveformCanvases.get(entry.target);
                                          if (!observed) continue;
                                          observed.visible = entry.isIntersecting;
                                          if (observed.visible) void renderWaveform(entry.target);
                                      }
                                  }
                              });
                          }
                          waveformObserver?.observe(canvas);
                          if (!waveformObserver && !waveformFallbackListening) {
                              window.addEventListener?.('scroll', refreshFallbackWaveforms, true);
                              window.addEventListener?.('resize', refreshFallbackWaveforms);
                              waveformFallbackListening = true;
                          }
                      }
                      if (state.item !== item) {
                          if (waveformItems.get(state.item) === canvas) waveformItems.delete(state.item);
                          state.item = item;
                          waveformItems.set(item, canvas);
                          state.version++;
                      }
                      if (state.path !== path) {
                          state.path = path;
                          state.version++;
                          state.drawnPath = '';
                      }
                      if (isWaveformVisible(canvas, state)) void renderWaveform(canvas);
                  };
                  const refreshFallbackWaveforms = () => {
                      for (const canvas of waveformCanvases.keys()) {
                          if (!canvas.isConnected) unregisterWaveform(canvas);
                          else void renderWaveform(canvas);
                      }
                  };

                  const startDragTrim = (e, item, type) => {
                      draggingTrimState.value = {
                          item: item,
                          type: type, // 'start' or 'end'
                          startX: e.clientX,
                          containerWidth: e.target.closest('.relative').offsetWidth,
                          startVal: type === 'start' ? (item.trimStart ?? 0) : (item.trimEnd ?? 1)
                      };

                      const onMove = (ev) => {
                          if (!draggingTrimState.value) return;
                          const state = draggingTrimState.value;
                          const item = state.item;
                          if (!item) return;

                          const deltaX = ev.clientX - state.startX;
                          const deltaPercent = deltaX / state.containerWidth;
                          let newVal = Math.max(0, Math.min(1, state.startVal + deltaPercent));

                          if (state.type === 'start') {
                              item.trimStart = Math.min(newVal, (item.trimEnd ?? 1) - 0.01);
                          } else {
                              item.trimEnd = Math.max(newVal, (item.trimStart ?? 0) + 0.01);
                          }
                      };

                      const onUp = () => {
                          window.removeEventListener('mousemove', onMove);
                          window.removeEventListener('mouseup', onUp);
                          draggingTrimState.value = null;
                          triggerAutoSave(); // 保存剪辑结果
                      };

                      window.addEventListener('mousemove', onMove);
                      window.addEventListener('mouseup', onUp);
                  };

                  // Watchers for Auto-Save
                  watch([rawScript, characters, sfxLibrary, bgmLibrary, timbres, filterLibrary, emotionPresets], () => {
                      if (isRestoring.value) return; // 如果正在恢复数据，不触发自动保存
                      triggerAutoSave();
                  }, { deep: true });

                  watch(scriptLines, () => {
                      if (isRestoring.value) return;
                      triggerAutoSave();
                  }, { deep: true });

                  watch(bgImageCount, () => {
                      localStorage.setItem(storageKeys.bgImageCount, String(Math.max(0, Number(bgImageCount.value) || 0)));
                  });

                  // 读取持久化配置
                  onMounted(async () => {

                       // 仅保留 LLM 和 TTS 的配置持久化 (API Key 等)
                       const savedList = localStorage.getItem(storageKeys.llmConfigs);
                       if (savedList) {
                           llmConfigs.value = JSON.parse(savedList);
                       } else {
                           // 迁移旧数据或初始化默认
                           const oldSingle = localStorage.getItem(storageKeys.legacyConfig);
                           if (oldSingle) {
                               const c = JSON.parse(oldSingle);
                               llmConfigs.value.push({ ...c, id: Date.now().toString(), name: translateMessage('data.defaultConfiguration') });
                               localStorage.removeItem(storageKeys.legacyConfig);
                           }
                       }

                       const savedLlmId = localStorage.getItem(storageKeys.llmConfigId);
                       if (savedLlmId && llmConfigs.value.some(c => c.id === savedLlmId)) {
                           currentConfigId.value = savedLlmId;
                       } else if (llmConfigs.value.length > 0) {
                           currentConfigId.value = llmConfigs.value[0].id;
                       }

                       // 读取 TTS 配置
                       const savedTts = localStorage.getItem(storageKeys.ttsConfigs);
                       if (savedTts) ttsConfigs.value = JSON.parse(savedTts);

                       const savedTtsId = localStorage.getItem(storageKeys.ttsConfigId);
                       if (savedTtsId && ttsConfigs.value.some(c => c.id === savedTtsId)) {
                           currentTtsConfigId.value = savedTtsId;
                       } else if (ttsConfigs.value.length > 0) {
                           currentTtsConfigId.value = ttsConfigs.value[0].id;
                       }

                       // 初始化默认滤波器
                       filterLibrary.value = [
                           { id: 'f1', name: '电话音', description: '模拟电话通话时的窄频带声音', type: 'bandpass', frequency: 1700, Q: 1.5, gain: 0, enabled: true },
                           { id: 'f2', name: '水下', description: '模拟在水下听到的闷声', type: 'lowpass', frequency: 400, Q: 1, gain: 0, enabled: true },
                           { id: 'f3', name: '老广播', description: '模拟老式收音机或广播的尖锐声音', type: 'highpass', frequency: 1500, Q: 1, gain: 0, enabled: true },
                           { id: 'f4', name: '机械失真', description: '模拟机器人或设备损坏时的失真声音', type: 'distortion', frequency: 1000, Q: 1, gain: 50, enabled: true }
                       ];

                       // 初始化默认情绪
                       emotionPresets.value = [...SYSTEM_EMOTIONS];

                       const savedPrompt = localStorage.getItem(storageKeys.promptTemplate);
                       if (savedPrompt) customPromptTemplate.value = savedPrompt;

                       const savedUseCustom = localStorage.getItem(storageKeys.useCustomPrompt);
                       if (savedUseCustom) useCustomPrompt.value = JSON.parse(savedUseCustom);

                       const savedVoicePrompt = localStorage.getItem(storageKeys.voicePromptTemplate);
                       if (savedVoicePrompt) customVoicePromptTemplate.value = savedVoicePrompt;

                       const savedUseCustomVoice = localStorage.getItem(storageKeys.useCustomVoicePrompt);
                       if (savedUseCustomVoice) useCustomVoicePrompt.value = JSON.parse(savedUseCustomVoice);

                       const savedQwenText = localStorage.getItem(storageKeys.qwenVoiceTextTemplate);
                       if (savedQwenText) customQwenVoiceTextTemplate.value = savedQwenText;

                       const savedUseCustomQwen = localStorage.getItem(storageKeys.useCustomQwenVoiceText);
                       if (savedUseCustomQwen) useCustomQwenVoiceText.value = JSON.parse(savedUseCustomQwen);

                       const savedBgImageCount = localStorage.getItem(storageKeys.bgImageCount);
                       if (savedBgImageCount !== null) {
                           const parsedBgImageCount = Number(savedBgImageCount);
                           bgImageCount.value = Number.isFinite(parsedBgImageCount) ? Math.max(0, parsedBgImageCount) : 0;
                       }

                       // --- Restore from IndexedDB ---
                       try {
                           await openWorkspaceDB();
                           isRestoring.value = true; // 开始恢复，暂停自动保存

                           // 1. Load Project Data
                           const activeWorkspace = await getActiveWorkspace();
                           activeProjectId.value = activeWorkspace.id;
                           storageBackend.value = activeWorkspace.backend;
                           let projectData;
                           if (activeWorkspace.backend === 'directory') {
                               const handle = await loadRecentDirectory(activeWorkspace.id);
                               const permission = handle && typeof handle.queryPermission === 'function'
                                   ? await handle.queryPermission({ mode: 'readwrite' }) : 'denied';
                               if (permission !== 'granted') {
                                   storageAccessBlocked = true;
                                   directoryError.value = '项目目录权限已失效，请重新选择目录。';
                                   throw new Error(directoryError.value);
                               }
                               directoryStore = await DirectoryProjectStore.open(handle);
                               activeAssetStore = directoryStore;
                               directoryName.value = handle.name;
                               projectData = await directoryStore.loadProject();
                           } else {
                               activeAssetStore = indexedDbAssetStore;
                               projectData = await loadWorkspaceProject(activeProjectId.value);
                           }

                           if (projectData) {
                               // --- STAGE 1: Restore all text/JSON data immediately ---
                               console.log('Project data found, restoring text and metadata...');

                               // Restore libraries (metadata only)
                              if (projectData.libraries) {
                                  sfxLibrary.value = (projectData.libraries.sfx || []).map(s => ({ ...s, volume: s.volume ?? 0.3 }));
                                  bgmLibrary.value = (projectData.libraries.bgm || []).map(b => ({ ...b, volume: b.volume ?? 0.3 }));
                                  timbres.value = projectData.libraries.timbres || [];
                                  filterLibrary.value = projectData.libraries.filters || filterLibrary.value; // Fallback to default if not in save

                                   if (projectData.libraries.emotions && Array.isArray(projectData.libraries.emotions)) {
                                       const customLoaded = projectData.libraries.emotions.filter(e => !isSystemEmotion(e.name) && Array.isArray(e.vector));
                                       const systemLoaded = projectData.libraries.emotions.filter(e => isSystemEmotion(e.name));
                                      const mergedSystem = SYSTEM_EMOTIONS.map(def => {
                                          const saved = systemLoaded.find(s => s.name === def.name);
                                          return { ...def, enabled: saved ? saved.enabled : undefined };
                                      });
                                      emotionPresets.value = [...mergedSystem, ...customLoaded];
                                  }
                              }

                              // Restore script list (metadata only)
                              if (!Array.isArray(projectData.scriptList)) throw new Error('Project script list is missing');
                              projectData.scriptList.forEach(script => {
                                  if (script.data && script.data.scriptLines) {
                                      script.data.scriptLines = script.data.scriptLines.map(lineData => ({
                                          trimStart: 0, trimEnd: 1, ...lineData, imageUrl: '', audioUrl: '', isGenerating: false
                                      }));
                                  }
                              });
                              scriptList.value = projectData.scriptList;
                              novels.value = projectData.novels || [];
                              currentScriptId.value = projectData.currentScriptId || (scriptList.value.length > 0 ? scriptList.value[0].id : 'default');

                               // Load active script into view immediately
                               const active = scriptList.value.find(s => s.id === currentScriptId.value);
                               if (active) {
                                   rawScript.value = active.data.rawScript || '';
                                   scriptLines.value = active.data.scriptLines || [];
                                   rawAnalysisResult.value = active.data.rawAnalysisResult || '';
                                   characters.value = active.data.characters || [];
                                   characters.value.forEach(c => { if (c.volume === undefined) c.volume = 1.0; });
                               }

                               // Only materialize media for the active script; other scripts remain on disk.
                               if (active) void hydrateScriptMedia(active).catch(error => console.warn('Media restore failed', error));
                               void collectOrphanAssets(activeAssetStore, activeProjectId.value, projectData, protectedAssetIds())
                                   .catch(error => console.warn('Orphan cleanup failed', error));

                           }
                       } catch (e) {
                           console.error('Failed to restore from IndexedDB', e);
                           if (storageBackend.value === 'directory') {
                               storageAccessBlocked = true;
                               directoryError.value = e.message || String(e);
                           }
                       } finally {
                           // Slightly longer delay to ensure background loading has started
                           setTimeout(() => { isRestoring.value = false; }, 500);
                       }
                  });
                  onUnmounted(() => {
                      isWorkspaceUnmounted = true;
                      previewGeneration++;
                      if (previewSource) {
                          try { previewSource.stop(); } catch { /* already stopped */ }
                          previewSource = null;
                          releasePreviewBuffer();
                      }
                      waveformObserver?.disconnect();
                      waveformCanvases.clear();
                      waveformItems.clear();
                      if (waveformFallbackListening) {
                          window.removeEventListener?.('scroll', refreshFallbackWaveforms, true);
                          window.removeEventListener?.('resize', refreshFallbackWaveforms);
                      }
                      mediaGeneration++;
                      analysisAbortController.value?.abort();
                      for (const line of scriptLines.value) line.abortController?.abort();
                      for (const char of characters.value) char.abortController?.abort();
                      objectUrls.releaseAll();
                      audioBufferCache.clear();
                      processedDialogueAssetCache.clear();
                      if (saveTimeout) clearTimeout(saveTimeout);
                      if (orphanSweepTimer) clearTimeout(orphanSweepTimer);
                  });

                  const currentTtsConfig = computed(() => {
                      return ttsConfigs.value.find(c => c.id === currentTtsConfigId.value) || null;
                  });

                  // --- 配置管理逻辑 ---
                  const saveConfigsToLocal = () => {
                      localStorage.setItem(storageKeys.llmConfigs, JSON.stringify(llmConfigs.value));
                  };

                  const saveConfig = () => {
                      if (!form.value.name || !form.value.baseUrl || !form.value.key) {
                          return alert(translateMessage("请填写完整信息"));
                      }

                      form.value.baseUrl = form.value.baseUrl.trim();
                      form.value.key = form.value.key.trim();

                      if (isEditing.value) {
                          const index = llmConfigs.value.findIndex(c => c.id === form.value.id);
                          if (index !== -1) llmConfigs.value[index] = { ...form.value };
                      } else {
                          llmConfigs.value.push({ ...form.value, id: Date.now().toString() });
                      }

                      saveConfigsToLocal();
                      resetForm();

                      // 如果是第一个，自动选中
                      if (llmConfigs.value.length === 1) {
                          currentConfigId.value = llmConfigs.value[0].id;
                      }
                  };

                  const editConfig = (conf) => {
                      form.value = { ...conf };
                      isEditing.value = true;
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                  };

                  const deleteConfig = (id) => {
                      if (!confirm(translateMessage("确定删除此配置吗？"))) return;
                      llmConfigs.value = llmConfigs.value.filter(c => c.id !== id);
                      saveConfigsToLocal();
                      if (currentConfigId.value === id) currentConfigId.value = '';
                  };

                  const resetForm = () => {
                      form.value = { id: '', name: '', baseUrl: '', model: '', key: '', params: '' };
                      isEditing.value = false;
                  };

                  // --- TTS 配置管理逻辑 ---
                  const saveTtsConfigsToLocal = () => {
                      localStorage.setItem(storageKeys.ttsConfigs, JSON.stringify(ttsConfigs.value));
                  };

                  const saveTtsConfig = () => {
                      if (!ttsForm.value.name || !ttsForm.value.baseUrl) {
                          return alert(translateMessage("请填写完整信息"));
                      }

                      ttsForm.value.baseUrl = ttsForm.value.baseUrl.trim();

                      if (isEditingTts.value) {
                          const index = ttsConfigs.value.findIndex(c => c.id === ttsForm.value.id);
                          if (index !== -1) ttsConfigs.value[index] = { ...ttsForm.value };
                      } else {
                          ttsConfigs.value.push({ ...ttsForm.value, id: Date.now().toString() });
                      }

                      saveTtsConfigsToLocal();
                      resetTtsForm();
                  };

                  const editTtsConfig = (conf) => {
                      ttsForm.value = { ...conf };
                      isEditingTts.value = true;
                  };

                  const deleteTtsConfig = (id) => {
                      if (!confirm(translateMessage("确定删除此 TTS 配置吗？"))) return;
                      ttsConfigs.value = ttsConfigs.value.filter(c => c.id !== id);
                      saveTtsConfigsToLocal();
                  };

                  const resetTtsForm = () => {
                      ttsForm.value = { id: '', name: '', baseUrl: '' };
                      isEditingTts.value = false;
                  };

                  // --- 角色库管理逻辑 (左侧栏) ---
                  const addCharacter = () => {
                      characters.value.push({
                          id: Date.now().toString(),
                          name: translateMessage('data.newCharacter'),
                          voiceFile: '', // Path for both display and synthesis
                          volume: 1.0
                      });
                  };

                  const bindCharacterTimbre = (char) => {
                      const timbre = timbres.value.find(item => item.refPath === char.voiceFile);
                      char.voiceAssetId = timbre?.assetId || '';
                      triggerAutoSave();
                  };
                  const replaceVoiceReference = (previousPath, nextPath, assetId) => {
                      if (!previousPath) return;
                      for (const char of characters.value) {
                          if (char.voiceFile === previousPath) {
                              char.voiceFile = nextPath;
                              char.voiceAssetId = assetId;
                          }
                      }
                      for (const script of scriptList.value) {
                          let changed = false;
                          for (const char of script.data.characters || []) {
                              if (char.voiceFile === previousPath) {
                                  char.voiceFile = nextPath;
                                  char.voiceAssetId = assetId;
                                  changed = true;
                              }
                          }
                          if (changed) dirtyScriptIds.add(script.id);
                      }
                  };

                  const deleteCharacter = (id) => {
                      if (!confirm(translateMessage("确定删除此角色吗？"))) return;
                      characters.value = characters.value.filter(c => c.id !== id);
                  };

                  const analyzeCharacterVoice = async (char) => {
                      if (char.isAnalyzing) {
                          if (char.abortController) char.abortController.abort();
                          return;
                      }

                      if (!currentConfig.value) return alert(translateMessage("请先在“模型配置”中配置 LLM"));
                      if (!rawScript.value.trim()) return alert(translateMessage("请先在右侧输入小说原文"));

                      activeScriptTasks++;
                      char.isAnalyzing = true;
                      const controller = new AbortController();
                      char.abortController = controller;

                      try {
                          const templateToUse = useCustomVoicePrompt.value
                              ? customVoicePromptTemplate.value : getDefaultVoicePromptTemplate();
                          const promptText = templateToUse
                              .replace(/\${charName}/g, char.name)
                              .replace(/\${rawScript}/g, rawScript.value.substring(0, 3000));

                          const cfg = currentConfig.value;
                          let url = cfg.baseUrl.trim().replace(/\/+$/, '');
                          if (!url.endsWith('/chat/completions')) url += '/chat/completions';

                          let body = { model: cfg.model, messages: [{ role: 'user', content: promptText }], stream: false };
                          if (cfg.params) {
                              try { body = { ...body, ...JSON.parse(cfg.params) }; } catch (e) { }
                          }

                          const res = await requestService(url, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.key}` },
                              body: JSON.stringify(body),
                              signal: controller.signal
                          });

                          if (!res.ok) throw new Error(translateMessage("LLM 请求失败: {0}", { 0: res.status }));
                          const data = await res.json();
                          const content = data.choices[0]?.message?.content || '';
                          char.voiceDescription = content.trim();
                      } catch (e) {
                          if (e.name !== 'AbortError') {
                              alert(translateMessage("分析失败: {0}", { 0: e.message }));
                          }
                      } finally {
                          char.isAnalyzing = false;
                          delete char.abortController;
                          activeScriptTasks--;
                      }
                  };

                  const generateQwenVoice = async (char) => {
                      if (char.isGeneratingVoice) {
                          if (char.abortController) char.abortController.abort();
                          return;
                      }

                      if (!currentTtsConfig.value) return alert(translateMessage("请先选择 TTS 服务"));
                      if (!char.voiceDescription) return alert(translateMessage("请先填写音色描述"));

                      const taskProjectId = activeProjectId.value;
                      const taskAssetStore = activeAssetStore;
                      activeScriptTasks++;
                      char.isGeneratingVoice = true;
                      let pendingVoiceAssetId = null;
                      const startTime = Date.now();
                      const controller = new AbortController();
                      char.abortController = controller;

                      // 设置 30 分钟 (1800秒) 的前端超时时间，防止前端代码主动放弃
                      const timeoutId = setTimeout(() => {
                          if (char.abortController) char.abortController.abort("timeout");
                      }, 1800000);

                      try {
                          const cfg = currentTtsConfig.value;
                          let baseUrl = cfg.baseUrl.trim().replace(/\/+$/, '');
                          if (baseUrl.endsWith('/v1')) baseUrl = baseUrl.slice(0, -3);

                          const template = useCustomQwenVoiceText.value
                              ? customQwenVoiceTextTemplate.value : getDefaultQwenVoiceTextTemplate();
                          const textToUse = template.replace(/\${charName}/g, char.name).replace(/\${char\.name}/g, char.name);

                          const payload = {
                              voice_description: char.voiceDescription,
                              text: textToUse
                          };

                          // 1. 调用 Qwen3 生成音频
                          const genRes = await requestService(`${baseUrl}/v1/qwen/design`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(payload),
                              signal: controller.signal,
                              cache: 'no-store'
                          });

                          // Don't clear timeout here, as upload might still need it
                          // clearTimeout(timeoutId);

                          if (!genRes.ok) {
                              const err = await genRes.text();
                              throw new Error(translateMessage("生成失败: {0}", { 0: err }));
                          }

                          const blob = await genRes.blob();
                          const filename = `qwen_${char.name}_${Date.now()}.wav`;
                          const file = new File([blob], filename, { type: 'audio/wav' });

                          // 2. 保存到本地资源管理
                          const voiceAsset = await taskAssetStore.put(file, { projectId: taskProjectId, kind: 'voice' });
                          pendingVoiceAssetId = voiceAsset.id;
                          pendingAssetIds.add(voiceAsset.id);
                          const servicePath = `unitale_${voiceAsset.id}.wav`;
                          const serviceFile = new File([blob], servicePath, { type: 'audio/wav' });

                          // 3. 上传回 TTS 服务器 (用于 IndexTTS 调用)
                          const formData = new FormData();
                          formData.append('audio', serviceFile);
                          formData.append('full_path', servicePath);

                          const upRes = await requestService(`${baseUrl}/v1/upload_audio`, {
                              method: 'POST',
                              body: formData,
                              signal: controller.signal
                          });
                          if (!upRes.ok) throw new Error(translateMessage("上传参考音频失败"));

                          // 4. 添加或更新音色库
                          const timbreName = `${char.name}_AI`;
                          const existingIndex = timbres.value.findIndex(t => t.name === timbreName);

                          if (existingIndex !== -1) {
                              // 更新已有音色
                              collectOrphansAfterSave = true;
                              replaceVoiceReference(timbres.value[existingIndex].refPath, servicePath, voiceAsset.id);
                              timbres.value[existingIndex].description = char.voiceDescription;
                              timbres.value[existingIndex].refPath = servicePath;
                              timbres.value[existingIndex].originalFileName = filename;
                              timbres.value[existingIndex].assetId = voiceAsset.id;
                          } else {
                              // 新增音色
                              timbres.value.push({
                                  id: Date.now().toString(),
                                  name: timbreName,
                                  description: char.voiceDescription,
                                  refPath: servicePath,
                                  originalFileName: filename,
                                  assetId: voiceAsset.id
                              });
                          }

                          // 5. 选中该音色
                          char.voiceFile = servicePath;
                          char.voiceAssetId = voiceAsset.id;
                          pendingAssetIds.delete(voiceAsset.id);
                          pendingVoiceAssetId = null;

                          // 6. 自动保存
                          triggerAutoSave();

                      } catch (e) {
                          console.error(e);
                          let msg = e.message;
                          const duration = (Date.now() - startTime) / 1000;

                          if (e.name === 'AbortError') {
                              if (controller.signal.reason === "timeout") {
                                  msg = translateMessage('请求超时 (超过 30 分钟)。请检查后端是否卡死。');
                              } else {
                                  msg = translateMessage('操作已手动取消。');
                              }
                          } else if (msg === 'Failed to fetch') {
                              msg = translateMessage('连接异常中断 (耗时 {seconds}秒)。\n这不是前端代码设定的超时(30分钟)，而是您的浏览器或网络环境(如代理/Nginx)强制断开了连接。\n\n由于无法修改后端保存文件，此音频已丢失。\n建议：尝试精简音色描述以减少生成时间。', { seconds: Math.round(duration) });
                          }
                          alert(translateMessage("生成音色失败: {0}", { 0: msg }));
                      } finally {
                          if (pendingVoiceAssetId) pendingAssetIds.delete(pendingVoiceAssetId);
                          clearTimeout(timeoutId);
                          char.isGeneratingVoice = false;
                          delete char.abortController;
                          activeScriptTasks--;
                      }
                  };


                  const uploadLibraryFile = async (file, kind, formRef, applySaved) => {
                      if (hasActiveMediaTask()) return alert(translateMessage('storage.busy'));
                      const store = activeAssetStore;
                      const projectId = activeProjectId.value;
                      const form = formRef.value;
                      activeScriptTasks++;
                      try {
                          const saved = await store.put(file, { projectId, kind });
                          if (isWorkspaceUnmounted || store !== activeAssetStore || projectId !== activeProjectId.value ||
                              formRef.value !== form) {
                              await store.remove(saved.id);
                              return;
                          }
                          applySaved(saved, form);
                          triggerAutoSave();
                      } finally {
                          activeScriptTasks--;
                      }
                  };

                  const handleTimbreFileUpload = async (event) => {
                      const file = event.target.files[0];
                      if (file) {
                          try {
                              await uploadLibraryFile(file, 'voice', timbreForm, (saved, form) => {
                                  form.assetId = saved.id;
                                  const extension = file.name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] || '.wav';
                                  form.refPath = `unitale_${saved.id}${extension}`;
                                  form.originalFileName = file.name;
                                  timbreFile.value = file;
                              });
                          } catch (error) {
                              console.error('Failed to save voice reference:', error);
                              alert(translateMessage('保存音色失败: {0}', { 0: error.message }));
                          }
                      }
                      event.target.value = ''; // Reset file input
                  };

                  // --- 音色库管理逻辑 ---
                  const saveTimbre = async () => {
                      if (!timbreForm.value.name || !timbreForm.value.refPath) {
                          return alert(translateMessage("请填写音色名称并选择一个参考音频文件"));
                      }

                      // A file MUST be selected when creating a NEW timbre.
                      if (!isEditingTimbre.value && !timbreFile.value) {
                          return alert(translateMessage("创建新音色时，必须选择一个参考音频文件。"));
                      }

                      const filename = timbreForm.value.refPath;

                      // 确定 ID (如果是新建，提前生成 ID 以便保存文件到本地存储)
                      let targetId = timbreForm.value.id;
                      if (!targetId) {
                          targetId = Date.now().toString();
                      }

                      try {
                          const newTimbreData = { ...timbreForm.value, id: targetId };

                          // After a potential upload, save the metadata.
                          if (isEditingTimbre.value) {
                              collectOrphansAfterSave = true;
                              const index = timbres.value.findIndex(c => c.id === targetId);
                              if (index !== -1) {
                                  replaceVoiceReference(timbres.value[index].refPath, newTimbreData.refPath, newTimbreData.assetId);
                                  timbres.value[index] = newTimbreData;
                              }
                          } else {
                              timbres.value.push(newTimbreData);
                          }
                          // saveTimbresToLocal(); // 不再持久化到 localStorage
                          resetTimbreForm();

                      } catch (e) {
                          console.error("保存音色时出错:", e);
                          alert(translateMessage("保存音色失败: {0}", { 0: e.message }));
                      }
                  };

                  const editTimbre = (timbre) => {
                      timbreForm.value = { ...timbre };
                      isEditingTimbre.value = true;
                      timbreFile.value = null; // Important: reset file on edit start
                  };

                  const deleteTimbre = async (id) => {
                      if (!confirm(translateMessage("确定删除此音色吗？"))) return;
                      collectOrphansAfterSave = true;
                      timbres.value = timbres.value.filter(c => c.id !== id);
                      // saveTimbresToLocal();
                      if (selectedTimbreId.value === id) selectedTimbreId.value = '';
                  };

                  const resetTimbreForm = () => {
                      timbreForm.value = { id: '', name: '', description: '', refPath: '' };
                      isEditingTimbre.value = false;
                      timbreFile.value = null; // Reset the stored file
                  };

                  // --- 音效库管理逻辑 ---
                  // 移除 saveSfxToLocal

                  const saveSfx = async () => {
                      if (!sfxForm.value.name || !sfxForm.value.filename) {
                          return alert(translateMessage("请填写音效名称和文件路径"));
                      }

                      try {
                          if (isEditingSfx.value) {
                              collectOrphansAfterSave = true;
                              const index = sfxLibrary.value.findIndex(s => s.id === sfxForm.value.id);
                              if (index !== -1) sfxLibrary.value[index] = { ...sfxForm.value };
                          } else {
                              sfxLibrary.value.push({ ...sfxForm.value, id: Date.now().toString(), enabled: true });
                          }
                          // saveSfxToLocal();
                          resetSfxForm();
                      } catch (e) {
                          alert(translateMessage("保存音效失败: {0}", { 0: e.message }));
                      }
                  };

                  const editSfx = (sfx) => {
                      sfxForm.value = { trimStart: 0, trimEnd: 1, volume: 1.0, ...sfx };
                      isEditingSfx.value = true;
                  };

                  const deleteSfx = (id) => {
                      if (!confirm(translateMessage("确定删除？"))) return;
                      collectOrphansAfterSave = true;
                      sfxLibrary.value = sfxLibrary.value.filter(s => s.id !== id);
                  };

                  const resetSfxForm = () => {
                      sfxForm.value = { id: '', name: '', description: '', filename: '', assetId: '', trimStart: 0, trimEnd: 1, volume: 0.3 };
                      isEditingSfx.value = false;
                  };

                  const handleSfxFileUpload = async (event) => {
                      const file = event.target.files[0];
                      if (file) {
                          try {
                              await uploadLibraryFile(file, 'sfx', sfxForm, (saved, form) => {
                                  form.assetId = saved.id;
                                  form.filename = file.name;
                                  form.trimStart = 0;
                                  form.trimEnd = 1;
                                  form.volume = 0.3;
                              });
                          } catch (error) {
                              console.error('Failed to save sound effect:', error);
                              alert(translateMessage('保存音效失败: {0}', { 0: error.message }));
                          }
                      }
                      event.target.value = '';
                  };

                  // --- BGM库管理逻辑 ---
                  const saveBgm = async () => {
                      if (!bgmForm.value.name || !bgmForm.value.filename) {
                          return alert(translateMessage("请填写 BGM 名称和文件路径"));
                      }

                      try {
                          if (isEditingBgm.value) {
                              collectOrphansAfterSave = true;
                              const index = bgmLibrary.value.findIndex(s => s.id === bgmForm.value.id);
                              if (index !== -1) bgmLibrary.value[index] = { ...bgmForm.value };
                          } else {
                              bgmLibrary.value.push({ ...bgmForm.value, id: Date.now().toString(), enabled: true });
                          }
                          resetBgmForm();
                      } catch (e) {
                          alert(translateMessage("保存 BGM 失败: {0}", { 0: e.message }));
                      }
                  };

                  const editBgm = (bgm) => {
                      bgmForm.value = { trimStart: 0, trimEnd: 1, volume: 1.0, ...bgm };
                      isEditingBgm.value = true;
                  };

                  const deleteBgm = (id) => {
                      if (!confirm(translateMessage("确定删除？"))) return;
                      collectOrphansAfterSave = true;
                      bgmLibrary.value = bgmLibrary.value.filter(s => s.id !== id);
                  };

                  const resetBgmForm = () => {
                      bgmForm.value = { id: '', name: '', description: '', filename: '', assetId: '', trimStart: 0, trimEnd: 1, volume: 0.3 };
                      isEditingBgm.value = false;
                  };

                  const handleBgmFileUpload = async (event) => {
                      const file = event.target.files[0];
                      if (file) {
                          try {
                              await uploadLibraryFile(file, 'bgm', bgmForm, (saved, form) => {
                                  form.assetId = saved.id;
                                  form.filename = file.name;
                                  form.trimStart = 0;
                                  form.trimEnd = 1;
                                  form.volume = 0.3;
                              });
                          } catch (error) {
                              console.error('Failed to save background music:', error);
                              alert(translateMessage('保存 BGM 失败: {0}', { 0: error.message }));
                          }
                      }
                      event.target.value = '';
                  };

                  // --- 滤波器库管理逻辑 ---
                  const saveFilter = () => {
                      if (!filterForm.value.name) return alert(translateMessage("请填写滤波器名称"));

                      const newFilter = { ...filterForm.value };
                      // Ensure numbers
                      newFilter.frequency = Number(newFilter.frequency);
                      newFilter.Q = Number(newFilter.Q);
                      newFilter.gain = Number(newFilter.gain);

                      if (isEditingFilter.value) {
                          const index = filterLibrary.value.findIndex(f => f.id === filterForm.value.id);
                          if (index !== -1) filterLibrary.value[index] = newFilter;
                      } else {
                          filterLibrary.value.push({ ...newFilter, id: Date.now().toString(), enabled: true });
                      }
                      resetFilterForm();
                  };

                  const editFilter = (filter) => {
                      filterForm.value = { ...filter };
                      isEditingFilter.value = true;
                  };

                  const deleteFilter = (id) => {
                      if (!confirm(translateMessage("确定删除此滤波器？"))) return;
                      filterLibrary.value = filterLibrary.value.filter(f => f.id !== id);
                  };

                  const resetFilterForm = () => {
                      filterForm.value = { id: '', name: '', description: '', type: 'lowpass', frequency: 1000, Q: 1, gain: 0 };
                      isEditingFilter.value = false;
                  };

                  // --- 情绪预设管理逻辑 ---
                  // 移除 saveEmotionPresetsToLocal

                  const saveEmotion = () => {
                      if (!emotionForm.value.name) return alert(translateMessage("请填写情绪名称"));
                      if (isSystemEmotion(emotionForm.value.name)) return alert(translateMessage("无法修改或覆盖系统预设情绪"));
                      if (isEditingEmotion.value) {
                          const index = emotionPresets.value.findIndex(e => e.id === emotionForm.value.id);
                          if (index !== -1) emotionPresets.value[index] = { ...emotionForm.value };
                      } else {
                          emotionPresets.value.push({ ...emotionForm.value, id: Date.now().toString(), enabled: true });
                      }
                      // saveEmotionPresetsToLocal();
                      resetEmotionForm();
                  };

                  const editEmotion = (emo) => {
                      emotionForm.value = { ...emo };
                      isEditingEmotion.value = true;
                  };

                  const deleteEmotion = (id) => {
                      if (!confirm(translateMessage("确定删除？"))) return;
                      emotionPresets.value = emotionPresets.value.filter(e => e.id !== id);
                      // saveEmotionPresetsToLocal();
                  };

                  const resetEmotionForm = () => {
                      emotionForm.value = { id: '', name: '', vector: [0, 0, 0, 0, 0, 0, 0, 0] };
                      isEditingEmotion.value = false;
                  };

                  const resetEmotionsToDefault = () => {
                      if (!confirm(translateMessage("确定要重置所有情绪预设为默认值吗？这将清除自定义的情绪。"))) return;
                      emotionPresets.value = [...SYSTEM_EMOTIONS];
                      // saveEmotionPresetsToLocal();
                  };

                  const availableRoles = computed(() => {
                      const roles = new Set(characters.value.map(c => c.name));
                      return Array.from(roles);
                  });

                  // --- 拖拽与排序逻辑 ---
                  const draggingIndex = ref(-1);
                  const moveLineUp = (index) => {
                      if (index <= 0) return;
                      const item = scriptLines.value.splice(index, 1)[0];
                      scriptLines.value.splice(index - 1, 0, item);
                  };
                  const moveLineDown = (index) => {
                      if (index >= scriptLines.value.length - 1) return;
                      const item = scriptLines.value.splice(index, 1)[0];
                      scriptLines.value.splice(index + 1, 0, item);
                  };

                  const toggleLineSelection = (index, event) => {
                      if (event) {
                          // 如果点击的是交互式控件（输入框、按钮、下拉框等）或其内部元素，则不切换选中状态
                          const interactive = event.target.closest('input, select, textarea, button, label, a');
                          if (interactive) return;
                      }
                      if (selectedLineIndex.value === index) {
                          selectedLineIndex.value = -1;
                      } else {
                          selectedLineIndex.value = index;
                      }
                  };

                  let dialogueSource = null;
                  let releaseDialogueBuffer = () => {};
                  let sfxSources = [];
                  const isAuditioningId = ref(null);

                  // Helper for distortion
                  const makeDistortionCurve = (amount) => {
                      const k = typeof amount === 'number' ? amount : 50;
                      const n_samples = 44100;
                      const curve = new Float32Array(n_samples);
                      const deg = Math.PI / 180;
                      for (let i = 0; i < n_samples; ++i) {
                          const x = (i * 2) / n_samples - 1;
                          curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
                      }
                      return curve;
                  };

                  const intensityMap = {
                      "微弱": 0.2,
                      "稍弱": 0.35,
                      "中等": 0.5,
                      "较强": 0.75,
                      "强烈": 1.0
                  };

                  const generateLineAudio = async (line, externalSignal = null) => {
                      // This button is a toggle. If the line is already generating, this aborts it.
                      if (line.isGenerating) {
                          if (line.abortController) {
                              line.abortController.abort();
                          }
                          return; // The finally block of the original call will handle cleanup.
                      }

                      if (!currentTtsConfig.value) {
                          alert(translateMessage("请先在 TTS 配置中心选择一个 TTS 服务"));
                          return;
                      }

                      const taskScriptId = currentScriptId.value;
                      const taskProjectId = activeProjectId.value;
                      const taskAssetStore = activeAssetStore;
                      activeScriptTasks++;
                      line.isGenerating = true;
                      const controller = new AbortController();
                      line.abortController = controller;
                      const internalSignal = controller.signal;

                      // Link external signal if provided (for batch abort)
                      const handleExternalAbort = () => controller.abort();
                      externalSignal?.addEventListener('abort', handleExternalAbort);

                      try {
                          const char = characters.value.find(c => c.name === line.role);
                          if (!char || !char.voiceFile) {
                              throw new Error(translateMessage("角色 \"{0}\" 未绑定音色文件路径。\n\n请在左侧的角色列表中为该角色选择一个音色文件，或手动输入路径。", { 0: line.role }));
                          }

                          let finalVector = [0, 0, 0, 0, 0, 0, 0, 0];
                          const preset = emotionPresets.value.find(e => e.name === line.emotion);
                          if (preset && preset.vector) {
                              if (isSystemEmotion(line.emotion)) {
                                  const intensityVal = intensityMap[line.intensity] || 0.5;
                                  finalVector = preset.vector.map(v => v * intensityVal);
                              } else {
                                  finalVector = preset.vector;
                              }
                          }

                          const payload = {
                              text: line.text,
                              audio_path: char.voiceFile,
                              emo_vector: finalVector
                          };

                          const selectedTimbre = timbres.value.find(item => item.refPath === char.voiceFile);
                          if (selectedTimbre) char.voiceAssetId = selectedTimbre.assetId || '';

                          const cfg = currentTtsConfig.value;
                          let baseUrl = cfg.baseUrl.trim().replace(/\/+$/, '');
                          if (baseUrl.endsWith('/v1')) baseUrl = baseUrl.slice(0, -3);

                          let voiceFile = null;
                          if (char.voiceAssetId) {
                              const voiceBlob = await taskAssetStore.get(char.voiceAssetId);
                              if (voiceBlob) voiceFile = new File([voiceBlob], char.voiceFile, { type: voiceBlob.type });
                          }
                          if (voiceFile) {
                              try {
                                  const checkUrl = `${baseUrl}/v1/check/audio?file_name=${encodeURIComponent(char.voiceFile)}`;
                                  const checkRes = await requestService(checkUrl, { signal: internalSignal });
                                  let exists = false;
                                  if (checkRes.ok) {
                                      exists = (await checkRes.json()).exists;
                                  }
                                  if (!exists) {
                                      const formData = new FormData();
                                      formData.append('audio', voiceFile, char.voiceFile);
                                      formData.append('full_path', char.voiceFile);
                                      await requestService(`${baseUrl}/v1/upload_audio`, { method: 'POST', body: formData, signal: internalSignal });
                                  }
                              } catch (e) {
                                  if (e.name !== 'AbortError') console.warn('自动上传音色文件失败:', e);
                                  else throw e; // Propagate abort
                              }
                          }

                          const synthRes = await requestService(`${baseUrl}/v2/synthesize`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(payload),
                              signal: internalSignal
                          });

                          if (!synthRes.ok) {
                              const errText = await synthRes.text();
                              throw new Error(translateMessage("语音合成失败: {0}", { 0: errText }));
                          }

                          const blob = await synthRes.blob();
                          const saved = await taskAssetStore.put(blob, { projectId: taskProjectId, kind: 'dialogue' });
                          if (isWorkspaceUnmounted || !scriptLines.value.includes(line) || taskScriptId !== currentScriptId.value || taskProjectId !== activeProjectId.value) {
                              await taskAssetStore.remove(saved.id);
                              return;
                          }
                          if (line.audioAssetId) collectOrphansAfterSave = true;
                          releaseLineMedia(taskScriptId, line);
                          line.audioAssetId = saved.id;
                          const audioUrl = objectUrls.create(mediaOwner(taskScriptId, line, 'audioUrl'), blob);
                          line.audioUrl = audioUrl;
                          line.trimStart = 0;
                          line.trimEnd = 1;
                          await saveProjectToDB();

                      } catch (e) {
                          // Don't show alert for abort errors, just log and re-throw
                          if (e.name !== 'AbortError') {
                              alert(e.message);
                              console.error(e);
                          }
                          throw e; // Re-throw so the caller (e.g., generateAllLines) knows about the failure.
                      } finally {
                          line.isGenerating = false;
                          delete line.abortController;
                          externalSignal?.removeEventListener('abort', handleExternalAbort);
                          activeScriptTasks--;
                      }
                  };

                                  let batchAbortController = null;

                                  const generateAllLines = async () => {

                                      if (isGeneratingAll.value) {

                                          if (batchAbortController) {

                                              batchAbortController.abort();

                                          }

                                          return;

                                      }



                                      const startIndex = selectedLineIndex.value !== -1 ? selectedLineIndex.value : 0;

                                      const linesToCheck = scriptLines.value.slice(startIndex);



                                      // Pre-flight check on lines that will be processed

                                      const linesToProcess = linesToCheck.filter(l => l.type === 'dialogue' && !l.audioAssetId);

                                      for (const line of linesToProcess) {

                                          const char = characters.value.find(c => c.name === line.role);

                                          if (!char || (!char.voiceFile && !char.voiceAssetId)) {

                                              const lineIndex = scriptLines.value.findIndex(l => l.id === line.id);

                                              alert(translateMessage("一键生成已终止。\n\n原因：第 {0} 行台词的角色（{1}）没有绑定音源。", { 0: lineIndex + 1, 1: line.role }));

                                              return;

                                          }

                                      }



                                      const dialogueCount = linesToProcess.length;

                                      if (dialogueCount === 0) {

                                          alert(translateMessage("没有需要生成的台词音频。"));

                                          return;

                                      }



                                      const confirmMsg = startIndex > 0

                                          ? translateMessage('即将从第 {start} 行（选中行）开始，为后续 {count} 条【未生成】的台词生成音频。确定继续吗？', { start: startIndex + 1, count: dialogueCount })

                                          : translateMessage('即将为全部 {count} 条【未生成】的台词生成音频。确定继续吗？', { count: dialogueCount });



                                      if (!confirm(confirmMsg)) return;



                                      isGeneratingAll.value = true;

                                      batchAbortController = new AbortController();

                                      const batchSignal = batchAbortController.signal;

                                      let failedCount = 0;



                                      try {

                                          // Iterate through the original slice to maintain order, but only process what's needed.

                                          for (const line of linesToCheck) {

                                              if (batchSignal.aborted) break;



                                              if (line.type === 'dialogue' && !line.audioAssetId) {

                                                  try {

                                                      await generateLineAudio(line, batchSignal);

                                                  } catch (e) {

                                                      if (e.name !== 'AbortError') {

                                                          console.error(`Error generating line for role ${line.role}:`, e);

                                                          failedCount++;

                                                      }

                                                  }

                                              }

                                          }



                                          if (batchSignal.aborted) {

                                              alert(translateMessage("批量生成已停止。"));

                                          } else if (failedCount > 0) {

                                              alert(translateMessage("一键生成完成，但有 {0} 条台词生成失败。请检查控制台或单独重新生成失败的台词。", { 0: failedCount }));

                                          } else {

                                              await saveProjectToDB();

                                              alert(translateMessage("批量生成完成！"));

                                          }

                                      } catch (e) {

                                          console.error("生成全部音频时发生意外错误:", e);

                                          alert(translateMessage("生成过程中出现未知错误，详情请查看控制台。"));

                                      } finally {

                                          isGeneratingAll.value = false;

                                          batchAbortController = null;

                                      }

                                  };



                                  const clearAllGeneratedAudio = async () => {

                                      const linesWithAudio = scriptLines.value.filter(l => l.audioAssetId);

                                      if (linesWithAudio.length === 0) {

                                          return alert(translateMessage("没有已生成的音频可以清除。"));

                                      }

                                      if (!confirm(translateMessage("确定要清除所有 {0} 条已生成的音频吗？此操作不可撤销。", { 0: linesWithAudio.length }))) {

                                          return;

                                      }



                                      const results = await Promise.allSettled(linesWithAudio.map(line => clearLineAudio(line)));
                                      const failures = results.filter(result => result.status === 'rejected');
                                      if (failures.length) {
                                          alert(translateMessage('部分音频清除失败，共 {count} 条。', { count: failures.length }));
                                      } else {
                                          alert(translateMessage("所有已生成的音频已被清除。"));
                                      }

                                  };

                  const playLineAudio = (line, stopPreviousSfx = true) => {
                      return new Promise(async (resolve, reject) => {
                          try {
                              // 1. Resume AudioContext if it's suspended
                              if (audioContext.state === 'suspended') {
                                  await audioContext.resume();
                              }

                              // 2. Stop anything currently playing
                              if (dialogueSource) {
                                  dialogueSource.onended = null; // Prevent onended from firing on manual stop
                                  dialogueSource.stop();
                                  dialogueSource = null;
                                  releaseDialogueBuffer();
                              }

                              if (playbackAnimationFrame) {
                                  cancelAnimationFrame(playbackAnimationFrame);
                                  playbackAnimationFrame = null;
                              }

                              if (stopPreviousSfx) {
                                  sfxSources.forEach(source => { try { source.stop(); } catch (e) { } });
                                  sfxSources = [];
                              }

                              // If it was a stop request (clicking the same line in manual mode)
                              if (isAuditioningId.value === line.id) {
                                  isAuditioningId.value = null;
                                  return resolve();
                              }

                              if (!line.audioAssetId) return resolve(); // Resolve silently if no audio

                              isAuditioningId.value = line.id;

                              // 3. Prepare loading promises
                              const loadSfx = async () => {
                                  if (!line.sfx || line.sfx.length === 0) return [];
                                  const promises = line.sfx.map(async (sfxItem) => {
                                      const sfxLibItem = sfxLibrary.value.find(s => s.id === sfxItem.sfxId);
                                      if (sfxLibItem && (sfxLibItem.assetId || sfxLibItem.filename)) {
                                          const buf = await loadAudioBuffer(sfxLibItem.assetId ? `asset:${sfxLibItem.assetId}` : sfxLibItem.filename);
                                          if (buf) return {
                                              buffer: buf,
                                              item: sfxItem,
                                              libVolume: sfxLibItem.volume ?? 1.0,
                                              trimStart: sfxLibItem.trimStart ?? 0,
                                              trimEnd: sfxLibItem.trimEnd ?? 1
                                          };
                                      }
                                      return null;
                                  });
                                  const results = await Promise.all(promises);
                                  return results.filter(r => r !== null);
                              };

                              const timingInfo = await getDialogueTimingInfo(line);
                              if (!timingInfo) {
                                  isAuditioningId.value = null;
                                  return resolve();
                              }
                              const { trimStart, trimEnd, processedBuffer } = timingInfo;
                              releaseDialogueBuffer = decodedCache.pinBuffer(processedBuffer);
                              const processedDuration = processedBuffer.duration;
                              const sfxBuffers = await loadSfx();
                              const trimSpan = Math.max(0.0001, trimEnd - trimStart);

                              const now = audioContext.currentTime + 0.05; // Slight delay for sync

                              // 6. Schedule SFX
                              sfxBuffers.forEach(({ buffer, item, libVolume, trimStart: sfxTrimStart, trimEnd: sfxTrimEnd }) => {
                                  const pos = parseFloat(item.position) || 0;
                                  const clampedPos = Math.max(0, Math.min(1, pos));
                                  const sfxTime = now + (processedDuration * clampedPos);
                                  if (Number.isFinite(sfxTime)) {
                                      const sSrc = audioContext.createBufferSource();
                                      sSrc.buffer = buffer;
                                      const sGain = audioContext.createGain();
                                      const finalSfxVol = (line.sfxVolume ?? 0.5) * (libVolume ?? 1.0);
                                      sGain.gain.setValueAtTime(finalSfxVol, now);
                                      sSrc.connect(sGain).connect(getAudioOutputNode());

                                      const sOffset = buffer.duration * sfxTrimStart;
                                      const sDuration = buffer.duration * (sfxTrimEnd - sfxTrimStart);
                                      sSrc.start(sfxTime, sOffset, sDuration);

                                      sfxSources.push(sSrc);
                                      sSrc.onended = () => {
                                          const idx = sfxSources.indexOf(sSrc);
                                          if (idx > -1) sfxSources.splice(idx, 1);
                                      };
                                  }
                              });

                              // 7. Play dialogue from processed buffer
                              const char = characters.value.find(c => c.name === line.role);
                              const charVol = char ? (char.volume ?? 1.0) : 1.0;
                              dialogueSource = audioContext.createBufferSource();
                              dialogueSource.buffer = processedBuffer;

                              const dialogueGain = audioContext.createGain();
                              dialogueGain.gain.setValueAtTime((line.dialogueVolume ?? 1.0) * charVol, audioContext.currentTime);

                              let lastNode = dialogueSource;
                              if (line.filterId) {
                                  const filterConfig = filterLibrary.value.find(f => f.id === line.filterId);
                                  if (filterConfig) {
                                      if (filterConfig.type === 'distortion') {
                                          const waveShaper = audioContext.createWaveShaper();
                                          waveShaper.curve = makeDistortionCurve(filterConfig.gain);
                                          waveShaper.oversample = '4x';
                                          lastNode.connect(waveShaper);
                                          lastNode = waveShaper;
                                      } else {
                                          const biquad = audioContext.createBiquadFilter();
                                          biquad.type = filterConfig.type;
                                          biquad.frequency.value = filterConfig.frequency;
                                          biquad.Q.value = filterConfig.Q;
                                          lastNode.connect(biquad);
                                          lastNode = biquad;
                                      }
                                  }
                              }
                              lastNode.connect(dialogueGain).connect(getAudioOutputNode());

                              const finishPlayback = () => {
                                  releaseDialogueBuffer();
                                  if (playbackAnimationFrame) {
                                      cancelAnimationFrame(playbackAnimationFrame);
                                      playbackAnimationFrame = null;
                                  }
                                  if (isAuditioningId.value === line.id) {
                                      isAuditioningId.value = null;
                                  }
                                  if (dialogueSource) dialogueSource = null;
                                  resolve();
                              };
                              dialogueSource.onended = finishPlayback;
                              dialogueSource.start(now, 0);

                              // 启动进度条动画
                              const updateProgress = () => {
                                  if (isAuditioningId.value !== line.id) return;
                                  const elapsed = Math.max(0, audioContext.currentTime - now);
                                  if (elapsed >= 0) {
                                      const progress = trimStart + ((elapsed / Math.max(0.0001, processedDuration)) * trimSpan);
                                      playbackProgress.value = Math.min(progress, trimEnd);
                                  } else {
                                      playbackProgress.value = trimStart;
                                  }

                                  if (audioContext.currentTime < now + processedDuration && isAuditioningId.value === line.id) {
                                      playbackAnimationFrame = requestAnimationFrame(updateProgress);
                                  } else {
                                      playbackProgress.value = trimEnd;
                                  }
                              };
                              playbackAnimationFrame = requestAnimationFrame(updateProgress);

                          } catch (e) {
                              console.error("Failed to play audio:", e);
                              releaseDialogueBuffer();
                              // alert('播放音频失败，请检查文件或网络。'); // Suppress alert for smoother UX
                              isAuditioningId.value = null;
                              resolve(); // Resolve to not block sequence
                          }
                      });
                  };

                  const clearLineAudio = async (line) => {
                      if (hasActiveMediaTask()) return alert(translateMessage('storage.busy'));
                      if (!line.audioUrl && !line.audioAssetId) return;

                      releaseLineMedia(currentScriptId.value, line);
                      line.audioAssetId = '';
                      collectOrphansAfterSave = true;
                      triggerAutoSave();
                  };

                  // --- Versioned project archive ---
                  const projectSnapshot = () => {
                      syncCurrentScriptState();
                      return createProjectSnapshot({
                          characters: characters.value,
                          scriptList: scriptList.value,
                          novels: novels.value,
                          currentScriptId: novelEditorId.value ? previousStandaloneScriptId : currentScriptId.value,
                          libraries: { sfx: sfxLibrary.value, bgm: bgmLibrary.value,
                              timbres: timbres.value, filters: filterLibrary.value,
                              emotions: emotionPresets.value }
                      });
                  };
                  const hasActiveMediaTask = () => isRestoring.value || activeScriptTasks > 0 || isAnalyzingScript.value || isGeneratingAll.value ||
                      isSequencePlaying.value || isExportingAudio.value || isGeneratingVideo.value ||
                      isExportingProject.value || characters.value.some(char => char.isGeneratingVoice) || scriptLines.value.some(line => line.isGenerating);
                  const protectedAssetIds = () => new Set([
                      ...pendingAssetIds,
                      timbreForm.value.assetId,
                      sfxForm.value.assetId,
                      bgmForm.value.assetId
                  ].filter(Boolean));
                  const downloadArchivePart = ({ name, blob }) => {
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = name;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      setTimeout(() => URL.revokeObjectURL(url), 30000);
                  };
                  const exportScriptState = async () => {
                      if (isExportingProject.value) return;
                      if (hasActiveMediaTask()) return alert(translateMessage('storage.busy'));
                      pendingArchiveParts = null;
                      hasMoreArchiveParts.value = false;
                      // The picker needs the click gesture, before the asynchronous archive work.
                      let writable = null;
                      try {
                          if (window.showSaveFilePicker) {
                              const handle = await window.showSaveFilePicker({
                                  suggestedName: `Unitale_${Date.now()}.zip`,
                                  types: [{ description: 'Unitale ZIP archive', accept: { 'application/zip': ['.zip'] } }]
                              });
                              writable = await handle.createWritable();
                          }
                      } catch (error) {
                          if (error?.name === 'AbortError') return;
                          console.warn('File picker unavailable, using download parts', error);
                      }
                      isExportingProject.value = true;
                      exportStatus.value = translateMessage('准备中...');
                      try {
                          const snapshot = projectSnapshot();
                          const refs = await activeAssetStore.list(activeProjectId.value);
                          if (writable) {
                              await exportArchiveToStream(snapshot, refs, activeAssetStore, writable);
                          } else {
                              pendingArchiveParts = exportArchiveParts(snapshot, refs, activeAssetStore);
                              const first = await pendingArchiveParts.next();
                              if (!first.done) {
                                  downloadArchivePart(first.value);
                                  const match = first.value.name.match(/part-(\d+)-of-(\d+)/);
                                  hasMoreArchiveParts.value = !!match && Number(match[1]) < Number(match[2]);
                              }
                          }
                      } catch (error) {
                          if (writable) try { await writable.abort(); } catch { /* preserve original error */ }
                          console.error(error);
                          alert(translateMessage('导出失败: {0}', { 0: error.message }));
                      } finally {
                          isExportingProject.value = false;
                          exportStatus.value = '';
                      }
                  };
                  const downloadNextArchivePart = async () => {
                      if (!pendingArchiveParts || !hasMoreArchiveParts.value || isExportingProject.value) return;
                      isExportingProject.value = true;
                      try {
                          const next = await pendingArchiveParts.next();
                          if (next.done) {
                              hasMoreArchiveParts.value = false;
                              pendingArchiveParts = null;
                              return;
                          }
                          downloadArchivePart(next.value);
                          const match = next.value.name.match(/part-(\d+)-of-(\d+)/);
                          hasMoreArchiveParts.value = !!match && Number(match[1]) < Number(match[2]);
                          if (!hasMoreArchiveParts.value) pendingArchiveParts = null;
                      } catch (error) {
                          alert(translateMessage('导出失败: {0}', { 0: error.message }));
                      } finally { isExportingProject.value = false; }
                  };

                  const applyProjectSnapshot = async snapshot => {
                      previewGeneration++;
                      for (const script of scriptList.value) releaseScriptMedia(script);
                      resetTimbreForm();
                      resetSfxForm();
                      resetBgmForm();
                      resetFilterForm();
                      selectedTimbreId.value = '';
                      selectedLineIndex.value = -1;
                      if (previewSource) {
                          try { previewSource.stop(); } catch { /* already stopped */ }
                          previewSource = null;
                          releasePreviewBuffer();
                      }
                      previewPlayingFile.value = null;
                      scriptList.value = snapshot.scriptList;
                      novels.value = snapshot.novels || [];
                      novelEditorId.value = null;
                      previousStandaloneScriptId = null;
                      currentScriptId.value = snapshot.currentScriptId;
                      sfxLibrary.value = snapshot.libraries.sfx;
                      bgmLibrary.value = snapshot.libraries.bgm;
                      timbres.value = snapshot.libraries.timbres;
                      filterLibrary.value = snapshot.libraries.filters;
                      emotionPresets.value = snapshot.libraries.emotions;
                      const active = scriptList.value.find(script => script.id === currentScriptId.value) || scriptList.value[0];
                      if (active) {
                          currentScriptId.value = active.id;
                          rawScript.value = active.data.rawScript || '';
                          scriptLines.value = active.data.scriptLines || [];
                          rawAnalysisResult.value = active.data.rawAnalysisResult || '';
                          characters.value = active.data.characters || [];
                          await hydrateScriptMedia(active).catch(error => console.warn('Media restore failed', error));
                      } else {
                          rawScript.value = '';
                          scriptLines.value = [];
                          rawAnalysisResult.value = '';
                          characters.value = snapshot.characters || [];
                      }
                      audioBufferCache.clear();
                      processedDialogueAssetCache.clear();
                      dirtyScriptIds.clear();
                      deletedScriptIds.clear();
                  };
                  const directoryModeAvailable = typeof window.showDirectoryPicker === 'function';
                  const migrateToDirectory = async () => {
                      if (!directoryModeAvailable || directoryStore) return;
                      if (hasActiveMediaTask()) return alert(translateMessage('storage.busy'));
                      let parent;
                      try { parent = await window.showDirectoryPicker({ mode: 'readwrite' }); }
                      catch (error) { if (error?.name !== 'AbortError') alert(error.message); return; }
                      if (!await ensureDirectoryPermission(parent)) return alert('无法获得目录写入权限。');
                      isExportingProject.value = true;
                      try {
                          await saveProjectToDB();
                          const snapshot = projectSnapshot();
                          const referenced = referencedAssetIds(snapshot);
                          const refs = (await indexedDbAssetStore.list(activeProjectId.value))
                              .filter(ref => referenced.has(ref.id));
                          const store = await DirectoryProjectStore.migrateFromIndexedDb(parent, snapshot, indexedDbAssetStore, refs);
                          await storeRecentDirectory(store.projectId, store.handle);
                          await setActiveWorkspace({ id: store.projectId, backend: 'directory' });
                          directoryStore = store;
                          activeAssetStore = store;
                          activeProjectId.value = store.projectId;
                          storageBackend.value = 'directory';
                          directoryName.value = store.handle.name;
                          directoryError.value = '';
                          storageAccessBlocked = false;
                          alert(`目录项目已建立：${store.handle.name}`);
                      } catch (error) {
                          console.error('Directory migration failed', error);
                          alert(translateMessage('导出失败: {0}', { 0: error.message }));
                      } finally { isExportingProject.value = false; }
                  };
                  const openDirectoryProject = async () => {
                      if (!directoryModeAvailable) return;
                      if (hasActiveMediaTask()) return alert(translateMessage('storage.busy'));
                      let handle;
                      try { handle = await window.showDirectoryPicker({ mode: 'readwrite' }); }
                      catch (error) { if (error?.name !== 'AbortError') alert(error.message); return; }
                      if (!await ensureDirectoryPermission(handle)) return alert('无法获得目录写入权限。');
                      isRestoring.value = true;
                      isExportingProject.value = true;
                      if (saveTimeout) clearTimeout(saveTimeout);
                      try {
                          if (!storageAccessBlocked) await saveProjectToDB();
                          const store = await DirectoryProjectStore.open(handle);
                          const snapshot = await store.loadProject();
                          await storeRecentDirectory(store.projectId, handle);
                          await setActiveWorkspace({ id: store.projectId, backend: 'directory' });
                          directoryStore = store;
                          activeAssetStore = store;
                          activeProjectId.value = store.projectId;
                          storageBackend.value = 'directory';
                          directoryName.value = handle.name;
                          directoryError.value = '';
                          storageAccessBlocked = false;
                          await applyProjectSnapshot(snapshot);
                      } catch (error) {
                          console.error('Open directory failed', error);
                          directoryError.value = error.message;
                          alert(translateMessage('导入失败: {0}', { 0: error.message }));
                      } finally {
                          isRestoring.value = false;
                          isExportingProject.value = false;
                      }
                  };
                  const clearLegacyDatabase = async () => {
                      if (!confirm(translateMessage('storage.legacyConfirm'))) return;
                      try {
                          await new Promise((resolve, reject) => {
                              const request = indexedDB.deleteDatabase('UnitaleDB');
                              request.onsuccess = () => resolve();
                              request.onerror = () => reject(request.error);
                              request.onblocked = () => reject(new Error('Close other tabs using the old database first'));
                          });
                          alert(translateMessage('storage.legacyCleared'));
                      } catch (error) {
                          alert(translateMessage('导入失败: {0}', { 0: error.message }));
                      }
                  };

                  const triggerImport = () => importFileRef.value?.click();
                  const handleImportFile = async (event) => {
                      const files = Array.from(event.target.files || []);
                      event.target.value = '';
                      if (!files.length) return;
                      if (hasActiveMediaTask()) return alert(translateMessage('storage.busy'));
                      if (!confirm(translateMessage('检测到完整工程文件。导入将覆盖当前的【资源库和脚本】（模型配置不会被覆盖）。确定继续吗？'))) return;
                      const oldWorkspace = { id: activeProjectId.value, backend: storageBackend.value };
                      const oldAssetStore = activeAssetStore;
                      const oldDirectoryStore = directoryStore;
                      isRestoring.value = true;
                      isExportingProject.value = true;
                      exportStatus.value = translateMessage('读取文件中...');
                      if (saveTimeout) clearTimeout(saveTimeout);
                      try {
                          await saveQueue.catch(() => {});
                          const { projectId, snapshot } = await importArchiveParts(files, indexedDbAssetStore);
                          // The complete staged project is durable before switching the active pointer.
                          await setActiveProjectId(projectId);
                          directoryStore = null;
                          activeAssetStore = indexedDbAssetStore;
                          activeProjectId.value = projectId;
                          storageBackend.value = 'indexeddb';
                          directoryName.value = '';
                          directoryError.value = '';
                          storageAccessBlocked = false;
                          await applyProjectSnapshot(snapshot);
                          let cleanupFailed = false;
                          if (oldWorkspace.backend === 'indexeddb' && oldWorkspace.id !== projectId) {
                              try {
                                  await removeWorkspaceProject(oldWorkspace.id);
                              } catch (cleanupError) {
                                  cleanupFailed = true;
                                  lastStorageError.value = cleanupError.message || String(cleanupError);
                                  console.warn('Old project cleanup failed after successful import', cleanupError);
                              }
                          }
                          alert(translateMessage('完整工程导入成功！所有资源和设置已恢复。'));
                          if (cleanupFailed) alert(`旧工程清理失败：${lastStorageError.value}`);
                      } catch (error) {
                          console.error('Project archive import failed', error);
                          if (activeProjectId.value !== oldWorkspace.id) {
                              await setActiveWorkspace(oldWorkspace);
                              activeProjectId.value = oldWorkspace.id;
                              activeAssetStore = oldAssetStore;
                              directoryStore = oldDirectoryStore;
                              storageBackend.value = oldWorkspace.backend;
                          }
                          alert(translateMessage('导入失败: {0}', { 0: error.message }));
                      } finally {
                          isRestoring.value = false;
                          isExportingProject.value = false;
                          exportStatus.value = '';
                      }
                  };

                  const triggerImportTxt = () => {
                      importTxtRef.value.click();
                  };

                  const commitNovelImport = async (fileName, parsed, selectedIndexes, includeIntro) => {
                      if (hasActiveMediaTask() || novelEditorId.value) throw new Error(translateMessage('storage.busy'));
                      const draft = buildNovelImport(fileName, parsed, new Set(selectedIndexes), includeIntro);
                      if (!draft.novel.selectedChapterIds.length) throw new Error('Select at least one chapter');
                      const projectId = activeProjectId.value;
                      const store = directoryStore;
                      activeScriptTasks++;
                      try {
                          if (saveTimeout) clearTimeout(saveTimeout);
                          saveTimeout = null;
                          await saveProjectToDB();
                          if (projectId !== activeProjectId.value || store !== directoryStore) throw new Error('Project changed during TXT import');
                          const changed = new Set(draft.scripts.map(script => script.id));
                          const data = createProjectSaveSnapshot({
                              characters: characters.value,
                              scriptList: [...scriptList.value, ...draft.scripts],
                              novels: [...novels.value, draft.novel],
                              currentScriptId: currentScriptId.value,
                              libraries: { sfx: sfxLibrary.value, bgm: bgmLibrary.value, timbres: timbres.value,
                                  filters: filterLibrary.value, emotions: emotionPresets.value }
                          }, changed);
                          if (store) await store.saveProject(data, changed);
                          else await saveWorkspaceProject(data, changed, projectId);
                          scriptList.value.push(...draft.scripts);
                          novels.value.push(draft.novel);
                          return draft.novel.id;
                      } finally {
                          activeScriptTasks--;
                      }
                  };

                  const setNovelSelection = (novelId, selectedIds) => {
                      if (novelBatch.value.running) return;
                      const novel = novels.value.find(item => item.id === novelId);
                      if (!novel) return;
                      const valid = new Set(novel.chapterIds);
                      novel.selectedChapterIds = [...new Set(selectedIds)].filter(id => valid.has(id));
                      triggerAutoSave();
                  };

                  const setNovelRoleTimbre = (novelId, roleName, timbreId, overwrite = false) => {
                      if (hasActiveMediaTask() || novelEditorId.value) throw new Error(translateMessage('storage.busy'));
                      const novel = novels.value.find(item => item.id === novelId);
                      if (!novel) throw new Error('Novel not found');
                      const role = roleName.trim();
                      const timbre = timbres.value.find(item => item.id === timbreId);
                      if (!role || (timbreId && !timbre)) throw new Error('Timbre not found');
                      syncCurrentScriptState();
                      const previous = timbres.value.find(item => item.id === novel.roleTimbreIds[role]);
                      if (timbreId) novel.roleTimbreIds[role] = timbreId;
                      else delete novel.roleTimbreIds[role];
                      for (const script of scriptList.value) {
                          if (script.novelId !== novelId) continue;
                          let changed = false;
                          for (const char of script.data.characters || []) {
                              if (char.name.trim() !== role) continue;
                              if (!overwrite && char.voiceFile && char.voiceFile !== previous?.refPath) continue;
                              char.voiceFile = timbre?.refPath || '';
                              char.voiceAssetId = timbre?.assetId || '';
                              changed = true;
                          }
                          if (changed) dirtyScriptIds.add(script.id);
                      }
                      triggerAutoSave();
                  };

                  const stopNovelBatch = () => novelBatchController?.abort();

                  const analyzeNovelBatch = async (novelId, { failedOnly = false, rerun = false } = {}) => {
                      if (hasActiveMediaTask() || novelEditorId.value) throw new Error(translateMessage('storage.busy'));
                      const novel = novels.value.find(item => item.id === novelId);
                      if (!novel) throw new Error('Novel not found');
                      const config = currentConfig.value;
                      if (!config) throw new Error('Select an LLM model first');
                      const selected = new Set(novel.selectedChapterIds);
                      const scripts = novel.chapterIds.map(id => scriptList.value.find(script => script.id === id))
                          .filter(script => script && selected.has(script.id) && script.data.rawScript.trim() &&
                              (!failedOnly || script.data.analysisError) && (rerun || !script.data.scriptLines.length));
                      if (!scripts.length) throw new Error('No chapters need analysis');
                      const projectId = activeProjectId.value;
                      const controller = new AbortController();
                      novelBatchController = controller;
                      novelBatch.value = { running: true, novelId, phase: 'analysis', current: 0, total: scripts.length, failed: 0 };
                      activeScriptTasks++;
                      const copy = value => JSON.parse(JSON.stringify(value));
                      const options = {
                          config: copy(config), promptTemplate: useCustomPrompt.value ? customPromptTemplate.value : getDefaultPromptTemplate(),
                          customPrompt: useCustomPrompt.value, bgImageCount: Math.max(0, Number(bgImageCount.value) || 0),
                          emotions: copy(emotionPresets.value), sfx: copy(sfxLibrary.value), bgm: copy(bgmLibrary.value),
                          filters: copy(filterLibrary.value), timbres: copy(timbres.value),
                          roleTimbreIds: { ...novel.roleTimbreIds }, signal: controller.signal,
                      };
                      try {
                          for (const script of scripts) {
                              if (controller.signal.aborted || activeProjectId.value !== projectId) break;
                              try {
                                  const result = await analyzeNovelChapter(script, options);
                                  if (controller.signal.aborted || activeProjectId.value !== projectId || !scriptList.value.includes(script)) break;
                                  if (script.data.scriptLines.length) {
                                      releaseScriptMedia(script);
                                      collectOrphansAfterSave = true;
                                  }
                                  script.data.rawAnalysisResult = result.rawAnalysisResult;
                                  script.data.scriptLines = result.scriptLines;
                                  script.data.characters = result.characters;
                                  delete script.data.analysisError;
                              } catch (error) {
                                  if (controller.signal.aborted || error?.name === 'AbortError') break;
                                  script.data.analysisError = error.message || String(error);
                                  novelBatch.value.failed++;
                              }
                              dirtyScriptIds.add(script.id);
                              await saveProjectToDB();
                              novelBatch.value.current++;
                          }
                      } finally {
                          novelBatch.value.running = false;
                          novelBatchController = null;
                          activeScriptTasks--;
                      }
                  };

                  const generateNovelBatch = async (novelId, { failedOnly = false, rerun = false } = {}) => {
                      if (hasActiveMediaTask() || novelEditorId.value) throw new Error(translateMessage('storage.busy'));
                      const novel = novels.value.find(item => item.id === novelId);
                      if (!novel) throw new Error('Novel not found');
                      const config = currentTtsConfig.value;
                      if (!config) throw new Error('Select a TTS service first');
                      const selected = new Set(novel.selectedChapterIds);
                      const chapters = novel.chapterIds.map(id => scriptList.value.find(script => script.id === id))
                          .filter(script => script && selected.has(script.id) && script.data.scriptLines.length);
                      const targets = chapters.flatMap(script => script.data.scriptLines
                          .filter(line => line.type === 'dialogue' && line.text?.trim() && (failedOnly || rerun || !line.audioAssetId) &&
                              (!failedOnly || line.ttsError))
                          .map(line => ({ script, line })));
                      if (!targets.length) throw new Error('No dialogue needs audio');
                      const missing = [...new Set(chapters.flatMap(script => missingNovelVoices(
                          targets.filter(target => target.script === script).map(target => target.line), script.data.characters)))];
                      if (missing.length) throw new Error(`请先绑定角色音色：${missing.join('、')}`);
                      const projectId = activeProjectId.value;
                      const store = activeAssetStore;
                      const controller = new AbortController();
                      novelBatchController = controller;
                      novelBatch.value = { running: true, novelId, phase: 'tts', current: 0, total: targets.length, failed: 0 };
                      activeScriptTasks++;
                      const copy = value => JSON.parse(JSON.stringify(value));
                      const emotions = copy(emotionPresets.value);
                      const timbreSnapshot = copy(timbres.value);
                      try {
                          for (const { script, line } of targets) {
                              if (controller.signal.aborted || activeProjectId.value !== projectId || activeAssetStore !== store) break;
                              try {
                                  const blob = await synthesizeNovelLine({ line, characters: script.data.characters,
                                      emotions, timbres: timbreSnapshot, config: copy(config), store, signal: controller.signal });
                                  if (controller.signal.aborted) break;
                                  const saved = await store.put(blob, { projectId, kind: 'dialogue' });
                                  if (controller.signal.aborted || isWorkspaceUnmounted || activeProjectId.value !== projectId ||
                                      activeAssetStore !== store || !scriptList.value.includes(script) || !script.data.scriptLines.includes(line)) {
                                      await store.remove(saved.id);
                                      break;
                                  }
                                  if (line.audioAssetId) collectOrphansAfterSave = true;
                                  releaseLineMedia(script.id, line);
                                  line.audioAssetId = saved.id;
                                  line.audioUrl = '';
                                  line.trimStart = 0;
                                  line.trimEnd = 1;
                                  delete line.ttsError;
                              } catch (error) {
                                  if (controller.signal.aborted || error?.name === 'AbortError') break;
                                  line.ttsError = error.message || String(error);
                                  novelBatch.value.failed++;
                              }
                              dirtyScriptIds.add(script.id);
                              await saveProjectToDB();
                              novelBatch.value.current++;
                          }
                      } finally {
                          novelBatch.value.running = false;
                          novelBatchController = null;
                          activeScriptTasks--;
                      }
                  };

                  const openNovelChapter = (id) => {
                      const chapter = scriptList.value.find(script => script.id === id && script.kind === 'novelChapter');
                      if (!chapter || hasActiveMediaTask() || novelEditorId.value) return false;
                      previousStandaloneScriptId = currentScriptId.value;
                      switchScript(id);
                      if (currentScriptId.value !== id) { previousStandaloneScriptId = null; return false; }
                      novelEditorId.value = id;
                      return true;
                  };

                  const closeNovelChapter = () => {
                      if (!novelEditorId.value) return true;
                      if (hasActiveMediaTask()) return false;
                      const targetId = previousStandaloneScriptId;
                      switchScript(targetId);
                      if (currentScriptId.value !== targetId) return false;
                      novelEditorId.value = null;
                      previousStandaloneScriptId = null;
                      return true;
                  };

                  const handleImportTxt = (event) => {
                      const file = event.target.files[0];
                      if (!file) return;
                      if (hasActiveMediaTask()) return alert(translateMessage('storage.busy'));
                      activeScriptTasks++;
                      const reader = new FileReader();
                      reader.onload = (e) => {
                          rawScript.value = e.target.result;
                          activeScriptTasks--;
                      };
                      reader.onerror = reader.onabort = () => { activeScriptTasks--; };
                      reader.readAsText(file);
                      event.target.value = '';
                  };

                  const collectSfxEvents = async dialogueEvents => {
                      const effects = [];
                      for (const evt of dialogueEvents) {
                          for (const effect of evt.line.sfx || []) {
                              const item = sfxLibrary.value.find(value => value.id === effect.sfxId);
                              const path = item?.assetId ? `asset:${item.assetId}` : item?.filename;
                              if (!path) continue;
                              const sound = await loadAudioBuffer(path);
                              if (!sound) continue;
                              const trimStart = Math.max(0, Math.min(1, Number(item.trimStart ?? 0)));
                              const trimEnd = Math.max(trimStart, Math.min(1, Number(item.trimEnd ?? 1)));
                              const position = Math.max(0, Math.min(1, Number(effect.position) || 0));
                              const start = evt.time + evt.duration * position;
                              const duration = sound.duration * (trimEnd - trimStart);
                              if (duration <= 0) continue;
                              effects.push({ start, end: start + duration, sourceOffset: sound.duration * trimStart,
                                  path, volume: (evt.line.sfxVolume ?? 0.5) * (item.volume ?? 1) });
                          }
                      }
                      return effects;
                  };

                  // --- Bounded WAV export: render at most two minutes at a time ---
                  const exportAudio = async () => {
                      const dialogueLines = scriptLines.value.filter(line => line.type === 'dialogue');
                      if (!dialogueLines.length) return alert(translateMessage('脚本为空'));
                      if (dialogueLines.some(line => !line.audioAssetId) &&
                          !confirm(translateMessage('部分台词尚未生成音频，导出时将被跳过。确定继续吗？'))) return;

                      let writable = null;
                      try {
                          if (window.showSaveFilePicker) {
                              const handle = await window.showSaveFilePicker({
                                  suggestedName: `Unitale_${Date.now()}.wav`,
                                  types: [{ description: 'WAV audio', accept: { 'audio/wav': ['.wav'] } }]
                              });
                              writable = await handle.createWritable();
                          }
                      } catch (error) {
                          if (error?.name === 'AbortError') return;
                          console.warn('Streaming file picker unavailable; downloading numbered WAV parts', error);
                      }
                      isExportingAudio.value = true;
                      try {
                          const events = [];
                          const bgmSegments = [];
                          let currentTime = 0;
                          let currentBgm = null;
                          for (const line of scriptLines.value) {
                              if (line.type === 'bgm') {
                                  if (line.action === 'play') {
                                      if (currentBgm) bgmSegments.push({ ...currentBgm, end: currentTime });
                                      currentBgm = { id: line.bgmId, start: currentTime, volume: line.volume };
                                  } else if (line.action === 'stop' && currentBgm) {
                                      bgmSegments.push({ ...currentBgm, end: currentTime });
                                      currentBgm = null;
                                  }
                              } else if (line.type === 'dialogue') {
                                  if (line.audioAssetId) {
                                      const timing = await getDialogueTimingInfo(line);
                                      if (timing) {
                                          currentTime += 0.05;
                                          events.push({ line, time: currentTime, duration: timing.effectiveDuration });
                                          currentTime += timing.effectiveDuration;
                                      }
                                  }
                                  currentTime += Number(line.break_duration) || 0;
                              }
                          }
                          const sfxEvents = await collectSfxEvents(events);
                          const totalDuration = totalTimelineDuration(currentTime, sfxEvents, EXPORT_TAIL_PADDING_SEC);
                          if (currentBgm) bgmSegments.push({ ...currentBgm, end: totalDuration });
                          const sampleRate = 44100;
                          const totalFrames = Math.ceil(totalDuration * sampleRate);
                          const framesPerPart = AUDIO_EXPORT_PART_SECONDS * sampleRate;
                          const canStreamSingle = writable && totalFrames * 4 <= WAV_MAX_DATA_BYTES;
                          if (writable && !canStreamSingle) {
                              await writable.abort();
                              writable = null;
                          }
                          if (canStreamSingle) await writable.write(makeWavHeader(totalFrames, sampleRate, 2));

                          const renderPart = async (startFrame, frameCount) => {
                              const start = startFrame / sampleRate;
                              const end = (startFrame + frameCount) / sampleRate;
                              const ctx = new OfflineAudioContext(2, frameCount, sampleRate);
                              const scheduleFilter = (source, line, gain) => {
                                  let last = source;
                                  if (line.filterId) {
                                      const setting = filterLibrary.value.find(item => item.id === line.filterId);
                                      if (setting) {
                                          if (setting.type === 'distortion') {
                                              const node = ctx.createWaveShaper();
                                              node.curve = makeDistortionCurve(setting.gain);
                                              node.oversample = '4x';
                                              last.connect(node);
                                              last = node;
                                          } else {
                                              const node = ctx.createBiquadFilter();
                                              node.type = setting.type;
                                              node.frequency.value = setting.frequency;
                                              node.Q.value = setting.Q;
                                              last.connect(node);
                                              last = node;
                                          }
                                      }
                                  }
                                  last.connect(gain).connect(ctx.destination);
                              };
                              for (const seg of bgmSegments) {
                                  if (seg.end <= start || seg.start >= end) continue;
                                  const item = bgmLibrary.value.find(value => value.id === seg.id);
                                  if (!item?.assetId && !item?.filename) continue;
                                  const buffer = await loadAudioBuffer(item.assetId ? `asset:${item.assetId}` : item.filename);
                                  if (!buffer) continue;
                                  const overlapStart = Math.max(start, seg.start);
                                  const overlapEnd = Math.min(end, seg.end);
                                  const src = ctx.createBufferSource();
                                  src.buffer = buffer;
                                  src.loop = true;
                                  src.loopStart = buffer.duration * (item.trimStart ?? 0);
                                  src.loopEnd = buffer.duration * (item.trimEnd ?? 1);
                                  const loopLength = Math.max(0.01, src.loopEnd - src.loopStart);
                                  const offset = src.loopStart + ((overlapStart - seg.start) % loopLength);
                                  const gain = ctx.createGain();
                                  const volume = (seg.volume ?? 1) * (item.volume ?? 1);
                                  const envelope = t => volume * Math.max(0, Math.min(1, (t - seg.start) / 2, (seg.end - t) / 2));
                                  gain.gain.setValueAtTime(envelope(overlapStart), overlapStart - start);
                                  const knots = [seg.start + 2, seg.end - 2, overlapEnd]
                                      .filter(t => t > overlapStart && t <= overlapEnd).sort((x, y) => x - y);
                                  for (const knot of knots) gain.gain.linearRampToValueAtTime(envelope(knot), knot - start);
                                  src.connect(gain).connect(ctx.destination);
                                  src.start(overlapStart - start, offset);
                                  src.stop(overlapEnd - start);
                              }
                              for (const evt of events) {
                                  const clip = clipAudioEvent({ start: evt.time, end: evt.time + evt.duration }, start, end);
                                  if (!clip) continue;
                                  const buffer = await getProcessedDialogueBuffer(evt.line);
                                  if (!buffer) continue;
                                  const src = ctx.createBufferSource();
                                  src.buffer = buffer;
                                  const gain = ctx.createGain();
                                  const character = characters.value.find(value => value.name === evt.line.role);
                                  gain.gain.value = (evt.line.dialogueVolume ?? 1) * (character?.volume ?? 1);
                                  scheduleFilter(src, evt.line, gain);
                                  src.start(clip.start - start, clip.offset, clip.duration);
                              }
                              for (const effect of sfxEvents) {
                                  const clip = clipAudioEvent(effect, start, end);
                                  if (!clip) continue;
                                  const sound = await loadAudioBuffer(effect.path);
                                  if (!sound) continue;
                                  const sfxSource = ctx.createBufferSource();
                                  sfxSource.buffer = sound;
                                  const sfxGain = ctx.createGain();
                                  sfxGain.gain.value = effect.volume;
                                  sfxSource.connect(sfxGain).connect(ctx.destination);
                                  sfxSource.start(clip.start - start, clip.offset, clip.duration);
                              }
                              return bufferToWave(await ctx.startRendering(), frameCount);
                          };
                          const ranges = frameRanges(totalFrames, framesPerPart);
                          const count = ranges.length;
                          for (let part = 0; part < count; part++) {
                              const { start: startFrame, count: frameCount } = ranges[part];
                              const blob = await renderPart(startFrame, frameCount);
                              if (canStreamSingle) {
                                  await writable.write(blob.slice(44));
                              } else {
                                  downloadArchivePart({ name: `Unitale_${currentScriptId.value}_${String(part + 1).padStart(3, '0')}-of-${String(count).padStart(3, '0')}.wav`, blob });
                              }
                          }
                          if (canStreamSingle) await writable.close();
                      } catch (error) {
                          if (writable) try { await writable.abort(); } catch { /* keep rendering error */ }
                          console.error(error);
                          alert(translateMessage('导出失败: {0}', { 0: error.message }));
                      } finally {
                          isExportingAudio.value = false;
                      }
                  };

                  const exportSRT = async () => {
                      const dialogueLines = scriptLines.value.filter(l => l.type === 'dialogue');
                      if (dialogueLines.length === 0) return alert(translateMessage("脚本为空"));

                      if (dialogueLines.some(l => !l.audioAssetId)) {
                          if (!confirm(translateMessage("部分台词尚未生成音频，导出字幕时时间轴可能不准确（将跳过未生成音频的行）。确定继续吗？"))) return;
                      }

                      isExportingAudio.value = true; // 复用 loading 状态

                      try {
                          // Keep only scalar durations so processed buffers can be evicted during long exports.
                          const audioMap = new Map();
                          for (const line of dialogueLines) {
                              if (line.audioAssetId) {
                                  const timingInfo = await getDialogueTimingInfo(line);
                                  if (timingInfo) audioMap.set(line.id, timingInfo.effectiveDuration);
                              }
                          }

                          let srtContent = '';
                          let currentTime = 0;
                          let counter = 1;

                          const formatTime = (seconds) => {
                              const date = new Date(0);
                              date.setMilliseconds(seconds * 1000);
                              const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
                              const mm = String(date.getUTCMinutes()).padStart(2, '0');
                              const ss = String(date.getUTCSeconds()).padStart(2, '0');
                              const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
                              return `${hh}:${mm}:${ss},${ms}`;
                          };

                          // 辅助函数：智能切割长字幕
                          const splitLongText = (text) => {
                              if (!text) return [];

                              // 1. 去除句末的逗号和句号 (保留问号感叹号等)
                              let processed = text.replace(/[，。,.]\s*$/, '');

                              // 2. 如果文本较短，直接返回
                              if (processed.length <= 25) return [processed];

                              // 3. 优先按标点符号切割
                              // 句号(。)和点(.)：作为分隔符消耗掉 (不保留在句末)
                              // 问号、感叹号等：保留在上一句
                              // 逗号：不作为主分隔符，保留在句中 (除非后续长度强制切割)
                              const parts = processed.split(/[。.]\s*|(?<=[！？；：!?])\s*/).filter(p => p.trim().length > 0);

                              const finalParts = [];
                              for (const p of parts) {
                                  // 3. 如果切割后的片段依然过长 (> 30字符)，强制按长度再次切割
                                  if (p.length > 30) {
                                      let remaining = p;
                                      while (remaining.length > 0) {
                                          let cutIndex = 25;
                                          if (remaining.length <= 25) {
                                              cutIndex = remaining.length;
                                          }
                                          else {
                                              // 尝试在逗号或空格处断句
                                              // 优先找逗号
                                              const lastComma = Math.max(remaining.lastIndexOf('，', 25), remaining.lastIndexOf(',', 25));
                                              const lastSpace = remaining.lastIndexOf(' ', 25);

                                              if (lastComma > 10) {
                                                  cutIndex = lastComma; // 切在逗号处 (逗号会被丢弃)
                                              } else if (lastSpace > 10) {
                                                  cutIndex = lastSpace;
                                              }
                                          }
                                          finalParts.push(remaining.substring(0, cutIndex).trim());

                                          // 如果是在逗号处切的，要跳过这个逗号
                                          if (remaining[cutIndex] === '，' || remaining[cutIndex] === ',') {
                                              remaining = remaining.substring(cutIndex + 1).trim();
                                          } else {
                                              remaining = remaining.substring(cutIndex).trim();
                                          }
                                      }
                                  } else {
                                      finalParts.push(p);
                                  }
                              }
                              return finalParts;
                          };

                          for (const line of scriptLines.value) {
                              if (line.type === 'dialogue') {
                                  const totalDuration = audioMap.get(line.id);
                                  if (totalDuration) {

                                      const startTime = currentTime + 0.05; // 对应 exportAudio 的 0.05s 偏移

                                      // 获取切割后的字幕片段
                                      const textSegments = splitLongText(line.text);
                                      const totalLength = textSegments.reduce((acc, cur) => acc + cur.length, 0);

                                      let segmentStartTime = startTime;

                                      if (totalLength > 0) {
                                          for (const segment of textSegments) {
                                              // 按字符长度比例分配时间
                                              const segmentRatio = segment.length / totalLength;
                                              const segmentDuration = totalDuration * segmentRatio;
                                              const segmentEndTime = segmentStartTime + segmentDuration;

                                              srtContent += `${counter}\n`;
                                              srtContent += `${formatTime(segmentStartTime)} --> ${formatTime(segmentEndTime)}\n`;
                                              srtContent += `${segment}\n\n`;

                                              counter++;
                                              segmentStartTime = segmentEndTime;
                                          }
                                      }

                                      currentTime = startTime + totalDuration;
                                  }
                                  currentTime += (line.break_duration || 0);
                              }
                          }

                          const blob = new Blob([srtContent], { type: 'text/plain' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${translateMessage('Unitale字幕文件')}_${Date.now()}.srt`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                      } catch (e) {
                          console.error(e);
                          alert(translateMessage("导出SRT失败: {0}", { 0: e.message }));
                      } finally {
                          isExportingAudio.value = false;
                      }
                  };

                  // 辅助函数：AudioBuffer 转 WAV Blob
                  function bufferToWave(abuffer, len) {
                      const numOfChan = abuffer.numberOfChannels;
                      const length = len * numOfChan * 2 + 44;
                      const buffer = new ArrayBuffer(length);
                      const view = new DataView(buffer);
                      const channels = [];
                      let i, sample;
                      let offset = 0;
                      let pos = 0;

                      function setUint16(data) { view.setUint16(offset, data, true); offset += 2; }
                      function setUint32(data) { view.setUint32(offset, data, true); offset += 4; }

                      setUint32(0x46464952); // "RIFF"
                      setUint32(length - 8); // file length - 8
                      setUint32(0x45564157); // "WAVE"
                      setUint32(0x20746d66); // "fmt " chunk
                      setUint32(16); // length = 16
                      setUint16(1); // PCM (uncompressed)
                      setUint16(numOfChan);
                      setUint32(abuffer.sampleRate);
                      setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
                      setUint16(numOfChan * 2); // block-align
                      setUint16(16); // 16-bit
                      setUint32(0x61746164); // "data" - chunk
                      setUint32(length - offset - 4); // chunk length

                      for (i = 0; i < abuffer.numberOfChannels; i++) channels.push(abuffer.getChannelData(i));

                      while (pos < len) {
                          for (i = 0; i < numOfChan; i++) {
                              sample = Math.max(-1, Math.min(1, channels[i][pos]));
                              sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
                              view.setInt16(offset, sample, true);
                              offset += 2;
                          }
                          pos++;
                      }
                      return new Blob([buffer], { type: "audio/wav" });
                  }

                  const EXPORT_TAIL_PADDING_SEC = 1.02;

                  // --- 脚本制作逻辑 ---
                  const splitScript = () => {
                      if (hasActiveMediaTask()) return alert(translateMessage('storage.busy'));
                      if (!rawScript.value.trim()) return alert(translateMessage("请输入原文内容"));

                      let text = rawScript.value.replace(/\r\n/g, '\n');
                      const splitRegex = /\n+|(?<=[。！？!?])(?=["']?)\s*/;

                      const lines = text.split(splitRegex)
                          .map(l => l.trim())
                          .filter(l => l.length > 0);

                      collectOrphansAfterSave = true;
                      for (const line of scriptLines.value) releaseLineMedia(currentScriptId.value, line);
                      scriptLines.value = lines.map(text => ({
                          id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
                          type: 'dialogue',
                          role: '旁白',
                          emotion: '平静',
                          intensity: '中等',
                          filterId: '',
                          text: text,
                          trimStart: 0,
                          trimEnd: 1,
                          sfxVolume: 1.0,
                          dialogueVolume: 1.0,
                          speed: 1.0,
                          audioUrl: '',
                          isGenerating: false
                      }));
                  };

                  const addBgmBlock = () => {
                      const newBlock = {
                          id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
                          type: 'bgm',
                          action: 'play',
                          volume: 1.0,
                          bgmId: bgmLibrary.value.length > 0 ? bgmLibrary.value[0].id : ''
                      };
                      if (selectedLineIndex.value !== -1 && selectedLineIndex.value < scriptLines.value.length) {
                          scriptLines.value.splice(selectedLineIndex.value + 1, 0, newBlock);
                          selectedLineIndex.value++;
                      } else {
                          scriptLines.value.push(newBlock);
                          selectedLineIndex.value = scriptLines.value.length - 1;
                      }
                  };

                  const addBgImageBlock = () => {
                      const newId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
                      const newBlock = {
                          id: newId,
                          type: 'bgImage',
                          bgImagePrompt: '',
                          imageUrl: ''
                      };
                      if (selectedLineIndex.value !== -1 && selectedLineIndex.value < scriptLines.value.length) {
                          scriptLines.value.splice(selectedLineIndex.value + 1, 0, newBlock);
                          selectedLineIndex.value++;
                      } else {
                          scriptLines.value.push(newBlock);
                          selectedLineIndex.value = scriptLines.value.length - 1;
                      }
                  };

                  const addDialogueBlock = () => {
                      const newBlock = {
                          id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
                          type: 'dialogue',
                          role: '旁白',
                          emotion: '平静',
                          intensity: '中等',
                          filterId: '',
                          text: '',
                          trimStart: 0,
                          trimEnd: 1,
                          sfx: [],
                          break_duration: 0,
                          sfxVolume: 1.0,
                          dialogueVolume: 1.0,
                          speed: 1.0,
                          audioUrl: '',
                          isGenerating: false
                      };
                      if (selectedLineIndex.value !== -1 && selectedLineIndex.value < scriptLines.value.length) {
                          scriptLines.value.splice(selectedLineIndex.value + 1, 0, newBlock);
                          selectedLineIndex.value++;
                      } else {
                          scriptLines.value.push(newBlock);
                          selectedLineIndex.value = scriptLines.value.length - 1;
                      }
                  };

                  const removeScriptLine = (index) => {
                      if (hasActiveMediaTask()) return alert(translateMessage('storage.busy'));
                      const line = scriptLines.value[index];
                      if (!line) return;
                      if (line.audioAssetId || line.bgImageAssetId) collectOrphansAfterSave = true;
                      releaseLineMedia(currentScriptId.value, line);
                      scriptLines.value.splice(index, 1);
                      if (selectedLineIndex.value === index) {
                          selectedLineIndex.value = -1;
                      } else if (selectedLineIndex.value > index) {
                          selectedLineIndex.value--;
                      }
                  };

                  const openBgImagePicker = (lineIndex) => {
                      pendingBgImageLineIndex.value = lineIndex;
                      if (bgImagePickerRef.value) bgImagePickerRef.value.click();
                  };

                  const handleBgImageFileChange = async (event) => {
                      if (hasActiveMediaTask()) {
                          event.target.value = '';
                          return alert(translateMessage('storage.busy'));
                      }
                      const file = event.target.files && event.target.files[0];
                      const lineIndex = pendingBgImageLineIndex.value;
                      pendingBgImageLineIndex.value = -1;
                      event.target.value = '';
                      if (!file) return;

                      const line = scriptLines.value[lineIndex];
                      if (!line || line.type !== 'bgImage') return;

                      const taskScriptId = currentScriptId.value;
                      const taskProjectId = activeProjectId.value;
                      const taskAssetStore = activeAssetStore;
                      activeScriptTasks++;
                      try {
                          const saved = await taskAssetStore.put(file, { projectId: taskProjectId, kind: 'backgroundImage' });
                          if (!scriptLines.value.includes(line) || taskScriptId !== currentScriptId.value || taskProjectId !== activeProjectId.value) {
                              await taskAssetStore.remove(saved.id);
                              return;
                          }
                          if (line.bgImageAssetId) collectOrphansAfterSave = true;
                          releaseLineMedia(taskScriptId, line);
                          line.bgImageAssetId = saved.id;
                          line.imageUrl = objectUrls.create(mediaOwner(taskScriptId, line, 'imageUrl'), file);
                      } catch (e) {
                          console.error('Failed to save bgImage asset:', e);
                          alert(translateMessage("保存背景图片失败，请重试。"));
                      } finally {
                          activeScriptTasks--;
                      }

                      triggerAutoSave();
                  };

                  const copyBgImagePrompt = async (line) => {
                      const text = line?.bgImagePrompt || '';
                      if (!text) return;
                      try {
                          await navigator.clipboard.writeText(text);
                          alert(translateMessage("已复制背景图片提示词"));
                      } catch (e) {
                          // Fallback for environments without clipboard permission
                          const ta = document.createElement('textarea');
                          ta.value = text;
                          ta.style.position = 'fixed';
                          ta.style.left = '-9999px';
                          document.body.appendChild(ta);
                          ta.select();
                          document.execCommand('copy');
                          document.body.removeChild(ta);
                          alert(translateMessage("已复制背景图片提示词"));
                      }
                  };

                  const autoResizeTextarea = (event) => {
                      const el = event.target;
                      el.style.height = 'auto';
                      el.style.height = el.scrollHeight + 'px';
                  };

                  const addLineSfx = (line) => {
                      if (!line.sfx) line.sfx = [];
                      const defaultSfx = sfxLibrary.value.length > 0 ? sfxLibrary.value[0].id : '';
                      line.sfx.push({ sfxId: defaultSfx, position: 0.5 });
                  };

                  const removeLineSfx = (line, index) => {
                      if (line.sfx) line.sfx.splice(index, 1);
                  };

                  const stopScriptSequentially = () => {
                      isSequencePlaying.value = false;
                      currentSequenceIndex.value = -1;
                      if (!isGeneratingVideo.value) stageBgUrl.value = '';
                      stageBgFadePrevUrl.value = '';
                      stageBgFadeStartTs.value = 0;
                      // Stop dialogue audio
                      if (dialogueSource) {
                          try { dialogueSource.stop(); } catch (e) { }
                          dialogueSource = null;
                      }
                      // Stop SFX audio
                      sfxSources.forEach(source => { try { source.stop(); } catch (e) { } });
                      sfxSources = [];
                      // Stop BGM audio
                      if (bgmAudioNode && bgmGainNode) {
                          const oldNode = bgmAudioNode;
                          const oldGain = bgmGainNode;
                          const now = audioContext.currentTime;
                          oldGain.gain.cancelScheduledValues(now);
                          oldGain.gain.setValueAtTime(oldGain.gain.value, now);
                          oldGain.gain.linearRampToValueAtTime(0, now + 2);
                          setTimeout(() => { try { oldNode.stop(); } catch (e) { } }, 2000);
                          bgmAudioNode = null;
                          bgmGainNode = null;
                      }
                  };

                  const playBgm = async (bgmId, volume = 0.4) => {
                      // Stop any existing BGM
                      if (bgmAudioNode && bgmGainNode) {
                          const oldNode = bgmAudioNode;
                          const oldGain = bgmGainNode;
                          const now = audioContext.currentTime;

                          // 淡出旧 BGM
                          oldGain.gain.cancelScheduledValues(now);
                          oldGain.gain.setValueAtTime(oldGain.gain.value, now);
                          oldGain.gain.linearRampToValueAtTime(0, now + 2);

                          setTimeout(() => {
                              try { oldNode.stop(); } catch (e) { }
                          }, 2000);

                          bgmAudioNode = null;
                          bgmGainNode = null;
                      }

                      const bgmLibItem = bgmLibrary.value.find(b => b.id === bgmId);
                      if (!bgmLibItem || (!bgmLibItem.assetId && !bgmLibItem.filename)) {
                          console.warn(`BGM not found in library: ${bgmId}`);
                          return;
                      }

                      try {
                          const audioBuffer = await loadAudioBuffer(bgmLibItem.assetId ? `asset:${bgmLibItem.assetId}` : bgmLibItem.filename);
                          if (!audioBuffer) throw new Error('Load failed');

                          bgmAudioNode = audioContext.createBufferSource();
                          bgmAudioNode.buffer = audioBuffer;
                          bgmAudioNode.loop = true;
                          bgmAudioNode.loopStart = audioBuffer.duration * (bgmLibItem.trimStart ?? 0);
                          bgmAudioNode.loopEnd = audioBuffer.duration * (bgmLibItem.trimEnd ?? 1);

                          bgmGainNode = audioContext.createGain();
                          // 淡入新 BGM
                          const libVolume = bgmLibItem.volume ?? 1.0;
                          const finalVolume = volume * libVolume;
                          bgmGainNode.gain.value = 0;
                          bgmGainNode.gain.linearRampToValueAtTime(finalVolume, audioContext.currentTime + 2);

                          bgmAudioNode.connect(bgmGainNode).connect(getAudioOutputNode());
                          bgmAudioNode.start(0, bgmAudioNode.loopStart);
                      } catch (e) {
                          console.error(`Failed to load or play BGM ${bgmLibItem.filename}:`, e);
                          alert(translateMessage("播放背景音乐失败: {0}", { 0: bgmLibItem.filename }));
                      }
                  };

                  const playScriptSequentially = async () => {
                      stopScriptSequentially();
                      isSequencePlaying.value = true;
                      const startIndex = selectedLineIndex.value !== -1 ? selectedLineIndex.value : 0;

                      // --- bgImage Pre-scan Logic ---
                      if (startIndex > 0) {
                          let lastBgImageLine = null;
                          for (let i = startIndex - 1; i >= 0; i--) {
                              const line = scriptLines.value[i];
                              if (line.type === 'bgImage') {
                                  lastBgImageLine = line;
                                  break;
                              }
                          }
                          if (lastBgImageLine && lastBgImageLine.imageUrl) {
                              setStageBgUrlWithFade(lastBgImageLine.imageUrl);
                          }
                      } else {
                          // 兜底：从开头播放但之前没有 bgImage，则尝试使用第一个 bgImage 作为开场背景
                          const firstBgImageLine = scriptLines.value.find(l => l.type === 'bgImage');
                          if (firstBgImageLine && firstBgImageLine.imageUrl) {
                              setStageBgUrlWithFade(firstBgImageLine.imageUrl);
                          }
                      }
                      // --- End bgImage Pre-scan ---

                      // --- BGM Pre-scan Logic ---
                      if (startIndex > 0) {
                          // Find the last BGM directive before the start index.
                          let lastBgmLine = null;
                          for (let i = startIndex - 1; i >= 0; i--) {
                              const line = scriptLines.value[i];
                              if (line.type === 'bgm') {
                                  lastBgmLine = line;
                                  break; // Found the last one, no need to look further back.
                              }
                          }

                          // If the last directive was to play a BGM, play it now.
                          // If it was 'stop' or null, we do nothing, as stopScriptSequentially() already handled it.
                          if (lastBgmLine && lastBgmLine.action === 'play') {
                              await playBgm(lastBgmLine.bgmId, lastBgmLine.volume);
                          }
                      }
                      // --- End BGM Pre-scan ---

                      for (let i = startIndex; i < scriptLines.value.length; i++) {
                          if (!isSequencePlaying.value) break; // Check if stopped

                          currentSequenceIndex.value = i;

                          // Scroll into view manually to prevent page scroll
                          const container = scriptListContainer.value;
                          const child = lineRefs.value[i];

                          if (container && child) {
                              const containerRect = container.getBoundingClientRect();
                              const childRect = child.getBoundingClientRect();

                              // The offset of the child relative to the container's top edge
                              const childOffsetTop = childRect.top - containerRect.top;

                              // The desired scrollTop to center the child
                              const newScrollTop = container.scrollTop + childOffsetTop - (container.clientHeight / 2) + (child.clientHeight / 2);

                              container.scrollTo({
                                  top: newScrollTop,
                                  behavior: 'smooth'
                              });
                          }

                          const line = scriptLines.value[i];

                          if (line.type === 'bgm') {
                              if (line.action === 'play') {
                                  await playBgm(line.bgmId, line.volume);
                              } else if (line.action === 'stop') {
                                  if (bgmAudioNode && bgmGainNode) {
                                      const oldNode = bgmAudioNode;
                                      const oldGain = bgmGainNode;
                                      const now = audioContext.currentTime;
                                      oldGain.gain.cancelScheduledValues(now);
                                      oldGain.gain.setValueAtTime(oldGain.gain.value, now);
                                      oldGain.gain.linearRampToValueAtTime(0, now + 2);
                                      setTimeout(() => { try { oldNode.stop(); } catch (e) { } }, 2000);
                                      bgmAudioNode = null;
                                      bgmGainNode = null;
                                  }
                              }
                          } else if (line.type === 'bgImage') {
                              setStageBgUrlWithFade(line.imageUrl || '');
                          } else { // 'dialogue'
                              if (!line.audioAssetId) {
                                  // 跳过未生成的台词
                                  continue;
                              }

                              // A promise that resolves when the line finishes playing
                              await playLineAudio(line, false);

                              if (!isSequencePlaying.value) break;

                              // Handle break duration
                              if (line.break_duration > 0) {
                                  await new Promise(resolve => setTimeout(resolve, line.break_duration * 1000));
                              }
                          }
                      }

                      // Reset when done or stopped
                      stopScriptSequentially();
                  };

                  // --- Bounded MP4 export: numbered segments of at most two minutes ---
                  const generateVideo = async () => {
                      const dialogueLines = scriptLines.value.filter(line => line.type === 'dialogue');
                      if (!dialogueLines.length) return alert(translateMessage('脚本为空'));
                      if (dialogueLines.some(line => !line.audioAssetId) &&
                          !confirm(translateMessage('部分台词尚未生成音频，导出视频时将跳过未生成的台词。确定继续吗？'))) return;
                      if (typeof VideoEncoder === 'undefined') {
                          return alert(translateMessage('当前浏览器不支持 WebCodecs API，无法快速导出视频。请使用最新版 Chrome 或 Edge。'));
                      }
                      const Mp4Muxer = getMp4Muxer();
                      if (!Mp4Muxer) return alert(translateMessage('缺少 Mp4Muxer 库，无法导出 MP4。'));
                      isGeneratingVideo.value = true;
                      exportStatus.value = translateMessage('准备素材...');
                      try {
                          const durations = new Map();
                          for (const line of dialogueLines) {
                              if (!line.audioAssetId) continue;
                              const timing = await getDialogueTimingInfo(line);
                              if (timing) durations.set(line.id, timing.effectiveDuration);
                          }
                          let time = 0;
                          let background = '';
                          let backgroundStart = 0;
                          const visuals = [];
                          const dialogueEvents = [];
                          const first = scriptLines.value.find(line => line.type === 'bgImage' && line.imageUrl);
                          if (first) background = first.imageUrl;
                          for (const line of scriptLines.value) {
                              if (line.type === 'bgImage' && line.imageUrl && line.imageUrl !== background) {
                                  if (time > backgroundStart) visuals.push({ url: background, start: backgroundStart, end: time });
                                  background = line.imageUrl;
                                  backgroundStart = time;
                              } else if (line.type === 'dialogue') {
                                  const duration = durations.get(line.id);
                                  if (duration) {
                                      time += 0.05;
                                      dialogueEvents.push({ line, time, duration });
                                      time += duration;
                                  }
                                  time += Number(line.break_duration) || 0;
                              }
                          }
                          const sfxEvents = await collectSfxEvents(dialogueEvents);
                          const totalDuration = totalTimelineDuration(time, sfxEvents, EXPORT_TAIL_PADDING_SEC);
                          visuals.push({ url: background, start: backgroundStart, end: totalDuration });
                          const fps = 4;
                          const totalFrames = Math.ceil(totalDuration * fps);
                          const framesPerPart = 120 * fps;
                          const count = Math.ceil(totalFrames / framesPerPart);
                          let [width, height] = videoResolution.value.split('x').map(Number);
                          width += width % 2;
                          height += height % 2;
                          const canvas = new OffscreenCanvas(width, height);
                          const ctx = canvas.getContext('2d', { alpha: false });
                          ctx.imageSmoothingEnabled = true;
                          ctx.imageSmoothingQuality = 'high';
                          const loadImage = url => new Promise(resolve => {
                              if (!url) return resolve(null);
                              const image = new Image();
                              image.onload = () => resolve(image);
                              image.onerror = () => resolve(null);
                              image.src = url;
                          });
                          let visualIndex = 0;
                          for (let part = 0; part < count; part++) {
                              const firstFrame = part * framesPerPart;
                              const partFrames = Math.min(framesPerPart, totalFrames - firstFrame);
                              const muxer = new Mp4Muxer.Muxer({
                                  target: new Mp4Muxer.ArrayBufferTarget(),
                                  video: { codec: 'avc', width, height },
                                  fastStart: 'in-memory'
                              });
                              let encoderError = null;
                              const encoder = new VideoEncoder({
                                  output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
                                  error: error => { encoderError = error; }
                              });
                              const config = {
                                  codec: 'avc1.4d002a', width, height, bitrate: 3_000_000,
                                  framerate: fps, hardwareAcceleration: 'prefer-hardware'
                              };
                              try {
                                  if (!(await VideoEncoder.isConfigSupported(config)).supported) {
                                      config.codec = 'avc1.42002a';
                                      config.hardwareAcceleration = 'no-preference';
                                  }
                                  encoder.configure(config);
                                  let lastUrl = null;
                                  let image = null;
                                  for (let frameIndex = 0; frameIndex < partFrames; frameIndex++) {
                                      const globalFrame = firstFrame + frameIndex;
                                      const frameTime = globalFrame / fps;
                                      while (visualIndex + 1 < visuals.length && frameTime >= visuals[visualIndex].end) visualIndex++;
                                      const visual = visuals[visualIndex];
                                      const url = visual?.url || '';
                                      const imageChanged = url !== lastUrl;
                                      if (imageChanged) {
                                          image = await loadImage(url);
                                          lastUrl = url;
                                          ctx.fillStyle = '#000';
                                          ctx.fillRect(0, 0, width, height);
                                          if (image?.width && image?.height) {
                                              const scale = Math.max(width / image.width, height / image.height);
                                              const drawnWidth = image.width * scale;
                                              const drawnHeight = image.height * scale;
                                              ctx.drawImage(image, (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight);
                                          }
                                      }
                                      while (encoder.encodeQueueSize > 16) {
                                          if (encoderError) throw encoderError;
                                          await new Promise(resolve => setTimeout(resolve, 10));
                                      }
                                      if (encoderError) throw encoderError;
                                      const timestamp = Math.round(frameIndex * 1_000_000 / fps);
                                      const duration = Math.max(1, Math.min(250000, Math.round((totalDuration - frameTime) * 1_000_000)));
                                      const frame = new VideoFrame(canvas, { timestamp, duration });
                                      encoder.encode(frame, { keyFrame: frameIndex === 0 || imageChanged });
                                      frame.close();
                                      exportStatus.value = translateMessage('编码视频 {0}%', { 0: Math.round((globalFrame + 1) / totalFrames * 100) });
                                  }
                                  await encoder.flush();
                                  if (encoderError) throw encoderError;
                              } finally {
                                  if (encoder.state !== 'closed') encoder.close();
                              }
                              muxer.finalize();
                              downloadArchivePart({
                                  name: `Unitale_${currentScriptId.value}_${String(part + 1).padStart(3, '0')}-of-${String(count).padStart(3, '0')}.mp4`,
                                  blob: new Blob([muxer.target.buffer], { type: 'video/mp4' })
                              });
                              await new Promise(resolve => setTimeout(resolve, 0));
                          }
                      } catch (error) {
                          console.error('Video generation failed', error);
                          alert(translateMessage('导出视频失败: {0}', { 0: error.message }));
                      } finally {
                          isGeneratingVideo.value = false;
                          exportStatus.value = '';
                      }
                  };

                  const analyzeScript = async () => {
                      if (isAnalyzingScript.value) {
                          if (analysisAbortController.value) analysisAbortController.value.abort();
                          isAnalyzingScript.value = false;
                          return;
                      }
                      if (hasActiveMediaTask()) return alert(translateMessage('storage.busy'));

                      if (!currentConfig.value) return alert(translateMessage("请先在“模型配置”选择一个 LLM 模型配置"));
                      if (!rawScript.value.trim()) return alert(translateMessage("请输入原文内容"));

                      const requestedBgImageCount = Math.max(0, Number(bgImageCount.value) || 0);
                      activeScriptTasks++;
                      isAnalyzingScript.value = true;
                      analysisAbortController.value = new AbortController();

                      let sfxSection = "";
                      const enabledSfx = sfxLibrary.value.filter(s => s.enabled !== false);

                      if (enabledSfx.length > 0) {
                          const sfxList = enabledSfx.map(s => `- ${s.name}: ${s.description}`).join('\n');
                          sfxSection = `# 音效库 (Sound Effects)\n你还可以使用以下音效素材，请根据剧情需要插入：\n${sfxList}\n**注意：必须严格使用列表中的名称，严禁编造不存在的音效。且绝对禁止使用 BGM 库中的名称。**`;
                      } else {
                          sfxSection = `# 音效库 (Sound Effects)\n当前音效库为空。\n**注意：请勿生成任何 'sfx' 字段。**`;
                      }

                      let bgmSection = "";
                      const enabledBgm = bgmLibrary.value.filter(b => b.enabled !== false);
                      if (enabledBgm.length > 0) {
                          const bgmList = enabledBgm.map(s => `- ${s.name}: ${s.description}`).join('\n');
                          bgmSection = `# 背景音乐库 (Background Music)\n现有以下背景音乐素材可用：\n${bgmList}\n\n**核心指令：**\n1. 必须**逐字匹配**使用列表中的名称。\n2. 如果列表中没有适合当前剧情的音乐，**请勿生成** BGM 播放指令。\n3. **严禁编造**列表中不存在的 BGM 名称。\n4. **绝对禁止**使用 SFX 库中的名称。`;
                      } else {
                          bgmSection = `# 背景音乐库 (Background Music)\n**当前背景音乐库为空 (EMPTY)。**\n\n**核心指令：**\n1. **严禁生成**任何 action="play" 的 BGM 控制块。\n2. 你只能生成 action="stop" 的指令（如果需要停止之前的音乐）。\n3. 绝对不要编造 BGM 名称。`;
                      }

                      let filterSection = "";
                      const enabledFilters = filterLibrary.value.filter(f => f.enabled !== false);
                      if (enabledFilters.length > 0) {
                          const fList = enabledFilters.map(f => `- ${f.name}: ${f.description}`).join('\n');
                          filterSection = `# 滤波器库 (Audio Filters)\n如果剧情需要特殊音效处理（如电话、水下、回忆），请使用以下滤波器：\n${fList}\n**注意：必须严格使用列表中的名称，如果没有匹配项则不要使用 filter 字段。**`;
                      } else {
                          filterSection = `# 滤波器库 (Audio Filters)\n当前滤波器库为空。\n**注意：请勿生成任何 filter 字段。**`;
                      }

                      const emotionList = emotionPresets.value.filter(e => e.enabled !== false).map(e => e.name).join(', ');

                      const bgmExampleLine = enabledBgm.length > 0
                          ? `{"type": "bgm", "action": "play", "name": "${enabledBgm[0].name}"},`
                          : '';

                      const sfxExample = enabledSfx.length > 0
                          ? `, "sfx": [{"name": "${enabledSfx[0].name}", "position": 0.2}]`
                          : '';

                      const templateToUse = useCustomPrompt.value ? customPromptTemplate.value : getDefaultPromptTemplate();
                      let finalPrompt = templateToUse
                          .replace(/\${emotionList}/g, emotionList)
                          .replace(/\${sfxSection}/g, sfxSection)
                          .replace(/\${bgmSection}/g, bgmSection)
                          .replace(/\${filterSection}/g, filterSection)
                          .replace(/\${bgmExampleLine}/g, bgmExampleLine)
                          .replace(/\${sfxExample}/g, sfxExample)
                          .replace(/\${rawScript}/g, rawScript.value)
                          .replace(/\${bgImageCount}/g, requestedBgImageCount);

                      // 兼容：当用户启用“自定义 Prompt”时，补充最低约束与数量约束（只添加，不删减原有 prompt）。
                      if (requestedBgImageCount === 0) {
                          // 默认模板包含开场必须插入 bgImage 的指令；0 张时移除整段，避免自相矛盾。
                          finalPrompt = finalPrompt.replace(/\n\s*## 7\. 背景图片块 \(bgImage\)[\s\S]*?(?=\n\s*## 小说原文:)/, '');
                          finalPrompt += '\n\n本次背景图片数量为 0。不要输出任何 type 为 bgImage 的对象。';
                      } else if (useCustomPrompt.value) {
                          if (!finalPrompt.includes('bgImage')) {
                              finalPrompt += `

  ## 背景图片块 (bgImage)
  - 需要在相邻的台词对象之间插入：\`{"type":"bgImage","image_prompt":"..."}\`
  - \`image_prompt\` 必须为用于生成图片的中文提示词，并且要根据当前小说上下文生成。
  - \`type\` 字段必须严格等于 \`bgImage\`。
  `;
                          }

                          finalPrompt += `

  ## 背景图片块数量约束（严格遵守）
  - 请在整个 JSON 数组中严格插入且仅插入 ${requestedBgImageCount} 个 \`type":"bgImage"\` 对象。
  - 第一个 \`bgImage\` 对象必须出现在“第一个 dialogue 对象之前”，用于视频开场背景；允许开头存在 \`bgm\` 控制块。
  - 除开场第一张外，其余 \`bgImage\` 必须按剧情节奏插入在台词之间（至少间隔一个 \`dialogue\`），避免连续出现多个 \`bgImage\`。
  `;
                      }

                      try {
                          const cfg = currentConfig.value;
                          let url = cfg.baseUrl.trim().replace(/\/+$/, '');
                          if (!url.endsWith('/chat/completions')) url += '/chat/completions';

                          let body = { model: cfg.model, messages: [{ role: 'user', content: finalPrompt }], stream: false };

                          if (cfg.params) {
                              try {
                                  const extraParams = JSON.parse(cfg.params);
                                  body = { ...body, ...extraParams };
                              } catch (e) {
                                  console.warn('解析额外参数失败:', e);
                              }
                          }

                          const res = await requestService(url, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.key}` },
                              body: JSON.stringify(body),
                              signal: analysisAbortController.value.signal
                          });

                          if (!res.ok) throw new Error(`HTTP ${res.status}`);

                          const data = await res.json();
                          const content = data.choices[0]?.message?.content || '';
                          rawAnalysisResult.value = content; // 保存原始输出
                          const jsonMatch = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
                          const jsonStr = jsonMatch ? jsonMatch[0] : content.replace(/```json/g, '').replace(/```/g, '').trim();

                          const parsed = JSON.parse(jsonStr);
                          if (Array.isArray(parsed)) {
                              // 数量为 0 时不接受模型幻觉生成的背景图片块。
                              const validParsed = requestedBgImageCount === 0
                                  ? parsed.filter(item => item?.type !== 'bgImage')
                                  : parsed;

                              const newRoles = new Set();
                              validParsed.forEach(item => {
                                  const r = item.role_name || item.role;
                                  if (r) newRoles.add(r);
                              });

                              // 重新构建角色列表：清空并填充 (保留已有角色的音色配置)
                              const newCharacterList = [];
                              newRoles.forEach(rName => {
                                  const existing = characters.value.find(c => c.name === rName);
                                  let voiceFile = '';
                                  let voiceAssetId = '';
                                  let id = Date.now() + Math.random().toString();
                                  let volume = 1.0;

                                  if (existing) {
                                      voiceFile = existing.voiceFile;
                                      voiceAssetId = existing.voiceAssetId || '';
                                      id = existing.id;
                                      volume = existing.volume ?? 1.0;
                                  } else {
                                      const currentNovel = novels.value.find(novel => novel.id === scriptList.value.find(script => script.id === currentScriptId.value)?.novelId);
                                      const matchingTimbre = currentNovel
                                          ? timbres.value.find(t => t.id === currentNovel.roleTimbreIds[rName.trim()])
                                          : timbres.value.find(t => t.name === rName);
                                      if (matchingTimbre) {
                                          voiceFile = matchingTimbre.refPath;
                                          voiceAssetId = matchingTimbre.assetId || '';
                                      }
                                  }

                                  newCharacterList.push({
                                      id: id,
                                      name: rName,
                                      voiceFile: voiceFile,
                                      voiceAssetId,
                                      volume: volume
                                  });
                              });
                              characters.value = newCharacterList;

                              collectOrphansAfterSave = true;
                              for (const line of scriptLines.value) releaseLineMedia(currentScriptId.value, line);
                              scriptLines.value = validParsed.map(item => {
                                  const filterId = matchLibraryId(item.filter, filterLibrary.value);
                                  const matchedSfx = Array.isArray(item.sfx) ? item.sfx
                                      .map(s => ({ sfxId: matchLibraryId(s.name, sfxLibrary.value), position: s.position }))
                                      .filter(s => s.sfxId) : [];
                                  let bgmId = '';
                                  if (item.type === 'bgm' && item.action === 'play') {
                                      const rawName = item.name || item.bgmName || '';
                                      bgmId = matchLibraryId(rawName, bgmLibrary.value);
                                  }

                                  return {
                                      id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
                                      type: item.type || 'dialogue',
                                      // Dialogue fields
                                      role: item.role_name || item.role || '旁白',
                                      text: item.text_content || item.text || item.content || '',
                                      emotion: item.emotion || '平静',
                                      intensity: item.intensity || '中等',
                                      filterId,
                                      sfx: matchedSfx,
                                      break_duration: typeof item.break_duration === 'number' ? item.break_duration : 0,
                                      trimStart: 0,
                                      trimEnd: 1,
                                      sfxVolume: 1.0,
                                      dialogueVolume: 1.0,
                                      audioUrl: '',
                                      isGenerating: false,
                                      // BGM fields
                                      action: item.action || 'play',
                                      volume: 1.0,
                                      bgmId,

                                      // bgImage fields (background-image block)
                                      bgImagePrompt: item.image_prompt || item.bgImagePrompt || item.imagePrompt || item.prompt || '',
                                      imageUrl: ''
                                  };
                              });
                          } else {
                              alert(translateMessage("AI 返回格式异常，请重试"));
                          }
                      } catch (e) {
                          if (e.name === 'AbortError') {
                              alert(translateMessage("分析已停止"));
                          } else {
                              console.error(e);
                              alert(translateMessage("分析失败: {0}", { 0: e.message }));
                          }
                      } finally {
                          isAnalyzingScript.value = false;
                          analysisAbortController.value = null;
                          activeScriptTasks--;
                      }
                  };


                  // --- 聊天逻辑 ---
                  const clearAll = () => {
                      result.value = '';
                      reasoning.value = '';
                      error.value = '';
                  };

                  const stopGeneration = () => {
                      if (abortController.value) {
                          abortController.value.abort();
                          abortController.value = null;
                          loading.value = false;
                      }
                  };

                  const send = async () => {
                      if (!currentConfig.value) return alert(translateMessage("请先选择一个有效的模型配置"));
                      const cfg = currentConfig.value;

                      loading.value = true;
                      result.value = '';
                      reasoning.value = '';
                      error.value = '';

                      abortController.value = new AbortController();

                      try {
                          let url = cfg.baseUrl.trim().replace(/\/+$/, '');

                          if (!url.endsWith('/chat/completions')) {
                              url += '/chat/completions';
                          }

                          let body = {
                              model: cfg.model,
                              messages: [{ role: 'user', content: prompt.value }],
                              stream: true
                          };

                          if (cfg.params) {
                              try {
                                  const extraParams = JSON.parse(cfg.params);
                                  body = { ...body, ...extraParams };
                              } catch (e) {
                                  console.warn('解析额外参数失败:', e);
                              }
                          }

                          const res = await requestService(url, {
                              method: 'POST',
                              headers: {
                                  'Content-Type': 'application/json',
                                  'Authorization': `Bearer ${cfg.key}`
                              },
                              body: JSON.stringify(body),
                              signal: abortController.value.signal
                          });

                          if (!res.ok) {
                              const errData = await res.text();
                              throw new Error(`HTTP ${res.status}: ${errData}`);
                          }

                          const reader = res.body.getReader();
                          const decoder = new TextDecoder();
                          let buffer = "";

                          while (true) {
                              const { done, value } = await reader.read();
                              if (done) break;

                              buffer += decoder.decode(value, { stream: true });
                              const lines = buffer.split('\n');
                              buffer = lines.pop(); // 保持最后一行完整

                              for (const line of lines) {
                                  const cleanLine = line.replace(/^data: /, '').trim();
                                  if (!cleanLine || cleanLine === '[DONE]') continue;

                                  try {
                                      const json = JSON.parse(cleanLine);
                                      const delta = json.choices[0]?.delta;

                                      if (delta?.reasoning_content) {
                                          reasoning.value += delta.reasoning_content;
                                      }
                                      if (delta?.content) {
                                          result.value += delta.content;
                                      }
                                  } catch (e) {
                                      // 忽略部分解析错误
                                  }
                              }
                          }
                      } catch (e) {
                          if (e.name === 'AbortError') {
                              // 用户手动停止，不报错
                          } else {
                              error.value = e.message;
                              if (e.message.includes('Failed to fetch')) {
                                  error.value += translateMessage("\n\n检测到跨域(CORS)限制！Gemini API 通常禁止从浏览器前端直接调用。\n建议：开启浏览器 CORS 插件，或使用后端中转。");
                              }
                          }
                      } finally {
                          loading.value = false;
                          abortController.value = null;
                      }
                  };

                  // --- TTS 逻辑 (SonicVale 协议) ---

                  const handleFileUpload = (event) => {
                      const file = event.target.files[0];
                      if (file) {
                          ttsRefFile.value = file;
                          if (!ttsRefPath.value || ttsRefPath.value === 'uploaded/ref.wav') {
                              ttsRefPath.value = `uploaded/${file.name}`;
                          }
                      }
                  };

                  const stopTtsGeneration = () => {
                      if (ttsAbortController.value) {
                          ttsAbortController.value.abort();
                          ttsAbortController.value = null;
                          ttsLoading.value = false;
                      }
                  };

                  const synthesizeAudio = async () => {
                      if (!currentTtsConfig.value) return alert(translateMessage("请选择 TTS 配置"));
                      const textToSpeak = result.value || prompt.value;
                      if (!textToSpeak) return alert(translateMessage("没有可合成的文本 (请先对话或输入提示词)"));
                      if (!ttsRefPath.value) return alert(translateMessage("请指定参考音频路径 ID"));

                      ttsLoading.value = true;
                      ttsError.value = '';
                      audioUrl.value = '';

                      ttsAbortController.value = new AbortController();

                      const cfg = currentTtsConfig.value;
                      let baseUrl = cfg.baseUrl.trim().replace(/\/+$/, '');
                      if (baseUrl.endsWith('/v1')) baseUrl = baseUrl.slice(0, -3);

                      try {
                          // 1. 检查音频是否存在
                          const checkUrl = `${baseUrl}/v1/check/audio?file_name=${encodeURIComponent(ttsRefPath.value)}`;
                          const checkRes = await requestService(checkUrl, { signal: ttsAbortController.value.signal });
                          if (!checkRes.ok) throw new Error(`Check failed: ${checkRes.status}`);
                          const checkData = await checkRes.json();

                          // 2. 上传逻辑：如果用户选择了文件，强制上传（覆盖）；否则检查服务端是否存在
                          // 修改：即使服务端存在，只要用户选了新文件，就强制上传，防止文件内容不一致或服务端文件损坏
                          if (ttsRefFile.value) {
                              const formData = new FormData();
                              formData.append('audio', ttsRefFile.value);
                              formData.append('full_path', ttsRefPath.value);

                              const uploadRes = await requestService(`${baseUrl}/v1/upload_audio`, {
                                  method: 'POST',
                                  body: formData,
                                  signal: ttsAbortController.value.signal
                              });

                              if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
                          } else if (!checkData.exists) {
                              throw new Error(translateMessage("服务端未找到音频 \"{0}\"，且未选择本地文件进行上传。", { 0: ttsRefPath.value }));
                          }

                          // 3. 合成语音
                          const synthPayload = {
                              text: textToSpeak,
                              audio_path: ttsRefPath.value,
                              emo_text: ttsEmoText.value || '中立'
                          };

                          const synthRes = await requestService(`${baseUrl}/v2/synthesize`, {
                              method: 'POST',
                              headers: {
                                  'Content-Type': 'application/json'
                              },
                              body: JSON.stringify(synthPayload),
                              signal: ttsAbortController.value.signal
                          });

                          if (!synthRes.ok) {
                              const errText = await synthRes.text();
                              throw new Error(`Synthesis failed: ${errText}`);
                          }

                          // 4. 处理二进制音频流
                          const blob = await synthRes.blob();
                          audioUrl.value = URL.createObjectURL(blob);

                      } catch (e) {
                          if (e.name === 'AbortError') {
                              // 用户手动停止
                          } else {
                              console.error(e);
                              ttsError.value = e.message;
                          }
                      } finally {
                          ttsLoading.value = false;
                          ttsAbortController.value = null;
                      }
                  };

                  const savePrompt = () => {
                      localStorage.setItem(storageKeys.promptTemplate, customPromptTemplate.value);
                      localStorage.setItem(storageKeys.useCustomPrompt, JSON.stringify(useCustomPrompt.value));
                      localStorage.setItem(storageKeys.voicePromptTemplate, customVoicePromptTemplate.value);
                      localStorage.setItem(storageKeys.useCustomVoicePrompt, JSON.stringify(useCustomVoicePrompt.value));
                      alert(translateMessage("Prompt 设置已保存"));
                  };

                  const saveVoicePrompt = () => {
                      localStorage.setItem(storageKeys.voicePromptTemplate, customVoicePromptTemplate.value);
                      localStorage.setItem(storageKeys.useCustomVoicePrompt, JSON.stringify(useCustomVoicePrompt.value));
                      alert(translateMessage("音色分析 Prompt 设置已保存"));
                  };

                  const resetPrompt = () => {
                      if (confirm(translateMessage("确定要恢复默认 Prompt 吗？"))) {
                          customPromptTemplate.value = getDefaultPromptTemplate();
                          customVoicePromptTemplate.value = getDefaultVoicePromptTemplate();
                      }
                  };

                  const resetVoicePrompt = () => {
                      if (confirm(translateMessage("确定要恢复默认的音色分析 Prompt 吗？"))) {
                          customVoicePromptTemplate.value = getDefaultVoicePromptTemplate();
                          localStorage.setItem(storageKeys.voicePromptTemplate, customVoicePromptTemplate.value);
                      }
                  };

                  const saveQwenVoiceText = () => {
                      localStorage.setItem(storageKeys.qwenVoiceTextTemplate, customQwenVoiceTextTemplate.value);
                      localStorage.setItem(storageKeys.useCustomQwenVoiceText, JSON.stringify(useCustomQwenVoiceText.value));
                      alert(translateMessage("Qwen 生成文本设置已保存"));
                  };

                  const resetQwenVoiceText = () => {
                      if (confirm(translateMessage("确定要恢复默认文本吗？"))) {
                          customQwenVoiceTextTemplate.value = getDefaultQwenVoiceTextTemplate();
                      }
                  };

                  // 监听开关状态，实时保存
                  watch(useCustomPrompt, (newVal) => {
                      localStorage.setItem(storageKeys.useCustomPrompt, JSON.stringify(newVal));
                  });

                  watch(useCustomVoicePrompt, (newVal) => {
                      localStorage.setItem(storageKeys.useCustomVoicePrompt, JSON.stringify(newVal));
                  });

                  watch(useCustomQwenVoiceText, (newVal) => {
                      localStorage.setItem(storageKeys.useCustomQwenVoiceText, JSON.stringify(newVal));
                  });

                  return {
                      // State
                      activeTab, llmConfigs, currentConfigId,
                      form, isEditing,
                      filterLibrary, filterForm, isEditingFilter, saveFilter, editFilter, deleteFilter, resetFilterForm,
                      prompt, result, reasoning, error, loading,

                      // TTS State
                      currentTtsConfigId, ttsConfigs, ttsRefPath, ttsEmoText,
                      audioUrl, ttsLoading, ttsError,

                      // TTS Actions
                      handleFileUpload, synthesizeAudio, stopTtsGeneration,

                      // Actions
                      saveConfig, editConfig, deleteConfig, resetForm,
                      // TTS Actions
                      ttsForm, isEditingTts,
                      saveTtsConfig, editTtsConfig, deleteTtsConfig, resetTtsForm,

                      // Character Actions (New)
                      characters, addCharacter, deleteCharacter, bindCharacterTimbre,
                      analyzeCharacterVoice, generateQwenVoice,

                      // Timbre Actions
                      timbres, timbreForm, isEditingTimbre, selectedTimbreId,
                      saveTimbre, editTimbre, deleteTimbre, resetTimbreForm, handleTimbreFileUpload,

                      // Emotion Actions
                      emotionPresets, emotionForm, isEditingEmotion,
                      saveEmotion, editEmotion, deleteEmotion, resetEmotionForm, resetEmotionsToDefault,
                      isSystemEmotion, // Export helper

                      // SFX Actions
                      sfxLibrary, sfxForm, isEditingSfx,
                      saveSfx, editSfx, deleteSfx, resetSfxForm, handleSfxFileUpload,
                      addLineSfx, removeLineSfx,

                      // BGM Actions
                      bgmLibrary, bgmForm, isEditingBgm,
                      saveBgm, editBgm, deleteBgm, resetBgmForm, handleBgmFileUpload,

                      // Audition Actions
                      availableRoles, isAuditioningId, generateLineAudio, playLineAudio, clearLineAudio,

                      playPreview, previewPlayingFile,
                      send, stopGeneration, clearAll,

                      playbackProgress, // Export for template
                      stageBgUrl,
                      bgImageCount,
                      bgImagePickerRef,
                      previewImageUrl,
                      isGeneratingVideo,

                      // Script Actions
                      rawScript, scriptLines, splitScript, removeScriptLine, autoResizeTextarea, analyzeScript, isAnalyzingScript, rawAnalysisResult,
                      addBgmBlock, addDialogueBlock, addBgImageBlock, selectedLineIndex,
                      drawWaveform, startDragTrim, // Exported for template
                      generateAllLines, isGeneratingAll, clearAllGeneratedAudio,
                      moveLineUp, moveLineDown,
                      toggleLineSelection,
                      openBgImagePicker, handleBgImageFileChange, copyBgImagePrompt, openImagePreview, closeImagePreview,
                      exportScriptState, triggerImport, handleImportFile, importFileRef, exportAudio, isExportingAudio,
                      downloadNextArchivePart, hasMoreArchiveParts,
                      exportSRT, triggerImportTxt, handleImportTxt, importTxtRef,
                      isExportingProject, exportStatus, videoResolution,
                      playScriptSequentially, stopScriptSequentially, isSequencePlaying, currentSequenceIndex,
                      lineRefs,
                      scriptListContainer,
                      scriptList, novels, currentScriptId, switchScript, addScript, deleteScriptTab,
                      novelEditorId, novelBatch, commitNovelImport, setNovelSelection, setNovelRoleTimbre,
                      analyzeNovelBatch, generateNovelBatch, stopNovelBatch, openNovelChapter, closeNovelChapter,
                      editingScriptId, startEditingScript, stopEditingScript, scriptNameInputRefs,

                      generationLanguage,
                      storageAudit, refreshStorageAudit,
                      lastStorageError,
                      storageBackend, directoryName, directoryError, directoryModeAvailable,
                      migrateToDirectory, openDirectoryProject, clearLegacyDatabase,
                      customPromptTemplate, useCustomPrompt, savePrompt, resetPrompt,
                      customVoicePromptTemplate, useCustomVoicePrompt, saveVoicePrompt, resetVoicePrompt,
                      customQwenVoiceTextTemplate, useCustomQwenVoiceText, saveQwenVoiceText, resetQwenVoiceText,
                      generateVideo,
                  };
}
