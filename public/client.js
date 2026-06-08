// ═══════════════════════════════════════════════════════════════════════════
// Clipper AI v2 — Client Application
// ═══════════════════════════════════════════════════════════════════════════

const API = '';
let currentVideo = null, currentHighlight = null, highlights = [], allHighlights = [];
let metadataStore = {}, clipInterval = null, currentLayout = 'full', cropXRatio = 0.5;

// ─── DOM ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const videoSelect    = $('videoSelect');
const btnAnalyze     = $('btnAnalyze');
const videoPlayer    = $('videoPlayer');
const cropOverlay    = $('cropOverlay');
const chkCropGuide   = $('chkCropGuide');
const videoDuration  = $('videoDurationText');
const timelineBar    = $('timelineBar');
const timelineProg   = $('timelineProgress');
const timelinePtr    = $('timelinePointer');
const highlightsList = $('highlightsList');
const metaTitle      = $('metaTitle');
const metaDescription= $('metaDescription');
const metaTranscription = $('metaTranscription');
const metaTopic         = $('metaTopic');
const metaThumbnailPrompt = $('metaThumbnailPrompt');
const btnGenerateAI  = $('btnGenerateAI');
const btnExport      = $('btnExport');
const btnPlayClip    = $('btnPlayClip');
const btnSettings    = $('btnSettings');
const btnCloseSet    = $('btnCloseSettings');
const btnSaveSet     = $('btnSaveSettings');
const settingsModal  = $('settingsModal');
const geminiApiKey   = $('geminiApiKey');
const geminiModel    = $('geminiModel');
const loaderOverlay  = $('loaderOverlay');
const loaderText     = $('loaderText');
const loaderSubText  = $('loaderSubText');
const toastContainer = $('toastContainer');
const statsBar       = $('statsBar');
const overlayText    = $('overlayText');
const overlayPosition= $('overlayPosition');
const overlayColor   = $('overlayColor');
const overlaySize    = $('overlaySize');
const subtitleStyle    = $('subtitleStyle');
const chkProgressBar   = $('chkProgressBar');
const secondaryVideoSelect = $('secondaryVideoSelect');
const btnDownloadBroll = $('btnDownloadBroll');
const liveTextOverlay  = $('liveTextOverlay');
const liveSubtitles    = $('liveSubtitles');
const liveProgressBar  = $('liveProgressBar');
const videoContainer   = $('videoContainer');
const inputCutStart = $('inputCutStart');
const inputCutEnd   = $('inputCutEnd');
const cutDurationDisplay = $('cutDurationDisplay');
const cutTimelineRange = $('cutTimelineRange');
const cutTimeStartLabel = $('cutTimeStartLabel');
const cutTimeEndLabel = $('cutTimeEndLabel');
const chkLoopPreview = $('chkLoopPreview');
const primaryColor = $('primaryColor');
const activeColor = $('activeColor');
const subtitleFont = $('subtitleFont');
const subtitleSize = $('subtitleSize');
const layoutFormat = $('layoutFormat');
const exportQuality = $('exportQuality');
const secondaryVideoPlayer = $('secondaryVideoPlayer');

const PROVIDER_MODELS = {
  gemini: [
    { value: 'gemini-2.0-flash-lite', text: 'Gemini 2.0 Flash Lite (Rápido, free-tier alto)' },
    { value: 'gemini-2.0-flash', text: 'Gemini 2.0 Flash (Equilibrado)' },
    { value: 'gemini-2.5-flash', text: 'Gemini 2.5 Flash (Avançado, free-tier baixo)' }
  ],
  groq: [
    { value: 'llama-3.1-8b-instant', text: 'Llama 3.1 8B (Velocidade Extrema)' },
    { value: 'llama3-8b-8192', text: 'Llama 3 8B (Equilibrado)' },
    { value: 'llama3-70b-8192', text: 'Llama 3 70B (Alta Capacidade)' },
    { value: 'gemma2-9b-it', text: 'Gemma 2 9B (Google Open Model)' }
  ]
};

const aiProvider = $('aiProvider');
const apiKeyLabel = $('apiKeyLabel');

let currentProvider = localStorage.getItem('AI_PROVIDER') || 'gemini';
let geminiKey = localStorage.getItem('GEMINI_API_KEY') || '';
let groqKey = localStorage.getItem('GROQ_API_KEY') || '';
let geminiSelectedModel = localStorage.getItem('GEMINI_MODEL') || 'gemini-2.0-flash-lite';
let groqSelectedModel = localStorage.getItem('GROQ_MODEL') || 'llama-3.1-8b-instant';

function updateProviderFields() {
  const provider = aiProvider.value;
  const models = PROVIDER_MODELS[provider] || [];
  
  geminiModel.innerHTML = '';
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.text;
    geminiModel.appendChild(opt);
  });

  if (provider === 'gemini') {
    apiKeyLabel.textContent = 'Gemini API Key';
    geminiApiKey.placeholder = 'AIzaSy...';
    geminiApiKey.value = geminiKey;
    geminiModel.value = geminiSelectedModel;
  } else {
    apiKeyLabel.textContent = 'Groq API Key';
    geminiApiKey.placeholder = 'gsk_...';
    geminiApiKey.value = groqKey;
    geminiModel.value = groqSelectedModel;
  }
}

// Initial sync
if (aiProvider) {
  aiProvider.value = currentProvider;
  updateProviderFields();
}

// ─── Init ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => { loadVideos(); setupEvents(); loadExports(); });

// ─── Toast ────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = { info: 'circle-info', success: 'circle-check', error: 'circle-exclamation' };
  t.innerHTML = `<i class="fa-solid fa-${icons[type] || 'circle-info'}"></i><span>${msg}</span>`;
  toastContainer.appendChild(t);
  setTimeout(() => { t.style.animation = 'toastIn 0.25s reverse forwards'; setTimeout(() => t.remove(), 250); }, 3500);
}

function showLoader(text, sub = '') { loaderText.textContent = text; loaderSubText.textContent = sub; loaderOverlay.classList.add('show'); }
function hideLoader() { loaderOverlay.classList.remove('show'); }

// ─── Events ───────────────────────────────────────────────────────────────
function setupEvents() {
  // Settings modal
  btnSettings.addEventListener('click', () => {
    aiProvider.value = currentProvider;
    updateProviderFields();
    settingsModal.classList.add('show');
  });
  if (aiProvider) {
    aiProvider.addEventListener('change', updateProviderFields);
  }
  btnCloseSet.addEventListener('click', () => settingsModal.classList.remove('show'));
  btnSaveSet.addEventListener('click', () => {
    currentProvider = aiProvider.value;
    localStorage.setItem('AI_PROVIDER', currentProvider);
    
    if (currentProvider === 'gemini') {
      geminiKey = geminiApiKey.value.trim();
      geminiSelectedModel = geminiModel.value;
      localStorage.setItem('GEMINI_API_KEY', geminiKey);
      localStorage.setItem('GEMINI_MODEL', geminiSelectedModel);
      toast(`Configurações salvas! Provedor: Gemini, Modelo: ${geminiSelectedModel}`, 'success');
    } else {
      groqKey = geminiApiKey.value.trim();
      groqSelectedModel = geminiModel.value;
      localStorage.setItem('GROQ_API_KEY', groqKey);
      localStorage.setItem('GROQ_MODEL', groqSelectedModel);
      toast(`Configurações salvas! Provedor: Groq, Modelo: ${groqSelectedModel}`, 'success');
    }
    settingsModal.classList.remove('show');
  });

  // Crop guide toggle
  chkCropGuide.addEventListener('change', e => {
    cropOverlay.style.display = e.target.checked ? 'flex' : 'none';
    if (e.target.checked) resetCropOverlayPosition();
  });

  // Video selection
  videoSelect.addEventListener('change', e => {
    if (!e.target.value) { currentVideo = null; videoPlayer.removeAttribute('src'); btnAnalyze.disabled = true; return; }
    currentVideo = e.target.value;
    videoPlayer.src = `/raw-videos/${encodeURIComponent(currentVideo)}`;
    btnAnalyze.disabled = false;
    clearAll();
    toast(`Vídeo carregado: ${currentVideo}`, 'success');
    setTimeout(resetCropOverlayPosition, 200);
  });

  btnAnalyze.addEventListener('click', analyzeVideo);

  // Smooth 60fps update loop for subtitles and progress bar
  let updateLoop = null;
  function updateSubtitlesAndProgressBar() {
    const c = videoPlayer.currentTime || 0;
    const d = videoPlayer.duration || 0;
    if (d > 0) {
      timelineProg.style.width = `${(c/d)*100}%`;
      videoDuration.textContent = `${fmt(c)} / ${fmt(d)}`;

      // Live Progress Bar Preview
      if (chkProgressBar.checked) {
        liveProgressBar.style.display = 'block';
        liveProgressBar.style.width = `${(c/d)*100}%`;
      } else {
        liveProgressBar.style.display = 'none';
      }

      // Live Subtitles Preview
      updateLiveSubtitles(c);

      // Sync secondary player in real-time
      if (currentLayout !== 'full') {
        const start = currentHighlight ? currentHighlight.start : 0;
        const secStart = parseFloat($('secondaryVideoStart').value || 0);
        const relTime = c - start;
        
        let targetTime = relTime + secStart;
        if (!secondaryVideoSelect.value) {
          targetTime = c;
        }
        
        if (Math.abs(secondaryVideoPlayer.currentTime - targetTime) > 0.15) {
          secondaryVideoPlayer.currentTime = Math.max(0, targetTime);
        }
        
        if (videoPlayer.paused && !secondaryVideoPlayer.paused) {
          secondaryVideoPlayer.pause();
        } else if (!videoPlayer.paused && secondaryVideoPlayer.paused) {
          secondaryVideoPlayer.muted = true;
          secondaryVideoPlayer.play().catch(()=>{});
        }
      }
    }
  }

  function startUpdateLoop() {
    if (updateLoop) return;
    const loop = () => {
      if (!videoPlayer.paused && !videoPlayer.ended) {
        updateSubtitlesAndProgressBar();
        updateLoop = requestAnimationFrame(loop);
      } else {
        updateLoop = null;
      }
    };
    updateLoop = requestAnimationFrame(loop);
  }

  function stopUpdateLoop() {
    if (updateLoop) {
      cancelAnimationFrame(updateLoop);
      updateLoop = null;
    }
  }

  videoPlayer.addEventListener('play', startUpdateLoop);
  videoPlayer.addEventListener('playing', startUpdateLoop);
  videoPlayer.addEventListener('pause', stopUpdateLoop);
  videoPlayer.addEventListener('ended', stopUpdateLoop);
  videoPlayer.addEventListener('timeupdate', updateSubtitlesAndProgressBar);
  videoPlayer.addEventListener('seeked', updateSubtitlesAndProgressBar);

  // Timeline seek
  timelineBar.addEventListener('click', e => {
    const r = timelineBar.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * videoPlayer.duration;
    if (!isNaN(t)) videoPlayer.currentTime = t;
  });
  timelineBar.addEventListener('mousemove', e => {
    const r = timelineBar.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * videoPlayer.duration;
    if (!isNaN(t)) timelinePtr.textContent = `${t.toFixed(1)}s`;
  });

  // Crop overlay drag
  let dragging = false, dragStartX = 0, overlayStartLeft = 0;
  cropOverlay.addEventListener('mousedown', e => {
    dragging = true;
    dragStartX = e.clientX;
    overlayStartLeft = cropOverlay.offsetLeft;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const container = $('videoContainer');
    const maxLeft = container.offsetWidth - cropOverlay.offsetWidth;
    let newLeft = overlayStartLeft + (e.clientX - dragStartX);
    newLeft = Math.max(0, Math.min(maxLeft, newLeft));
    cropOverlay.style.left = `${newLeft}px`;
    // Calculate cropX ratio (0 = left, 1 = right)
    cropXRatio = maxLeft > 0 ? newLeft / maxLeft : 0.5;
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  // Layout selector
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLayout = btn.dataset.layout;
      updateLayoutPreview();
    });
  });

  // Live text overlay preview listeners
  overlayText.addEventListener('input', updateTextOverlayPreview);
  overlayPosition.addEventListener('change', updateTextOverlayPreview);
  overlayColor.addEventListener('input', updateTextOverlayPreview);
  overlaySize.addEventListener('change', updateTextOverlayPreview);

  // Subtitle style listener & custom formatting listeners
  subtitleStyle.addEventListener('change', () => {
    updateLiveSubtitles(videoPlayer.currentTime);
  });
  primaryColor.addEventListener('input', () => updateLiveSubtitles(videoPlayer.currentTime));
  activeColor.addEventListener('input', () => updateLiveSubtitles(videoPlayer.currentTime));
  subtitleFont.addEventListener('change', () => updateLiveSubtitles(videoPlayer.currentTime));
  subtitleSize.addEventListener('input', () => updateLiveSubtitles(videoPlayer.currentTime));

  // Download B-roll listener
  btnDownloadBroll.addEventListener('click', downloadBroll);

  // Toggle secondary video options container
  secondaryVideoSelect.addEventListener('change', () => {
    const hasSec = secondaryVideoSelect.value !== "";
    $('secondaryVideoSettings').style.display = hasSec ? 'block' : 'none';
    syncSecondaryPlayer();
  });

  // Modal preview close
  $('btnClosePreview').addEventListener('click', closeExportPreview);
  $('previewModal').addEventListener('click', (e) => {
    if (e.target === $('previewModal')) closeExportPreview();
  });

  // Tier filters
  document.querySelectorAll('.tier-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.tier-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      filterByTier(pill.dataset.tier);
    });
  });

  // Metadata inputs
  metaTitle.addEventListener('input', e => { if (currentHighlight) { ensureMeta(currentHighlight.id).title = e.target.value; } });
  metaDescription.addEventListener('input', e => { if (currentHighlight) { ensureMeta(currentHighlight.id).description = e.target.value; } });
  metaTranscription.addEventListener('input', e => { if (currentHighlight) { ensureMeta(currentHighlight.id).transcription = e.target.value; } });
  metaTopic.addEventListener('input', e => { if (currentHighlight) { ensureMeta(currentHighlight.id).topic = e.target.value; } });
  metaThumbnailPrompt.addEventListener('input', e => { if (currentHighlight) { ensureMeta(currentHighlight.id).thumbnail_prompt = e.target.value; } });

  btnGenerateAI.addEventListener('click', generateAI);
  btnPlayClip.addEventListener('click', playClip);
  btnExport.addEventListener('click', exportClip);
  window.addEventListener('resize', resetCropOverlayPosition);
  
  // Setup video import panel
  setupImportPanel();
  
  // Setup cut fine-tuning events
  setupCutAdjustmentEvents();
}

function ensureMeta(id) { if (!metadataStore[id]) metadataStore[id] = {}; return metadataStore[id]; }

// ─── Load Videos ──────────────────────────────────────────────────────────
async function loadVideos() {
  try {
    const r = await (await fetch(`${API}/api/videos`)).json();
    if (r.success && r.videos.length > 0) {
      videoSelect.innerHTML = '<option value="">Selecione um vídeo...</option>';
      secondaryVideoSelect.innerHTML = '<option value="">Nenhum (Zoom/Duplicar Principal)</option>';
      r.videos.forEach(v => {
        const o = document.createElement('option');
        o.value = v.name;
        o.textContent = `${v.name} (${v.sizeMB} MB)`;
        videoSelect.appendChild(o);

        // Also populate the B-Roll / secondary video select
        const o2 = document.createElement('option');
        o2.value = v.name;
        o2.textContent = `${v.name} (${v.sizeMB} MB)`;
        secondaryVideoSelect.appendChild(o2);
      });
    } else {
      videoSelect.innerHTML = '<option value="">Nenhum vídeo encontrado</option>';
    }
  } catch { toast('Erro ao listar vídeos.', 'error'); }
}

// ─── Generate Metadata for Block (Helper) ──────────────────────────────────
async function generateMetadataForBlock(hl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout

    const activeKey = currentProvider === 'gemini' ? geminiKey : groqKey;
    const activeModel = currentProvider === 'gemini' ? geminiSelectedModel : groqSelectedModel;

    const res = await fetch(`${API}/api/generate-metadata`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoName: currentVideo, start: hl.start, end: hl.end,
        apiKey: activeKey, provider: currentProvider, model: activeModel,
        tier: hl.tier, score: hl.score
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    const r = await res.json();
    if (r.success) {
      const m = r.metadata;
      metadataStore[hl.id] = {
        title: m.title,
        description: m.description,
        transcription: m.transcription,
        topic: m.topic,
        thumbnail_prompt: m.thumbnail_prompt || '',
        words: m.words || []
      };
      const te = $(`hl-t-${hl.id}`);
      if (te) te.textContent = m.title;
      return true;
    } else {
      console.warn(`[Meta] Block #${hl.id} failed: ${r.error}`);
      return false;
    }
  } catch (e) {
    console.error(`[Meta] Block #${hl.id} error:`, e.name === 'AbortError' ? 'Timeout (2min)' : e);
    return false;
  }
}

// ─── Analyze ──────────────────────────────────────────────────────────────
async function analyzeVideo() {
  if (!currentVideo) return;
  showLoader('Analisando vídeo com IA...', 'Motor de 3 camadas: silêncio adaptativo → agrupamento → scoring');

  try {
    const r = await (await fetch(`${API}/api/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoName: currentVideo })
    })).json();

    if (r.success) {
      allHighlights = r.highlights;
      highlights = [...allHighlights];
      renderHighlights(highlights);
      drawTimeline(highlights, r.duration);
      updateStats(r.highlights, r.stats);
      statsBar.style.display = 'flex';

      toast(`Análise concluída! ${highlights.length} blocos encontrados.`, 'success');
      
      // Auto-select the first highlight block
      if (highlights.length > 0) {
        selectHL(highlights[0].id);
      }
    } else {
      toast(`Erro: ${r.error}`, 'error');
    }
  } catch (e) { console.error(e); toast('Erro de conexão.', 'error'); }
  finally { hideLoader(); }
}

// ─── Stats ────────────────────────────────────────────────────────────────
function updateStats(hl, stats) {
  $('statBlocks').textContent = hl.length;
  $('statGold').textContent = hl.filter(h => h.tier === 'gold').length;
  $('statSilver').textContent = hl.filter(h => h.tier === 'silver').length;
  $('statBronze').textContent = hl.filter(h => h.tier === 'bronze').length;
}

// ─── Filter by Tier ───────────────────────────────────────────────────────
function filterByTier(tier) {
  highlights = tier === 'all' ? [...allHighlights] : allHighlights.filter(h => h.tier === tier);
  renderHighlights(highlights);
}

// ─── Clear ────────────────────────────────────────────────────────────────
function clearAll() {
  highlights = []; allHighlights = []; currentHighlight = null; metadataStore = {};
  highlightsList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-wand-magic-sparkles"></i><p>Aguardando análise...</p></div>';
  document.querySelectorAll('.timeline-highlight').forEach(m => m.remove());
  metaTitle.value = ''; metaDescription.value = ''; metaTranscription.value = ''; metaTopic.value = ''; metaThumbnailPrompt.value = '';
  btnExport.disabled = true; btnPlayClip.disabled = true;
  statsBar.style.display = 'none';
}

// ─── Render Highlights ────────────────────────────────────────────────────
function renderHighlights(list) {
  if (!list.length) {
    highlightsList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-filter-circle-xmark"></i><p>Nenhum bloco neste filtro</p></div>';
    return;
  }

  highlightsList.innerHTML = '';
  list.forEach(hl => {
    const el = document.createElement('div');
    el.className = 'highlight-item';
    el.id = `hl-${hl.id}`;
    el.onclick = () => selectHL(hl.id);

    const title = metadataStore[hl.id]?.title || `Bloco #${hl.id}`;
    el.innerHTML = `
      <div class="hl-top">
        <span class="hl-title">
          <span class="tier-badge ${hl.tier}">${hl.tier}</span>
          <span id="hl-t-${hl.id}">${title}</span>
        </span>
        <span class="hl-time">${fmt(hl.start)} → ${fmt(hl.end)}</span>
      </div>
      <div class="score-bar-container">
        <span>Score</span>
        <div class="score-bar"><div class="score-bar-fill ${hl.tier}" style="width:${hl.score}%"></div></div>
        <span>${hl.score}</span>
      </div>`;
    highlightsList.appendChild(el);
  });
}

// ─── Draw Timeline ────────────────────────────────────────────────────────
function drawTimeline(list, dur) {
  document.querySelectorAll('.timeline-highlight').forEach(m => m.remove());
  list.forEach(hl => {
    const m = document.createElement('div');
    m.className = `timeline-highlight ${hl.tier}`;
    m.style.left = `${(hl.start/dur)*100}%`;
    m.style.width = `${(hl.duration/dur)*100}%`;
    timelineBar.appendChild(m);
  });
}

// ─── Select Highlight ─────────────────────────────────────────────────────
function selectHL(id) {
  const hl = allHighlights.find(h => h.id === id);
  if (!hl) return;
  currentHighlight = hl;

  document.querySelectorAll('.highlight-item').forEach(e => e.classList.remove('active'));
  const el = $(`hl-${id}`);
  if (el) el.classList.add('active');

  videoPlayer.currentTime = hl.start;

  const meta = metadataStore[hl.id] || {};
  metaTitle.value = meta.title || `Bloco #${hl.id} ⚡`;
  metaDescription.value = meta.description || '';
  metaTranscription.value = meta.transcription || '';
  metaTopic.value = meta.topic || '';
  metaThumbnailPrompt.value = meta.thumbnail_prompt || '';

  if (!meta.title) { ensureMeta(hl.id).title = `Bloco #${hl.id} ⚡`; }

  // Update fine-tuning inputs & visual timeline range
  if (inputCutStart && inputCutEnd && cutDurationDisplay) {
    inputCutStart.value = hl.start.toFixed(1);
    inputCutEnd.value = hl.end.toFixed(1);
    cutDurationDisplay.textContent = (hl.end - hl.start).toFixed(1) + 's';
    
    const d = videoPlayer.duration || 1;
    if (cutTimelineRange) {
      cutTimelineRange.style.left = `${(hl.start / d) * 100}%`;
      cutTimelineRange.style.width = `${((hl.end - hl.start) / d) * 100}%`;
    }
    if (cutTimeStartLabel) cutTimeStartLabel.textContent = `Início: ${hl.start.toFixed(1)}s`;
    if (cutTimeEndLabel) cutTimeEndLabel.textContent = `Fim: ${hl.end.toFixed(1)}s`;
  }

  btnExport.disabled = false;
  btnPlayClip.disabled = false;
  toast(`Bloco #${id} (${hl.tier}) — Score ${hl.score}/100`, 'info');
}

// ─── Play Clip ────────────────────────────────────────────────────────────
function playClip() {
  if (!currentHighlight) return;
  if (clipInterval) clearInterval(clipInterval);
  videoPlayer.currentTime = currentHighlight.start;
  videoPlayer.play();
  clipInterval = setInterval(() => {
    if (videoPlayer.currentTime >= currentHighlight.end) {
      if (chkLoopPreview && chkLoopPreview.checked) {
        videoPlayer.currentTime = currentHighlight.start;
      } else {
        videoPlayer.pause();
        clearInterval(clipInterval);
      }
    }
  }, 80);
}

// ─── Generate AI Metadata ─────────────────────────────────────────────────
async function generateAI() {
  if (!currentHighlight || !currentVideo) return;
  const providerLabel = currentProvider === 'gemini' ? 'Gemini IA' : 'Groq (Whisper + Llama)';
  showLoader(`Gerando metadados com ${providerLabel}...`, 'Transcrição + título viral + descrição SEO');

  try {
    const activeKey = currentProvider === 'gemini' ? geminiKey : groqKey;
    const activeModel = currentProvider === 'gemini' ? geminiSelectedModel : groqSelectedModel;

    const r = await (await fetch(`${API}/api/generate-metadata`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoName: currentVideo, start: currentHighlight.start, end: currentHighlight.end,
        apiKey: activeKey, provider: currentProvider, model: activeModel,
        tier: currentHighlight.tier, score: currentHighlight.score
      })
    })).json();

    if (r.success) {
      const m = r.metadata;
      metaTitle.value = m.title;
      metaDescription.value = m.description;
      metaTranscription.value = m.transcription;
      metaTopic.value = m.topic;
      metaThumbnailPrompt.value = m.thumbnail_prompt || '';
      metadataStore[currentHighlight.id] = {
        title: m.title,
        description: m.description,
        transcription: m.transcription,
        topic: m.topic,
        thumbnail_prompt: m.thumbnail_prompt || '',
        words: m.words || []
      };
      const te = $(`hl-t-${currentHighlight.id}`);
      if (te) te.textContent = m.title;
      
      if (r.fallback) {
        const detail = r.errorMsg ? `: ${r.errorMsg}` : '';
        toast(`Aviso: Erro na API${detail}. Usando metadados locais de backup.`, 'warning');
      } else {
        toast('Metadados e timestamps gerados com sucesso!', 'success');
      }
      updateLiveSubtitles(videoPlayer.currentTime);
    } else { toast(`Erro: ${r.error}`, 'error'); }
  } catch (e) { console.error(e); toast('Erro de conexão.', 'error'); }
  finally { hideLoader(); }
}

// ─── Export ───────────────────────────────────────────────────────────────
async function exportClip() {
  if (!currentHighlight || !currentVideo) return;
  const title = metaTitle.value.trim() || `Bloco #${currentHighlight.id}`;

  const txtOverlay = overlayText.value.trim() ? {
    text: overlayText.value.trim(),
    position: overlayPosition.value,
    color: overlayColor.value,
    size: parseInt(overlaySize.value)
  } : null;

  showLoader('Exportando vídeo profissional...', `Layout: ${currentLayout.toUpperCase()} • Fade in/out • Legendas: ${subtitleStyle.value ? subtitleStyle.value.toUpperCase() : 'NÃO'}`);

  try {
    const r = await (await fetch(`${API}/api/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoName: currentVideo,
        secondaryVideoName: secondaryVideoSelect.value || null,
        secondaryVideoStart: parseFloat($('secondaryVideoStart').value || 0),
        secondaryVideoCropX: parseFloat($('secondaryVideoCropX').value || 0.5),
        start: currentHighlight.start,
        end: currentHighlight.end,
        title, layout: currentLayout, cropX: cropXRatio,
        textOverlay: txtOverlay,
        subtitleStyle: subtitleStyle.value || null,
        words: metadataStore[currentHighlight.id]?.words || null,
        showProgressBar: chkProgressBar.checked,
        layoutFormat: layoutFormat.value,
        quality: exportQuality.value,
        subtitleFont: subtitleFont.value,
        subtitleSize: parseInt(subtitleSize.value),
        primaryColor: primaryColor.value,
        activeColor: activeColor.value
      })
    })).json();

    if (r.success) {
      toast('Exportação concluída!', 'success');
      loadExports();
      const el = $(`hl-${currentHighlight.id}`);
      if (el) {
        let dl = el.querySelector('.hl-downloads');
        if (dl) dl.remove();
        dl = document.createElement('div');
        dl.className = 'hl-downloads';
        dl.style.cssText = 'margin-top:0.5rem;font-size:0.75rem;display:flex;gap:0.5rem;align-items:center;';
        dl.innerHTML = `
          <span style="color:var(--accent-cyan);">✓</span>
          <a href="/exports/${encodeURIComponent(r.files.landscape)}" download style="color:var(--text-primary);text-decoration:underline;">16:9</a>
          <a href="/exports/${encodeURIComponent(r.files.portrait)}" download style="color:var(--accent-pink);text-decoration:underline;">9:16</a>`;
        el.appendChild(dl);
      }
    } else { toast(`Erro: ${r.error}`, 'error'); }
  } catch (e) { console.error(e); toast('Erro de conexão.', 'error'); }
  finally { hideLoader(); }
}

// ─── Creative Studio Preview Updates ──────────────────────────────────────────
function updateTextOverlayPreview() {
  const txt = overlayText.value.trim();
  if (txt) {
    liveTextOverlay.textContent = txt;
    liveTextOverlay.style.color = overlayColor.value;
    liveTextOverlay.style.fontSize = `${parseInt(overlaySize.value) * 0.35}px`; // scale down for player container size
    liveTextOverlay.className = `live-text-overlay ${overlayPosition.value}`;
    liveTextOverlay.style.display = 'block';
  } else {
    liveTextOverlay.style.display = 'none';
  }
}

function updateLayoutPreview() {
  videoContainer.classList.remove('preview-split-h', 'preview-split-v', 'preview-pip');
  if (currentLayout === 'split-h') {
    videoContainer.classList.add('preview-split-h');
    cropOverlay.style.width = '63.28%';
    cropOverlay.querySelector('.crop-label').textContent = '9:8 (Talking Head)';
  } else if (currentLayout === 'split-v') {
    videoContainer.classList.add('preview-split-v');
    cropOverlay.style.width = '31.64%';
    cropOverlay.querySelector('.crop-label').textContent = '9:16';
  } else if (currentLayout === 'pip') {
    videoContainer.classList.add('preview-pip');
    cropOverlay.style.width = '31.64%';
    cropOverlay.querySelector('.crop-label').textContent = '9:16 (Talking Head)';
  } else {
    cropOverlay.style.width = '31.64%';
    cropOverlay.querySelector('.crop-label').textContent = '9:16';
  }
  resetCropOverlayPosition();
  syncSecondaryPlayer();
}

function resetCropOverlayPosition() {
  const container = $('videoContainer');
  const maxLeft = container.offsetWidth - cropOverlay.offsetWidth;
  const newLeft = maxLeft * cropXRatio;
  cropOverlay.style.left = `${newLeft}px`;
}

function updateLiveSubtitles(currentTime) {
  if (!currentHighlight || !subtitleStyle.value) {
    liveSubtitles.style.display = 'none';
    return;
  }

  const meta = metadataStore[currentHighlight.id];
  if (!meta || !meta.words || meta.words.length === 0) {
    liveSubtitles.style.display = 'none';
    return;
  }

  // Apply dynamic color, font, and size overrides to preview
  liveSubtitles.style.setProperty('--primary-color', primaryColor.value);
  liveSubtitles.style.setProperty('--active-color', activeColor.value);
  liveSubtitles.style.fontFamily = subtitleFont.value;
  liveSubtitles.style.fontSize = `${subtitleSize.value * 0.35}px`;

  const relTime = currentTime - currentHighlight.start;

  // Group words into lines of 4
  const words = meta.words;
  const lines = [];
  let currentLine = [];
  for (const w of words) {
    if (currentLine.length > 0) {
      const first = currentLine[0];
      const gap = w.s - first.s;
      if (currentLine.length >= 4 || gap > 2.5) {
        lines.push(currentLine);
        currentLine = [];
      }
    }
    currentLine.push(w);
  }
  if (currentLine.length > 0) lines.push(currentLine);

  // Find active line
  const activeLine = lines.find(line => {
    const start = line[0].s;
    const end = line[line.length - 1].e;
    return relTime >= start - 0.2 && relTime <= end + 0.5;
  });

  if (activeLine) {
    // Determine active word index
    const activeWordIdx = activeLine.findIndex(w => relTime >= w.s && relTime <= w.e);

    const html = activeLine.map((w, idx) => {
      if (idx === activeWordIdx) {
        return `<span class="highlight">${w.w.toUpperCase()}</span>`;
      }
      return w.w.toUpperCase();
    }).join(' ');

    liveSubtitles.innerHTML = html;
    liveSubtitles.className = `live-subtitles style-${subtitleStyle.value}`;
    liveSubtitles.style.display = 'block';
  } else {
    liveSubtitles.style.display = 'none';
  }
}

async function downloadBroll() {
  showLoader('Baixando B-roll de Gameplay...', 'Isso pode levar alguns segundos...');
  try {
    const r = await (await fetch(`${API}/api/download-sample-broll`, { method: 'POST' })).json();
    if (r.success) {
      toast('B-roll de gameplay baixado com sucesso!', 'success');
      await loadVideos();
    } else {
      toast(`Erro ao baixar B-roll: ${r.error}`, 'error');
    }
  } catch (e) {
    console.error(e);
    toast('Erro de conexão ao baixar B-roll', 'error');
  } finally {
    hideLoader();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function fmt(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

// ─── Video Import Panel Logic ─────────────────────────────────────────────
function setupImportPanel() {
  const importHeader = $('importHeader');
  const importContent = $('importContent');
  const importToggleIcon = $('importToggleIcon');
  const tabBtns = document.querySelectorAll('.import-tab-btn');
  const tabPanes = document.querySelectorAll('.import-tab-pane');
  
  // Toggle panel collapse
  importHeader.addEventListener('click', () => {
    const isHidden = importContent.style.display === 'none';
    importContent.style.display = isHidden ? 'flex' : 'none';
    importToggleIcon.classList.toggle('rotated', isHidden);
  });
  
  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      if (tabId === 'local') {
        $('tabPaneLocal').classList.add('active');
      } else {
        $('tabPaneYoutube').classList.add('active');
      }
    });
  });
  
  // Local upload dropzone trigger click
  const uploadDropzone = $('uploadDropzone');
  const localVideoInput = $('localVideoInput');
  
  uploadDropzone.addEventListener('click', () => {
    localVideoInput.click();
  });
  
  // Drag & Drop events
  uploadDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadDropzone.style.borderColor = 'var(--accent-purple)';
    uploadDropzone.style.background = 'rgba(139, 92, 246, 0.05)';
  });
  
  uploadDropzone.addEventListener('dragleave', () => {
    uploadDropzone.style.borderColor = 'var(--border-glass)';
    uploadDropzone.style.background = 'rgba(255, 255, 255, 0.01)';
  });
  
  uploadDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadDropzone.style.borderColor = 'var(--border-glass)';
    uploadDropzone.style.background = 'rgba(255, 255, 255, 0.01)';
    
    if (e.dataTransfer.files.length > 0) {
      handleLocalFileUpload(e.dataTransfer.files[0]);
    }
  });
  
  localVideoInput.addEventListener('change', () => {
    if (localVideoInput.files.length > 0) {
      handleLocalFileUpload(localVideoInput.files[0]);
    }
  });
  
  // YouTube Download Button
  const btnDownloadYoutube = $('btnDownloadYoutube');
  const youtubeUrlInput = $('youtubeUrlInput');
  const youtubeStatusMsg = $('youtubeStatusMsg');
  
  btnDownloadYoutube.addEventListener('click', async () => {
    const url = youtubeUrlInput.value.trim();
    if (!url) {
      showYoutubeStatus('Por favor, insira um link do YouTube.', 'error');
      return;
    }
    
    btnDownloadYoutube.disabled = true;
    showYoutubeStatus('Iniciando download... Isso pode levar de 30s a 2min para vídeos normais.', '');
    
    try {
      const response = await fetch('/api/download-youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      
      const result = await response.json();
      if (result.success) {
        showYoutubeStatus(`Vídeo baixado com sucesso: ${result.filename}`, 'success');
        youtubeUrlInput.value = '';
        
        // Reload video list
        await loadVideos();
        
        // Auto-select downloaded video
        videoSelect.value = result.filename;
        // Trigger select change event programmatically
        videoSelect.dispatchEvent(new Event('change'));
      } else {
        showYoutubeStatus(`Erro: ${result.error || 'Não foi possível baixar o vídeo.'}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showYoutubeStatus('Erro de conexão com o servidor.', 'error');
    } finally {
      btnDownloadYoutube.disabled = false;
    }
  });
  
  function showYoutubeStatus(msg, type) {
    youtubeStatusMsg.textContent = msg;
    youtubeStatusMsg.className = 'youtube-status-msg ' + type;
    youtubeStatusMsg.style.display = 'block';
  }
}

async function handleLocalFileUpload(file) {
  const container = $('uploadProgressContainer');
  const percentText = $('uploadProgressPercent');
  const progressBar = $('uploadProgressBar');
  const fileNameText = $('uploadFileName');
  
  fileNameText.textContent = file.name;
  container.style.display = 'block';
  percentText.textContent = '0%';
  progressBar.style.width = '0%';
  
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload-video', true);
  xhr.setRequestHeader('x-filename', file.name);
  xhr.setRequestHeader('Content-Type', file.type);
  
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const percent = Math.round((e.loaded / e.total) * 100);
      percentText.textContent = `${percent}%`;
      progressBar.style.width = `${percent}%`;
    }
  };
  
  xhr.onload = async () => {
    if (xhr.status === 200) {
      const result = JSON.parse(xhr.responseText);
      if (result.success) {
        toast(`Upload concluído: ${result.filename}`, 'success');
        setTimeout(() => {
          container.style.display = 'none';
        }, 1500);
        
        // Reload video list
        await loadVideos();
        
        // Auto-select uploaded video
        videoSelect.value = result.filename;
        // Trigger select change event
        videoSelect.dispatchEvent(new Event('change'));
      } else {
        toast(`Erro no upload: ${result.error}`, 'error');
      }
    } else {
      toast('Falha no upload do arquivo.', 'error');
    }
  };
  xhr.onerror = () => {
    toast('Erro de conexão no upload.', 'error');
  };
  
  xhr.send(file);
}

// ─── Fine-Tuning Cut Logic ────────────────────────────────────────────────
function setupCutAdjustmentEvents() {
  inputCutStart.addEventListener('change', () => {
    updateHighlightTimes(inputCutStart.value, inputCutEnd.value, 'start');
  });
  inputCutEnd.addEventListener('change', () => {
    updateHighlightTimes(inputCutStart.value, inputCutEnd.value, 'end');
  });

  $('btnStartMinus1').addEventListener('click', () => {
    if (currentHighlight) updateHighlightTimes(currentHighlight.start - 1.0, currentHighlight.end, 'start');
  });
  $('btnStartMinus01').addEventListener('click', () => {
    if (currentHighlight) updateHighlightTimes(currentHighlight.start - 0.1, currentHighlight.end, 'start');
  });
  $('btnStartPlus01').addEventListener('click', () => {
    if (currentHighlight) updateHighlightTimes(currentHighlight.start + 0.1, currentHighlight.end, 'start');
  });
  $('btnStartPlus1').addEventListener('click', () => {
    if (currentHighlight) updateHighlightTimes(currentHighlight.start + 1.0, currentHighlight.end, 'start');
  });

  $('btnEndMinus1').addEventListener('click', () => {
    if (currentHighlight) updateHighlightTimes(currentHighlight.start, currentHighlight.end - 1.0, 'end');
  });
  $('btnEndMinus01').addEventListener('click', () => {
    if (currentHighlight) updateHighlightTimes(currentHighlight.start, currentHighlight.end - 0.1, 'end');
  });
  $('btnEndPlus01').addEventListener('click', () => {
    if (currentHighlight) updateHighlightTimes(currentHighlight.start, currentHighlight.end + 0.1, 'end');
  });
  $('btnEndPlus1').addEventListener('click', () => {
    if (currentHighlight) updateHighlightTimes(currentHighlight.start, currentHighlight.end + 1.0, 'end');
  });

  // Capture current video time as Start/End
  $('btnSetStartCurrent').addEventListener('click', () => {
    if (currentHighlight) {
      updateHighlightTimes(videoPlayer.currentTime, currentHighlight.end, 'start');
      toast('Início do corte marcado no tempo atual!', 'success');
    }
  });

  $('btnSetEndCurrent').addEventListener('click', () => {
    if (currentHighlight) {
      updateHighlightTimes(currentHighlight.start, videoPlayer.currentTime, 'end');
      toast('Fim do corte marcado no tempo atual!', 'success');
    }
  });

  // Nudge / Shift block
  $('btnNudgeLeft').addEventListener('click', () => {
    if (!currentHighlight) return;
    const d = videoPlayer.duration || 99999;
    let shift = -0.5;
    if (currentHighlight.start + shift < 0) {
      shift = -currentHighlight.start;
    }
    updateHighlightTimes(currentHighlight.start + shift, currentHighlight.end + shift, 'start');
  });

  $('btnNudgeRight').addEventListener('click', () => {
    if (!currentHighlight) return;
    const d = videoPlayer.duration || 99999;
    let shift = 0.5;
    if (currentHighlight.end + shift > d) {
      shift = d - currentHighlight.end;
    }
    updateHighlightTimes(currentHighlight.start + shift, currentHighlight.end + shift, 'end');
  });

  // Local Listen / Play Cut
  $('btnPlayAdjusted').addEventListener('click', () => {
    if (!currentHighlight) {
      toast('Selecione um bloco temático primeiro.', 'info');
      return;
    }
    playClip();
  });

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', e => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
      return;
    }
    
    if (!currentHighlight) return;
    
    const key = e.key.toLowerCase();
    
    if (key === ' ') {
      e.preventDefault();
      if (videoPlayer.paused) {
        videoPlayer.play();
      } else {
        videoPlayer.pause();
      }
    } else if (key === 'i' || e.key === '[') {
      e.preventDefault();
      updateHighlightTimes(videoPlayer.currentTime, currentHighlight.end, 'start');
      toast('Início do corte marcado no tempo atual!', 'success');
    } else if (key === 'o' || e.key === ']') {
      e.preventDefault();
      updateHighlightTimes(currentHighlight.start, videoPlayer.currentTime, 'end');
      toast('Fim do corte marcado no tempo atual!', 'success');
    } else if (key === 'arrowleft') {
      e.preventDefault();
      const d = videoPlayer.duration || 99999;
      let shift = -0.5;
      if (currentHighlight.start + shift < 0) shift = -currentHighlight.start;
      updateHighlightTimes(currentHighlight.start + shift, currentHighlight.end + shift, 'start');
    } else if (key === 'arrowright') {
      e.preventDefault();
      const d = videoPlayer.duration || 99999;
      let shift = 0.5;
      if (currentHighlight.end + shift > d) shift = d - currentHighlight.end;
      updateHighlightTimes(currentHighlight.start + shift, currentHighlight.end + shift, 'end');
    } else if (key === 'l') {
      e.preventDefault();
      const chk = $('chkLoopPreview');
      if (chk) {
        chk.checked = !chk.checked;
        toast(`Loop de Preview: ${chk.checked ? 'ATIVADO' : 'DESATIVADO'}`, 'info');
      }
    }
  });

  // Drag and Drop shifting of the visual cut range slider
  const cutRange = $('cutTimelineRange');
  const cutTrack = document.querySelector('.cut-timeline-track');
  
  let draggingRange = false;
  let dragRangeStartMouseX = 0;
  let dragRangeStartHighlightStart = 0;
  let dragRangeStartHighlightEnd = 0;
  
  if (cutRange && cutTrack) {
    cutRange.addEventListener('mousedown', (e) => {
      if (!currentHighlight) return;
      draggingRange = true;
      dragRangeStartMouseX = e.clientX;
      dragRangeStartHighlightStart = currentHighlight.start;
      dragRangeStartHighlightEnd = currentHighlight.end;
      cutRange.style.cursor = 'grabbing';
      e.stopPropagation();
      e.preventDefault();
    });
    
    window.addEventListener('mousemove', (e) => {
      if (!draggingRange || !currentHighlight) return;
      
      const trackWidth = cutTrack.offsetWidth || 1;
      const d = videoPlayer.duration || 1;
      const deltaX = e.clientX - dragRangeStartMouseX;
      const deltaTime = (deltaX / trackWidth) * d;
      
      const duration = dragRangeStartHighlightEnd - dragRangeStartHighlightStart;
      let newStart = dragRangeStartHighlightStart + deltaTime;
      let newEnd = dragRangeStartHighlightEnd + deltaTime;
      
      if (newStart < 0) {
        newStart = 0;
        newEnd = duration;
      }
      if (newEnd > d) {
        newEnd = d;
        newStart = d - duration;
      }
      
      updateHighlightTimes(newStart, newEnd, 'start');
    });
    
    window.addEventListener('mouseup', () => {
      if (draggingRange) {
        draggingRange = false;
        if (cutRange) cutRange.style.cursor = 'grab';
      }
    });
  }
}

function updateHighlightTimes(startVal, endVal, seekTarget = null) {
  if (!currentHighlight) {
    toast('Selecione um bloco temático primeiro.', 'info');
    return;
  }
  
  const d = videoPlayer.duration || 99999;
  let start = parseFloat(startVal);
  let end = parseFloat(endVal);
  
  if (isNaN(start) || start < 0) start = 0;
  if (isNaN(end) || end > d) end = d;
  
  if (start >= end) {
    if (seekTarget === 'start') {
      start = Math.max(0, end - 0.5);
    } else {
      end = Math.min(d, start + 0.5);
    }
  }
  
  // Save times back to highlight model
  currentHighlight.start = Number(start.toFixed(2));
  currentHighlight.end = Number(end.toFixed(2));
  currentHighlight.duration = Number((end - start).toFixed(2));
  
  // Update inputs and label
  inputCutStart.value = start.toFixed(1);
  inputCutEnd.value = end.toFixed(1);
  cutDurationDisplay.textContent = currentHighlight.duration.toFixed(1) + 's';
  
  // Update visual timeline range inside the panel
  if (cutTimelineRange) {
    cutTimelineRange.style.left = `${(start / d) * 100}%`;
    cutTimelineRange.style.width = `${((end - start) / d) * 100}%`;
  }
  if (cutTimeStartLabel) cutTimeStartLabel.textContent = `Início: ${start.toFixed(1)}s`;
  if (cutTimeEndLabel) cutTimeEndLabel.textContent = `Fim: ${end.toFixed(1)}s`;
  
  // Update highlight item in the sidebar list
  const hlItem = $(`hl-${currentHighlight.id}`);
  if (hlItem) {
    const timeSpan = hlItem.querySelector('.hl-time');
    if (timeSpan) {
      timeSpan.textContent = `${fmt(start)} → ${fmt(end)}`;
    }
  }
  
  // Redraw timelines and overlays
  drawTimeline(allHighlights, d);
  
  // Seek video for interactive boundary checking
  if (seekTarget === 'start') {
    videoPlayer.currentTime = start;
  } else if (seekTarget === 'end') {
    videoPlayer.currentTime = Math.max(start, end - 1.5);
  }
}

// ─── Real-Time Secondary Player Setup & Alignment ─────────────────────────────
function syncSecondaryPlayer() {
  if (currentLayout === 'full') {
    secondaryVideoPlayer.style.display = 'none';
    secondaryVideoPlayer.pause();
    return;
  }
  
  const secVal = secondaryVideoSelect.value;
  if (secVal) {
    const expectedSrc = `/raw-videos/${encodeURIComponent(secVal)}`;
    const urlObj = new URL(secondaryVideoPlayer.src || '', window.location.href);
    if (urlObj.pathname !== expectedSrc) {
      secondaryVideoPlayer.src = expectedSrc;
    }
    videoContainer.classList.add('has-secondary-active');
  } else {
    if (videoPlayer.src) {
      const urlObj = new URL(secondaryVideoPlayer.src || '', window.location.href);
      const mainUrlObj = new URL(videoPlayer.src, window.location.href);
      if (urlObj.pathname !== mainUrlObj.pathname) {
        secondaryVideoPlayer.src = videoPlayer.src;
      }
    }
    videoContainer.classList.remove('has-secondary-active');
  }

  // Ensure secondary player is always muted to not conflict with voice track
  secondaryVideoPlayer.muted = true;
  
  // Sincronizar play/pause imediato se o player principal estiver tocando
  if (!videoPlayer.paused) {
    secondaryVideoPlayer.play().catch(()=>{});
  } else {
    secondaryVideoPlayer.pause();
  }
}

// ─── Exports Gallery Loading & Maintenance ──────────────────────────────────
async function loadExports() {
  try {
    const res = await fetch('/api/exports');
    const r = await res.json();
    const gallery = $('exportsGallery');
    if (!gallery) return;
    
    if (r.success && r.exports && r.exports.length > 0) {
      gallery.innerHTML = '';
      r.exports.forEach(item => {
        const card = document.createElement('div');
        card.className = 'export-card';
        
        const isLandscape = item.name.includes('_16_9');
        const isSquare = item.name.includes('_1_1');
        
        let label = '9:16 Vertical';
        if (isLandscape) label = '16:9 Paisagem';
        else if (isSquare) label = '1:1 Quadrado';
        
        const safeName = item.name.replace('.mp4', '');
        const dateFormatted = new Date(item.createdAt).toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        
        card.innerHTML = `
          <div class="export-card-thumbnail">
            <i class="fa-solid fa-video"></i>
            <div class="export-card-play-overlay" onclick="playExportedVideo('${item.name}', '${item.url}', '${item.sizeMB} MB')">
              <div class="btn-play-circle"><i class="fa-solid fa-play"></i></div>
            </div>
          </div>
          <div class="export-card-body">
            <div class="export-card-title" title="${safeName}">${safeName}</div>
            <div class="export-card-meta">
              <span>${label}</span>
              <span>${item.sizeMB} MB</span>
            </div>
            <div style="font-size:0.7rem; color:var(--text-secondary); margin-top:0.2rem;">${dateFormatted}</div>
            <div class="export-card-actions">
              <div class="export-card-downloads">
                <a class="btn-download-link" href="${item.url}" download="${item.name}"><i class="fa-solid fa-download"></i> Baixar</a>
              </div>
              <button class="btn-delete-clip" onclick="deleteExportedVideo('${item.name}')" title="Excluir do Servidor">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
        `;
        gallery.appendChild(card);
      });
    } else {
      gallery.innerHTML = `
        <div class="empty-gallery-state">
          <i class="fa-solid fa-box-open"></i>
          <p>Nenhum clipe exportado ainda. Exporte um bloco acima para começar!</p>
        </div>
      `;
    }
  } catch (err) {
    console.error('[Gallery] Erro ao carregar exportados:', err);
  }
}

async function deleteExportedVideo(filename) {
  if (!confirm('Deseja realmente excluir este clipe permanentemente do servidor?')) return;
  
  try {
    const res = await fetch(`/api/exports/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    const r = await res.json();
    if (r.success) {
      toast('Clipe excluído com sucesso!', 'success');
      await loadExports();
    } else {
      toast(`Erro ao excluir clipe: ${r.error}`, 'error');
    }
  } catch (err) {
    console.error(err);
    toast('Erro de conexão ao excluir clipe.', 'error');
  }
}

function playExportedVideo(name, url, size) {
  const modal = $('previewModal');
  const player = $('previewVideoPlayer');
  const nameLabel = $('previewVideoName');
  const sizeLabel = $('previewVideoSize');
  
  if (!modal || !player) return;
  
  nameLabel.textContent = name;
  sizeLabel.textContent = size;
  player.src = url;
  modal.classList.add('show');
  player.play().catch(()=>{});
}

function closeExportPreview() {
  const modal = $('previewModal');
  const player = $('previewVideoPlayer');
  if (modal && player) {
    player.pause();
    player.removeAttribute('src');
    modal.classList.remove('show');
  }
}

// Bind methods globally to ensure inline onclick handlers work
window.playExportedVideo = playExportedVideo;
window.deleteExportedVideo = deleteExportedVideo;
window.closeExportPreview = closeExportPreview;
window.syncSecondaryPlayer = syncSecondaryPlayer;
window.loadExports = loadExports;

