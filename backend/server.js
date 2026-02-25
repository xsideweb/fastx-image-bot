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

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const NANO_BANANA_API = 'https://api.nanobananaapi.ai/api/v1/nanobanana';

// In-memory stores
const imageStore = new Map(); // id -> { buffer, mimeType }
const taskMeta = new Map();   // taskId -> { userId, prompt, createdAt }
const taskResults = new Map(); // taskId -> { successFlag, resultImageUrl?, errorMessage?, galleryItem? }

// Gallery: in-memory array, persist to data/gallery.json
let gallery = [];
const GALLERY_FILE = path.join(__dirname, 'data', 'gallery.json');

function loadGallery() {
  try {
    const dir = path.dirname(GALLERY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(GALLERY_FILE)) {
      const raw = fs.readFileSync(GALLERY_FILE, 'utf8');
      gallery = JSON.parse(raw);
      if (!Array.isArray(gallery)) gallery = [];
    }
  } catch (e) {
    console.warn('Gallery load failed:', e.message);
    gallery = [];
  }
}

function saveGallery() {
  try {
    const dir = path.dirname(GALLERY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(GALLERY_FILE, JSON.stringify(gallery, null, 2), 'utf8');
  } catch (e) {
    console.warn('Gallery save failed:', e.message);
  }
}

loadGallery();

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
app.get('/api/image/:id', (req, res) => {
  const { id } = req.params;
  const entry = imageStore.get(id);
  if (!entry) {
    return res.status(404).json({ error: 'Image not found' });
  }
  res.set('Content-Type', entry.mimeType || 'image/png');
  res.send(entry.buffer);
  // Optional: delete after first serve to free memory (or use TTL)
  imageStore.delete(id);
});

// ——— POST /api/callback (Nano Banana webhook) ———
app.post('/api/callback', (req, res) => {
  const { code, msg, data } = req.body || {};
  const taskId = data?.taskId;
  if (!taskId) {
    return res.status(400).json({ error: 'Missing taskId' });
  }
  const successFlag = code === 200 ? 1 : (code === 400 ? 2 : 3);
  const resultImageUrl = data?.info?.resultImageUrl || data?.response?.resultImageUrl || '';
  const errorMessage = msg || (successFlag !== 1 ? 'Generation failed' : '');

  taskResults.set(taskId, {
    successFlag,
    resultImageUrl: resultImageUrl || undefined,
    errorMessage: errorMessage || undefined,
    galleryItem: undefined,
  });

  if (successFlag === 1 && resultImageUrl) {
    const meta = taskMeta.get(taskId);
    if (meta?.userId != null) {
      const galleryItem = {
        id: uuidv4(),
        userId: meta.userId,
        url: resultImageUrl,
        prompt: meta.prompt || '',
        createdAt: meta.createdAt || Date.now(),
      };
      gallery.unshift(galleryItem);
      saveGallery();
      const saved = taskResults.get(taskId);
      saved.galleryItem = { id: galleryItem.id, url: galleryItem.url, prompt: galleryItem.prompt, createdAt: galleryItem.createdAt };
      taskResults.set(taskId, saved);
    }
  }

  taskMeta.delete(taskId);
  res.status(200).json({ status: 'received' });
});

// ——— GET /api/task/:taskId ———
app.get('/api/task/:taskId', async (req, res) => {
  const { taskId } = req.params;
  let result = taskResults.get(taskId);

  if (!result) {
    const apiKey = process.env.NANO_BANANA_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Backend not configured' });
    }
    try {
      const r = await fetch(`${NANO_BANANA_API}/record-info?taskId=${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const body = await r.json();
      if (body?.code !== 200) {
        return res.status(502).json({
          error: 'Nano Banana error',
          message: body?.msg || 'Failed to get task status',
          successFlag: 2,
          errorMessage: body?.msg || 'Ошибка запроса статуса',
        });
      }
      const data = body?.data || {};
      const taskStatus = data.successFlag; // 0=generating, 1=success, 2=create failed, 3=generate failed
      const resultImageUrl = data.response?.resultImageUrl || data.info?.resultImageUrl || '';
      const errorMessage = data.errorMessage || body?.msg || (taskStatus !== 1 ? 'Генерация не удалась' : '');

      if (taskStatus === 0) {
        return res.json({ successFlag: 0 });
      }

      result = {
        successFlag: taskStatus,
        resultImageUrl: resultImageUrl || undefined,
        errorMessage: taskStatus !== 1 ? errorMessage : undefined,
        galleryItem: undefined,
      };
      if (taskStatus === 1 && resultImageUrl) {
        const meta = taskMeta.get(taskId);
        if (meta?.userId != null && meta.userId !== '') {
          const galleryItem = {
            id: uuidv4(),
            userId: meta.userId,
            url: resultImageUrl,
            prompt: meta.prompt || '',
            createdAt: meta.createdAt || Date.now(),
          };
          gallery.unshift(galleryItem);
          saveGallery();
          result.galleryItem = { id: galleryItem.id, url: galleryItem.url, prompt: galleryItem.prompt, createdAt: galleryItem.createdAt };
        }
      }
      taskMeta.delete(taskId);
      taskResults.set(taskId, result);
    } catch (e) {
      return res.status(502).json({ error: 'Failed to fetch task status', message: e.message });
    }
  }

  res.json({
    successFlag: result.successFlag,
    resultImageUrl: result.resultImageUrl,
    errorMessage: result.errorMessage,
    galleryItem: result.galleryItem,
  });
});

// ——— GET /api/gallery ———
app.get('/api/gallery', (req, res) => {
  const userId = req.query.userId;
  if (userId === undefined || userId === '') {
    return res.json([]);
  }
  const list = gallery
    .filter((e) => String(e.userId) === String(userId))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((e) => ({ id: e.id, url: e.url, prompt: e.prompt, createdAt: e.createdAt }));
  res.json(list);
});

// ——— POST /api/generate ———
async function handleGenerate(req, res) {
  const apiKey = process.env.NANO_BANANA_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Backend not configured: NANO_BANANA_API_KEY' });
  }

  let prompt, type, userId, quality, aspect, format;
  let imageIds = [];

  if (req.is('multipart/form-data') && req.files?.length) {
    prompt = req.body.prompt;
    type = (req.body.type || 'IMAGETOIAMGE').toUpperCase();
    userId = req.body.userId !== undefined ? req.body.userId : '';
    quality = req.body.quality;
    aspect = req.body.aspect || '1:1';
    format = req.body.format;
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
  if (type !== 'TEXTTOIAMGE' && type !== 'IMAGETOIAMGE') {
    return res.status(400).json({ error: 'Invalid type' });
  }
  if (type === 'IMAGETOIAMGE' && imageIds.length === 0) {
    return res.status(400).json({ error: 'IMAGETOIAMGE requires at least one image' });
  }

  const imageUrls = imageIds.map((id) => `${BASE_URL}/api/image/${id}`);
  const callBackUrl = `${BASE_URL}/api/callback`;

  const payload = {
    prompt: prompt.trim(),
    type,
    callBackUrl,
    numImages: 1,
    image_size: aspect,
  };
  if (imageUrls.length) payload.imageUrls = imageUrls;

  try {
    const r = await fetch(`${NANO_BANANA_API}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const body = await r.json();
    if (body?.code !== 200 || !body?.data?.taskId) {
      return res.status(502).json({
        error: 'Nano Banana error',
        message: body?.msg || 'No taskId returned',
        code: body?.code,
      });
    }
    const taskId = body.data.taskId;
    taskMeta.set(taskId, {
      userId,
      prompt: prompt.trim(),
      createdAt: Date.now(),
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
