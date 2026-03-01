/**
 * Backend for Xside AI Mini App — Nano Banana image generation
 * POST /api/generate, GET /api/image/:id, POST /api/callback, GET /api/task/:taskId, GET /api/gallery
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const NANO_BANANA_API = 'https://api.nanobananaapi.ai/api/v1/nanobanana';

// In-memory stores
const imageStore = new Map(); // id -> { buffer, mimeType }
const taskMeta = new Map();   // taskId -> { userId, prompt, createdAt, modelKey?, aspect?, format? }
const taskResults = new Map(); // taskId -> { successFlag, resultImageUrl?, errorMessage?, galleryItem? }

// PostgreSQL pool
const DB_URL = process.env.DATABASE_URL || process.env.database_url;
const pool = new Pool({
  connectionString: DB_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

// Multer: memory storage for multipart images
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png'].includes(file.mimetype);
    cb(null, !!ok);
  },
});

app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Static: serve frontend from parent directory (optional, for single deploy)
const publicDir = path.join(__dirname, '..');
app.use(express.static(publicDir));

// ——— GET /api/image/:id ———
// KIE запрашивает изображения по URL асинхронно; не удаляем сразу, даём 2 мин на повторные запросы
const IMAGE_TTL_MS = 2 * 60 * 1000;

app.get('/api/image/:id', (req, res) => {
  const { id } = req.params;
  const entry = imageStore.get(id);
  if (!entry) {
    return res.status(404).json({ error: 'Image not found' });
  }
  res.set('Content-Type', entry.mimeType || 'image/png');
  res.send(entry.buffer);
  setTimeout(() => imageStore.delete(id), IMAGE_TTL_MS);
});

// ——— GET /api/share ———
// HTML-страница с og:title="Переслано из FastX" — в Telegram показывается как текст ссылки, редирект на картинку
app.get('/api/share', (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).send('Missing url');
  }
  if (!rawUrl.startsWith('https://')) {
    return res.status(400).send('Invalid url');
  }
  const viewUrl = `${BASE_URL}/api/view?url=${encodeURIComponent(rawUrl)}`;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0;url=${esc(viewUrl)}">
  <meta property="og:title" content="Переслано из FastX">
  <meta property="og:image" content="${esc(viewUrl)}">
  <meta property="og:type" content="website">
  <title>Переслано из FastX</title>
</head>
<body>
  <p><a href="${esc(viewUrl)}">Переслано из FastX</a></p>
</body>
</html>`;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ——— GET /api/view ———
// Прокси для просмотра: отдаёт картинку с Content-Disposition: inline (можно смотреть в браузере)
app.get('/api/view', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ error: 'Missing url' });
  }
  if (!rawUrl.startsWith('https://')) {
    return res.status(400).json({ error: 'Invalid url' });
  }
  try {
    const r = await fetch(rawUrl, { redirect: 'follow' });
    if (!r.ok) return res.status(502).json({ error: 'Failed to fetch image' });
    const buf = Buffer.from(await r.arrayBuffer());
    const ctype = r.headers.get('content-type') || 'image/png';
    res.set('Content-Type', ctype);
    res.set('Content-Disposition', 'inline');
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch image' });
  }
});

// ——— GET /api/download ———
// Прокси для скачивания: отдаёт картинку с Content-Disposition: attachment для Telegram.downloadFile
app.get('/api/download', async (req, res) => {
  const rawUrl = req.query.url;
  const filename = req.query.filename || 'image.png';
  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ error: 'Missing url' });
  }
  if (!rawUrl.startsWith('https://')) {
    return res.status(400).json({ error: 'Invalid url' });
  }
  try {
    const r = await fetch(rawUrl, { redirect: 'follow' });
    if (!r.ok) return res.status(502).json({ error: 'Failed to fetch image' });
    const buf = Buffer.from(await r.arrayBuffer());
    const ctype = r.headers.get('content-type') || 'image/png';
    res.set('Content-Type', ctype);
    res.set('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '%22')}"`);
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch image' });
  }
});

// ——— POST /api/callback (KIE playground webhook for nano-banana) ———
app.post('/api/callback', async (req, res) => {
  const { code, msg, data } = req.body || {};
  const taskId = data?.taskId;
  if (!taskId) {
    return res.status(400).json({ error: 'Missing taskId' });
  }

  let resultImageUrl;
  if (typeof data?.resultJson === 'string') {
    try {
      const parsed = JSON.parse(data.resultJson);
      const urls = parsed.resultUrls || parsed.urls || parsed.images || [];
      if (Array.isArray(urls) && urls.length > 0) {
        resultImageUrl = urls[0];
      }
    } catch (e) {
      // ignore JSON parse errors, will be treated as missing result
    }
  }

  const state = data?.state;
  const successFlag = code === 200 && state === 'success' ? 1 : 3;
  const errorMessage = data?.failMsg || msg || (successFlag !== 1 ? 'Generation failed' : '');

  let galleryItem;

  if (successFlag === 1 && resultImageUrl) {
    const meta = taskMeta.get(taskId);
    if (meta?.userId != null) {
      const id = uuidv4();
      const createdAt = new Date(meta.createdAt || Date.now());
      galleryItem = {
        id,
        userId: meta.userId,
        url: resultImageUrl,
        prompt: meta.prompt || '',
        createdAt: createdAt.getTime(),
      };

      try {
        await pool.query(
          `INSERT INTO generations (id, user_id, url, prompt, model, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            id,
            String(meta.userId),
            resultImageUrl,
            meta.prompt || '',
            meta.modelKey || null,
            createdAt,
          ]
        );
      } catch (e) {
        console.error('Failed to insert gallery item:', e.message);
      }
    }
  }

  taskResults.set(taskId, {
    successFlag,
    resultImageUrl: resultImageUrl || undefined,
    errorMessage: errorMessage || undefined,
    galleryItem: galleryItem
      ? { id: galleryItem.id, url: galleryItem.url, prompt: galleryItem.prompt, createdAt: galleryItem.createdAt }
      : undefined,
  });

  taskMeta.delete(taskId);
  res.status(200).json({ status: 'received' });
});

// ——— GET /api/task/:taskId ———
app.get('/api/task/:taskId', (req, res) => {
  const { taskId } = req.params;
  const result = taskResults.get(taskId);

  // Если результата ещё нет (ждём callback от KIE) — сообщаем фронту, что генерация продолжается
  if (!result) {
    return res.json({ successFlag: 0 });
  }

  res.json({
    successFlag: result.successFlag,
    resultImageUrl: result.resultImageUrl,
    errorMessage: result.errorMessage,
    galleryItem: result.galleryItem,
  });
});

// ——— GET /api/gallery ———
app.get('/api/gallery', async (req, res) => {
  const userId = req.query.userId;
  if (userId === undefined || userId === '') {
    return res.json([]);
  }
  try {
    const result = await pool.query(
      `SELECT id, url, prompt, created_at
       FROM generations
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [String(userId)]
    );
    const list = result.rows.map((row) => ({
      id: row.id,
      url: row.url,
      prompt: row.prompt,
      createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    }));
    res.json(list);
  } catch (e) {
    console.error('Failed to load gallery:', e.message);
    res.status(500).json({ error: 'Failed to load gallery' });
  }
});

// ——— Favorites: ensure table exists ———
const initFavoritesTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS favorite_prompts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, prompt)
      )
    `);
  } catch (e) {
    console.error('Failed to init favorite_prompts table:', e.message);
  }
};

// ——— GET /api/favorites ———
app.get('/api/favorites', async (req, res) => {
  const userId = req.query.userId;
  if (userId === undefined || userId === '') {
    return res.json([]);
  }
  try {
    await initFavoritesTable();
    const result = await pool.query(
      `SELECT prompt FROM favorite_prompts WHERE user_id = $1 ORDER BY created_at DESC`,
      [String(userId)]
    );
    res.json(result.rows.map((row) => row.prompt));
  } catch (e) {
    console.error('Failed to load favorites:', e.message);
    res.status(500).json({ error: 'Failed to load favorites' });
  }
});

// ——— POST /api/favorites ———
app.post('/api/favorites', async (req, res) => {
  const userId = req.body?.userId;
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!userId || !prompt) {
    return res.status(400).json({ error: 'Missing userId or prompt' });
  }
  try {
    await initFavoritesTable();
    await pool.query(
      `INSERT INTO favorite_prompts (user_id, prompt) VALUES ($1, $2) ON CONFLICT (user_id, prompt) DO NOTHING`,
      [String(userId), prompt]
    );
    const result = await pool.query(
      `SELECT prompt FROM favorite_prompts WHERE user_id = $1 ORDER BY created_at DESC`,
      [String(userId)]
    );
    res.json(result.rows.map((row) => row.prompt));
  } catch (e) {
    console.error('Failed to add favorite:', e.message);
    res.status(500).json({ error: 'Failed to add favorite' });
  }
});

// ——— DELETE /api/favorites ———
app.delete('/api/favorites', async (req, res) => {
  const userId = req.body?.userId;
  const prompt = req.body?.prompt != null ? String(req.body.prompt) : '';
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }
  try {
    await initFavoritesTable();
    await pool.query(
      `DELETE FROM favorite_prompts WHERE user_id = $1 AND prompt = $2`,
      [String(userId), prompt]
    );
    const result = await pool.query(
      `SELECT prompt FROM favorite_prompts WHERE user_id = $1 ORDER BY created_at DESC`,
      [String(userId)]
    );
    res.json(result.rows.map((row) => row.prompt));
  } catch (e) {
    console.error('Failed to remove favorite:', e.message);
    res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

// ——— POST /api/generate ———
async function handleGenerate(req, res) {
  const apiKey = process.env.NANO_BANANA_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Backend not configured: NANO_BANANA_API_KEY' });
  }

  let prompt, type, userId, quality, aspect, format, modelKey;
  let imageIds = [];

  if (req.is('multipart/form-data') && req.files?.length) {
    prompt = req.body.prompt;
    type = (req.body.type || 'IMAGETOIAMGE').toUpperCase();
    userId = req.body.userId !== undefined ? req.body.userId : '';
    quality = req.body.quality;
    aspect = req.body.aspect || '1:1';
    format = req.body.format;
    modelKey = req.body.model;
    const files = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
    const imagesField = req.files?.length ? req.files : files;
    for (const f of imagesField.slice(0, 8)) {
      const id = uuidv4();
      imageStore.set(id, { buffer: f.buffer, mimeType: f.mimetype || 'image/png' });
      imageIds.push(id);
    }
  } else {
    const body = req.body || {};
    prompt = body.prompt;
    type = (body.type || (body.images?.length ? 'IMAGETOIAMGE' : 'TEXTTOIAMGE')).toUpperCase();
    userId = body.userId !== undefined ? body.userId : '';
    quality = body.quality;
    aspect = body.aspect || '1:1';
    format = body.format;
    modelKey = body.model;
    const images = body.images || [];
    for (let i = 0; i < Math.min(images.length, 8); i++) {
      const img = images[i];
      let buffer;
      let mimeType = 'image/png';
      if (typeof img === 'string') {
        const base64 = img.replace(/^data:image\/\w+;base64,/, '');
        buffer = Buffer.from(base64, 'base64');
        const m = img.match(/^data:(image\/\w+);base64,/);
        if (m) mimeType = m[1];
      } else if (img?.data) {
        const base64 = typeof img.data === 'string' ? img.data.replace(/^data:image\/\w+;base64,/, '') : img.data;
        buffer = Buffer.from(base64, 'base64');
        mimeType = img.mimeType || 'image/png';
      } else continue;
      const id = uuidv4();
      imageStore.set(id, { buffer, mimeType });
      imageIds.push(id);
    }
  }

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid prompt' });
  }
  if (type === 'IMAGETOIAMGE' && imageIds.length === 0) {
    return res.status(400).json({ error: 'Загрузите хотя бы одно изображение' });
  }
  if (type !== 'TEXTTOIAMGE' && type !== 'IMAGETOIAMGE') {
    return res.status(400).json({ error: 'Invalid type' });
  }

  const callBackUrl = `${BASE_URL}/api/callback`;
  const imageUrls = imageIds.map((id) => `${BASE_URL}/api/image/${id}`);

  let payload;
  if (modelKey === 'nano-pro') {
    // nano-banana-pro: prompt, aspect_ratio, resolution, output_format, опционально image_input (до 8 URL)
    const resolution = quality === '4' ? '4K' : quality === '2' ? '2K' : '1K';
    const outFormat = (format || 'png').toLowerCase() === 'jpeg' ? 'jpg' : (format || 'png');
    const input = {
      prompt: prompt.trim(),
      aspect_ratio: aspect || '1:1',
      resolution: resolution || '1K',
      output_format: outFormat || 'png',
    };
    if (imageUrls.length > 0) {
      input.image_input = imageUrls;
    }
    payload = {
      model: 'nano-banana-pro',
      callBackUrl,
      input,
    };
  } else if (modelKey === 'nano-2') {
    // nano-banana-2: prompt, aspect_ratio, resolution, output_format, google_search (bool), опционально image_input (до 14 URL)
    const resolution = quality === '4' ? '4K' : quality === '2' ? '2K' : '1K';
    const outFormat = (format || 'png').toLowerCase() === 'jpeg' ? 'jpg' : (format || 'png');
    const input = {
      prompt: prompt.trim(),
      aspect_ratio: aspect || 'auto',
      google_search: false,
      resolution: resolution || '1K',
      output_format: outFormat || 'jpg',
    };
    if (imageUrls.length > 0) {
      input.image_input = imageUrls.slice(0, 14);
    }
    payload = {
      model: 'nano-banana-2',
      callBackUrl,
      input,
    };
  } else if (modelKey === 'nano' && imageUrls.length > 0) {
    // Базовая модель + картинки: google/nano-banana-edit (image_urls)
    payload = {
      model: 'google/nano-banana-edit',
      callBackUrl,
      input: {
        prompt: prompt.trim(),
        image_urls: imageUrls.slice(0, 10),
        output_format: (format || 'png').toLowerCase() === 'jpeg' ? 'jpeg' : 'png',
        image_size: aspect || '1:1',
      },
    };
  } else {
    // Базовая модель без картинок: text-to-image google/nano-banana
    payload = {
      model: 'google/nano-banana',
      callBackUrl,
      input: {
        prompt: prompt.trim(),
        output_format: format || 'png',
        image_size: aspect || '1:1',
      },
    };
  }

  try {
    const r = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const body = await r.json();
    if (body?.code !== 200 || !body?.data?.taskId) {
      console.error('KIE createTask error:', body?.code, body?.message || body?.msg, JSON.stringify(body));
      return res.status(502).json({
        error: 'Nano Banana error',
        message: body?.message || body?.msg || 'No taskId returned',
        code: body?.code,
      });
    }
    const taskId = body.data.taskId;
    const qVal = String(quality ?? '1');
    const q = qVal === '4' ? 4 : qVal === '2' ? 2 : 1;
    let tokensSpent = 10;
    if (type === 'IMAGETOIAMGE') {
      tokensSpent = 10; // Редакт фото
    } else if (modelKey === 'nano') {
      tokensSpent = 10; // Базовая — без разрешения
    } else if (modelKey === 'nano-pro') {
      tokensSpent = q === 4 ? 60 : 45;
    } else if (modelKey === 'nano-2') {
      tokensSpent = q === 1 ? 20 : q === 2 ? 30 : 45; // 1K=20, 2K=30, 4K=45
    }
    taskMeta.set(taskId, {
      userId,
      prompt: prompt.trim(),
      createdAt: Date.now(),
      modelKey,
      aspect,
      format,
      tokensSpent,
    });
    res.status(200).json({ taskId });
  } catch (e) {
    res.status(502).json({ error: 'Failed to call Nano Banana', message: e.message });
  }
}

app.post('/api/generate', (req, res, next) => {
  if (req.is('application/json')) {
    return handleGenerate(req, res).catch(next);
  }
  next();
}, upload.array('images', 8), (req, res, next) => {
  handleGenerate(req, res).catch(next);
});

app.listen(PORT, () => {
  console.log(`Server running at ${BASE_URL || 'http://localhost:' + PORT}`);
});
