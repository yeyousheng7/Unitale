import { ref, onMounted, computed, watch } from 'vue'
import { initDB, saveAssetToDB, loadAssetFromDB, saveAssetsBatch, saveProjectRecord, loadProjectRecord, deleteAssetFromDB } from '../services/storage/indexedDb'
import { createProjectSnapshot } from '../services/storage/snapshot'
import { storageKeys } from '../services/storage/keys'
import { blobToBase64, base64ToBlob, extractMediaJsonFromFileStream } from '../services/project/media'
import { createProjectExportBlob } from '../services/project/export'
import { ensureFFmpegLoaded, runFFmpegTask, getMp4Muxer } from '../services/audio/legacyAdapters'
import { getAudioBlobFromUrl, getFileExtensionFromBlob, buildDialogueAudioFilter } from '../services/audio/processing'
import { requestService } from '../services/api/client'

export function useUnitaleWorkspace() {
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
                  const saveProjectToDB = async () => {
                      await initDB();

                      syncCurrentScriptState(); // 确保当前状态同步到列表

                      const projectData = createProjectSnapshot({
                          characters: characters.value,
                          scriptList: scriptList.value,
                          currentScriptId: currentScriptId.value,
                          libraries: {
                              sfx: sfxLibrary.value,
                              bgm: bgmLibrary.value,
                              timbres: timbres.value,
                              filters: filterLibrary.value,
                              emotions: emotionPresets.value
                          }
                      });

                      return saveProjectRecord(projectData);
                  };

                  let saveTimeout = null;
                  const triggerAutoSave = () => {
                      if (saveTimeout) clearTimeout(saveTimeout);
                      saveTimeout = setTimeout(() => {
                          saveProjectToDB().catch(e => console.warn('Auto-save failed', e));
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
                  const sfxForm = ref({ id: '', name: '', description: '', filename: '', trimStart: 0, trimEnd: 1, volume: 0.3 });
                  const isEditingSfx = ref(false);

                  // BGM库状态
                  const bgmLibrary = ref(/** @type {any[]} */ ([]));
                  const bgmForm = ref({ id: '', name: '', description: '', filename: '', trimStart: 0, trimEnd: 1, volume: 0.3 });
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
                  const scriptList = ref([{ id: 'default', name: '脚本 1', data: { rawScript: '', scriptLines: [], rawAnalysisResult: '', characters: [] } }]);
                  const currentScriptId = ref('default');
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
                      if (isAnalyzingScript.value || isGeneratingAll.value || isSequencePlaying.value) {
                          return alert('请先停止当前的生成或播放任务，再切换脚本。');
                      }
                      if (id === currentScriptId.value) return;
                      syncCurrentScriptState();

                      const target = scriptList.value.find(s => s.id === id);
                      if (target) {
                          currentScriptId.value = id;
                          rawScript.value = target.data.rawScript || '';
                          scriptLines.value = target.data.scriptLines || [];
                          rawAnalysisResult.value = target.data.rawAnalysisResult || '';
                          characters.value = target.data.characters || [];
                          characters.value.forEach(c => { if (c.volume === undefined) c.volume = 1.0; });
                          selectedLineIndex.value = -1;
                      }
                  };

                  const addScript = () => {
                      if (isAnalyzingScript.value || isGeneratingAll.value || isSequencePlaying.value) {
                          return alert('请先停止当前的生成或播放任务，再添加脚本。');
                      }
                      syncCurrentScriptState();
                      const newId = Date.now().toString();
                      const num = scriptList.value.length + 1;
                      const newScript = {
                          id: newId,
                          name: `脚本 ${num}`,
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
                      editingScriptId.value = null;
                  };

                  const deleteScriptTab = (id) => {
                      if (isAnalyzingScript.value || isGeneratingAll.value || isSequencePlaying.value) {
                          return alert('请先停止当前的生成或播放任务，再删除脚本。');
                      }
                      if (scriptList.value.length <= 1) return alert('至少保留一个脚本');
                      if (!confirm('确定删除此脚本吗？')) return;

                      const idx = scriptList.value.findIndex(s => s.id === id);
                      if (idx === -1) return;

                      if (id === currentScriptId.value) {
                          const nextIdx = idx === 0 ? 1 : idx - 1;
                          switchScript(scriptList.value[nextIdx].id);
                      }
                      scriptList.value.splice(idx, 1);
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
                  const isRestoring = ref(false); // 新增：恢复数据时的锁

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

                  const customPromptTemplate = ref(defaultPromptTemplate);
                  const useCustomPrompt = ref(false);

                  const defaultVoicePromptTemplate = `请根据以下小说片段，简要描述角色“\${charName}”的音色特征。\n要求：必须要带上性别，对音色的描述文本非常精炼，控制在20字以内。重点描述声音的物理质感（如声线粗细、年龄感、沙哑/清脆等），不要包含过多的性格或情绪描写。直接输出描述，不要废话。\n\n小说片段：\n\${rawScript}`;

                  const customVoicePromptTemplate = ref(defaultVoicePromptTemplate);
                  const useCustomVoicePrompt = ref(false);

                  const defaultQwenVoiceTextTemplate = "我是${charName}，初次见面，请多多指教。正在进行声线校准测试，一，二，三。这段音频将作为我的基准音色，希望能完美演绎接下来的故事，请多关照。";
                  const customQwenVoiceTextTemplate = ref(defaultQwenVoiceTextTemplate);
                  const useCustomQwenVoiceText = ref(false);

                  // --- 音频引擎与缓存 (Audio Engine & Cache) ---
                  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                  let videoRecordingAudioDestination = null;
                  const getAudioOutputNode = () => videoRecordingAudioDestination || audioContext.destination;
                  const audioBufferCache = new Map();
                  const processedDialogueAssetCache = new Map();
                  const processedDialogueBufferPromiseCache = new Map();
                  const localFileMap = ref(new Map());

                  // FFmpeg lifecycle and queue live in the audio adapter.
                  // Audio conversion helpers live in the audio service.
                  const getProcessedDialogueAsset = async (line) => {
                      if (!line?.audioUrl) return null;
                      const sourceBuffer = await loadAudioBuffer(line.audioUrl);
                      if (!sourceBuffer) return null;

                      const trimStart = line.trimStart || 0;
                      const trimEnd = line.trimEnd || 1;
                      const speed = line.speed || 1.0;
                      const cacheKey = [
                          line.id,
                          line.audioUrl,
                          sourceBuffer.length,
                          sourceBuffer.sampleRate,
                          trimStart,
                          trimEnd,
                          speed
                      ].join('|');

                      if (processedDialogueAssetCache.has(cacheKey)) {
                          return processedDialogueAssetCache.get(cacheKey);
                      }
                      if (processedDialogueBufferPromiseCache.has(cacheKey)) {
                          return processedDialogueBufferPromiseCache.get(cacheKey);
                      }

                      const processPromise = (async () => {
                          const safeSpeed = Math.max(0.2, Math.min(2, Number(speed) || 1));
                          const startSec = sourceBuffer.duration * trimStart;
                          const endSec = Math.max(startSec + 0.01, sourceBuffer.duration * trimEnd);

                          if (Math.abs(safeSpeed - 1) < 0.001 && trimStart <= 0.0001 && trimEnd >= 0.9999) {
                              const originalBlob = await getAudioBlobFromUrl(line.audioUrl);
                              const processedBuffer = sourceBuffer;
                              const asset = {
                                  buffer: processedBuffer,
                                  blob: originalBlob,
                                  url: line.audioUrl,
                                  duration: processedBuffer.duration
                              };
                              processedDialogueAssetCache.set(cacheKey, asset);
                              return asset;
                          }

                          const ffmpeg = await ensureFFmpegLoaded();
                          const sourceBlob = await getAudioBlobFromUrl(line.audioUrl);
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
                          const processedUrl = URL.createObjectURL(processedBlob);
                          const processedBuffer = await loadAudioBuffer(processedUrl);
                          const asset = {
                              buffer: processedBuffer,
                              blob: processedBlob,
                              url: processedUrl,
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

                  const loadAudioBuffer = async (filename) => {
                      if (!filename) return null;
                      if (audioBufferCache.has(filename)) return audioBufferCache.get(filename);

                      try {
                          let arrayBuffer;
                          if (localFileMap.value.has(filename)) {
                              arrayBuffer = await localFileMap.value.get(filename).arrayBuffer();
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
                          const buffer = await audioContext.decodeAudioData(arrayBuffer);
                          audioBufferCache.set(filename, buffer);
                          return buffer;
                      } catch (e) {
                          console.warn(`Failed to load audio: ${filename}`, e);
                          return null;
                      }
                  };

                  // --- 预览播放逻辑 ---
                  const previewPlayingFile = ref(null);
                  let previewSource = null;

                  const playPreview = async (item) => {
                      if (audioContext.state === 'suspended') await audioContext.resume();

                      if (previewSource) {
                          try { previewSource.stop(); } catch (e) { }
                          previewSource = null;
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
                          filename = item.filename || item.refPath;
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
                      if (buffer) {
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

                          previewSource.onended = () => {
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

                  const preloadAudioAssets = async () => {
                      // 移除启动时的自动预加载，因为现在没有持久化的文件列表
                      // 仅在导入工程后或添加文件时加载
                  };

                  // --- 波形绘制与剪辑逻辑 ---
                  const drawWaveform = async (canvas, item) => {
                      const audioPath = item.audioUrl || item.filename || item.refPath;
                      if (!canvas || !audioPath) return;

                      if (canvas._lastUrl === audioPath) return;
                      canvas._lastUrl = audioPath;

                      const buffer = await loadAudioBuffer(audioPath);
                      if (!buffer) {
                          const ctx = canvas.getContext('2d');
                          ctx.clearRect(0, 0, canvas.width, canvas.height);
                          return;
                      }

                      const ctx = canvas.getContext('2d');
                      const width = canvas.width;
                      const height = canvas.height;
                      const data = buffer.getChannelData(0);
                      const step = Math.ceil(data.length / width);
                      const amp = height / 2;

                      ctx.clearRect(0, 0, width, height);
                      ctx.fillStyle = '#94a3b8'; // slate-400
                      ctx.beginPath();

                      for (let i = 0; i < width; i++) {
                          let min = 1.0;
                          let max = -1.0;
                          for (let j = 0; j < step; j++) {
                              const datum = data[(i * step) + j];
                              if (datum < min) min = datum;
                              if (datum > max) max = datum;
                          }
                          ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
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
                               llmConfigs.value.push({ ...c, id: Date.now().toString(), name: '默认配置' });
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
                           await initDB();
                           isRestoring.value = true; // 开始恢复，暂停自动保存

                           // 1. Load Project Data
                           const projectData = await loadProjectRecord();

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
                              if (projectData.scriptList && Array.isArray(projectData.scriptList)) {
                                  projectData.scriptList.forEach(script => {
                                      if (script.data && script.data.scriptLines) {
                                           script.data.scriptLines = script.data.scriptLines.map(lineData => {
                                               return { trimStart: 0, trimEnd: 1, ...lineData, imageUrl: '', audioUrl: '', isGenerating: false };
                                           });
                                       }
                                   });
                                   scriptList.value = projectData.scriptList;
                                   currentScriptId.value = projectData.currentScriptId || (scriptList.value.length > 0 ? scriptList.value[0].id : 'default');
                               } else {
                                   // Compatibility for older format
                                   scriptList.value = [{
                                       id: 'default',
                                       name: '脚本 1',
                                       data: {
                                           rawScript: projectData.rawScript || '',
                                           scriptLines: (projectData.scriptLines || []).map(lineData => ({ trimStart: 0, trimEnd: 1, ...lineData, imageUrl: '', audioUrl: '', isGenerating: false })),
                                           rawAnalysisResult: projectData.rawAnalysisResult || '',
                                           characters: projectData.characters || []
                                       }
                                   }];
                                   currentScriptId.value = 'default';
                               }

                               // Load active script into view immediately
                               const active = scriptList.value.find(s => s.id === currentScriptId.value);
                               if (active) {
                                   rawScript.value = active.data.rawScript || '';
                                   scriptLines.value = active.data.scriptLines || [];
                                   rawAnalysisResult.value = active.data.rawAnalysisResult || '';
                                   characters.value = active.data.characters || [];
                                   characters.value.forEach(c => { if (c.volume === undefined) c.volume = 1.0; });
                               }

                               console.log('Project text data restored. Loading audio in background...');

                               // --- STAGE 2: Load audio assets in the background ---
                               setTimeout(async () => {
                                   const restoreAssets = async (lib, fileKey) => {
                                       if (!lib) return;
                                       for (const item of lib) {
                                           const filename = item[fileKey];
                                           if (filename) {
                                               if (localFileMap.value.has(filename)) continue;
                                               const blob = await loadAssetFromDB(filename);
                                               if (blob) {
                                                   const file = new File([blob], filename, { type: blob.type });
                                                   localFileMap.value.set(filename, file);
                                                   loadAudioBuffer(filename); // Pre-cache decoded buffer
                                               }
                                           }
                                       }
                                   };

                                   await restoreAssets(sfxLibrary.value, 'filename');
                                   await restoreAssets(bgmLibrary.value, 'filename');
                                   await restoreAssets(timbres.value, 'refPath');

                                   const allChars = scriptList.value.flatMap(s => s.data.characters || []);
                                   await restoreAssets(allChars, 'voiceFile');

                                   // Restore script line audio
                                   for (const script of scriptList.value) {
                                       const lines = script.data.scriptLines || [];
                                       for (const line of lines) {
                                          if (line.type === 'dialogue') {
                                               const audioKey = `line_audio_${line.id}`;
                                               const blob = await loadAssetFromDB(audioKey);
                                               if (blob) {
                                                   line.audioUrl = URL.createObjectURL(blob);
                                               }
                                          } else if (line.type === 'bgImage') {
                                              const bgKey = line.bgImageAssetKey || `bgImage_${line.id}`;
                                              const blob = await loadAssetFromDB(bgKey);
                                              if (blob) {
                                                  line.imageUrl = URL.createObjectURL(blob);
                                              }
                                           }
                                       }
                                   }
                                   console.log('Background audio loading complete.');
                               }, 100); // Small delay to let UI render first

                           }
                       } catch (e) {
                           console.error('Failed to restore from IndexedDB', e);
                       } finally {
                           // Slightly longer delay to ensure background loading has started
                           setTimeout(() => { isRestoring.value = false; }, 500);
                       }
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
                          return alert('请填写完整信息');
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
                      if (!confirm('确定删除此配置吗？')) return;
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
                          return alert('请填写完整信息');
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
                      if (!confirm('确定删除此 TTS 配置吗？')) return;
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
                          name: '新角色',
                          voiceFile: '', // Path for both display and synthesis
                          volume: 1.0
                      });
                  };

                  const deleteCharacter = (id) => {
                      if (!confirm('确定删除此角色吗？')) return;
                      characters.value = characters.value.filter(c => c.id !== id);
                  };

                  const analyzeCharacterVoice = async (char) => {
                      if (char.isAnalyzing) {
                          if (char.abortController) char.abortController.abort();
                          return;
                      }

                      if (!currentConfig.value) return alert('请先在“模型配置”中配置 LLM');
                      if (!rawScript.value.trim()) return alert('请先在右侧输入小说原文');

                      char.isAnalyzing = true;
                      const controller = new AbortController();
                      char.abortController = controller;

                      try {
                          const templateToUse = useCustomVoicePrompt.value ? customVoicePromptTemplate.value : defaultVoicePromptTemplate;
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

                          if (!res.ok) throw new Error(`LLM 请求失败: ${res.status}`);
                          const data = await res.json();
                          const content = data.choices[0]?.message?.content || '';
                          char.voiceDescription = content.trim();
                      } catch (e) {
                          if (e.name !== 'AbortError') {
                              alert('分析失败: ' + e.message);
                          }
                      } finally {
                          char.isAnalyzing = false;
                          delete char.abortController;
                      }
                  };

                  const generateQwenVoice = async (char) => {
                      if (char.isGeneratingVoice) {
                          if (char.abortController) char.abortController.abort();
                          return;
                      }

                      if (!currentTtsConfig.value) return alert('请先选择 TTS 服务');
                      if (!char.voiceDescription) return alert('请先填写音色描述');

                      char.isGeneratingVoice = true;
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

                          const template = useCustomQwenVoiceText.value ? customQwenVoiceTextTemplate.value : defaultQwenVoiceTextTemplate;
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
                              throw new Error(`生成失败: ${err}`);
                          }

                          const blob = await genRes.blob();
                          const filename = `qwen_${char.name}_${Date.now()}.wav`;
                          const file = new File([blob], filename, { type: 'audio/wav' });

                          // 2. 保存到本地资源管理
                          localFileMap.value.set(filename, file);
                          await saveAssetToDB(filename, file);

                          // 3. 上传回 TTS 服务器 (用于 IndexTTS 调用)
                          const formData = new FormData();
                          formData.append('audio', file);
                          formData.append('full_path', filename);

                          const upRes = await requestService(`${baseUrl}/v1/upload_audio`, {
                              method: 'POST',
                              body: formData,
                              signal: controller.signal
                          });
                          if (!upRes.ok) throw new Error('上传参考音频失败');

                          // 4. 添加或更新音色库
                          const timbreName = `${char.name}_AI`;
                          const existingIndex = timbres.value.findIndex(t => t.name === timbreName);

                          if (existingIndex !== -1) {
                              // 更新已有音色
                              timbres.value[existingIndex].description = char.voiceDescription;
                              timbres.value[existingIndex].refPath = filename;
                          } else {
                              // 新增音色
                              timbres.value.push({
                                  id: Date.now().toString(),
                                  name: timbreName,
                                  description: char.voiceDescription,
                                  refPath: filename
                              });
                          }

                          // 5. 选中该音色
                          char.voiceFile = filename;

                          // 6. 自动保存
                          triggerAutoSave();

                      } catch (e) {
                          console.error(e);
                          let msg = e.message;
                          const duration = (Date.now() - startTime) / 1000;

                          if (e.name === 'AbortError') {
                              if (controller.signal.reason === "timeout") {
                                  msg = '请求超时 (超过 30 分钟)。请检查后端是否卡死。';
                              } else {
                                  msg = '操作已手动取消。';
                              }
                          } else if (msg === 'Failed to fetch') {
                              msg = `连接异常中断 (耗时 ${Math.round(duration)}秒)。\n这不是前端代码设定的超时(30分钟)，而是您的浏览器或网络环境(如代理/Nginx)强制断开了连接。\n\n由于无法修改后端保存文件，此音频已丢失。\n建议：尝试精简音色描述以减少生成时间。`;
                          }
                          alert('生成音色失败: ' + msg);
                      } finally {
                          clearTimeout(timeoutId);
                          char.isGeneratingVoice = false;
                          delete char.abortController;
                      }
                  };


                  const handleTimbreFileUpload = (event) => {
                      const file = event.target.files[0];
                      if (file) {
                          timbreForm.value.refPath = file.name;
                          timbreFile.value = file; // Store the file object
                          localFileMap.value.set(file.name, file);
                          saveAssetToDB(file.name, file); // Save to DB
                          triggerAutoSave();
                      }
                      event.target.value = ''; // Reset file input
                  };

                  // --- 音色库管理逻辑 ---
                  const syncTimbresWithServer = async () => {
                      // 尝试获取可用的 TTS 配置
                      let cfg = currentTtsConfig.value;
                      if (!cfg && ttsConfigs.value.length > 0) {
                          // 如果当前未选中，默认使用第一个
                          currentTtsConfigId.value = ttsConfigs.value[0].id;
                          cfg = ttsConfigs.value[0];
                      }

                      if (!cfg) {
                          console.warn("未找到可用的 TTS 配置，无法同步音色文件。");
                          return;
                      }

                      let baseUrl = cfg.baseUrl.trim().replace(/\/+$/, '');
                      if (baseUrl.endsWith('/v1')) baseUrl = baseUrl.slice(0, -3);
                      console.log(`正在同步音色文件到服务器: ${baseUrl}`);

                      for (const t of timbres.value) {
                          if (!t.refPath) continue;

                          // 检查内存中是否有该文件
                          const file = localFileMap.value.get(t.refPath);
                          if (!file) {
                              console.warn(`音色文件未在内存中找到 (可能未导入或丢失): ${t.refPath}`);
                              continue;
                          }

                          try {
                              // 1. 检查服务器是否存在
                              const checkUrl = `${baseUrl}/v1/check/audio?file_name=${encodeURIComponent(t.refPath)}`;
                              const checkRes = await requestService(checkUrl);
                              let exists = false;
                              if (checkRes.ok) {
                                  const checkData = await checkRes.json();
                                  exists = checkData.exists;
                              }

                              // 2. 如果不存在，则上传
                              if (!exists) {
                                  console.log(`正在上传缺失的音色文件: ${t.name} (${t.refPath})`);
                                  const formData = new FormData();
                                  formData.append('audio', file);
                                  formData.append('full_path', t.refPath);

                                  await requestService(`${baseUrl}/v1/upload_audio`, {
                                      method: 'POST',
                                      body: formData,
                                  });
                              } else {
                                  console.log(`音色文件已存在: ${t.name}`);
                              }
                          } catch (e) {
                              console.error(`同步音色 ${t.name} 失败:`, e);
                          }
                      }
                      console.log("音色同步完成。");
                  };

                  const saveTimbre = async () => {
                      if (!timbreForm.value.name || !timbreForm.value.refPath) {
                          return alert('请填写音色名称并选择一个参考音频文件');
                      }

                      // A file MUST be selected when creating a NEW timbre.
                      if (!isEditingTimbre.value && !timbreFile.value) {
                          return alert('创建新音色时，必须选择一个参考音频文件。');
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
                              const index = timbres.value.findIndex(c => c.id === targetId);
                              if (index !== -1) {
                                  timbres.value[index] = newTimbreData;
                              }
                          } else {
                              timbres.value.push(newTimbreData);
                          }
                          // saveTimbresToLocal(); // 不再持久化到 localStorage
                          resetTimbreForm();

                      } catch (e) {
                          console.error("保存音色时出错:", e);
                          alert(`保存音色失败: ${e.message}`);
                      }
                  };

                  const editTimbre = (timbre) => {
                      timbreForm.value = { ...timbre };
                      isEditingTimbre.value = true;
                      timbreFile.value = null; // Important: reset file on edit start
                  };

                  const deleteTimbre = async (id) => {
                      if (!confirm('确定删除此音色吗？')) return;
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
                          return alert('请填写音效名称和文件路径');
                      }

                      try {
                          if (isEditingSfx.value) {
                              const index = sfxLibrary.value.findIndex(s => s.id === sfxForm.value.id);
                              if (index !== -1) sfxLibrary.value[index] = { ...sfxForm.value };
                          } else {
                              sfxLibrary.value.push({ ...sfxForm.value, id: Date.now().toString(), enabled: true });
                          }
                          if (sfxForm.value.filename) loadAudioBuffer(sfxForm.value.filename);
                          // saveSfxToLocal();
                          resetSfxForm();
                      } catch (e) {
                          alert(`保存音效失败: ${e.message}`);
                      }
                  };

                  const editSfx = (sfx) => {
                      sfxForm.value = { trimStart: 0, trimEnd: 1, volume: 1.0, ...sfx };
                      isEditingSfx.value = true;
                  };

                  const deleteSfx = (id) => {
                      if (!confirm('确定删除？')) return;
                      sfxLibrary.value = sfxLibrary.value.filter(s => s.id !== id);
                  };

                  const resetSfxForm = () => {
                      sfxForm.value = { id: '', name: '', description: '', filename: '', trimStart: 0, trimEnd: 1, volume: 0.3 };
                      isEditingSfx.value = false;
                  };

                  const handleSfxFileUpload = (event) => {
                      const file = event.target.files[0];
                      if (file) {
                          sfxForm.value.filename = file.name;
                          sfxForm.value.trimStart = 0;
                          sfxForm.value.trimEnd = 1;
                          sfxForm.value.volume = 0.3;
                          localFileMap.value.set(file.name, file);
                          saveAssetToDB(file.name, file); // Save to DB
                          triggerAutoSave();
                          loadAudioBuffer(file.name);
                      }
                      event.target.value = '';
                  };

                  // --- BGM库管理逻辑 ---
                  const saveBgmToLocal = () => {
                      localStorage.setItem(storageKeys.bgm, JSON.stringify(bgmLibrary.value));
                  };

                  const saveBgm = async () => {
                      if (!bgmForm.value.name || !bgmForm.value.filename) {
                          return alert('请填写 BGM 名称和文件路径');
                      }

                      try {
                          if (isEditingBgm.value) {
                              const index = bgmLibrary.value.findIndex(s => s.id === bgmForm.value.id);
                              if (index !== -1) bgmLibrary.value[index] = { ...bgmForm.value };
                          } else {
                              bgmLibrary.value.push({ ...bgmForm.value, id: Date.now().toString(), enabled: true });
                          }
                          if (bgmForm.value.filename) loadAudioBuffer(bgmForm.value.filename);
                          // saveBgmToLocal();
                          resetBgmForm();
                      } catch (e) {
                          alert(`保存 BGM 失败: ${e.message}`);
                      }
                  };

                  const editBgm = (bgm) => {
                      bgmForm.value = { trimStart: 0, trimEnd: 1, volume: 1.0, ...bgm };
                      isEditingBgm.value = true;
                  };

                  const deleteBgm = (id) => {
                      if (!confirm('确定删除？')) return;
                      bgmLibrary.value = bgmLibrary.value.filter(s => s.id !== id);
                  };

                  const resetBgmForm = () => {
                      bgmForm.value = { id: '', name: '', description: '', filename: '', trimStart: 0, trimEnd: 1, volume: 0.3 };
                      isEditingBgm.value = false;
                  };

                  const handleBgmFileUpload = (event) => {
                      const file = event.target.files[0];
                      if (file) {
                          bgmForm.value.filename = file.name;
                          bgmForm.value.trimStart = 0;
                          bgmForm.value.trimEnd = 1;
                          bgmForm.value.volume = 0.3;
                          localFileMap.value.set(file.name, file);
                          saveAssetToDB(file.name, file); // Save to DB
                          triggerAutoSave();
                          loadAudioBuffer(file.name);
                      }
                      event.target.value = '';
                  };

                  // --- 滤波器库管理逻辑 ---
                  const saveFiltersToLocal = () => {
                      localStorage.setItem(storageKeys.filters, JSON.stringify(filterLibrary.value));
                  };

                  const saveFilter = () => {
                      if (!filterForm.value.name) return alert('请填写滤波器名称');

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
                      // saveFiltersToLocal();
                      resetFilterForm();
                  };

                  const editFilter = (filter) => {
                      filterForm.value = { ...filter };
                      isEditingFilter.value = true;
                  };

                  const deleteFilter = (id) => {
                      if (!confirm('确定删除此滤波器？')) return;
                      filterLibrary.value = filterLibrary.value.filter(f => f.id !== id);
                      // saveFiltersToLocal();
                  };

                  const resetFilterForm = () => {
                      filterForm.value = { id: '', name: '', description: '', type: 'lowpass', frequency: 1000, Q: 1, gain: 0 };
                      isEditingFilter.value = false;
                  };

                  // --- 情绪预设管理逻辑 ---
                  // 移除 saveEmotionPresetsToLocal

                  const saveEmotion = () => {
                      if (!emotionForm.value.name) return alert('请填写情绪名称');
                      if (isSystemEmotion(emotionForm.value.name)) return alert('无法修改或覆盖系统预设情绪');
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
                      if (!confirm('确定删除？')) return;
                      emotionPresets.value = emotionPresets.value.filter(e => e.id !== id);
                      // saveEmotionPresetsToLocal();
                  };

                  const resetEmotionForm = () => {
                      emotionForm.value = { id: '', name: '', vector: [0, 0, 0, 0, 0, 0, 0, 0] };
                      isEditingEmotion.value = false;
                  };

                  const resetEmotionsToDefault = () => {
                      if (!confirm('确定要重置所有情绪预设为默认值吗？这将清除自定义的情绪。')) return;
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
                          alert('请先在 TTS 配置中心选择一个 TTS 服务');
                          return;
                      }

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
                              throw new Error(`角色 "${line.role}" 未绑定音色文件路径。\n\n请在左侧的角色列表中为该角色选择一个音色文件，或手动输入路径。`);
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

                          const cfg = currentTtsConfig.value;
                          let baseUrl = cfg.baseUrl.trim().replace(/\/+$/, '');
                          if (baseUrl.endsWith('/v1')) baseUrl = baseUrl.slice(0, -3);

                          const voiceFile = localFileMap.value.get(char.voiceFile);
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
                              throw new Error(`语音合成失败: ${errText}`);
                          }

                          const blob = await synthRes.blob();
                          await saveAssetToDB(`line_audio_${line.id}`, blob);
                          const audioUrl = URL.createObjectURL(blob);
                          line.audioUrl = audioUrl;
                          line.trimStart = 0;
                          line.trimEnd = 1;

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

                                      const linesToProcess = linesToCheck.filter(l => l.type === 'dialogue' && !l.audioUrl);

                                      for (const line of linesToProcess) {

                                          const char = characters.value.find(c => c.name === line.role);

                                          if (!char || !char.voiceFile) {

                                              const lineIndex = scriptLines.value.findIndex(l => l.id === line.id);

                                              alert(`一键生成已终止。\n\n原因：第 ${lineIndex + 1} 行台词的角色（${line.role}）没有绑定音源。`);

                                              return;

                                          }

                                      }



                                      const dialogueCount = linesToProcess.length;

                                      if (dialogueCount === 0) {

                                          alert('没有需要生成的台词音频。');

                                          return;

                                      }



                                      const confirmMsg = startIndex > 0

                                          ? `即将从第 ${startIndex + 1} 行（选中行）开始，为后续 ${dialogueCount} 条【未生成】的台词生成音频。确定继续吗？`

                                          : `即将为全部 ${dialogueCount} 条【未生成】的台词生成音频。确定继续吗？`;



                                      if (!confirm(confirmMsg)) return;



                                      isGeneratingAll.value = true;

                                      batchAbortController = new AbortController();

                                      const batchSignal = batchAbortController.signal;

                                      let failedCount = 0;



                                      try {

                                          // Iterate through the original slice to maintain order, but only process what's needed.

                                          for (const line of linesToCheck) {

                                              if (batchSignal.aborted) break;



                                              if (line.type === 'dialogue' && !line.audioUrl) {

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

                                              alert('批量生成已停止。');

                                          } else if (failedCount > 0) {

                                              alert(`一键生成完成，但有 ${failedCount} 条台词生成失败。请检查控制台或单独重新生成失败的台词。`);

                                          } else {

                                              await saveProjectToDB();

                                              alert('批量生成完成！');

                                          }

                                      } catch (e) {

                                          console.error("生成全部音频时发生意外错误:", e);

                                          alert('生成过程中出现未知错误，详情请查看控制台。');

                                      } finally {

                                          isGeneratingAll.value = false;

                                          batchAbortController = null;

                                      }

                                  };



                                  const clearAllGeneratedAudio = async () => {

                                      const linesWithAudio = scriptLines.value.filter(l => l.audioUrl);

                                      if (linesWithAudio.length === 0) {

                                          return alert('没有已生成的音频可以清除。');

                                      }

                                      if (!confirm(`确定要清除所有 ${linesWithAudio.length} 条已生成的音频吗？此操作不可撤销。`)) {

                                          return;

                                      }



                                      for (const line of linesWithAudio) {

                                          // Don't wait for each one, do them in parallel

                                          clearLineAudio(line);

                                      }



                                      alert('所有已生成的音频已被清除。');

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

                              if (!line.audioUrl) return resolve(); // Resolve silently if no audio

                              isAuditioningId.value = line.id;

                              // 3. Prepare loading promises
                              const loadSfx = async () => {
                                  if (!line.sfx || line.sfx.length === 0) return [];
                                  const promises = line.sfx.map(async (sfxItem) => {
                                      const sfxLibItem = sfxLibrary.value.find(s => s.name === sfxItem.name);
                                      if (sfxLibItem && sfxLibItem.filename) {
                                          const buf = await loadAudioBuffer(sfxLibItem.filename);
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
                              if (line.filter) {
                                  const filterConfig = filterLibrary.value.find(f => f.name === line.filter);
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
                              // alert('播放音频失败，请检查文件或网络。'); // Suppress alert for smoother UX
                              isAuditioningId.value = null;
                              resolve(); // Resolve to not block sequence
                          }
                      });
                  };

                  const clearLineAudio = async (line) => {
                      if (!line.audioUrl) return;

                      const audioUrlToDelete = line.audioUrl;
                      const audioKey = `line_audio_${line.id}`;

                      line.audioUrl = '';
                      URL.revokeObjectURL(audioUrlToDelete);

                      if (audioBufferCache.has(audioUrlToDelete)) {
                          audioBufferCache.delete(audioUrlToDelete);
                      }

                      try {
                          await deleteAssetFromDB(audioKey);
                      } catch (e) {
                          console.error(`Failed to delete asset ${audioKey} from DB`, e);
                      }

                      triggerAutoSave();
                  };

                  // --- 存档管理逻辑 ---
                  // Project media conversion and streaming import live in the project service.
                  const exportScriptState = async () => {
                      if (!confirm('即将导出包含所有素材（音效、BGM、音色）的完整工程文件。如果素材较多，文件可能较大，请耐心等待。')) return;

                      isExportingProject.value = true;
                      exportStatus.value = '准备中...';

                      syncCurrentScriptState(); // 确保最新状态

                      try {
                          // 1. 处理资源库 (嵌入音频文件)
                          const processLibrary = async (lib, fileKey) => {
                              const processed = [];
                              for (let i = 0; i < lib.length; i++) {
                                  const item = lib[i];
                                  // 进度提示 & 让出主线程防止卡死
                                  if (i % 20 === 0) { exportStatus.value = `打包资源 ${Math.round((i / lib.length) * 100)}%`; await new Promise(r => requestAnimationFrame(r)); }

                                  const itemCopy = { ...item };
                                  const filename = item[fileKey];
                                  if (filename) {
                                      let blob = null;
                                      // 1. 优先从内存 Map 获取 (File 对象)
                                      if (localFileMap.value.has(filename)) {
                                          blob = localFileMap.value.get(filename);
                                      }
                                      // 2. 如果内存没有，尝试从 IndexedDB 读取 (Blob)
                                      if (!blob) {
                                          blob = await loadAssetFromDB(filename);
                                      }

                                      if (blob) {
                                          try {
                                              itemCopy._fileData = await blobToBase64(blob);
                                              itemCopy._mimeType = blob.type;
                                          } catch (e) {
                                              console.warn(`Failed to embed file: ${filename}`, e);
                                          }
                                      }
                                  }
                                  processed.push(itemCopy);
                              }
                              return processed;
                          };

                          const sfxExport = await processLibrary(sfxLibrary.value, 'filename');
                          const bgmExport = await processLibrary(bgmLibrary.value, 'filename');
                          const timbreExport = await processLibrary(timbres.value, 'refPath');

                          // 导出所有脚本的音频
                          const scriptListExport = JSON.parse(JSON.stringify(scriptList.value));

                          // 遍历所有脚本的所有台词
                          for (const script of scriptListExport) {
                              const lines = script.data.scriptLines || [];
                              for (let i = 0; i < lines.length; i++) {
                                  const line = lines[i];
                                  line.isGenerating = false;

                              if (i % 20 === 0) { exportStatus.value = `打包音频...`; await new Promise(r => requestAnimationFrame(r)); }

                              // 尝试获取音频 Blob (优先 fetch URL，失败则查 DB)
                              let blob = null;
                              // 注意：这里 line.audioUrl 在 scriptListExport 中只是字符串，
                              // 我们需要去原始 scriptList 中找对应的 blob url，或者直接查 DB

                              // 简单起见，直接查 DB，因为 audioUrl 可能是 blob: 且不一定在当前页面上下文中有效（如果跨页面）
                              // 但这里是在当前页面，所以 blob url 有效。
                              // 我们需要找到原始内存中的 line 对象来获取 audioUrl
                              const originalScript = scriptList.value.find(s => s.id === script.id);
                              const originalLine = originalScript?.data.scriptLines[i];

                              if (line.audioUrl) {
                                  try {
                                      const res = await fetch(originalLine.audioUrl);
                                      blob = await res.blob();
                                  } catch (e) { /* ignore */ }
                              }

                              if (!blob && line.type === 'dialogue') {
                                  blob = await loadAssetFromDB(`line_audio_${line.id}`);
                              }

                              if (!blob && line.type === 'bgImage') {
                                  const bgKey = line.bgImageAssetKey || `bgImage_${line.id}`;
                                  blob = await loadAssetFromDB(bgKey);
                              }

                              if (blob) {
                                  try {
                                      if (line.type === 'dialogue') {
                                          line.audioBase64 = await blobToBase64(blob);
                                          line.audioUrl = ''; // 导出时不保存 blob URL
                                      } else if (line.type === 'bgImage') {
                                          line.imageBase64 = await blobToBase64(blob);
                                          line.imageMimeType = blob.type;
                                          line.imageUrl = ''; // 导出时不保存 blob URL
                                      }
                                  } catch (e) {
                                      console.warn('导出资源失败:', line.id, e);
                                  }
                              }
                              }
                          }

                          exportStatus.value = '生成文件...';
                          await new Promise(r => requestAnimationFrame(r));

                          const blob = createProjectExportBlob({
                              sfx: sfxExport,
                              bgm: bgmExport,
                              timbres: timbreExport,
                              filters: filterLibrary.value,
                              emotions: emotionPresets.value,
                              characters: characters.value,
                              scriptList: scriptListExport,
                              currentScriptId: currentScriptId.value
                          });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          const now = new Date();
                          const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
                          a.download = `Unitale工程文件_${timestamp}.json`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          setTimeout(() => URL.revokeObjectURL(url), 30000);
                      } catch (e) {
                          console.error(e);
                          alert('导出失败: ' + e.message);
                      } finally {
                          isExportingProject.value = false;
                          exportStatus.value = '';
                      }
                  };

                  const triggerImport = () => {
                      importFileRef.value.click();
                  };

                  const handleImportFile = async (event) => {
                      const file = event.target.files[0];
                      if (!file) return;

                      try {
                          isRestoring.value = true; // 导入期间锁定，防止自动保存触发
                          isExportingProject.value = true; // 复用 loading 状态
                          exportStatus.value = '读取巨型文件中...';

                          exportStatus.value = '读取文件中...';
                          const extractedBlobs = [];
                          let data;

                          if (file.size > 50 * 1024 * 1024) {
                              exportStatus.value = '提取媒体数据...';
                              const { tinyJsonStr, extractedBlobs: streamExtractedBlobs } = await extractMediaJsonFromFileStream(file);
                              extractedBlobs.push(...streamExtractedBlobs);
                              if (!tinyJsonStr || !tinyJsonStr.trim()) {
                                  throw new Error('导入文件为空或流式读取失败。');
                              }

                              exportStatus.value = '解析结构数据...';
                              try {
                                  data = JSON.parse(tinyJsonStr);
                              } catch (err) {
                                  console.error("JSON解析失败:", err);
                                  const match = err.message.match(/position (\d+)/);
                                  if (match) {
                                      const pos = parseInt(match[1]);
                                      console.error("解析出错位置附近内容:", tinyJsonStr.substring(Math.max(0, pos - 80), pos + 80));
                                  } else {
                                      console.error("流式预处理后尾部片段:", tinyJsonStr.slice(-200));
                                  }
                                  exportStatus.value = `解析失败: ${err.message}`;
                                  throw err;
                              }
                          } else {
                              const text = await file.text();
                              if (!text || !text.trim()) {
                                  throw new Error('导入文件为空。请重新导出后再试；旧导出的文件可能在下载时没有完整写入。');
                              }

                              exportStatus.value = '解析结构数据...';
                              try {
                                  data = JSON.parse(text);
                              } catch (directParseError) {
                                  console.warn('直接解析失败，尝试启用 Base64 提取兼容路径...', directParseError);
                                  exportStatus.value = '提取媒体数据...';

                                  let tinyJsonStr;
                                  try {
                                      tinyJsonStr = text.replace(/"(_fileData|audioBase64|imageBase64)"\s*:\s*"(data:[^"]+)"/g, (match, key, base64) => {
                                          extractedBlobs.push(base64);
                                          return `"${key}":"__EXTRACTED_BASE64_${extractedBlobs.length - 1}__"`;
                                      });
                                  } catch (e) {
                                      console.error('正则替换提取Base64时出错:', e);
                                      exportStatus.value = `提取失败: ${e.message}`;
                                      throw e;
                                  }

                                  try {
                                      data = JSON.parse(tinyJsonStr);
                                  } catch (err) {
                                      console.error("JSON解析失败:", err);
                                      const match = err.message.match(/position (\d+)/);
                                      if (match) {
                                          const pos = parseInt(match[1]);
                                          console.error("解析出错位置附近内容:", tinyJsonStr.substring(Math.max(0, pos - 80), pos + 80));
                                      } else {
                                          console.error("原始文件尾部片段:", text.slice(-200));
                                          console.error("预处理后尾部片段:", tinyJsonStr.slice(-200));
                                      }
                                      exportStatus.value = `解析失败: ${err.message}`;
                                      throw err;
                                  }
                              }
                          }

                              const assetsToSave = []; // 用于批量收集待保存的音频文件

                              // 辅助函数：恢复资源库文件
                              const restoreLibraryFiles = async (libItems, fileKey) => {
                                  if (!libItems || !Array.isArray(libItems)) return [];
                                  const restoredItems = [];
                                  for (const item of libItems) {
                                      if (!item) continue;
                                      if (item._fileData) {
                                          try {
                                              // 如果使用了提取器，拿回真实的 base64 数据
                                              let realBase64 = item._fileData;
                                              if (realBase64.startsWith('__EXTRACTED_BASE64_')) {
                                                  const match = realBase64.match(/__EXTRACTED_BASE64_(\d+)__/);
                                                  if (match) realBase64 = extractedBlobs[parseInt(match[1])];
                                              }

                                              const blob = base64ToBlob(realBase64, item._mimeType || 'audio/wav');
                                              const file = new File([blob], item[fileKey], { type: item._mimeType || 'audio/wav' });
                                              localFileMap.value.set(item[fileKey], file);

                                              // 优化：收集到批量列表，稍后统一保存
                                              assetsToSave.push({ key: item[fileKey], blob: file });

                                              // 预加载到缓存
                                              loadAudioBuffer(item[fileKey]);

                                              delete item._fileData;
                                              delete item._mimeType;
                                          } catch (err) {
                                              console.warn(`Failed to restore file: ${item[fileKey]}`, err);
                                          }
                                      }
                                      restoredItems.push(item);
                                  }
                                  return restoredItems;
                              };

                              if (data.version === '2.0' || data.project) {
                                  // v2.0 完整工程格式
                                  if (!confirm('检测到完整工程文件。导入将覆盖当前的【资源库和脚本】（模型配置不会被覆盖）。确定继续吗？')) return;

                                  // --- 清空当前数据 ---
                                  rawScript.value = '';
                                  rawAnalysisResult.value = '';
                                  characters.value = [];
                                  scriptLines.value = [];
                                  scriptList.value = [{ id: 'default', name: '脚本 1', data: { rawScript: '', scriptLines: [], rawAnalysisResult: '', characters: [] } }];
                                  sfxLibrary.value = [];
                                  bgmLibrary.value = [];
                                  timbres.value = [];
                                  filterLibrary.value = [];
                                  emotionPresets.value = [];
                                  localFileMap.value.clear();
                                  audioBufferCache.clear();

                                  // 2. 恢复资源库
                                  if (data.libraries) {
                                      sfxLibrary.value = (await restoreLibraryFiles(data.libraries.sfx, 'filename')).map(s => ({ ...s, volume: s.volume ?? 0.3 }));
                                      bgmLibrary.value = (await restoreLibraryFiles(data.libraries.bgm, 'filename')).map(b => ({ ...b, volume: b.volume ?? 0.3 }));
                                      timbres.value = await restoreLibraryFiles(data.libraries.timbres, 'refPath');
                                      filterLibrary.value = data.libraries.filters || [];
                                      emotionPresets.value = data.libraries.emotions || [];

                                      // 恢复情绪库：合并系统预设 + 导入的自定义情绪
                                      if (data.libraries.emotions && Array.isArray(data.libraries.emotions)) {
                                          const customImported = data.libraries.emotions.filter(e => !isSystemEmotion(e.name) && Array.isArray(e.vector));
                                          const systemImported = data.libraries.emotions.filter(e => isSystemEmotion(e.name));

                                          const mergedSystem = SYSTEM_EMOTIONS.map(def => {
                                              const imported = systemImported.find(s => s.name === def.name);
                                              return { ...def, enabled: imported ? imported.enabled : undefined };
                                          });

                                          emotionPresets.value = [...mergedSystem, ...customImported];
                                      } else {
                                          emotionPresets.value = [...SYSTEM_EMOTIONS];
                                      }

                                      // 不再调用 save*ToLocal，因为数据仅在内存中

                                      // 不在启动或导入时自动同步音色到 TTS 服务器。
                                      // 仅在用户主动点击生成相关按钮时，再按需检查和上传。
                                  }

                                  // 3. 恢复项目状态
                                  const proj = data.project;
                                  characters.value = proj.characters || [];
                                  characters.value.forEach(c => { if (c.volume === undefined) c.volume = 1.0; });

                                  if (proj.scriptList) {
                                      scriptList.value = proj.scriptList;
                                      currentScriptId.value = proj.currentScriptId || scriptList.value[0].id;
                                  } else {
                                      // 兼容旧版 v2.0 (如果存在)
                                      scriptList.value = [{
                                          id: 'default',
                                          name: '脚本 1',
                                          data: {
                                              rawScript: proj.rawScript || '',
                                              scriptLines: proj.scriptLines || [],
                                              rawAnalysisResult: proj.rawAnalysisResult || '',
                                              characters: proj.characters || []
                                          }
                                      }];
                                      currentScriptId.value = 'default';
                                  }

                                  // 恢复台词音频
                                  exportStatus.value = '恢复台词音频...';
                                  for (const script of scriptList.value) {
                                      const lines = script.data.scriptLines || [];
                                      for (const line of lines) {
                                          if (!line) continue;
                                          if (line.audioBase64) {
                                              try {
                                                  let realAudioBase64 = line.audioBase64;
                                                  if (typeof realAudioBase64 === 'string' && realAudioBase64.startsWith('__EXTRACTED_BASE64_')) {
                                                      const match = realAudioBase64.match(/__EXTRACTED_BASE64_(\d+)__/);
                                                      if (match) realAudioBase64 = extractedBlobs[parseInt(match[1])];
                                                  }
                                                  let blob;
                                                  if (realAudioBase64.startsWith('data:')) {
                                                      const parts = realAudioBase64.split(',');
                                                      const mime = parts[0].match(/:(.*?);/)[1];
                                                      blob = base64ToBlob(realAudioBase64, mime);
                                                  } else {
                                                      const res = await fetch(realAudioBase64);
                                                      blob = await res.blob();
                                                  }
                                                  assetsToSave.push({ key: `line_audio_${line.id}`, blob: blob });
                                                  if (line.speed === undefined) line.speed = 1.0;
                                                  line.audioUrl = URL.createObjectURL(blob);
                                                  delete line.audioBase64;
                                              } catch (err) { console.warn('Audio restore failed', err); }
                                          }
                                          if (line.type === 'bgImage' && line.imageBase64) {
                                              try {
                                                  let realImageBase64 = line.imageBase64;
                                                  if (typeof realImageBase64 === 'string' && realImageBase64.startsWith('__EXTRACTED_BASE64_')) {
                                                      const match = realImageBase64.match(/__EXTRACTED_BASE64_(\d+)__/);
                                                      if (match) realImageBase64 = extractedBlobs[parseInt(match[1])];
                                                  }
                                                  let blob;
                                                  if (realImageBase64.startsWith('data:')) {
                                                      const parts = realImageBase64.split(',');
                                                      const mime = parts[0].match(/:(.*?);/)[1];
                                                      blob = base64ToBlob(realImageBase64, mime);
                                                  } else {
                                                      const res = await fetch(realImageBase64);
                                                      blob = await res.blob();
                                                  }
                                                  const bgKey = line.bgImageAssetKey || `bgImage_${line.id}`;
                                                  line.bgImageAssetKey = bgKey;
                                                  assetsToSave.push({ key: bgKey, blob: blob });
                                                  line.imageUrl = URL.createObjectURL(blob);
                                                  delete line.imageBase64;
                                                  // imageMimeType 将由 blob.type 自动带入
                                              } catch (err) { console.warn('Image restore failed', err); }
                                          }
                                      }
                                  }

                                  // 加载当前脚本
                                  const active = scriptList.value.find(s => s.id === currentScriptId.value);
                                  if (active) {
                                      rawScript.value = active.data.rawScript;
                                      scriptLines.value = active.data.scriptLines;
                                      rawAnalysisResult.value = active.data.rawAnalysisResult;
                                      characters.value = active.data.characters || [];
                                      characters.value.forEach(c => { if (c.volume === undefined) c.volume = 1.0; });
                                  }

                                  // 执行批量保存 (一次性写入所有文件)
                                  exportStatus.value = '写入数据库...';
                                  if (assetsToSave.length > 0) {
                                      try {
                                          await saveAssetsBatch(assetsToSave);
                                      } catch (e) {
                                          console.error("Asset save failed:", e);
                                          alert("警告：部分音频资源保存到数据库失败（可能是空间不足），刷新页面后可能会丢失音频文件。但脚本和角色设置将尝试保存。");
                                      }
                                  }

                                  // 强制保存一次项目状态到 DB，确保 JSON 数据也同步
                                  await saveProjectToDB();

                                  alert('完整工程导入成功！所有资源和设置已恢复。');

                              } else if (data.scriptLines && Array.isArray(data.scriptLines)) {
                                  // v1.x 旧版存档格式兼容
                                  if (confirm('检测到旧版存档。确定要读取吗？当前未保存的进度将被覆盖。')) {
                                      // 修复：先清空角色列表，防止残留
                                      characters.value = [];

                                      if (data.rawScript !== undefined) rawScript.value = data.rawScript;
                                      if (data.rawAnalysisResult !== undefined) rawAnalysisResult.value = data.rawAnalysisResult;

                                      // 修复：读取存档时，如果存档包含角色列表则直接使用，否则根据台词重建角色列表
                                      // 这样可以确保“没有的角色要删除”，并且“角色的音色选用也要保存”
                                      if (data.characters && Array.isArray(data.characters)) {
                                          characters.value = data.characters;
                                          characters.value.forEach(c => { if (c.volume === undefined) c.volume = 1.0; });
                                      } else {
                                          // 兼容旧存档：从台词中提取角色
                                          const roles = new Set();
                                          data.scriptLines.forEach(l => {
                                              if (l.type === 'dialogue' && l.role) roles.add(l.role);
                                          });
                                          characters.value = Array.from(roles).map(r => {
                                              const matchingTimbre = timbres.value.find(t => t.name === r);
                                              return {
                                                  id: Date.now() + Math.random().toString(),
                                                  name: r,
                                                  voiceFile: matchingTimbre ? matchingTimbre.refPath : '',
                                                  volume: 1.0
                                              };
                                          });
                                      }

                                      // 恢复音频数据 (Base64 -> Blob URL)
                                      exportStatus.value = '恢复旧版数据...';

                                      // 初始化脚本列表
                                      scriptList.value = [{
                                          id: 'default',
                                          name: '脚本 1',
                                          data: { rawScript: rawScript.value, scriptLines: [], rawAnalysisResult: rawAnalysisResult.value }
                                      }];
                                      currentScriptId.value = 'default';
                                      const activeScriptData = scriptList.value[0].data;
                                      const restoredLines = [];

                                      for (const line of data.scriptLines) {
                                          // 兼容性修复：确保必要字段存在
                                          if (!line.id) line.id = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
                                          if (!line.type) line.type = 'dialogue';
                                          if (line.trimStart === undefined) line.trimStart = 0;
                                          if (line.trimEnd === undefined) line.trimEnd = 1;
                                          if (line.speed === undefined) line.speed = 1.0;

                                          // 兼容旧版音量字段
                                          if (line.type === 'dialogue') {
                                              if (line.dialogueVolume === undefined && line.volume !== undefined) line.dialogueVolume = line.volume;
                                              if (line.dialogueVolume === undefined) line.dialogueVolume = 1.0;
                                          }

                                          if (line.audioBase64) {
                                              try {
                                                  const res = await fetch(line.audioBase64);
                                                  const blob = await res.blob();

                                                  // 优化：收集到批量列表
                                                  assetsToSave.push({ key: `line_audio_${line.id}`, blob: blob });

                                                  line.audioUrl = URL.createObjectURL(blob);
                                                  // delete line.audioBase64; // 可选：释放内存，但保留在对象中也没关系
                                              } catch (err) {
                                                  console.warn('恢复音频失败:', line.id, err);
                                              }
                                          }
                                          restoredLines.push(line);
                                      }

                                      activeScriptData.scriptLines = restoredLines;
                                      scriptLines.value = restoredLines; // Sync to view

                                      exportStatus.value = '保存中...';
                                      if (assetsToSave.length > 0) {
                                          try {
                                              await saveAssetsBatch(assetsToSave);
                                          } catch (e) {
                                              console.error("Asset save failed:", e);
                                          }
                                      }
                                      await saveProjectToDB();
                                      alert('存档读取成功！');
                                  }
                              } else {
                                  alert('无效的存档文件格式');
                              }
                          } catch (err) {
                              console.error('导入工程失败:', err);
                              exportStatus.value = `导入失败: ${err.message}`;
                              alert(`导入失败: ${err.message}\n请打开控制台查看详细报错。`);
                          } finally {
                              isExportingProject.value = false;
                              exportStatus.value = '';
                          }
                          event.target.value = ''; // Reset
                  };

                  const triggerImportTxt = () => {
                      importTxtRef.value.click();
                  };

                  const handleImportTxt = (event) => {
                      const file = event.target.files[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (e) => {
                          rawScript.value = e.target.result;
                      };
                      reader.readAsText(file);
                      event.target.value = '';
                  };

                  // --- 导出音频逻辑 (WAV) ---
                  const exportAudio = async () => {
                      const dialogueLines = scriptLines.value.filter(l => l.type === 'dialogue');
                      if (dialogueLines.length === 0) return alert('脚本为空');
                      if (dialogueLines.some(l => !l.audioUrl)) {
                          if (!confirm('部分台词尚未生成音频，导出时将被跳过。确定继续吗？')) return;
                      }

                      isExportingAudio.value = true;

                      try {
                          const assets = { processedDialogues: {}, dialogueTimings: {}, sfx: {}, bgm: {} };

                          // 1. 加载所有台词音频
                          for (const line of dialogueLines) {
                              if (line.audioUrl) {
                                  assets.processedDialogues[line.id] = await getProcessedDialogueBuffer(line);
                                  assets.dialogueTimings[line.id] = await getDialogueTimingInfo(line);
                              }
                          }

                          // 2. 加载用到的音效
                          const usedSfxNames = new Set();
                          scriptLines.value.forEach(l => { if (l.sfx) l.sfx.forEach(s => usedSfxNames.add(s.name)); });
                          for (const name of usedSfxNames) {
                              const item = sfxLibrary.value.find(s => s.name === name);
                              if (item && item.filename) {
                                  try { assets.sfx[name] = await loadAudioBuffer(item.filename); } catch (e) { }
                              }
                          }

                          // 3. 加载用到的 BGM
                          const usedBgmNames = new Set();
                          scriptLines.value.forEach(l => { if (l.type === 'bgm' && l.action === 'play') usedBgmNames.add(l.bgmName); });
                          for (const name of usedBgmNames) {
                              const item = bgmLibrary.value.find(b => b.name === name);
                              if (item && item.filename) {
                                  try { assets.bgm[name] = await loadAudioBuffer(item.filename); } catch (e) { }
                              }
                          }

                          // 4. 计算时间轴
                          let currentTime = 0;
                          const events = [];
                          const bgmSegments = [];
                          let currentBgm = null;

                          for (const line of scriptLines.value) {
                              if (line.type === 'bgm') {
                                  if (line.action === 'play') {
                                      if (currentBgm) bgmSegments.push({ ...currentBgm, end: currentTime });
                                      currentBgm = { name: line.bgmName, start: currentTime, volume: line.volume };
                                  } else if (line.action === 'stop') {
                                      if (currentBgm) {
                                          bgmSegments.push({ ...currentBgm, end: currentTime });
                                          currentBgm = null;
                                      }
                                  }
                              } else if (line.type === 'dialogue') {
                                  const processedBuffer = assets.processedDialogues[line.id];
                                  const timingInfo = assets.dialogueTimings[line.id];
                                  if (processedBuffer && timingInfo) {
                                      // 模拟 playLineAudio 中的 0.05s 调度延迟，确保导出节奏与实时播放一致
                                      currentTime += 0.05;
                                      events.push({
                                          type: 'dialogue',
                                          time: currentTime,
                                          buffer: processedBuffer,
                                          duration: timingInfo.effectiveDuration,
                                          line: line
                                      });
                                      currentTime += timingInfo.effectiveDuration;
                                  }
                                  currentTime += (line.break_duration || 0);
                              }
                          }
                          if (currentBgm) bgmSegments.push({ ...currentBgm, end: currentTime + EXPORT_TAIL_PADDING_SEC });

                          // 5. 离线渲染
                          const totalDuration = currentTime + EXPORT_TAIL_PADDING_SEC;
                          const offlineCtx = new OfflineAudioContext(2, totalDuration * 44100, 44100);

                          // 调度 BGM
                          bgmSegments.forEach(seg => {
                              const buffer = assets.bgm[seg.name];
                              if (buffer) {
                                  const libItem = bgmLibrary.value.find(b => b.name === seg.name);
                                  const libVol = libItem ? (libItem.volume ?? 1.0) : 1.0;
                                  const finalVol = seg.volume * libVol;

                                  const src = offlineCtx.createBufferSource();
                                  src.buffer = buffer;
                                  src.loop = true;
                                  const trimStart = libItem?.trimStart ?? 0;
                                  const trimEnd = libItem?.trimEnd ?? 1;
                                  src.loopStart = buffer.duration * trimStart;
                                  src.loopEnd = buffer.duration * trimEnd;

                                  const gain = offlineCtx.createGain();
                                  gain.gain.setValueAtTime(0, seg.start);
                                  gain.gain.linearRampToValueAtTime(finalVol, seg.start + 2);
                                  gain.gain.setValueAtTime(finalVol, Math.max(seg.start + 2, seg.end - 2));
                                  gain.gain.linearRampToValueAtTime(0, seg.end);
                                  src.connect(gain).connect(offlineCtx.destination);
                                  src.start(seg.start, src.loopStart); // Start from loop start
                                  src.stop(seg.end);
                              }
                          });

                          // 调度台词和音效
                          events.forEach(evt => {
                              const dSrc = offlineCtx.createBufferSource();
                              dSrc.buffer = evt.buffer;
                              const dGain = offlineCtx.createGain();
                              const char = characters.value.find(c => c.name === evt.line.role);
                              const charVol = char ? (char.volume ?? 1.0) : 1.0;
                              dGain.gain.value = (evt.line.dialogueVolume ?? 1.0) * charVol;

                              let lastNode = dSrc;
                              // 应用滤镜
                              if (evt.line.filter) {
                                  const fConfig = filterLibrary.value.find(f => f.name === evt.line.filter);
                                  if (fConfig) {
                                      if (fConfig.type === 'distortion') {
                                          const ws = offlineCtx.createWaveShaper();
                                          ws.curve = makeDistortionCurve(fConfig.gain);
                                          ws.oversample = '4x';
                                          lastNode.connect(ws);
                                          lastNode = ws;
                                      } else {
                                          const bq = offlineCtx.createBiquadFilter();
                                          bq.type = fConfig.type;
                                          bq.frequency.value = fConfig.frequency;
                                          bq.Q.value = fConfig.Q;
                                          lastNode.connect(bq);
                                          lastNode = bq;
                                      }
                                  }
                              }
                              lastNode.connect(dGain).connect(offlineCtx.destination);
                              dSrc.start(evt.time, 0, Math.min(evt.buffer.duration, evt.duration));

                              // 调度音效
                              if (evt.line.sfx) {
                                  evt.line.sfx.forEach(s => {
                                      const sBuffer = assets.sfx[s.name];
                                      if (sBuffer) {
                                          const pos = parseFloat(s.position) || 0;
                                          const clampedPos = Math.max(0, Math.min(1, pos));
                                          const sfxTime = evt.time + (evt.duration * clampedPos);
                                          if (Number.isFinite(sfxTime)) {
                                              const sSrc = offlineCtx.createBufferSource();
                                              sSrc.buffer = sBuffer;
                                              const sGain = offlineCtx.createGain();
                                              const libItem = sfxLibrary.value.find(l => l.name === s.name);
                                              const libVol = libItem ? (libItem.volume ?? 1.0) : 1.0;
                                              const scriptVol = evt.line.sfxVolume ?? 0.5;
                                              sGain.gain.value = scriptVol * libVol;

                                              const sTrimStart = libItem?.trimStart ?? 0;
                                              const sTrimEnd = libItem?.trimEnd ?? 1;
                                              const sOffset = sBuffer.duration * sTrimStart;
                                              const sDuration = sBuffer.duration * (sTrimEnd - sTrimStart);

                                              sSrc.connect(sGain).connect(offlineCtx.destination);
                                              sSrc.start(sfxTime, sOffset, sDuration);
                                          }
                                      }
                                  });
                              }
                          });

                          const renderedBuffer = await offlineCtx.startRendering();
                          const wavBlob = bufferToWave(renderedBuffer, renderedBuffer.length);
                          const url = URL.createObjectURL(wavBlob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `storyforge_export_${Date.now()}.wav`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);

                      } catch (e) {
                          console.error(e);
                          alert('导出失败: ' + e.message);
                      } finally {
                          isExportingAudio.value = false;
                      }
                  };

                  const exportSRT = async () => {
                      const dialogueLines = scriptLines.value.filter(l => l.type === 'dialogue');
                      if (dialogueLines.length === 0) return alert('脚本为空');

                      if (dialogueLines.some(l => !l.audioUrl)) {
                          if (!confirm('部分台词尚未生成音频，导出字幕时时间轴可能不准确（将跳过未生成音频的行）。确定继续吗？')) return;
                      }

                      isExportingAudio.value = true; // 复用 loading 状态

                      try {
                          // 1. 加载所有台词音频以获取时长
                          const audioMap = new Map();
                          const loadPromises = dialogueLines.map(async (line) => {
                              if (line.audioUrl) {
                                  const timingInfo = await getDialogueTimingInfo(line);
                                  if (timingInfo) audioMap.set(line.id, timingInfo);
                              }
                          });
                          await Promise.all(loadPromises);

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
                                  const timingInfo = audioMap.get(line.id);
                                  if (timingInfo) {
                                      const totalDuration = timingInfo.effectiveDuration;

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
                          a.download = `Unitale字幕文件_${Date.now()}.srt`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                      } catch (e) {
                          console.error(e);
                          alert('导出SRT失败: ' + e.message);
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
                      if (!rawScript.value.trim()) return alert('请输入原文内容');

                      let text = rawScript.value.replace(/\r\n/g, '\n');
                      const splitRegex = /\n+|(?<=[。！？!?])(?=["']?)\s*/;

                      const lines = text.split(splitRegex)
                          .map(l => l.trim())
                          .filter(l => l.length > 0);

                      scriptLines.value = lines.map(text => ({
                          id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
                          type: 'dialogue',
                          role: '旁白',
                          emotion: '平静',
                          intensity: '中等',
                          filter: '',
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
                          bgmName: bgmLibrary.value.length > 0 ? bgmLibrary.value[0].name : ''
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
                          // selected background will be saved into assets store and restored via bgImageAssetKey
                          bgImageAssetKey: '',
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
                          filter: '',
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
                      const file = event.target.files && event.target.files[0];
                      const lineIndex = pendingBgImageLineIndex.value;
                      pendingBgImageLineIndex.value = -1;
                      event.target.value = '';
                      if (!file) return;

                      const line = scriptLines.value[lineIndex];
                      if (!line || line.type !== 'bgImage') return;

                      const assetKey = line.bgImageAssetKey || `bgImage_${line.id}`;
                      line.bgImageAssetKey = assetKey;
                      line.imageUrl = URL.createObjectURL(file);

                      try {
                          await saveAssetToDB(assetKey, file);
                      } catch (e) {
                          console.error('Failed to save bgImage asset:', e);
                          alert('保存背景图片失败，请重试。');
                      }

                      triggerAutoSave();
                  };

                  const copyBgImagePrompt = async (line) => {
                      const text = line?.bgImagePrompt || '';
                      if (!text) return;
                      try {
                          await navigator.clipboard.writeText(text);
                          alert('已复制背景图片提示词');
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
                          alert('已复制背景图片提示词');
                      }
                  };

                  const autoResizeTextarea = (event) => {
                      const el = event.target;
                      el.style.height = 'auto';
                      el.style.height = el.scrollHeight + 'px';
                  };

                  const addLineSfx = (line) => {
                      if (!line.sfx) line.sfx = [];
                      const defaultSfx = sfxLibrary.value.length > 0 ? sfxLibrary.value[0].name : 'New SFX';
                      line.sfx.push({ name: defaultSfx, position: 0.5 });
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

                  const playBgm = async (bgmName, volume = 0.4) => {
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

                      const bgmLibItem = bgmLibrary.value.find(b => b.name === bgmName);
                      if (!bgmLibItem || !bgmLibItem.filename) {
                          console.warn(`BGM not found in library: ${bgmName}`);
                          return;
                      }

                      try {
                          const audioBuffer = await loadAudioBuffer(bgmLibItem.filename);
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
                          alert(`播放背景音乐失败: ${bgmLibItem.filename}`);
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
                              await playBgm(lastBgmLine.bgmName, lastBgmLine.volume);
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
                                  await playBgm(line.bgmName, line.volume);
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
                              if (!line.audioUrl) {
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

                  // --- 视频生成（MP4 离线合成） ---
  const generateVideo = async () => {
                      const dialogueLines = scriptLines.value.filter(l => l.type === 'dialogue');
                      if (dialogueLines.length === 0) return alert('脚本为空');

                      if (dialogueLines.some(l => !l.audioUrl)) {
                          if (!confirm('部分台词尚未生成音频，导出视频时将跳过未生成的台词。确定继续吗？')) return;
                      }

                      if (typeof VideoEncoder === 'undefined') {
                          return alert('当前浏览器不支持 WebCodecs API，无法快速导出视频。请使用最新版 Chrome 或 Edge。');
                      }
                      const Mp4Muxer = getMp4Muxer();
                    if (!Mp4Muxer) {
                          return alert('缺少 Mp4Muxer 库，无法导出 MP4。');
                      }

                      isGeneratingVideo.value = true;
                      exportStatus.value = '准备素材...';

                      try {
                          const dialogueTimings = new Map();

                          // 1. 加载所有台词时长信息
                          for (const line of dialogueLines) {
                              if (line.audioUrl) {
                                  const timingInfo = await getDialogueTimingInfo(line);
                                  if (timingInfo) dialogueTimings.set(line.id, timingInfo);
                              }
                          }

                          // 2. 加载背景图片
                          const bgUrls = Array.from(new Set(
                              scriptLines.value.filter(l => l.type === 'bgImage' && l.imageUrl).map(l => l.imageUrl)
                          ));
                          const bgImageCache = new Map();
                          for (const url of bgUrls) {
                              const img = new Image();
                              img.crossOrigin = 'anonymous';
                              await new Promise((resolve) => {
                                  img.onload = resolve;
                                  img.onerror = resolve;
                                  img.src = url;
                              });
                              bgImageCache.set(url, img);
                          }

                          // 3. 用与音频导出一致的时长规则计算视频时间轴
                          let currentTime = 0;
                          const visualTimeline = [];
                          let currentBgUrl = '';
                          let lastBgChangeTime = 0;

                          // 初始化首个背景
                          const firstBgLine = scriptLines.value.find(l => l.type === 'bgImage' && l.imageUrl);
                          if (firstBgLine) currentBgUrl = firstBgLine.imageUrl;

                          for (const line of scriptLines.value) {
                              if (line.type === 'bgImage') {
                                  if (line.imageUrl && line.imageUrl !== currentBgUrl) {
                                      if (currentTime > lastBgChangeTime) {
                                          visualTimeline.push({
                                              url: currentBgUrl,
                                              start: lastBgChangeTime,
                                              end: currentTime
                                          });
                                      }
                                      currentBgUrl = line.imageUrl;
                                      lastBgChangeTime = currentTime;
                                  }
                              } else if (line.type === 'dialogue') {
                                  const timingInfo = dialogueTimings.get(line.id);
                                  if (timingInfo) {
                                      currentTime += 0.05;
                                      currentTime += timingInfo.effectiveDuration;
                                  }
                                  currentTime += (line.break_duration || 0);
                              }
                          }
                          if (currentTime > lastBgChangeTime) {
                              visualTimeline.push({
                                  url: currentBgUrl,
                                  start: lastBgChangeTime,
                                  end: currentTime
                              });
                          }

                          exportStatus.value = '生成视频轨道...';

                          const fps = 4;
                          const totalDuration = currentTime + EXPORT_TAIL_PADDING_SEC;
                          let [width, height] = videoResolution.value.split('x').map(Number);

                          // Ensure width and height are even numbers (required by many hardware encoders)
                          width = width % 2 === 0 ? width : width + 1;
                          height = height % 2 === 0 ? height : height + 1;

                          const muxer = new Mp4Muxer.Muxer({
                              target: new Mp4Muxer.ArrayBufferTarget(),
                              video: { codec: 'avc', width, height },
                              fastStart: 'in-memory'
                          });

                          let videoEncoder;

                          const encodeErrorPromise = new Promise((_, reject) => {
                              videoEncoder = new VideoEncoder({
                                  output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
                                  error: e => {
                                      console.error('VideoEncoder error:', e);
                                      reject(new Error('视频编码错误: ' + e.message));
                                  }
                              });

                          });

                          // Dynamically choose codec profile based on resolution.                        // 1080p (1920x1080 or 1080x1920) typically needs Level 4.2 (avc1.64002A) or Level 4.0.
                          let codecString = 'avc1.4d002a'; // Main Profile，静态高清图更不容易出马赛克

                          const config = {
                              codec: codecString,
                              width, height,
                              bitrate: 3_000_000,
                              framerate: fps,
                              hardwareAcceleration: "prefer-hardware"
                          };

                          try {
                              const support = await VideoEncoder.isConfigSupported(config);
                              if (!support.supported) {
                                  console.warn("Video configuration not supported by hardware, trying software/baseline fallback...");
                                  config.codec = 'avc1.42002a'; // Fallback to Baseline Profile Level 4.2
                                  config.hardwareAcceleration = "no-preference";

                                  const fallbackSupport = await VideoEncoder.isConfigSupported(config);
                                  if (!fallbackSupport.supported) {
                                      // Extreme fallback
                                      config.codec = 'avc1.42001f'; // Baseline 3.1
                                  }
                              }
                          } catch (e) {
                              console.warn("Failed to check video config support, using default", e);
                              config.codec = 'avc1.42002a'; // Fallback to Baseline Profile Level 4.2 on error
                              config.hardwareAcceleration = "no-preference";
                          }

                          videoEncoder.configure(config);

                          // Yield to the event loop to allow the encoders' configuration tasks to complete.
                          await new Promise(r => setTimeout(r, 0));

                          const renderVideoPromise = async () => {
                              const offscreenCanvas = new OffscreenCanvas(width, height);
                              const offscreenCtx = offscreenCanvas.getContext('2d', { alpha: false });
                              offscreenCtx.imageSmoothingEnabled = true;
                              offscreenCtx.imageSmoothingQuality = 'high';
                              const drawCover = (ctx, img, cw, ch) => {
                                  const scale = Math.max(cw / img.width, ch / img.height);
                                  const dw = img.width * scale;
                                  const dh = img.height * scale;
                                  const dx = (cw - dw) / 2;
                                  const dy = (ch - dh) / 2;
                                  ctx.drawImage(img, dx, dy, dw, dh);
                              };

                              const segments = visualTimeline
                                  .filter(stage => stage && stage.end > stage.start)
                                  .map((stage, index, arr) => {
                                      const stageEnd = index === arr.length - 1 ? totalDuration : stage.end;
                                      return {
                                          url: stage.url || '',
                                          startUs: Math.round(stage.start * 1000000),
                                          durationUs: Math.max(1, Math.round((stageEnd - stage.start) * 1000000))
                                      };
                                  });

                              if (segments.length === 0) {
                                  segments.push({
                                      url: '',
                                      startUs: 0,
                                      durationUs: Math.max(1, Math.round(totalDuration * 1000000))
                                  });
                              }

                              const frameDurationUs = Math.round(1000000 / fps);
                              const totalFrames = segments.reduce((sum, stage) => {
                                  return sum + Math.max(1, Math.ceil(stage.durationUs / frameDurationUs));
                              }, 0);
                              let encodedFrames = 0;

                              for (let i = 0; i < segments.length; i++) {
                                  const stage = segments[i];
                                  const currentUrl = stage.url;

                                  offscreenCtx.fillStyle = '#000';
                                  offscreenCtx.fillRect(0, 0, width, height);

                                  if (currentUrl && bgImageCache.has(currentUrl)) {
                                      const img = bgImageCache.get(currentUrl);
                                      drawCover(offscreenCtx, img, width, height);
                                  }

                                  while (videoEncoder.encodeQueueSize > 30) {
                                      if (videoEncoder.state !== 'configured') {
                                          break;
                                      }
                                      await new Promise(r => setTimeout(r, 10));
                                  }

                                  const stageFrames = Math.max(1, Math.ceil(stage.durationUs / frameDurationUs));
                                  for (let frameIndex = 0; frameIndex < stageFrames; frameIndex++) {
                                      const frameStartUs = stage.startUs + (frameIndex * frameDurationUs);
                                      const isLastFrame = frameIndex === stageFrames - 1;
                                      const durationUs = isLastFrame
                                          ? Math.max(1, stage.durationUs - (frameIndex * frameDurationUs))
                                          : frameDurationUs;

                                      const frame = new VideoFrame(offscreenCanvas, {
                                          timestamp: frameStartUs,
                                          duration: durationUs
                                      });
                                      if (videoEncoder.state !== 'configured') {
                                          frame.close();
                                          throw new Error('视频编码器状态异常 (' + videoEncoder.state + ')。可能是分辨率或编码配置不受当前浏览器支持。');
                                      }
                                      videoEncoder.encode(frame, { keyFrame: frameIndex === 0 });
                                      frame.close();
                                      encodedFrames++;
                                  }

                                  exportStatus.value = `编码视频 ${Math.round((encodedFrames / totalFrames) * 100)}%`;
                                  await new Promise(r => setTimeout(r, 0));
                              }

                              if (videoEncoder.state === 'configured') {
                                  await videoEncoder.flush();
                                  videoEncoder.close();
                              }
                          };

                          // 运行编码并捕获任何可能发生的抛错
                          await Promise.race([
                              renderVideoPromise(),
                              encodeErrorPromise
                          ]);

                          exportStatus.value = '封装 MP4...';
                          muxer.finalize();
                          const mp4Buffer = muxer.target.buffer;
                          const blob = new Blob([mp4Buffer], { type: 'video/mp4' });

                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `Unitale_导出视频_${Date.now()}.mp4`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);

                      } catch (e) {
                          console.error('Video generation failed:', e);
                          alert('导出视频失败: ' + e.message);
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

                      if (!currentConfig.value) return alert('请先在“模型配置”选择一个 LLM 模型配置');
                      if (!rawScript.value.trim()) return alert('请输入原文内容');

                      const requestedBgImageCount = Math.max(0, Number(bgImageCount.value) || 0);
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

                      const templateToUse = useCustomPrompt.value ? customPromptTemplate.value : defaultPromptTemplate;
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
                                  let id = Date.now() + Math.random().toString();
                                  let volume = 1.0;

                                  if (existing) {
                                      voiceFile = existing.voiceFile;
                                      id = existing.id;
                                      volume = existing.volume ?? 1.0;
                                  } else {
                                      const matchingTimbre = timbres.value.find(t => t.name === rName);
                                      if (matchingTimbre) voiceFile = matchingTimbre.refPath;
                                  }

                                  newCharacterList.push({
                                      id: id,
                                      name: rName,
                                      voiceFile: voiceFile,
                                      volume: volume
                                  });
                              });
                              characters.value = newCharacterList;

                              scriptLines.value = validParsed.map(item => {
                                  // 通用模糊匹配函数
                                  const findBestMatch = (target, library) => {
                                      if (!target) return '';
                                      const t = target.trim().toLowerCase();
                                      // 1. 精确匹配
                                      const exact = library.find(i => i.name.toLowerCase() === t);
                                      if (exact) return exact.name;

                                      // 2. 模糊匹配 (包含关系)
                                      const candidates = library.filter(i => {
                                          const n = i.name.toLowerCase();
                                          return n.includes(t) || t.includes(n);
                                      });

                                      if (candidates.length > 0) {
                                          // 按长度差排序，找最接近的
                                          candidates.sort((a, b) => Math.abs(a.name.length - target.length) - Math.abs(b.name.length - target.length));
                                          return candidates[0].name;
                                      }
                                      return '';
                                  };

                                  // 1. 匹配滤波器
                                  let matchedFilter = '';
                                  if (item.filter) {
                                      matchedFilter = findBestMatch(item.filter, filterLibrary.value);
                                  }

                                  // 2. 匹配音效
                                  let matchedSfx = [];
                                  if (item.sfx && Array.isArray(item.sfx)) {
                                      matchedSfx = item.sfx.map(s => ({
                                          name: findBestMatch(s.name, sfxLibrary.value) || s.name,
                                          position: s.position
                                      }));
                                  }

                                  // 3. 匹配 BGM
                                  let matchedBgmName = '';
                                  if (item.type === 'bgm' && item.action === 'play') {
                                      const rawName = item.name || item.bgmName || '';
                                      matchedBgmName = findBestMatch(rawName, bgmLibrary.value) || rawName;
                                  }

                                  return {
                                      id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
                                      type: item.type || 'dialogue',
                                      // Dialogue fields
                                      role: item.role_name || item.role || '旁白',
                                      text: item.text_content || item.text || item.content || '',
                                      emotion: item.emotion || '平静',
                                      intensity: item.intensity || '中等',
                                      filter: matchedFilter,
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
                                      bgmName: matchedBgmName,

                                      // bgImage fields (background-image block)
                                      bgImagePrompt: item.image_prompt || item.bgImagePrompt || item.imagePrompt || item.prompt || '',
                                      bgImageAssetKey: '',
                                      imageUrl: ''
                                  };
                              });
                          } else {
                              alert('AI 返回格式异常，请重试');
                          }
                      } catch (e) {
                          if (e.name === 'AbortError') {
                              alert('分析已停止');
                          } else {
                              console.error(e);
                              alert('分析失败: ' + e.message);
                          }
                      } finally {
                          isAnalyzingScript.value = false;
                          analysisAbortController.value = null;
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
                      if (!currentConfig.value) return alert('请先选择一个有效的模型配置');
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
                                  error.value += "\n\n检测到跨域(CORS)限制！Gemini API 通常禁止从浏览器前端直接调用。\n建议：开启浏览器 CORS 插件，或使用后端中转。";
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
                      if (!currentTtsConfig.value) return alert('请选择 TTS 配置');
                      const textToSpeak = result.value || prompt.value;
                      if (!textToSpeak) return alert('没有可合成的文本 (请先对话或输入提示词)');
                      if (!ttsRefPath.value) return alert('请指定参考音频路径 ID');

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
                              throw new Error(`服务端未找到音频 "${ttsRefPath.value}"，且未选择本地文件进行上传。`);
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
                      alert('Prompt 设置已保存');
                  };

                  const saveVoicePrompt = () => {
                      localStorage.setItem(storageKeys.voicePromptTemplate, customVoicePromptTemplate.value);
                      localStorage.setItem(storageKeys.useCustomVoicePrompt, JSON.stringify(useCustomVoicePrompt.value));
                      alert('音色分析 Prompt 设置已保存');
                  };

                  const resetPrompt = () => {
                      if (confirm('确定要恢复默认 Prompt 吗？')) {
                          customPromptTemplate.value = defaultPromptTemplate;
                          customVoicePromptTemplate.value = defaultVoicePromptTemplate;
                      }
                  };

                  const resetVoicePrompt = () => {
                      if (confirm('确定要恢复默认的音色分析 Prompt 吗？')) {
                          customVoicePromptTemplate.value = defaultVoicePromptTemplate;
                          localStorage.setItem(storageKeys.voicePromptTemplate, defaultVoicePromptTemplate);
                      }
                  };

                  const saveQwenVoiceText = () => {
                      localStorage.setItem(storageKeys.qwenVoiceTextTemplate, customQwenVoiceTextTemplate.value);
                      localStorage.setItem(storageKeys.useCustomQwenVoiceText, JSON.stringify(useCustomQwenVoiceText.value));
                      alert('Qwen 生成文本设置已保存');
                  };

                  const resetQwenVoiceText = () => {
                      if (confirm('确定要恢复默认文本吗？')) {
                          customQwenVoiceTextTemplate.value = defaultQwenVoiceTextTemplate;
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
                      characters, addCharacter, deleteCharacter,
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
                      exportSRT, triggerImportTxt, handleImportTxt, importTxtRef,
                      isExportingProject, exportStatus, videoResolution,
                      playScriptSequentially, stopScriptSequentially, isSequencePlaying, currentSequenceIndex,
                      lineRefs,
                      scriptListContainer,
                      scriptList, currentScriptId, switchScript, addScript, deleteScriptTab,
                      editingScriptId, startEditingScript, stopEditingScript, scriptNameInputRefs,

                      customPromptTemplate, useCustomPrompt, savePrompt, resetPrompt,
                      customVoicePromptTemplate, useCustomVoicePrompt, saveVoicePrompt, resetVoicePrompt,
                      customQwenVoiceTextTemplate, useCustomQwenVoiceText, saveQwenVoiceText, resetQwenVoiceText,
                      generateVideo,
                  };
}
