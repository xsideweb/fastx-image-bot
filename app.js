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

  const TOPUP_PACKS = [
    { id: '25', stars: 25, credits: 50, priceRub: 49 },
    { id: '50', stars: 50, credits: 100, priceRub: 95 },
    { id: '100', stars: 100, credits: 210, priceRub: 179 },
    { id: '250', stars: 250, credits: 530, priceRub: 429 },
  ];

  async function loadFavoritePrompts() {
    const userId = getUserId();
    if (userId == null) {
      favoritePrompts = [];
      return;
    }
    try {
      const r = await fetch(apiUrl('/api/favorites?userId=' + encodeURIComponent(String(userId)) + '&type=photo'));
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
        body: JSON.stringify({ userId: String(userId), prompt: t, type: 'photo' }),
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
        body: JSON.stringify({ userId: String(userId), prompt: String(text), type: 'photo' }),
      });
      if (!r.ok) return;
      await loadFavoritePrompts();
    } catch (_) {}
  }

  let currentModel = 'nano';

  // Цены по модели и качеству: nano/base/edit=6; nano-2: 1K 12, 2K 18, 4K 27; nano-pro: 1/2K 27, 4K 36
  function getCurrentCost() {
    if (currentModel === 'nano') return 6;
    const quality = $('#select-quality')?.value || '1';
    const q = quality === '4' ? 4 : quality === '2' ? 2 : 1;
    if (currentModel === 'nano-pro') return q === 4 ? 36 : 27;
    if (currentModel === 'nano-2') {
      if (q === 1) return 12;
      if (q === 2) return 18;
      return 27;
    }
    return 6;
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

  function getImageUrl(item, size) {
    const url = item?.url;
    if (!url || !url.startsWith('https://')) return url || '';
    const base = apiUrl('/api/');
    if (size === 'thumb') return base + 'thumb?url=' + encodeURIComponent(url);
    if (size === 'preview') return base + 'view?url=' + encodeURIComponent(url) + '&w=724&h=724';
    return url;
  }

  const screenCreate = $('#screen-create');
  const screenGallery = $('#screen-gallery');
  const screenPrompts = $('#screen-prompts');
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
  const langToggle = $('#lang-toggle');
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
      addCell.innerHTML =
        '<span class="images-drop-plus">+</span>' +
        '<span class="images-drop-label">' +
        (currentLang === 'en' ? 'Add' : 'Добавить') +
        '</span>';
      addCell.addEventListener('click', () => imagesFileInput && imagesFileInput.click());
      imagesThumbs.appendChild(addCell);
    }

    imagesThumbs.classList.toggle('images-thumbs--empty', count === 0);
    updateGenerateCost();
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
    const fallback = currentLang === 'en' ? 'User' : 'Пользователь';
    if (!user) return fallback;
    if (user.username) return '@' + user.username;
    if (user.first_name) return user.first_name;
    return fallback;
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
  }

  function createGridItem(item) {
    const div = document.createElement('div');
    div.className = 'grid-item';
    div.dataset.id = item?.id || '';
    const img = document.createElement('img');
    img.src = getImageUrl(item, 'thumb');
    img.alt = item.prompt || 'Изображение';
    img.loading = 'lazy';
    div.appendChild(img);
    return div;
  }

  function updateGenerateCost() {
    if (generateCostValueEl) {
      generateCostValueEl.textContent = String(getCurrentCost());
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
      empty.textContent = currentLang === 'en' ? 'No images yet' : 'пока изображений нет';
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
      if (item?.id) el.style.viewTransitionName = 'gallery-item-' + item.id;
      el.addEventListener('click', () => openPreview(item));
      if (item?.id) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'images-thumb-remove gallery-item-remove';
        removeBtn.setAttribute('aria-label', 'Удалить из галереи');
        removeBtn.dataset.galleryId = item.id;
        removeBtn.innerHTML = '<span aria-hidden="true">×</span>';
        el.appendChild(removeBtn);
      }
      galleryGrid.appendChild(el);
    });
  }

  const GALLERY_DELETE_ANIMATION_MS = 280;

  async function deleteGalleryItem(itemId, cardEl) {
    try {
      const ok = await confirmDelete(
        currentLang === 'en'
          ? 'Delete this generation from gallery?'
          : 'Удалить эту генерацию из галереи?'
      );
      if (!ok) return;
      const userId = getUserId();
      if (userId == null) return;
      const r = await fetch(apiUrl('/api/gallery'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: String(userId), id: itemId }),
      });
      if (!r.ok) {
        if (Telegram?.showPopup) {
          Telegram.showPopup({
            title: currentLang === 'en' ? 'Error' : 'Ошибка',
            message: currentLang === 'en'
              ? 'Failed to delete image from gallery'
              : 'Не удалось удалить изображение из галереи',
          });
        }
        return;
      }
      const doRemove = () => {
        const idx = gallery.findIndex((g) => g.id === itemId);
        if (idx !== -1) gallery.splice(idx, 1);
        const recentIdx = recent.findIndex((g) => g.id === itemId);
        if (recentIdx !== -1) recent.splice(recentIdx, 1);
        if (cardEl && cardEl.isConnected) {
          try {
            cardEl.remove();
          } catch (removeErr) {
            renderGalleryGrid();
          }
        } else {
          renderGalleryGrid();
        }
        if (gallery.length === 0 && galleryEmpty) galleryEmpty.classList.remove('hidden');
        renderRecentGrid();
      };
      if (cardEl && cardEl.isConnected) {
        cardEl.classList.add('gallery-item-removing');
        setTimeout(doRemove, GALLERY_DELETE_ANIMATION_MS);
      } else {
        doRemove();
      }
    } catch (_) {
      if (Telegram?.showPopup) {
        Telegram.showPopup({
          title: currentLang === 'en' ? 'Error' : 'Ошибка',
          message: currentLang === 'en' ? 'No connection to server' : 'Нет связи с сервером',
        });
      }
    }
  }

  if (galleryGrid) {
    galleryGrid.addEventListener('click', (e) => {
      const targetEl = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
      const btn = targetEl && targetEl.closest && targetEl.closest('.gallery-item-remove');
      if (!btn || !btn.dataset.galleryId) return;
      e.preventDefault();
      e.stopPropagation();
      const cardEl = btn.closest('.grid-item');
      deleteGalleryItem(btn.dataset.galleryId, cardEl);
    }, true);
  }

  let currentPreviewItem = null;

  function openPreview(item) {
    if (!item?.url || !previewImage || !previewOverlay) return;
    currentPreviewItem = item;
    const url = getImageUrl(item, 'preview');
    previewImage.classList.remove('zoomed');
    // Сначала очищаем src, чтобы не мигала предыдущая картинка
    previewImage.src = '';
    previewImage.alt = item.prompt || 'Превью';
    previewImage.src = url;
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
        if (screenPrompts && screenPrompts.classList.contains('active')) renderProfileFavorites();
      });
    }
  });
  if (btnPreviewCopyOnImage) btnPreviewCopyOnImage.addEventListener('click', (e) => { e.stopPropagation(); copyPromptToClipboard(); });
  if (previewClose) previewClose.addEventListener('click', closePreview);
  if (previewBackdrop) previewBackdrop.addEventListener('click', closePreview);

  function exportImage() {
    const url = currentPreviewItem?.url || previewImage?.src;
    if (!url) return;
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

  function shareImage() {
    const url = currentPreviewItem?.url;
    if (!url) return;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (Telegram?.showPopup) Telegram.showPopup({ title: 'Поделиться', message: 'Сначала скачайте изображение' });
      return;
    }
    // Прокси через /api/view — чтобы при открытии ссылка показывала картинку, а не скачивала
    const viewUrl = apiUrl('/api/view?url=' + encodeURIComponent(url));
    const shareText = '\nПереслано из FastX Image Generator';
    const shareLink = 'https://t.me/share/url?url=' + encodeURIComponent(viewUrl) + '&text=' + encodeURIComponent(shareText);
    if (Telegram?.openTelegramLink) {
      Telegram.openTelegramLink(shareLink);
    } else {
      window.open(shareLink, '_blank');
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

  function showScreen(name) {
    $$('.screen').forEach((s) => s.classList.remove('active'));
    $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.screen === name));
    if (name === 'create' && screenCreate) screenCreate.classList.add('active');
    if (name === 'gallery') {
      if (screenGallery) screenGallery.classList.add('active');
      renderGalleryGrid();
    }
    if (name === 'prompts') {
      if (screenPrompts) screenPrompts.classList.add('active');
      loadFavoritePrompts().then(() => renderProfileFavorites());
    }
  }

  $$('.nav-item').forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });

  const topupPacksOverlay = $('#topup-packs-overlay');
  const topupPacksList = $('#topup-packs-list');
  const topupPacksBackdrop = topupPacksOverlay ? $('.topup-packs-backdrop', topupPacksOverlay) : null;
  const topupPacksClose = topupPacksOverlay ? $('.topup-packs-close', topupPacksOverlay) : null;

  function renderTopupButtons(container) {
    if (!container) return;
    if (!Array.isArray(TOPUP_PACKS) || TOPUP_PACKS.length === 0) return;
    container.innerHTML = TOPUP_PACKS.map((p) => {
      const baseCoins = p.stars === 25 ? 50 : p.stars === 50 ? 100 : p.stars === 100 ? 200 : 500;
      const hasBonus = p.credits > baseCoins;
      const bonusAmount = hasBonus ? p.credits - baseCoins : 0;
      const economyPct = hasBonus && baseCoins ? Math.round((bonusAmount / baseCoins) * 100) : 0;
      const bonus = hasBonus ? ' <span class="topup-pack-bonus">+' + bonusAmount + ' бонус</span>' : '';
      const coins = String(baseCoins);
      const badge = economyPct ? '<span class="topup-pack-badge">Экономия ' + economyPct + '%</span>' : '';
      return '<button type="button" class="topup-pack-btn neumorph-btn gradient-premium" data-pack-id="' + String(p.id).replace(/"/g, '&quot;') + '">' +
        badge +
        '<span class="topup-pack-main"><span class="topup-pack-stars"><img src="icons/star.svg" alt="" class="icon icon-btn-sm"> ' + p.stars + ' Stars</span> <span class="topup-pack-coins">(' + coins + ' монет' + bonus + ')</span></span>' +
        '<span class="topup-pack-rub">≈ ' + p.priceRub + ' руб</span></button>';
    }).join('');
    container.querySelectorAll('.topup-pack-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const userId = getUserId();
        if (userId == null) {
          if (Telegram?.showPopup) Telegram.showPopup({ title: 'Ошибка', message: 'Войдите в аккаунт Telegram' });
          else if (typeof alert === 'function') alert('Войдите в аккаунт Telegram');
          return;
        }
        buyPack(userId, btn.dataset.packId);
      });
    });
  }

  function openTopupPacksModal() {
    const userId = getUserId();
    if (userId == null) {
      if (Telegram?.showPopup) Telegram.showPopup({ title: 'Ошибка', message: 'Войдите в аккаунт Telegram' });
      else if (typeof alert === 'function') alert('Войдите в аккаунт Telegram');
      return;
    }
    renderTopupButtons(topupPacksList);
    if (topupPacksOverlay) {
      topupPacksOverlay.classList.remove('hidden');
      topupPacksOverlay.setAttribute('aria-hidden', 'false');
    }
  }

  async function buyPack(userId, packId) {
    try {
      const r = await fetch(apiUrl('/api/invoice-link'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: String(userId), pack: String(packId) }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        if (Telegram?.showPopup) Telegram.showPopup({ title: 'Ошибка', message: err.error || err.message || 'Не удалось создать счёт' });
        return;
      }
      const { invoiceUrl } = await r.json();
      if (topupPacksOverlay) {
        topupPacksOverlay.classList.add('hidden');
        topupPacksOverlay.setAttribute('aria-hidden', 'true');
      }
      if (invoiceUrl && Telegram?.openInvoice) {
        Telegram.openInvoice(invoiceUrl);
      } else if (invoiceUrl && Telegram?.openLink) {
        Telegram.openLink(invoiceUrl);
      } else if (Telegram?.showPopup) {
        Telegram.showPopup({
          title: currentLang === 'en' ? 'Top up' : 'Пополнение',
          message: currentLang === 'en' ? 'Open the link in Telegram' : 'Откройте ссылку в Telegram',
        });
      }
    } catch (e) {
      if (Telegram?.showPopup) {
        Telegram.showPopup({
          title: currentLang === 'en' ? 'Error' : 'Ошибка',
          message: currentLang === 'en' ? 'No connection to server' : 'Нет связи с сервером',
        });
      }
    }
  }

  function closeTopupPacksModal() {
    if (topupPacksOverlay) {
      topupPacksOverlay.classList.add('hidden');
      topupPacksOverlay.setAttribute('aria-hidden', 'true');
    }
  }

  if (topupPacksBackdrop) topupPacksBackdrop.addEventListener('click', closeTopupPacksModal);
  if (topupPacksClose) topupPacksClose.addEventListener('click', closeTopupPacksModal);

  if (viewAll) viewAll.addEventListener('click', () => showScreen('gallery'));

  // Меню профиля
  if (menuBtn) menuBtn.addEventListener('click', toggleMenu);
  if (menuBackdrop) menuBackdrop.addEventListener('click', closeMenu);
  if (menuBtnTopup) {
    menuBtnTopup.addEventListener('click', () => {
      closeMenu();
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
    if (progressText) {
      const defaultText = currentLang === 'en' ? 'Generating...' : 'Генерация...';
      progressText.textContent = text || defaultText;
    }
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

  async function loadCreditsFromApi() {
    const userId = getUserId();
    if (userId == null) return;
    try {
      const r = await fetch(apiUrl('/api/credits?userId=' + encodeURIComponent(String(userId))));
      if (!r.ok) return;
      const data = await r.json();
      if (typeof data.credits === 'number') {
        credits = Math.max(0, data.credits);
        renderCredits();
      }
    } catch (_) {}
  }

  const confirmOverlay = document.createElement('div');
  confirmOverlay.className = 'confirm-overlay hidden';
  confirmOverlay.innerHTML =
    '<div class="confirm-backdrop"></div>' +
    '<div class="confirm-panel">' +
      '<p class="confirm-message"></p>' +
      '<div class="confirm-buttons">' +
        '<button type="button" class="confirm-btn confirm-btn-cancel neumorph-btn">Отмена</button>' +
        '<button type="button" class="confirm-btn confirm-btn-ok neumorph-btn gradient-premium">Удалить</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(confirmOverlay);

  const confirmMsgEl = confirmOverlay.querySelector('.confirm-message');
  const confirmOkBtn = confirmOverlay.querySelector('.confirm-btn-ok');
  const confirmCancelBtn = confirmOverlay.querySelector('.confirm-btn-cancel');
  const confirmBackdrop = confirmOverlay.querySelector('.confirm-backdrop');

  const LANG_STORAGE_KEY = 'xside-lang';

  function getInitialLang() {
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(LANG_STORAGE_KEY);
        if (stored === 'ru' || stored === 'en') return stored;
      }
    } catch (_) {}
    const code = Telegram?.initDataUnsafe?.user?.language_code || navigator.language || navigator.userLanguage || 'ru';
    if (String(code).toLowerCase().startsWith('en')) return 'en';
    return 'ru';
  }

  let currentLang = getInitialLang();

  function applyLanguage() {
    const isEn = currentLang === 'en';
    if (document.documentElement) {
      document.documentElement.lang = isEn ? 'en' : 'ru';
    }

    if (langToggle) {
      langToggle.textContent = isEn ? 'EN' : 'RU';
      langToggle.setAttribute('aria-label', isEn ? 'Language' : 'Язык');
    }

    if (promptInput) {
      promptInput.placeholder = isEn
        ? 'What do you want to generate? (e.g. Cyberpunk banana on a neon bike)'
        : 'Что хотите сгенерировать? (например: Киберпанк-банан на неоновом байке)';
    }

    const qualityLabel = document.querySelector('#quality-wrap .select-label-text');
    if (qualityLabel) qualityLabel.textContent = isEn ? 'Quality' : 'Качество';

    const aspectLabel = document.querySelector('#select-aspect')?.closest('.select-label')?.querySelector('.select-label-text');
    if (aspectLabel) aspectLabel.textContent = isEn ? 'Aspect ratio' : 'Соотношение';

    const formatLabel = document.querySelector('#select-format')?.closest('.select-label')?.querySelector('.select-label-text');
    if (formatLabel) formatLabel.textContent = isEn ? 'Format' : 'Формат';

    const uploadTitle = document.querySelector('.images-upload-title');
    if (uploadTitle) uploadTitle.textContent = isEn ? 'IMAGES (OPTIONAL)' : 'ИЗОБРАЖЕНИЯ (НЕОБЯЗАТЕЛЬНО)';

    const uploadRules = document.querySelector('.images-upload-rules');
    if (uploadRules) uploadRules.textContent = isEn ? 'up to 8 JPG/PNG • ≤ 10 MB' : 'до 8 шт. JPG/PNG • ≤ 10 МБ';

    const generateLabel = document.querySelector('#btn-generate-label');
    if (generateLabel) generateLabel.textContent = isEn ? 'Generate' : 'Сгенерировать';

    const recentEmpty = document.querySelector('.recent-empty');
    if (recentEmpty) recentEmpty.textContent = isEn ? 'No images yet' : 'пока изображений нет';

    const addLabel = document.querySelector('.images-drop-label');
    if (addLabel) addLabel.textContent = isEn ? 'Add' : 'Добавить';

    if (progressText) {
      if (progressWrap && !progressWrap.classList.contains('hidden')) {
        if (progressText.textContent === 'Генерация...' || progressText.textContent === 'Generating...') {
          progressText.textContent = isEn ? 'Generating...' : 'Генерация...';
        }
      } else {
        progressText.textContent = isEn ? 'Generating...' : 'Генерация...';
      }
    }

    const recentTitle = document.querySelector('.recent-title');
    if (recentTitle) recentTitle.textContent = isEn ? 'Recent generations' : 'Последние генерации';

    const viewAll = document.querySelector('#view-all');
    if (viewAll) viewAll.textContent = isEn ? 'All' : 'Все';

    const galleryTitle = document.querySelector('.gallery-title');
    if (galleryTitle) galleryTitle.textContent = isEn ? 'Gallery' : 'Галерея';

    if (galleryEmpty) {
      galleryEmpty.textContent = isEn
        ? 'No images yet. Create the first one on the “Create” tab.'
        : 'Пока нет изображений. Создайте первое на вкладке «Создать».';
    }

    const menuNicknameEl = document.querySelector('#menu-nickname');
    if (menuNicknameEl && menuNicknameEl.textContent === 'Пользователь') {
      menuNicknameEl.textContent = isEn ? 'User' : 'Пользователь';
    }

    const packsTitle = document.querySelector('.topup-packs-title');
    if (packsTitle) packsTitle.textContent = isEn ? 'Buy coins' : 'Купить монеты';

    const favTitle = document.querySelector('.profile-favorites-title');
    if (favTitle) favTitle.textContent = isEn ? 'Favorite prompts' : 'Избранные промпты';

    if (profileFavoritesEmpty) {
      profileFavoritesEmpty.textContent = isEn
        ? 'Add prompts from the image preview (★).'
        : 'Добавляйте промпты из превью картинки (★).';
    }

    const menuCreditsLine = document.querySelector('.menu-credits-line');
    if (menuCreditsLine) {
      const span = menuCreditsLine.querySelector('#menu-credits');
      if (span) {
        const value = span.textContent || '0';
        menuCreditsLine.innerHTML =
          '<img src="icons/banking-coin.svg" alt="" class="icon icon-credits-inline">' +
          '<span id="menu-credits" class="menu-credits">' +
          value +
          '</span> ' +
          (isEn ? 'coins' : 'монет');
      }
    }

    const menuTopup = document.querySelector('#menu-btn-topup');
    if (menuTopup) menuTopup.textContent = isEn ? 'Buy tokens' : 'Купить токены';

    const navCreate = document.querySelector('.bottom-nav .nav-item[data-screen="create"] .nav-label');
    if (navCreate) navCreate.textContent = isEn ? 'Create' : 'Создать';

    const navGallery = document.querySelector('.bottom-nav .nav-item[data-screen="gallery"] .nav-label');
    if (navGallery) navGallery.textContent = isEn ? 'Gallery' : 'Галерея';

    const navPrompts = document.querySelector('.bottom-nav .nav-item[data-screen="prompts"] .nav-label');
    if (navPrompts) navPrompts.textContent = isEn ? 'Prompts' : 'Промпты';

    const previewPromptBtn = document.querySelector('#btn-preview-prompt');
    if (previewPromptBtn) {
      previewPromptBtn.textContent = isEn ? 'Show prompt' : 'Показать промпт';
      previewPromptBtn.setAttribute('aria-label', isEn ? 'Show prompt' : 'Показать промпт');
    }

    const btnShareEl = document.querySelector('#btn-share');
    if (btnShareEl) btnShareEl.innerHTML = '<img src="icons/share.svg" alt="" class="icon icon-btn-sm"> ' + (isEn ? 'Share' : 'Поделиться');

    const btnExportEl = document.querySelector('#btn-export');
    if (btnExportEl) btnExportEl.innerHTML = '<img src="icons/download-minimalistic.svg" alt="" class="icon icon-btn-sm"> ' + (isEn ? 'Download' : 'Скачать');

    if (confirmOkBtn) confirmOkBtn.textContent = isEn ? 'Delete' : 'Удалить';
    if (confirmCancelBtn) confirmCancelBtn.textContent = isEn ? 'Cancel' : 'Отмена';
  }

  function setLanguage(lang) {
    if (lang !== 'ru' && lang !== 'en') return;
    currentLang = lang;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LANG_STORAGE_KEY, currentLang);
      }
    } catch (_) {}
    applyLanguage();
  }

  if (langToggle) {
    langToggle.addEventListener('click', () => {
      setLanguage(currentLang === 'en' ? 'ru' : 'en');
    });
  }

  function confirmDelete(message) {
    return new Promise((resolve) => {
      if (confirmMsgEl) confirmMsgEl.textContent = message;
      confirmOverlay.classList.remove('hidden');

      function cleanup(result) {
        confirmOverlay.classList.add('hidden');
        confirmOkBtn.removeEventListener('click', onOk);
        confirmCancelBtn.removeEventListener('click', onCancel);
        confirmBackdrop.removeEventListener('click', onCancel);
        resolve(result);
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }

      confirmOkBtn.addEventListener('click', onOk);
      confirmCancelBtn.addEventListener('click', onCancel);
      confirmBackdrop.addEventListener('click', onCancel);
    });
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
    loadCreditsFromApi().then(() => {
      renderCredits();
    }).catch(() => {
      renderCredits();
    });
    if (progressFill) progressFill.style.width = '100%';
    if (progressText) progressText.textContent = currentLang === 'en' ? 'Done!' : 'Готово!';
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
    const fallbackMessage = currentLang === 'en' ? 'Failed to generate image' : 'Не удалось сгенерировать изображение';
    const title = currentLang === 'en' ? 'Error' : 'Ошибка';
    const finalMessage = message || fallbackMessage;
    if (Telegram?.showPopup) Telegram.showPopup({ title, message: finalMessage });
    else if (typeof alert === 'function') alert(finalMessage);
  }

  let lastGenerationCost = 0;

  function showInsufficientCreditsPopup(required) {
    const msg = (currentLang === 'en'
      ? 'You need ' + String(required) + ' tokens to generate. Please top up your balance.'
      : 'Для генерации нужно ' + String(required) + ' токенов. Пополните баланс.'
    );
    const tg = window.Telegram?.WebApp;
    if (tg?.showPopup && typeof tg.showPopup === 'function') {
      const buttons = [
        { id: 'close', type: 'close', text: currentLang === 'en' ? 'Close' : 'Закрыть' },
        { id: 'topup', type: 'default', text: currentLang === 'en' ? 'Top up' : 'Пополнить' },
      ];
      tg.showPopup(
        { title: currentLang === 'en' ? 'Not enough tokens' : 'Недостаточно токенов', message: msg, buttons },
        () => {}
      );
      return;
    }
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(
        currentLang === 'en'
          ? 'Not enough tokens. Please top up in the Profile app.'
          : 'Недостаточно токенов. Пополните баланс в приложении Профиль.'
      );
      return;
    }
  }

  async function startGenerate() {
    const prompt = (promptInput?.value || '').trim();
    if (!prompt) {
      if (Telegram?.showPopup) {
        Telegram.showPopup({
          title: currentLang === 'en' ? 'Enter description' : 'Введите описание',
          message: currentLang === 'en' ? 'Write a prompt for generation' : 'Напишите промпт для генерации',
        });
      }
      return;
    }
    const imgs = getUploadedImages();
    const type = imgs.length === 0 ? 'TEXTTOIAMGE' : 'IMAGETOIAMGE';
    lastGenerationCost = getCurrentCost();
    const options = window.getGenerationOptions ? window.getGenerationOptions() : {};
    const userId = getUserId();

    if (userId != null && credits < lastGenerationCost) {
      showInsufficientCreditsPopup(lastGenerationCost);
      return;
    }

    if (btnGenerate) btnGenerate.disabled = true;
    setProgress(true, currentLang === 'en' ? 'Sending...' : 'Отправка...', 0);

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
          if (err && err.error === 'INSUFFICIENT_CREDITS') {
            if (typeof err.credits === 'number') {
              credits = Math.max(0, err.credits);
              renderCredits();
            }
            showInsufficientCreditsPopup(lastGenerationCost);
            if (btnGenerate) btnGenerate.disabled = false;
            setProgress(false);
            return;
          }
          throw new Error(err.message || err.error || (currentLang === 'en' ? 'Request error' : 'Ошибка запроса'));
        }
        const data = await r.json();
        if (typeof data.credits === 'number') {
          credits = Math.max(0, data.credits);
          renderCredits();
        }
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
          if (err && err.error === 'INSUFFICIENT_CREDITS') {
            if (typeof err.credits === 'number') {
              credits = Math.max(0, err.credits);
              renderCredits();
            }
            showInsufficientCreditsPopup(lastGenerationCost);
            if (btnGenerate) btnGenerate.disabled = false;
            setProgress(false);
            return;
          }
          throw new Error(err.message || err.error || 'Ошибка запроса');
        }
        const data = await r.json();
        if (typeof data.credits === 'number') {
          credits = Math.max(0, data.credits);
          renderCredits();
        }
        taskId = data.taskId;
      }
    } catch (e) {
      const msg = e.message || '';
      const isNetworkError = msg === 'Failed to fetch' || msg === 'NetworkError' || msg.includes('network') || msg.includes('fetch');
      const netMsg = currentLang === 'en' ? 'No connection to server. Please try again.' : 'Нет связи с сервером. Попробуйте ещё раз.';
      const genericMsg = currentLang === 'en' ? 'Network is unavailable' : 'Сеть недоступна';
      showError(isNetworkError ? netMsg : (msg || genericMsg));
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
        if (typeof data.credits === 'number') {
          credits = Math.max(0, data.credits);
          renderCredits();
        }
        if (successFlag === 1) {
          finishGenerate(data.resultImageUrl, data.galleryItem);
          return;
        }
        if (successFlag === 2 || successFlag === 3) {
          if (data.error === 'INSUFFICIENT_CREDITS') {
            showInsufficientCreditsPopup(typeof data.required === 'number' ? data.required : lastGenerationCost);
            return;
          }
          showError(data.errorMessage || (currentLang === 'en' ? 'Generation failed' : 'Генерация не удалась'));
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
    renderRecentGrid();
    renderGalleryGrid();
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
        renderRecentGrid();
        renderGalleryGrid();
      }
    } catch (_) {}
  }

  updateGenerateCost();
  renderMenuProfile();
  loadCreditsFromApi().then(() => renderCredits()).catch(() => renderCredits());
  loadGalleryOnStart();
  renderUploads();
  applyLanguage();
})();
