/**
 * Xside AI — Telegram Mini App
 * Генерация изображений: промпт, загрузка фото, галерея, preview, меню профиля.
 */

(function () {
  'use strict';

  const Telegram = window.Telegram?.WebApp;
  if (Telegram) {
    Telegram.ready();
    Telegram.expand();
  }

  // State
  let credits = 450;
  const recent = [];
  const gallery = [];

  let favoritePrompts = [];

  async function loadFavoritePrompts() {
    const userId = getUserId();
    if (userId == null) {
      favoritePrompts = [];
      return;
    }
    try {
      const r = await fetch(apiUrl('/api/favorites?userId=' + encodeURIComponent(String(userId))));
      if (!r.ok) {
        favoritePrompts = [];
        return;
      }
      const data = await r.json();
      favoritePrompts = Array.isArray(data) ? data : [];
    } catch (_) {
      favoritePrompts = [];
    }
  }

  async function addFavoritePrompt(text) {
    const t = (text || '').trim();
    if (!t) return;
    const userId = getUserId();
    if (userId == null) return;
    try {
      const r = await fetch(apiUrl('/api/favorites'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: String(userId), prompt: t }),
      });
      if (!r.ok) return;
      await loadFavoritePrompts();
    } catch (_) {}
  }

  async function removeFavoritePrompt(text) {
    const userId = getUserId();
    if (userId == null) return;
    try {
      const r = await fetch(apiUrl('/api/favorites'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: String(userId), prompt: String(text) }),
      });
      if (!r.ok) return;
      await loadFavoritePrompts();
    } catch (_) {}
  }

  let currentModel = 'nano';

  // Цены: базовая 10; edit 10; nano-2: 1K 20, 2K 30, 4K 45; Pro: 1/2K 45, 4K 60
  function getCurrentCost(isEdit) {
    if (isEdit) return 10; // Редакт фото
    if (currentModel === 'nano') return 10; // Базовая — без выбора разрешения
    const quality = $('#select-quality')?.value || '1';
    const q = quality === '4' ? 4 : quality === '2' ? 2 : 1;
    if (currentModel === 'nano-pro') return q === 4 ? 60 : 45;
    if (currentModel === 'nano-2') {
      if (q === 1) return 20;  // 1K
      if (q === 2) return 30;  // 2K
      return 45;               // 4K
    }
    return 10;
  }

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const API_BASE = (typeof window !== 'undefined' && (window.__APP_CONFIG__?.apiBase || document.documentElement.dataset?.apiBase)) || '';
  const isLocalFile = typeof location !== 'undefined' && (location.protocol === 'file:' || location.origin === 'null');
  const defaultApiBase = 'http://localhost:3000';
  const apiUrl = (path) => {
    const base = API_BASE || (isLocalFile ? defaultApiBase : location.origin);
    return (base.replace(/\/$/, '') + path);
  };

  const screenCreate = $('#screen-create');
  const screenGallery = $('#screen-gallery');
  const screenProfile = $('#screen-profile');
  const profileNickname = $('#profile-nickname');
  const profileCredits = $('#profile-credits');
  const profileGenerationsHint = $('#profile-generations-hint');
  const profileFavoritesList = $('#profile-favorites-list');
  const profileFavoritesEmpty = $('#profile-favorites-empty');
  const promptInput = $('#prompt-input');
  const btnGenerate = $('#btn-generate');
  const progressWrap = $('#progress-wrap');
  const progressFill = $('#progress-fill');
  const progressText = $('#progress-text');
  const recentGrid = $('#recent-grid');
  const galleryGrid = $('#gallery-grid');
  const galleryEmpty = $('#gallery-empty');
  const viewAll = $('#view-all');
  const previewOverlay = $('#preview-overlay');
  const previewImage = $('#preview-image');
  const previewClose = $('.preview-close', previewOverlay);
  const previewBackdrop = $('.preview-backdrop', previewOverlay);
  const btnPreviewPrompt = $('#btn-preview-prompt');
  const btnPreviewFavoriteOnImage = $('#btn-preview-favorite-on-image');
  const btnPreviewCopyOnImage = $('#btn-preview-copy-on-image');
  const previewImageButtons = $('#preview-image-buttons');
  const previewPromptPopover = $('#preview-prompt-popover');
  const btnShare = $('#btn-share');
  const btnExport = $('#btn-export');
  const creditsEl = $('#credits');
  const generateCostEl = $('#generate-cost');
  const menuOverlay = $('#menu-overlay');
  const menuNickname = $('#menu-nickname');
  const menuCreditsEl = $('#menu-credits');
  const menuBackdrop = $('.menu-backdrop', menuOverlay);
  const menuBtnTopup = $('#menu-btn-topup');
  const menuBtn = $('.menu-btn');
  const menuBtnIcon = $('#menu-btn-icon');
  const imagesFileInput = $('#images-file-input');
  const imagesThumbs = $('#images-thumbs');
  const imagesCounter = $('#images-counter');
  const imagesUploadArea = $('#images-upload-area');
  const modelButtons = $$('.model-option');
  const generateCostValueEl = $('#generate-cost-value');

  const MAX_UPLOADS = 8;
  const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 МБ
  const ACCEPT_TYPES = ['image/jpeg', 'image/png'];
  const uploadedImages = [];

  function isAcceptedFile(file) {
    if (!ACCEPT_TYPES.includes(file.type)) return false;
    if (file.size > MAX_SIZE_BYTES) return false;
    return true;
  }

  function addUploadedFiles(files) {
    const remaining = MAX_UPLOADS - uploadedImages.length;
    let added = 0;
    for (const file of files) {
      if (added >= remaining) break;
      if (!isAcceptedFile(file)) continue;
      const id = 'up-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      uploadedImages.push({ id, file, dataUrl: null });
      added++;
      const reader = new FileReader();
      reader.onload = () => {
        const item = uploadedImages.find((u) => u.id === id);
        if (item) item.dataUrl = reader.result;
        const wrap = imagesThumbs?.querySelector('[data-upload-id="' + id + '"]');
        if (wrap) {
          const img = wrap.querySelector('img');
          if (img) img.src = reader.result;
        } else {
          renderUploads();
        }
      };
      reader.readAsDataURL(file);
    }
    if (added > 0) renderUploads();
  }

  function removeUpload(id) {
    const i = uploadedImages.findIndex((u) => u.id === id);
    if (i !== -1) uploadedImages.splice(i, 1);
    renderUploads();
  }

  function renderUploads() {
    if (!imagesThumbs || !imagesCounter || !imagesUploadArea) return;
    imagesThumbs.innerHTML = '';
    const count = uploadedImages.length;
    imagesCounter.textContent = count + '/' + MAX_UPLOADS;

    uploadedImages.forEach((item) => {
      const wrap = document.createElement('div');
      wrap.className = 'images-thumb-wrap';
      wrap.dataset.uploadId = item.id;
      const img = document.createElement('img');
      img.src = item.dataUrl || '';
      img.alt = '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'images-thumb-remove';
      btn.innerHTML = '×';
      btn.setAttribute('aria-label', 'Удалить');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeUpload(item.id);
      });
      wrap.appendChild(img);
      wrap.appendChild(btn);
      imagesThumbs.appendChild(wrap);
    });

    if (count < MAX_UPLOADS) {
      const addCell = document.createElement('div');
      addCell.className = 'images-add-cell';
      addCell.innerHTML = '<span class="images-drop-plus">+</span><span class="images-drop-label">Добавить</span>';
      addCell.addEventListener('click', () => imagesFileInput && imagesFileInput.click());
      imagesThumbs.appendChild(addCell);
    }

    imagesThumbs.classList.toggle('images-thumbs--empty', count === 0);
  }

  if (imagesFileInput) {
    imagesFileInput.addEventListener('change', (e) => {
      const files = e.target.files ? [...e.target.files] : [];
      addUploadedFiles(files);
      e.target.value = '';
    });
  }

  if (imagesUploadArea) {
    imagesUploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      imagesUploadArea.classList.add('drag-over');
    });
    imagesUploadArea.addEventListener('dragleave', (e) => {
      if (!imagesUploadArea.contains(e.relatedTarget)) imagesUploadArea.classList.remove('drag-over');
    });
    imagesUploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      imagesUploadArea.classList.remove('drag-over');
      const files = e.dataTransfer.files ? [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')) : [];
      addUploadedFiles(files);
    });
  }

  function getUploadedImages() {
    return uploadedImages.map((u) => ({ id: u.id, file: u.file, dataUrl: u.dataUrl }));
  }

  function getNickname() {
    const user = Telegram?.initDataUnsafe?.user;
    if (!user) return 'Пользователь';
    if (user.username) return '@' + user.username;
    if (user.first_name) return user.first_name;
    return 'Пользователь';
  }

  const MENU_ICON_OPEN = 'icons/hamburger-menu.svg';
  const MENU_ICON_CLOSE = 'icons/close.svg';

  function openMenu() {
    if (!menuOverlay) return;
    renderMenuProfile();
    menuOverlay.classList.remove('hidden');
    menuOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (menuBtnIcon) menuBtnIcon.src = MENU_ICON_CLOSE;
    if (menuBtn) menuBtn.setAttribute('aria-label', 'Закрыть меню');
  }

  function closeMenu() {
    if (!menuOverlay) return;
    menuOverlay.classList.add('hidden');
    menuOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (menuBtnIcon) menuBtnIcon.src = MENU_ICON_OPEN;
    if (menuBtn) menuBtn.setAttribute('aria-label', 'Меню');
  }

  function toggleMenu() {
    if (menuOverlay && !menuOverlay.classList.contains('hidden')) closeMenu();
    else openMenu();
  }

  function renderMenuProfile() {
    const nickname = getNickname();
    if (menuNickname) menuNickname.textContent = nickname;
    if (menuCreditsEl) menuCreditsEl.textContent = String(credits);
  }

  function renderCredits() {
    if (creditsEl) creditsEl.textContent = String(credits);
    if (menuCreditsEl) menuCreditsEl.textContent = String(credits);
    if (screenProfile && screenProfile.classList.contains('active')) renderProfile();
  }

  function createGridItem(item) {
    const div = document.createElement('div');
    div.className = 'grid-item';
    div.dataset.id = item?.id || '';
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = item.prompt || 'Изображение';
    img.loading = 'lazy';
    div.appendChild(img);
    return div;
  }

  let galleryLoadedFromApi = false;

  function updateGenerateCost() {
    if (generateCostValueEl) {
      generateCostValueEl.textContent = String(getCurrentCost(false));
    }
  }

  function toggleQualityVisibility() {
    const wrap = $('#quality-wrap');
    if (wrap) wrap.classList.toggle('hidden', currentModel === 'nano');
  }

  if (modelButtons && modelButtons.length) {
    const activeBtn = modelButtons.find((btn) => btn.classList.contains('model-option-active'));
    if (activeBtn?.dataset?.model) {
      currentModel = activeBtn.dataset.model;
    }
    modelButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        modelButtons.forEach((b) => b.classList.remove('model-option-active'));
        btn.classList.add('model-option-active');
        if (btn.dataset?.model) {
          currentModel = btn.dataset.model;
        }
        toggleQualityVisibility();
        updateGenerateCost();
      });
    });
  }

  toggleQualityVisibility();

  const selectQuality = $('#select-quality');
  if (selectQuality) selectQuality.addEventListener('change', updateGenerateCost);

  function renderRecentGrid() {
    if (!recentGrid) return;
    recentGrid.innerHTML = '';
    if (recent.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'recent-empty';
      empty.textContent = 'пока изображений нет';
      recentGrid.appendChild(empty);
      return;
    }
    recent.slice(0, 6).forEach((item) => {
      const el = createGridItem(item);
      el.addEventListener('click', () => openPreview(item));
      recentGrid.appendChild(el);
    });
  }

  function renderGalleryGrid() {
    if (!galleryGrid) return;
    galleryGrid.innerHTML = '';
    if (gallery.length === 0) {
      if (galleryEmpty) galleryEmpty.classList.remove('hidden');
      return;
    }
    if (galleryEmpty) galleryEmpty.classList.add('hidden');
    gallery.forEach((item) => {
      const el = createGridItem(item);
      el.addEventListener('click', () => openPreview(item));
      galleryGrid.appendChild(el);
    });
  }

  let currentPreviewItem = null;

  function openPreview(item) {
    if (!item?.url || !previewImage || !previewOverlay) return;
    currentPreviewItem = item;
    previewImage.src = item.url;
    previewImage.alt = item.prompt || 'Превью';
    previewImage.classList.remove('zoomed');
    if (previewPromptPopover) {
      previewPromptPopover.classList.add('hidden');
      previewPromptPopover.textContent = '';
    }
    if (previewImageButtons) previewImageButtons.classList.add('hidden');
    if (btnPreviewFavoriteOnImage) btnPreviewFavoriteOnImage.style.backgroundColor = '';
    previewOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    loadFavoritePrompts();
  }

  function closePreview() {
    if (previewOverlay) {
      previewOverlay.classList.add('hidden');
      document.body.style.overflow = '';
    }
    if (previewPromptPopover) {
      previewPromptPopover.classList.add('hidden');
      previewPromptPopover.textContent = '';
    }
    if (btnPreviewPrompt) {
      btnPreviewPrompt.textContent = 'Показать промпт';
      btnPreviewPrompt.setAttribute('aria-label', 'Показать промпт');
    }
    if (previewImageButtons) previewImageButtons.classList.add('hidden');
  }

  function updateFavoriteButtonStyle() {
    if (!btnPreviewFavoriteOnImage) return;
    const inFavorites = currentPreviewItem && favoritePrompts.includes(currentPreviewItem.prompt);
    btnPreviewFavoriteOnImage.style.backgroundColor = inFavorites ? 'var(--accent-mid)' : '';
  }

  function togglePromptPopover() {
    if (!previewPromptPopover || !currentPreviewItem || !btnPreviewPrompt) return;
    const isHidden = previewPromptPopover.classList.contains('hidden');
    if (isHidden) {
      previewPromptPopover.textContent = currentPreviewItem.prompt || 'Промпт не указан';
      previewPromptPopover.classList.remove('hidden');
      btnPreviewPrompt.textContent = 'Спрятать промпт';
      btnPreviewPrompt.setAttribute('aria-label', 'Спрятать промпт');
      if (previewImageButtons) previewImageButtons.classList.remove('hidden');
      updateFavoriteButtonStyle();
    } else {
      previewPromptPopover.classList.add('hidden');
      previewPromptPopover.textContent = '';
      btnPreviewPrompt.textContent = 'Показать промпт';
      btnPreviewPrompt.setAttribute('aria-label', 'Показать промпт');
      if (previewImageButtons) previewImageButtons.classList.add('hidden');
      if (btnPreviewFavoriteOnImage) btnPreviewFavoriteOnImage.style.backgroundColor = '';
    }
  }

  let copyFeedbackTimeout = null;

  function copyPromptToClipboard() {
    if (!currentPreviewItem?.prompt) return;
    const text = currentPreviewItem.prompt;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    if (btnPreviewCopyOnImage) {
      if (copyFeedbackTimeout) clearTimeout(copyFeedbackTimeout);
      const img = btnPreviewCopyOnImage.querySelector('.icon, img');
      if (img) {
        img.src = 'icons/check-circle.svg';
      }
      btnPreviewCopyOnImage.style.backgroundColor = '#ff9500';
      copyFeedbackTimeout = setTimeout(() => {
        if (img) img.src = 'icons/copy.svg';
        btnPreviewCopyOnImage.style.backgroundColor = '';
        copyFeedbackTimeout = null;
      }, 3000);
    }
  }

  function togglePreviewZoom() {
    if (previewImage) previewImage.classList.toggle('zoomed');
  }

  if (previewImage) previewImage.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePreviewZoom();
  });
  if (btnPreviewPrompt) btnPreviewPrompt.addEventListener('click', (e) => { e.stopPropagation(); togglePromptPopover(); });
  if (btnPreviewFavoriteOnImage) btnPreviewFavoriteOnImage.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentPreviewItem?.prompt) {
      addFavoritePrompt(currentPreviewItem.prompt).then(() => {
        updateFavoriteButtonStyle();
        if (screenProfile && screenProfile.classList.contains('active')) renderProfileFavorites();
      });
    }
  });
  if (btnPreviewCopyOnImage) btnPreviewCopyOnImage.addEventListener('click', (e) => { e.stopPropagation(); copyPromptToClipboard(); });
  if (previewClose) previewClose.addEventListener('click', closePreview);
  if (previewBackdrop) previewBackdrop.addEventListener('click', closePreview);

  function exportImage() {
    if (!previewImage?.src) return;
    const url = previewImage.src;
    const ext = (url.split('?')[0].match(/\.(png|jpe?g|webp|gif)$/i)?.[1] || 'png').toLowerCase();
    const filename = 'xside-ai-' + Date.now() + '.' + (ext === 'jpeg' ? 'jpg' : ext);

    function doDownload(blobOrUrl, isBlob) {
      const href = isBlob ? URL.createObjectURL(blobOrUrl) : blobOrUrl;
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (isBlob) URL.revokeObjectURL(href);
      if (Telegram?.showPopup) Telegram.showPopup({ title: 'Скачать', message: 'Изображение сохранено' });
    }

    // Telegram WebApp 8.0+: нативный диалог скачивания — работает на мобильных
    if (Telegram?.downloadFile && typeof Telegram.downloadFile === 'function' && !url.startsWith('blob:')) {
      // Прокси даёт Content-Disposition: attachment — нужно для корректного скачивания в Telegram
      const downloadUrl = apiUrl('/api/download?url=' + encodeURIComponent(url) + '&filename=' + encodeURIComponent(filename));
      Telegram.downloadFile({ url: downloadUrl, file_name: filename }, (accepted) => {
        if (Telegram?.showPopup) {
          Telegram.showPopup({
            title: 'Скачать',
            message: accepted ? 'Изображение сохранено' : 'Скачивание отменено',
          });
        }
      });
      return;
    }

    if (url.startsWith('blob:') || url.startsWith(window.location.origin)) {
      doDownload(url, false);
      return;
    }
    fetch(url, { mode: 'cors' })
      .then((r) => r.blob())
      .then((blob) => doDownload(blob, true))
      .catch(() => {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        if (Telegram?.showPopup) Telegram.showPopup({ title: 'Скачать', message: 'Откройте ссылку и сохраните изображение' });
      });
  }

  function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text);
  }

  function shareImage() {
    if (!previewImage?.src) return;
    const url = previewImage.src;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (Telegram?.showPopup) Telegram.showPopup({ title: 'Поделиться', message: 'Сначала скачайте изображение' });
      return;
    }
    const text = currentPreviewItem?.prompt ? String(currentPreviewItem.prompt).slice(0, 200) : 'Изображение Xside AI';
    const shareUrl = 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text);
    if (Telegram?.openTelegramLink) {
      Telegram.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank');
    }
  }

  if (btnShare) btnShare.addEventListener('click', shareImage);
  if (btnExport) btnExport.addEventListener('click', exportImage);

  function renderProfileFavorites() {
    if (!profileFavoritesList || !profileFavoritesEmpty) return;
    profileFavoritesList.innerHTML = '';
    if (favoritePrompts.length === 0) {
      profileFavoritesEmpty.classList.remove('hidden');
      return;
    }
    profileFavoritesEmpty.classList.add('hidden');
    const maxLen = 80;
    favoritePrompts.forEach((prompt) => {
      const chip = document.createElement('div');
      chip.className = 'profile-favorite-chip';
      const text = document.createElement('span');
      text.className = 'profile-favorite-chip-text';
      text.textContent = prompt.length > maxLen ? prompt.slice(0, maxLen) + '…' : prompt;
      text.title = prompt;
      const actions = document.createElement('span');
      actions.className = 'profile-favorite-chip-actions';
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'profile-favorite-chip-btn';
      copyBtn.setAttribute('aria-label', 'Копировать');
      const copyIcon = document.createElement('img');
      copyIcon.src = 'icons/copy.svg';
      copyIcon.alt = '';
      copyIcon.className = 'icon';
      copyBtn.appendChild(copyIcon);
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(prompt).catch(() => {});
          copyIcon.src = 'icons/check-circle.svg';
          setTimeout(() => { copyIcon.src = 'icons/copy.svg'; }, 3000);
        }
      });
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'profile-favorite-chip-btn';
      removeBtn.setAttribute('aria-label', 'Удалить из избранного');
      removeBtn.innerHTML = '×';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFavoritePrompt(prompt).then(() => renderProfileFavorites());
      });
      actions.appendChild(copyBtn);
      actions.appendChild(removeBtn);
      chip.appendChild(text);
      chip.appendChild(actions);
      profileFavoritesList.appendChild(chip);
    });
  }

  function renderProfile() {
    if (profileNickname) profileNickname.textContent = getNickname();
    if (profileCredits) profileCredits.textContent = String(credits);
    const basicGens = Math.floor(credits / 10);
    if (profileGenerationsHint) {
      profileGenerationsHint.textContent = '(≈ ' + basicGens + ' генераций)';
    }
    renderProfileFavorites();
  }

  function showScreen(name) {
    $$('.screen').forEach((s) => s.classList.remove('active'));
    $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.screen === name));
    if (name === 'create' && screenCreate) screenCreate.classList.add('active');
    if (name === 'gallery') {
      if (screenGallery) screenGallery.classList.add('active');
      renderGalleryGrid();
    }
    if (name === 'profile') {
      if (screenProfile) screenProfile.classList.add('active');
      loadFavoritePrompts().then(() => renderProfile());
    }
  }

  $$('.nav-item').forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });

  [$('#profile-btn-test-1'), $('#profile-btn-test-2'), $('#profile-btn-test-3')].forEach((btn, i) => {
    if (btn) btn.addEventListener('click', () => {
      if (Telegram?.showPopup) Telegram.showPopup({ title: 'Тест', message: 'Нажата тестовая кнопка ' + (i + 1) });
      else if (typeof alert === 'function') alert('Тестовая кнопка ' + (i + 1));
    });
  });

  if (viewAll) viewAll.addEventListener('click', () => showScreen('gallery'));

  // Меню профиля
  if (menuBtn) menuBtn.addEventListener('click', toggleMenu);
  if (menuBackdrop) menuBackdrop.addEventListener('click', closeMenu);
  if (menuBtnTopup) {
    menuBtnTopup.addEventListener('click', () => {
      // Подставьте ссылку на оплату или команду бота
      const topupUrl = 'https://t.me/YourBot?start=pay';
      if (Telegram?.openLink) Telegram.openLink(topupUrl);
      else if (Telegram?.showPopup) Telegram.showPopup({ title: 'Пополнение баланса', message: 'Скоро будет доступно' });
    });
  }

  let progressIntervalId = null;

  function setProgress(visible, text, percent) {
    if (progressIntervalId != null) {
      clearInterval(progressIntervalId);
      progressIntervalId = null;
    }
    if (progressWrap) progressWrap.classList.toggle('hidden', !visible);
    if (progressFill) progressFill.style.width = visible ? (typeof percent === 'number' ? percent + '%' : '0%') : '0%';
    if (progressText) progressText.textContent = text || 'Генерация...';
  }

  function startProgressSimulation() {
    let p = 15;
    progressIntervalId = setInterval(() => {
      p = Math.min(p + 3, 88);
      if (progressFill) progressFill.style.width = p + '%';
      if (p >= 88 && progressIntervalId) {
        clearInterval(progressIntervalId);
        progressIntervalId = null;
      }
    }, 2000);
  }

  function getUserId() {
    return Telegram?.initDataUnsafe?.user?.id;
  }

  function resetPromptAndUploads() {
    if (promptInput) promptInput.value = '';
    uploadedImages.length = 0;
    renderUploads();
    if (imagesFileInput) imagesFileInput.value = '';
  }

  function finishGenerate(resultImageUrl, galleryItem) {
    const item = galleryItem || {
      id: 'gen-' + Date.now(),
      url: resultImageUrl,
      prompt: (promptInput?.value || '').trim() || 'Изображение',
      createdAt: Date.now(),
    };
    if (item.url) {
      recent.unshift(item);
      gallery.unshift(item);
    }
    credits = Math.max(0, credits - lastGenerationCost);
    renderCredits();
    if (progressFill) progressFill.style.width = '100%';
    if (progressText) progressText.textContent = 'Готово!';
    setTimeout(() => {
      setProgress(false);
      if (btnGenerate) btnGenerate.disabled = false;
      renderRecentGrid();
      renderGalleryGrid();
      resetPromptAndUploads();
    }, 400);
  }

  function showError(message) {
    setProgress(false);
    if (progressIntervalId) clearInterval(progressIntervalId);
    progressIntervalId = null;
    if (btnGenerate) btnGenerate.disabled = false;
    if (Telegram?.showPopup) Telegram.showPopup({ title: 'Ошибка', message: message || 'Не удалось сгенерировать изображение' });
    else if (typeof alert === 'function') alert(message || 'Не удалось сгенерировать изображение');
  }

  let lastGenerationCost = 0;

  async function startGenerate() {
    const prompt = (promptInput?.value || '').trim();
    if (!prompt) {
      if (Telegram?.showPopup) Telegram.showPopup({ title: 'Введите описание', message: 'Напишите промпт для генерации' });
      return;
    }
    const imgs = getUploadedImages();
    const type = imgs.length === 0 ? 'TEXTTOIAMGE' : 'IMAGETOIAMGE';
    lastGenerationCost = getCurrentCost(imgs.length > 0);
    const options = window.getGenerationOptions ? window.getGenerationOptions() : {};
    const userId = getUserId();

    if (btnGenerate) btnGenerate.disabled = true;
    setProgress(true, 'Отправка...', 0);

    let taskId;
    try {
      if (imgs.length === 0) {
        const r = await fetch(apiUrl('/api/generate'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            type,
            userId: userId != null ? String(userId) : '',
            quality: options.quality,
            aspect: options.aspect || '1:1',
            format: options.format,
            model: options.model,
          }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.message || err.error || 'Ошибка запроса');
        }
        const data = await r.json();
        taskId = data.taskId;
      } else {
        const form = new FormData();
        form.append('prompt', prompt);
        form.append('type', type);
        form.append('userId', userId != null ? String(userId) : '');
        form.append('aspect', options.aspect || '1:1');
        form.append('quality', options.quality ?? '1');
        form.append('format', options.format || 'png');
        form.append('model', options.model || 'nano-pro');
        imgs.forEach((u) => {
          if (u.file) form.append('images', u.file);
        });
        const r = await fetch(apiUrl('/api/generate'), { method: 'POST', body: form });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.message || err.error || 'Ошибка запроса');
        }
        const data = await r.json();
        taskId = data.taskId;
      }
    } catch (e) {
      showError(e.message || 'Сеть недоступна');
      return;
    }

    setProgress(true, 'Генерация...', 15);
    startProgressSimulation();
    const pollInterval = 2000;
    const poll = async () => {
      try {
        const r = await fetch(apiUrl('/api/task/' + encodeURIComponent(taskId)));
        if (!r.ok) return;
        const data = await r.json();
        const successFlag = data.successFlag;
        if (successFlag === 1) {
          finishGenerate(data.resultImageUrl, data.galleryItem);
          return;
        }
        if (successFlag === 2 || successFlag === 3) {
          showError(data.errorMessage || 'Генерация не удалась');
          return;
        }
        setTimeout(poll, pollInterval);
      } catch {
        setTimeout(poll, pollInterval);
      }
    };
    setTimeout(poll, pollInterval);
  }

  if (btnGenerate) btnGenerate.addEventListener('click', startGenerate);

  // Для API: getGenerationOptions() → { quality, aspect, format, model }
  window.getGenerationOptions = () => ({
    quality: $('#select-quality')?.value ?? '1',
    aspect: $('#select-aspect')?.value ?? '1:1',
    format: $('#select-format')?.value ?? 'png',
    model: currentModel,
  });

  async function loadGalleryOnStart() {
    const userId = getUserId();
    if (userId == null) return;
    try {
      const r = await fetch(apiUrl('/api/gallery?userId=' + encodeURIComponent(String(userId))));
      if (!r.ok) return;
      const list = await r.json();
      if (Array.isArray(list) && list.length > 0) {
        gallery.length = 0;
        recent.length = 0;
        list.forEach((item) => {
          gallery.push(item);
          recent.push(item);
        });
        galleryLoadedFromApi = true;
      }
    } catch (_) {}
    renderRecentGrid();
    renderGalleryGrid();
  }

  updateGenerateCost();
  renderMenuProfile();
  loadGalleryOnStart().then(() => {
    renderRecentGrid();
    renderGalleryGrid();
  });
  renderCredits();
  renderUploads();
})();
