import express from 'express';
import cors from 'cors';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/exports', express.static(path.join(__dirname, 'exports')));

// ─── Serve raw videos (restricted to video extensions only) ─────────────────
const VIDEO_EXTS = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv'];
app.use('/raw-videos', (req, res, next) => {
  const ext = path.extname(req.path).toLowerCase();
  if (!VIDEO_EXTS.includes(ext)) return res.status(403).json({ error: 'Forbidden' });
  next();
}, express.static(path.resolve(__dirname, '..')));

// ─── FFmpeg / FFprobe Paths (configurable via .env) ─────────────────────────
const ffmpeg  = () => process.env.FFMPEG_PATH  || 'ffmpeg';
const ffprobe = () => process.env.FFPROBE_PATH || 'ffprobe';

// ─── Gemini Model (configurable via .env) ───────────────────────────────────
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';

// ─── Startup: Clean orphan temp files ───────────────────────────────────────
(function cleanupTempFiles() {
  const patterns = [/^tmp_.*\.(wav|mp3)$/, /^temp_.*\.ass$/];
  fs.readdirSync(__dirname).forEach(f => {
    if (patterns.some(p => p.test(f))) {
      try { fs.unlinkSync(path.join(__dirname, f)); console.log(`[Cleanup] Removed: ${f}`); } catch {}
    }
  });
})();

// ─── Utility ────────────────────────────────────────────────────────────────
const run = (cmd, args) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args);
  let out = '', err = '';
  p.stdout.on('data', d => out += d);
  p.stderr.on('data', d => err += d);
  p.on('close', code => code === 0 ? resolve({ out, err }) : reject(new Error(err)));
});

// ─── Groq API Helpers ────────────────────────────────────────────────────────
async function transcribeGroq(apiKey, audioPath, modelName = 'whisper-large-v3') {
  const buffer = fs.readFileSync(audioPath);
  const boundary = '----WebKitFormBoundaryClipperAI' + Math.random().toString(36).substring(2);
  const parts = [];
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${modelName}\r\n`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`);
  
  const headerBuffer = Buffer.from(parts.join(''));
  const fileBuffer = buffer;
  const footerBuffer = Buffer.from(`\r\n--${boundary}--\r\n`);
  
  const bodyBuffer = Buffer.concat([headerBuffer, fileBuffer, footerBuffer]);
  
  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body: bodyBuffer
  });
  
  if (!response.ok) {
    const errText = await response.text();
    // Fallback to whisper-large-v3-turbo if whisper-large-v3 is blocked in the Groq Org settings
    if (response.status === 403 && errText.includes('model_permission_blocked_org') && modelName === 'whisper-large-v3') {
      console.log(`[Groq Whisper] Model ${modelName} is blocked. Retrying with whisper-large-v3-turbo...`);
      return await transcribeGroq(apiKey, audioPath, 'whisper-large-v3-turbo');
    }
    throw new Error(`Groq Whisper failed: ${response.status} - ${errText}`);
  }
  
  return await response.json();
}

async function chatGroq(apiKey, transcription, modelName = 'llama-3.1-8b-instant', clipDuration, tier, score) {
  const prompt = `Você é um editor profissional de vídeos virais.
Analise este texto de transcrição de um vídeo de ${clipDuration.toFixed(0)}s (classificado como tier "${tier}" com score ${score}/100):
"${transcription}"

Gere as seguintes informações de metadados de forma criativa e otimizada.
Você deve retornar APENAS um JSON válido seguindo estritamente a seguinte estrutura (sem markdown ou texto extra):
{
  "title": "título viral curto com emojis, otimizado para TikTok/Reels/Shorts",
  "description": "descrição SEO cativante com 3-5 hashtags no final",
  "topic": "tema principal do trecho em 2-3 palavras",
  "thumbnail_prompt": "highly detailed English image generation prompt (for Midjourney or DALL-E 3) to create a high-CTR cinematic cover/thumbnail matching the speaker's tone and visual context"
}

IMPORTANTE: O campo "thumbnail_prompt" DEVE ser obrigatoriamente escrito em inglês, descrevendo uma cena visual atraente e cinematic para a capa (thumb) do vídeo, mesmo que os outros campos estejam em português.`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq Llama failed: ${response.status} - ${errText}`);
  }

  const json = await response.json();
  const content = json.choices?.[0]?.message?.content;
  return JSON.parse(content);
}

// ─── Route: List Videos ─────────────────────────────────────────────────────
app.get('/api/videos', (req, res) => {
  try {
    const dir = path.resolve(__dirname, '..');
    const videos = fs.readdirSync(dir)
      .filter(f => ['.mp4','.avi','.mov','.mkv'].includes(path.extname(f).toLowerCase()))
      .map(f => {
        const s = fs.statSync(path.join(dir, f));
        return { name: f, path: path.join(dir, f), sizeBytes: s.size, sizeMB: (s.size/1048576).toFixed(2) };
      });
    res.json({ success: true, videos });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─── Route: Upload Local Video ──────────────────────────────────────────────
app.post('/api/upload-video', (req, res) => {
  const filename = req.headers['x-filename'] || `upload_${Date.now()}.mp4`;
  // Sanitize filename to prevent directory traversal
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9_.-]/g, '_');
  const targetPath = path.resolve(__dirname, '..', safeName);
  
  console.log(`[Upload] Saving file to ${targetPath}...`);
  const writeStream = fs.createWriteStream(targetPath);
  req.pipe(writeStream);
  
  writeStream.on('finish', () => {
    console.log(`[Upload] File saved successfully to ${targetPath}`);
    res.json({ success: true, filename: safeName });
  });
  
  writeStream.on('error', (err) => {
    console.error('[Upload] Error saving file:', err);
    res.status(500).json({ success: false, error: err.message });
  });
});

// Helper: Dynamic downloader for yt-dlp.exe
const YTDLP_PATH = path.resolve(__dirname, 'yt-dlp.exe');
function ensureYtdlp() {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(YTDLP_PATH)) {
      return resolve();
    }
    
    console.log('[YouTube Download] Downloading yt-dlp.exe...');
    const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
    const file = fs.createWriteStream(YTDLP_PATH);
    
    function get(downloadUrl) {
      https.get(downloadUrl, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          get(response.headers.location);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download yt-dlp.exe: HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log('[YouTube Download] yt-dlp.exe downloaded successfully.');
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(YTDLP_PATH, () => {});
        reject(err);
      });
    }
    
    get(url);
  });
}

// ─── Route: Download YouTube Video ──────────────────────────────────────────
app.post('/api/download-youtube', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'URL do YouTube é obrigatória.' });
  }
  
  try {
    await ensureYtdlp();
    
    // Alphanumeric video ID matching or timestamp-based fallback
    const videoIdMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    const videoId = videoIdMatch ? videoIdMatch[1] : `yt_${Date.now()}`;
    const outputFilename = `yt_${videoId}.mp4`;
    const outputPath = path.resolve(__dirname, '..', outputFilename);
    
    console.log(`[YouTube] Downloading ${url} to ${outputPath}...`);
    
    const cmd = `"${YTDLP_PATH}" -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "${outputPath}" "${url}"`;
    
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error('[YouTube Error]', error, stderr);
        return res.status(500).json({ success: false, error: error.message || stderr });
      }
      
      console.log('[YouTube Success]', stdout);
      if (fs.existsSync(outputPath)) {
        res.json({ success: true, filename: outputFilename });
      } else {
        res.status(500).json({ success: false, error: 'Arquivo não foi criado após o download.' });
      }
    });
  } catch (err) {
    console.error('[YouTube Download Exception]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Route: Video Info (resolution, fps, duration) ──────────────────────────
app.post('/api/video-info', async (req, res) => {
  const { videoName } = req.body;
  const videoPath = path.resolve(__dirname, '..', videoName);
  if (!fs.existsSync(videoPath)) return res.status(404).json({ success: false, error: 'Not found' });

  try {
    const r = await run(ffprobe(), [
      '-v','error','-select_streams','v:0',
      '-show_entries','stream=width,height,r_frame_rate,duration',
      '-show_entries','format=duration',
      '-of','json', videoPath
    ]);
    const info = JSON.parse(r.out);
    const stream = info.streams?.[0] || {};
    const dur = parseFloat(stream.duration || info.format?.duration || 0);
    const [num,den] = (stream.r_frame_rate || '30/1').split('/');
    res.json({
      success: true,
      width: stream.width || 1920,
      height: stream.height || 1080,
      fps: Math.round(parseInt(num)/parseInt(den)),
      duration: dur
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Helper to analyze audio volume/energy statistics of a video segment
async function getBlockVolumeStats(videoPath, start, dur) {
  try {
    const r = await run(ffmpeg(), [
      '-ss', `${start}`,
      '-t', `${dur}`,
      '-i', videoPath,
      '-vn',
      '-af', 'volumedetect',
      '-f', 'null', '-'
    ]);
    const maxMatch = r.err.match(/max_volume:\s*(-?\d+\.?\d*)\s*dB/);
    const meanMatch = r.err.match(/mean_volume:\s*(-?\d+\.?\d*)\s*dB/);
    return {
      maxVolume: maxMatch ? parseFloat(maxMatch[1]) : 0,
      meanVolume: meanMatch ? parseFloat(meanMatch[1]) : -25
    };
  } catch (e) {
    console.warn(`[Volume Analysis] Failed for block at ${start}s:`, e.message);
    return { maxVolume: 0, meanVolume: -25 };
  }
}

// ─── Route: Analyze (3-Layer Engine) ────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { videoName } = req.body;
  if (!videoName) return res.status(400).json({ success: false, error: 'videoName required' });

  const videoPath = path.resolve(__dirname, '..', videoName);
  if (!fs.existsSync(videoPath)) return res.status(404).json({ success: false, error: 'Not found' });

  try {
    // ── PHASE 0: Get duration ──
    const durR = await run(ffprobe(), ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1', videoPath]);
    const duration = parseFloat(durR.out.trim());
    console.log(`[Analyze] Duration: ${duration}s`);

    // ── PHASE 1: Adaptive noise floor via volumedetect ──
    console.log('[Analyze] Phase 1: Detecting noise floor...');
    const volR = await run(ffmpeg(), ['-vn', '-i', videoPath, '-af','volumedetect', '-f','null', '-']);
    const meanMatch = volR.err.match(/mean_volume:\s*(-?\d+\.?\d*)\s*dB/);
    const meanVol = meanMatch ? parseFloat(meanMatch[1]) : -25;
    // Adaptive threshold: mean + 8dB (louder than average silence)
    const silenceThreshold = Math.min(meanVol + 8, -18);
    console.log(`[Analyze] Mean volume: ${meanVol}dB → Silence threshold: ${silenceThreshold}dB`);

    // ── PHASE 2: Silence detection with adaptive threshold ──
    console.log('[Analyze] Phase 2: Detecting silences...');
    const silR = await run(ffmpeg(), [
      '-vn',
      '-i', videoPath,
      '-af', `silencedetect=noise=${silenceThreshold}dB:d=1.5`,
      '-f','null', '-'
    ]);

    const startRe = /silence_start: (\d+\.?\d*)/g;
    const endRe   = /silence_end: (\d+\.?\d*) \| silence_duration: (\d+\.?\d*)/g;
    const starts = []; let m;
    while ((m = startRe.exec(silR.err)) !== null) starts.push(parseFloat(m[1]));
    const silences = []; let si = 0;
    while ((m = endRe.exec(silR.err)) !== null) {
      if (si < starts.length) {
        silences.push({ start: starts[si], end: parseFloat(m[1]), dur: parseFloat(m[2]) });
        si++;
      }
    }
    console.log(`[Analyze] Found ${silences.length} silences`);

    // Extract active speech segments
    const segments = [];
    let t = 0;
    for (const s of silences) {
      if (s.start - t > 1) segments.push({ start: t, end: s.start, dur: s.start - t });
      t = s.end;
    }
    if (duration - t > 1) segments.push({ start: t, end: duration, dur: duration - t });

    // ── PHASE 3: Topic grouping ──
    // Merge segments separated by gaps < 4s into "topic blocks"
    console.log('[Analyze] Phase 3: Grouping into topic blocks...');
    const TOPIC_GAP = 4; // seconds — gaps smaller than this stay in the same topic
    const MIN_BLOCK = 5; // discard blocks shorter than 5s
    const blocks = [];

    if (segments.length > 0) {
      let cur = { start: segments[0].start, end: segments[0].end };
      for (let i = 1; i < segments.length; i++) {
        const gap = segments[i].start - cur.end;
        if (gap < TOPIC_GAP) {
          cur.end = segments[i].end; // absorb into same block
        } else {
          const dur = cur.end - cur.start;
          if (dur >= MIN_BLOCK) blocks.push({ ...cur, dur });
          cur = { start: segments[i].start, end: segments[i].end };
        }
      }
      const dur = cur.end - cur.start;
      if (dur >= MIN_BLOCK) blocks.push({ ...cur, dur });
    }

    // ── PHASE 4: Scoring & Ranking ──
    console.log('[Analyze] Phase 4: Scoring (with audio energy peak analysis)...');
    const scored = await Promise.all(blocks.map(async (b, i) => {
      const stats = await getBlockVolumeStats(videoPath, b.start, b.dur);

      // Duration score: sweet spot 15-60s gets max
      let durScore;
      if (b.dur >= 15 && b.dur <= 60) durScore = 100;
      else if (b.dur < 15) durScore = (b.dur / 15) * 100;
      else durScore = Math.max(0, 100 - ((b.dur - 60) / 60) * 50);

      // Position score: middle of video gets bonus
      const relPos = ((b.start + b.end) / 2) / duration;
      const posScore = 100 * (1 - Math.abs(relPos - 0.45) * 1.5);

      // Energy score (calculated from peak max_volume and average mean_volume)
      const peakVolume = stats.maxVolume;
      const peakScore = Math.max(0, 100 + peakVolume * 5); // closer to 0dB is louder
      const meanVolume = stats.meanVolume;
      const energyDensity = Math.min(100, Math.max(0, (meanVolume + 40) * 3.33));
      const energyScore = Math.round(peakScore * 0.5 + energyDensity * 0.5);

      // Final dynamic cross-score
      const score = Math.round(durScore * 0.4 + Math.max(0, posScore) * 0.2 + energyScore * 0.4);
      return { ...b, score: Math.min(100, Math.max(0, score)) };
    }));

    // Sort by score descending for tier assignment
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    const goldCutoff  = Math.ceil(sorted.length * 0.3);
    const silverCutoff = Math.ceil(sorted.length * 0.7);
    const tierMap = {};
    sorted.forEach((b, i) => {
      const key = `${b.start}-${b.end}`;
      if (i < goldCutoff) tierMap[key] = 'gold';
      else if (i < silverCutoff) tierMap[key] = 'silver';
      else tierMap[key] = 'bronze';
    });

    // ── PHASE 5: Padding & Final Output ──
    const PADDING = 0.3;
    const highlights = scored.map((b, i) => ({
      id: i + 1,
      start:    parseFloat(Math.max(0, b.start - PADDING).toFixed(2)),
      end:      parseFloat(Math.min(duration, b.end + PADDING).toFixed(2)),
      duration: parseFloat((b.dur + PADDING * 2).toFixed(2)),
      score:    b.score,
      tier:     tierMap[`${b.start}-${b.end}`] || 'bronze'
    }));

    console.log(`[Analyze] Result: ${highlights.length} topic blocks (from ${silences.length} silences, ${segments.length} segments)`);

    res.json({ success: true, duration, highlights, stats: {
      meanVolume: meanVol,
      silenceThreshold,
      rawSilences: silences.length,
      rawSegments: segments.length,
      topicBlocks: highlights.length
    }});
  } catch (e) {
    console.error('[Analyze] Error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Route: Generate Metadata (Gemini) ──────────────────────────────────────
app.post('/api/generate-metadata', async (req, res) => {
  const { videoName, start, end, apiKey, provider: clientProvider, tier, score, model: clientModel } = req.body;
  if (!videoName || start === undefined || end === undefined)
    return res.status(400).json({ success: false, error: 'Missing params' });

  const provider = clientProvider || 'gemini';
  const videoPath = path.resolve(__dirname, '..', videoName);
  const tmpAudio = path.join(__dirname, `tmp_${Date.now()}.mp3`);

  try {
    const clipDuration = end - start;
    // Use MP3 instead of WAV to reduce file size (~250KB vs ~4MB)
    await run(ffmpeg(), ['-y', '-ss', `${start}`, '-t', `${clipDuration}`, '-i', videoPath, '-vn', '-ar', '16000', '-ac', '1', '-b:a', '64k', tmpAudio]);

    if (provider === 'groq') {
      const key = apiKey || process.env.GROQ_API_KEY;
      if (!key) throw new Error("Chave Groq API Key não configurada");

      console.log(`[Metadata - Groq] Transcrevendo com Whisper...`);
      const whisperRes = await transcribeGroq(key, tmpAudio, 'whisper-large-v3');
      const transcription = whisperRes.text || '';

      const segments = [];
      if (whisperRes.segments && whisperRes.segments.length > 0) {
        for (const s of whisperRes.segments) {
          segments.push({
            text: s.text,
            s: s.start,
            e: s.end
          });
        }
      }

      console.log(`[Metadata - Groq] Gerando metadados com Llama (${clientModel || 'llama-3.1-8b-instant'})...`);
      const chatRes = await chatGroq(key, transcription, clientModel || 'llama-3.1-8b-instant', clipDuration, tier || 'silver', score || 50);

      const words = [];
      if (segments.length > 0) {
        for (const seg of segments) {
          if (!seg.text) continue;
          const segWords = seg.text.trim().split(/\s+/).filter(Boolean);
          if (segWords.length === 0) continue;
          const sTime = parseFloat(seg.s || 0);
          const eTime = parseFloat(seg.e || 0);
          const duration = Math.max(0.1, eTime - sTime);
          const wordDur = duration / segWords.length;
          segWords.forEach((w, idx) => {
            words.push({
              w: w,
              s: Number((sTime + idx * wordDur).toFixed(2)),
              e: Number((sTime + (idx + 1) * wordDur).toFixed(2))
            });
          });
        }
      } else {
        const allWords = transcription.trim().split(/\s+/).filter(Boolean);
        const wordDur = clipDuration / Math.max(1, allWords.length);
        allWords.forEach((w, idx) => {
          words.push({
            w: w,
            s: Number((idx * wordDur).toFixed(2)),
            e: Number(((idx + 1) * wordDur).toFixed(2))
          });
        });
      }

      res.json({
        success: true,
        metadata: {
          transcription: transcription,
          title: chatRes.title || `Destaque #${Math.floor(start)}s ⚡`,
          description: chatRes.description || `Trecho de ${start.toFixed(0)}s a ${end.toFixed(0)}s.`,
          topic: chatRes.topic || 'Conversa',
          words: words
        }
      });
      return;
    }

    // Default: Gemini
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (key) {
      const genAI = new GoogleGenerativeAI(key);
      const useModel = clientModel || GEMINI_MODEL;
      const model = genAI.getGenerativeModel({ model: useModel });
      console.log(`[Metadata] Using model: ${useModel}`);
      const audio64 = fs.readFileSync(tmpAudio).toString('base64');

      const prompt = `Você é um editor profissional de vídeos virais. Analise este segmento de áudio de um vídeo.
Contexto: Este é um bloco temático de ${(end-start).toFixed(0)}s, classificado como tier "${tier||'silver'}" com score ${score||50}/100.

Retorne APENAS um JSON válido (sem markdown) com a seguinte estrutura:
{
  "transcription": "transcrição precisa e fiel de todas as falas",
  "title": "título viral curto com emojis, otimizado para TikTok/Reels/Shorts",
  "description": "descrição SEO cativante com 3-5 hashtags no final",
  "topic": "tema principal do trecho em 2-3 palavras",
  "thumbnail_prompt": "highly detailed English image generation prompt (for Midjourney or DALL-E 3) to create a high-CTR cinematic cover/thumbnail matching the speaker's tone and visual context",
  "segments": [
    { "text": "frase falada curta (de 3 a 5 palavras)", "s": tempo_inicio_relativo_ao_audio, "e": tempo_fim_relativo_ao_audio }
  ]
}

IMPORTANTE:
1. O array "segments" deve quebrar a transcrição em frases curtas (de 3 a 5 palavras cada) com seus tempos de início (s) e fim (e) relativos ao início do áudio fornecido (começando em 0.0). Seja preciso e garanta que o JSON seja perfeitamente válido.
2. O campo "thumbnail_prompt" DEVE ser obrigatoriamente escrito em inglês, descrevendo uma cena visual atraente e cinematic para a capa (thumb) do vídeo, mesmo que a transcrição e os demais campos estejam em português.`;

      // Retry loop for rate limits (max 3 attempts to avoid long hangs)
      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const resp = await model.generateContent([prompt, { inlineData: { data: audio64, mimeType: 'audio/mpeg' } }]);
          const text = resp.response.text();
          const firstOpen = text.indexOf('{');
          const lastClose = text.lastIndexOf('}');
          if (firstOpen === -1 || lastClose === -1 || lastClose <= firstOpen) {
            throw new Error("Modelo não retornou um JSON válido");
          }
          const raw = text.substring(firstOpen, lastClose + 1);
          const metadata = JSON.parse(raw);

          // Convert segments to words for client compatibility
          if (metadata.segments && metadata.segments.length > 0) {
            const words = [];
            for (const seg of metadata.segments) {
              if (!seg.text) continue;
              const segWords = seg.text.trim().split(/\s+/).filter(Boolean);
              if (segWords.length === 0) continue;
              const sTime = parseFloat(seg.s || 0);
              const eTime = parseFloat(seg.e || 0);
              const duration = Math.max(0.1, eTime - sTime);
              const wordDur = duration / segWords.length;
              segWords.forEach((w, idx) => {
                words.push({
                  w: w,
                  s: Number((sTime + idx * wordDur).toFixed(2)),
                  e: Number((sTime + (idx + 1) * wordDur).toFixed(2))
                });
              });
            }
            metadata.words = words;
            delete metadata.segments;
          } else if (!metadata.words || metadata.words.length === 0) {
            // Fallback: split entire transcription
            const tx = metadata.transcription || '';
            const allWords = tx.trim().split(/\s+/).filter(Boolean);
            const clipDuration = end - start;
            const wordDur = clipDuration / Math.max(1, allWords.length);
            metadata.words = allWords.map((w, idx) => ({
              w: w,
              s: Number((idx * wordDur).toFixed(2)),
              e: Number(((idx + 1) * wordDur).toFixed(2))
            }));
          }

          res.json({ success: true, metadata });
          return;
        } catch (geminiErr) {
          if (geminiErr.status === 429 && attempt < MAX_RETRIES - 1) {
            const errText = geminiErr.message?.toLowerCase() || '';
            const isQuotaExceeded = errText.includes('quota exceeded') || errText.includes('exceeded your current quota');
            if (isQuotaExceeded) {
              console.log('[Metadata] Quota exceeded. Skipping retries to avoid long hangs.');
              throw geminiErr;
            }
            let waitSec = 10 + (attempt * 10);
            const retryMatch = geminiErr.message?.match(/retry in (\d+)/i);
            if (retryMatch) waitSec = Math.max(parseInt(retryMatch[1]) + 2, waitSec);
            console.log(`[Metadata] Rate limited (attempt ${attempt + 1}/${MAX_RETRIES}). Waiting ${waitSec}s...`);
            await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
            continue;
          }
          throw geminiErr;
        }
      }
    } else {
      res.json({ success: true, metadata: {
        transcription: 'API Key não configurada',
        title: `Destaque #${Math.floor(start)}s ⚡`,
        description: `Trecho de ${start.toFixed(0)}s a ${end.toFixed(0)}s. #shorts #viral #video`,
        topic: 'Conversa',
        thumbnail_prompt: 'A dynamic cinematic YouTube thumbnail, dramatic lighting, high quality, 4k --ar 16:9',
        words: []
      }});
    }
  } catch (e) {
    console.error('[Metadata API Error - Falling back to offline mode]', e);
    const clipDuration = end - start;
    const fallbackText = "Legenda indisponível (limite de cota atingido)";
    const fallbackWords = fallbackText.split(' ').map((w, idx, arr) => {
      const segmentDuration = clipDuration / arr.length;
      return {
        w: w,
        s: Number((idx * segmentDuration).toFixed(2)),
        e: Number(((idx + 1) * segmentDuration).toFixed(2))
      };
    });

    res.json({
      success: true,
      fallback: true,
      errorMsg: e.message,
      metadata: {
        transcription: fallbackText,
        title: `Destaque #${Math.floor(start)}s ⚡`,
        description: `Trecho de ${start.toFixed(0)}s a ${end.toFixed(0)}s. #shorts #viral #video`,
        topic: 'Conversa',
        thumbnail_prompt: 'A dynamic cinematic YouTube thumbnail, dramatic lighting, high quality, 4k --ar 16:9',
        words: fallbackWords
      }
    });
  } finally {
    if (fs.existsSync(tmpAudio)) try { fs.unlinkSync(tmpAudio); } catch {}
  }
});

// ─── Subtitles Helper: Generate ASS File ──────────────────────────────────────
function formatAssTime(sec) {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

function generateAssFile(words, style = 'hormozi', fontFamily = 'Arial', fontSize = 60, primaryColorHex = '#ffffff', activeColorHex = '#fbbf24') {
  let header = `[Script Info]
Title: Clipper AI Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
`;

  const font = fontFamily || 'Arial';
  const size = fontSize || 60;
  const primColor = hexToAssColor(primaryColorHex);
  const actColor = hexToAssColor(activeColorHex);

  let styleLine = `Style: Default,${font},${size},${primColor},&H0000FFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,5,0,2,10,10,280,1`;
  if (style === 'neon') {
    // Cyan primary, Pink outline
    styleLine = `Style: Default,${font},${size},&H00FFFF00,&H0000FF00,&H009948EC,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,2,10,10,280,1`;
  } else if (style === 'minimalist') {
    styleLine = `Style: Default,${font},${size},${primColor},&H00000000,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,280,1`;
  }

  let events = `
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  if (!words || words.length === 0) return header + styleLine + events;

  // Group words into lines of at most 4 words or 2.5s gap
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

  // Generate highlight dialogue lines
  const activeColorTag = actColor.replace('&H00', ''); // e.g. '00FFFF'
  for (const line of lines) {
    const lineStart = line[0].s;
    const lineEnd = line[line.length - 1].e;

    // 1. Pre-highlight line (all default primary color)
    events += `Dialogue: 0,${formatAssTime(lineStart - 0.2)},${formatAssTime(lineStart)},Default,,0,0,0,,${line.map(w => w.w.toUpperCase()).join(' ')}\n`;

    // 2. Active word highlights
    for (let i = 0; i < line.length; i++) {
      const activeWord = line[i];
      const textArray = line.map((w, idx) => {
        if (idx === i) {
          // Dynamic active color highlight
          return `{\\c&H${activeColorTag}&}${w.w.toUpperCase()}{\\c}`;
        }
        return w.w.toUpperCase();
      });
      events += `Dialogue: 0,${formatAssTime(activeWord.s)},${formatAssTime(activeWord.e)},Default,,0,0,0,,${textArray.join(' ')}\n`;
    }

    // 3. Post-highlight line (all default primary color)
    events += `Dialogue: 0,${formatAssTime(lineEnd)},${formatAssTime(lineEnd + 0.5)},Default,,0,0,0,,${line.map(w => w.w.toUpperCase()).join(' ')}\n`;
  }

  return header + styleLine + events;
}

// ─── Route: Download Sample B-roll ──────────────────────────────────────────
app.post('/api/download-sample-broll', async (req, res) => {
  try {
    const targetPath = path.resolve(__dirname, '..', 'gameplay_broll.mp4');
    if (fs.existsSync(targetPath)) {
      return res.json({ success: true, message: 'gameplay_broll.mp4 já existe.' });
    }
    console.log('[B-roll] Baixando gameplay de teste...');
    const response = await fetch('https://www.w3schools.com/html/mov_bbb.mp4');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(targetPath, buffer);
    console.log('[B-roll] Download concluído!');
    res.json({ success: true, message: 'gameplay_broll.mp4 baixado com sucesso!' });
  } catch (e) {
    console.error('[B-roll] Download falhou:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Helper to convert hex to ASS BGR format
function hexToAssColor(hex) {
  if (!hex) return '&H00FFFFFF';
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
  }
  if (clean.length !== 6) return '&H00FFFFFF';
  const r = clean.substring(0, 2);
  const g = clean.substring(2, 4);
  const b = clean.substring(4, 6);
  return `&H00${b}${g}${r}`;
}

// ─── Route: Get Exported Clips History ──────────────────────────────────────
app.get('/api/exports', (req, res) => {
  try {
    const dir = path.join(__dirname, 'exports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const files = fs.readdirSync(dir)
      .filter(f => ['.mp4'].includes(path.extname(f).toLowerCase()))
      .map(f => {
        const p = path.join(dir, f);
        const s = fs.statSync(p);
        return {
          name: f,
          url: `/exports/${f}`,
          sizeMB: (s.size / (1024 * 1024)).toFixed(2),
          createdAt: s.mtime
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ success: true, exports: files });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Route: Delete Exported Clip ────────────────────────────────────────────
app.delete('/api/exports/:filename', (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const p = path.join(__dirname, 'exports', filename);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: 'File not found' });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Route: Export with Layouts & Overlays (V3) ──────────────────────────────
app.post('/api/export', async (req, res) => {
  const {
    videoName, secondaryVideoName, start, end, title,
    layout = 'full', cropX = 0.5, textOverlay,
    subtitleStyle, words, showProgressBar,
    secondaryVideoStart = 0, secondaryVideoCropX = 0.5,
    layoutFormat = 'portrait', quality = 'medium',
    subtitleFont = 'Arial', subtitleSize = 60,
    primaryColor = '#ffffff', activeColor = '#fbbf24'
  } = req.body;

  if (!videoName || start === undefined || end === undefined || !title)
    return res.status(400).json({ success: false, error: 'Missing params' });

  const videoPath = path.resolve(__dirname, '..', videoName);
  const exportsDir = path.join(__dirname, 'exports');
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

  const safe = title.replace(/[^a-z0-9]/gi,'_').toLowerCase().substring(0,25) + `_${Math.floor(Date.now()/1000)}`;
  let tmpAss = null;

  try {
    // Get source resolution
    const infoR = await run(ffprobe(), ['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json', videoPath]);
    const info = JSON.parse(infoR.out);
    const srcW = info.streams?.[0]?.width || 1920;
    const srcH = info.streams?.[0]?.height || 1080;

    const fadeDur = 0.5;
    const clipDur = end - start;
    const fadeOutStart = Math.max(0, clipDur - fadeDur);

    // Map quality to CRF
    let crf = '23';
    if (quality === 'high') crf = '18';
    else if (quality === 'low') crf = '28';

    // ── 16:9 Export ──
    const out16 = path.join(exportsDir, `${safe}_16_9.mp4`);
    await run(ffmpeg(), ['-y', '-ss', `${start}`, '-t', `${clipDur}`, '-i', videoPath,
      '-vf', `fade=in:st=0:d=${fadeDur},fade=out:st=${fadeOutStart}:d=${fadeDur}`,
      '-af', `afade=in:st=0:d=${fadeDur},afade=out:st=${fadeOutStart}:d=${fadeDur}`,
      '-c:v','libx264','-crf', crf,'-preset','fast','-c:a','aac','-b:a','192k',
      '-t', `${clipDur}`,
      out16
    ]);

    // ── 9:16 (Portrait) / 1:1 (Square) Export with layout ──
    const isSquare = (layoutFormat === 'square');
    const outW = 1080;
    const outH = isSquare ? 1080 : 1920;
    const out9 = path.join(exportsDir, `${safe}_${isSquare ? '1_1' : '9_16'}.mp4`);

    // Check if secondary B-roll exists
    const secondaryPath = secondaryVideoName ? path.resolve(__dirname, '..', secondaryVideoName) : null;
    const hasSecondary = secondaryPath && fs.existsSync(secondaryPath);

    // Prepare inputs
    const inputs = ['-y'];
    inputs.push('-ss', `${start}`, '-t', `${clipDur}`, '-i', videoPath);
    if (hasSecondary) {
      inputs.push('-ss', `${secondaryVideoStart}`, '-t', `${clipDur}`, '-i', secondaryPath);
    }

    const cropW9 = isSquare ? srcH : Math.round(srcH * 9 / 16);
    const cropOff = Math.round((srcW - cropW9) * Math.min(1, Math.max(0, cropX)));

    let filterComplex = '';

    if (layout === 'split-h') {
      if (isSquare) {
        // Square Split-H: Top half 1080x540, Bottom half 1080x540
        const topH = 540;
        const botH = 540;
        const cropW = srcH; // 1080
        const cropH = Math.round(srcH / 2); // 540
        const cropOffX = Math.round((srcW - cropW) * Math.min(1, Math.max(0, cropX)));
        const cropOffY = Math.round((srcH - cropH) / 2);

        if (hasSecondary) {
          filterComplex =
            `[0:v]crop=${cropW}:${cropH}:${cropOffX}:${cropOffY},scale=${outW}:${topH},setsar=1[top];` +
            `[1:v]scale='max(1080,iw*540/ih)':'max(540,ih*1080/iw)',crop=1080:540:(iw-1080)*${secondaryVideoCropX}:0,setsar=1[bot];` +
            `[top][bot]vstack[v]`;
        } else {
          filterComplex =
            `[0:v]split[a][b];` +
            `[a]scale='max(1080,iw*540/ih)':'max(540,ih*1080/iw)',crop=1080:540,setsar=1[top];` +
            `[b]crop=${cropW}:${cropH}:${cropOffX}:${cropOffY},scale=${outW}:${botH},setsar=1[bot];` +
            `[top][bot]vstack[v]`;
        }
      } else {
        // Portrait Split-H (original logic)
        const topH = Math.round(outH * 0.5);
        const botH = outH - topH;
        const cropW8 = Math.min(srcW, Math.round(srcH * 9 / 8));
        const cropH8 = Math.min(srcH, Math.round(cropW8 * 8 / 9));
        const cropOff8 = Math.round((srcW - cropW8) * Math.min(1, Math.max(0, cropX)));
        const cropOff8Y = Math.round((srcH - cropH8) / 2);

        if (hasSecondary) {
          filterComplex =
            `[0:v]crop=${cropW8}:${cropH8}:${cropOff8}:${cropOff8Y},scale=${outW}:${topH},setsar=1[top];` +
            `[1:v]scale='max(1080,iw*960/ih)':'max(960,ih*1080/iw)',crop=1080:960:(iw-1080)*${secondaryVideoCropX}:0,setsar=1[bot];` +
            `[top][bot]vstack[v]`;
        } else {
          filterComplex =
            `[0:v]split[a][b];` +
            `[a]scale='max(1080,iw*960/ih)':'max(960,ih*1080/iw)',crop=1080:960,setsar=1[top];` +
            `[b]crop=${cropW8}:${cropH8}:${cropOff8}:${cropOff8Y},scale=${outW}:${botH},setsar=1[bot];` +
            `[top][bot]vstack[v]`;
        }
      }
    } else if (layout === 'split-v') {
      const halfW = Math.round(outW / 2);
      if (hasSecondary) {
        filterComplex =
          `[0:v]scale=${halfW}:${outH}:force_original_aspect_ratio=decrease,pad=${halfW}:${outH}:(ow-iw)/2:(oh-ih)/2,setsar=1[left];` +
          `[1:v]scale=${halfW}:${outH}:force_original_aspect_ratio=decrease,pad=${halfW}:${outH}:(ow-iw)/2:(oh-ih)/2,setsar=1[right];` +
          `[left][right]hstack[v]`;
      } else {
        filterComplex =
          `[0:v]split[a][b];` +
          `[a]scale=${halfW}:${outH}:force_original_aspect_ratio=decrease,pad=${halfW}:${outH}:(ow-iw)/2:(oh-ih)/2,setsar=1[left];` +
          `[b]scale=${halfW}:${outH}:force_original_aspect_ratio=decrease,pad=${halfW}:${outH}:(ow-iw)/2:(oh-ih)/2,setsar=1[right];` +
          `[left][right]hstack[v]`;
      }
    } else if (layout === 'pip') {
      if (isSquare) {
        // Square PiP: Background is secondary (scaled cover 1080x1080), PiP overlay is primary (320x570)
        const cropW = srcH;
        const cropOffX = Math.round((srcW - cropW) * Math.min(1, Math.max(0, cropX)));
        const cropW9 = Math.round(srcH * 9 / 16);
        const cropOff9 = Math.round((srcW - cropW9) * Math.min(1, Math.max(0, cropX)));

        if (hasSecondary) {
          filterComplex =
            `[1:v]scale='max(1080,iw*1080/ih)':'max(1080,ih*1080/iw)',crop=1080:1080:(iw-1080)*${secondaryVideoCropX}:0,setsar=1[main];` +
            `[0:v]crop=${cropW9}:${srcH}:${cropOff9}:0,scale=320:570,setsar=1[pip];` +
            `[main][pip]overlay=W-w-30:30[v]`;
        } else {
          filterComplex =
            `[0:v]split[a][b];` +
            `[a]crop=${cropW}:${srcH}:${cropOffX}:0,scale=${outW}:${outH},setsar=1[main];` +
            `[b]scale=320:180,setsar=1[pip];` +
            `[main][pip]overlay=W-w-30:30[v]`;
        }
      } else {
        // Portrait PiP
        const cropW9 = Math.round(srcH * 9 / 16);
        const cropOff9 = Math.round((srcW - cropW9) * Math.min(1, Math.max(0, cropX)));

        if (hasSecondary) {
          filterComplex =
            `[1:v]scale='max(1080,iw*1920/ih)':'max(1920,ih*1080/iw)',crop=1080:1920:(iw-1080)*${secondaryVideoCropX}:0,setsar=1[main];` +
            `[0:v]crop=${cropW9}:${srcH}:${cropOff9}:0,scale=380:675,setsar=1[pip];` +
            `[main][pip]overlay=W-w-30:30[v]`;
        } else {
          filterComplex =
            `[0:v]split[a][b];` +
            `[a]crop=${cropW9}:${srcH}:${cropOff9}:0,scale=${outW}:${outH},setsar=1[main];` +
            `[b]scale=380:214,setsar=1[pip];` +
            `[main][pip]overlay=W-w-30:30[v]`;
        }
      }
    } else {
      // Full crop (default)
      if (isSquare) {
        const cropW = srcH;
        const cropOffX = Math.round((srcW - cropW) * Math.min(1, Math.max(0, cropX)));
        filterComplex = `[0:v]crop=${cropW}:${srcH}:${cropOffX}:0,scale=${outW}:${outH},setsar=1[v]`;
      } else {
        filterComplex = `[0:v]crop=${cropW9}:${srcH}:${cropOff}:0,scale=${outW}:${outH},setsar=1[v]`;
      }
    }

    // Add fade in/out to layout video stream [v]
    filterComplex += `;[v]fade=in:st=0:d=${fadeDur},fade=out:st=${fadeOutStart}:d=${fadeDur}[v]`;

    // Subtitle Compilation & Burning
    if (subtitleStyle && words && words.length > 0) {
      tmpAss = path.join(__dirname, `temp_${Date.now()}.ass`);
      const assContent = generateAssFile(words, subtitleStyle, subtitleFont, subtitleSize, primaryColor, activeColor);
      fs.writeFileSync(tmpAss, assContent, 'utf8');

      // Use only basename to avoid Windows drive path colons in filter graph
      const relativeAss = path.basename(tmpAss);
      filterComplex += `;[v]subtitles=${relativeAss}[v]`;
    }

    // Dynamic Progress Bar (Vizard Style)
    if (showProgressBar) {
      filterComplex += `;color=c=0xec4899:s=1080x15[pbar]; [v][pbar]overlay=x='-W+(W*t/${clipDur})':y=0[v]`;
    }

    // Text Overlay
    if (textOverlay && textOverlay.text) {
      const txt = textOverlay.text.replace(/'/g, "\\'").replace(/:/g, "\\:");
      const sz = textOverlay.size || 48;
      const clr = textOverlay.color || 'white';
      const pos = textOverlay.position || 'bottom';
      const yExpr = pos === 'top' ? '80' : pos === 'center' ? '(h-text_h)/2' : 'h-text_h-120';
      const fontPath = 'C\\:/Windows/Fonts/arial.ttf';
      filterComplex += `;[v]drawtext=fontfile='${fontPath}':text='${txt}':fontsize=${sz}:fontcolor=${clr}:x=(w-text_w)/2:y=${yExpr}:borderw=3:bordercolor=black@0.7[v]`;
    }

    // Compile FFmpeg command args
    const ffmpegArgs = [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[v]',
      '-map', '0:a', // keep primary audio
      '-af', `afade=in:st=0:d=${fadeDur},afade=out:st=${fadeOutStart}:d=${fadeDur}`,
      '-c:v','libx264','-crf', crf,'-preset','fast','-c:a','aac','-b:a','192k',
      '-t', `${clipDur}`,
      out9
    ];

    await run(ffmpeg(), ffmpegArgs);

    res.json({ success: true, files: {
      landscape: path.basename(out16),
      portrait: path.basename(out9),
      exportsFolder: exportsDir
    }});
  } catch (e) {
    console.error('[Export]', e);
    res.status(500).json({ success: false, error: e.message });
  } finally {
    if (tmpAss && fs.existsSync(tmpAss)) {
      try { fs.unlinkSync(tmpAss); } catch {}
    }
  }
});

app.listen(PORT, () => console.log(`Clipper AI v2 running → http://localhost:${PORT}`));
