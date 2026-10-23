/**
 * ГОСТ-Документ: Клиентская логика приложения
 * - Уникальные шаблоны для каждой профессии (АЭС, Электрик, Сварщик, Бухгалтер)
 * - Оформление центрального окна как в Word (чистый белый лист везде)
 * - Очередь из нескольких файлов у проверяющего (горят отдельно для каждой профессии)
 * - Автоматическое добавление в библиографию при любом копировании текста справа
 * - Собственная база нормативных документов для каждой профессии + общие стандарты
 */

let currentRole = 'author'; // 'author' | 'reviewer'
let currentSpecialtyId = 'npp';
let currentDoc = null;
let allUserDocs = [];
let specialtiesList = [];
let normDocsList = [];
let activeNormDoc = null;
let stagedReviewComments = [];
let activeReviewDocId = null;

let currentUser = {
  id: 'slavickozlov',
  name: 'Козлов В.А.',
  login: 'slavickozlov-stack',
  role: 'Работники АЭС',
  reviewer: 'Профессор Смирнов А.В.'
};

let currentZoom = 95;
let pendingNormCitationDoc = null;
let savedSelectionRange = null;
let savedActiveEditableElement = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadSpecialties();
  await loadUserDocuments();
  setupCitationTracking();
  setupTitleInputsEditTracking();
  applyZoom();
  document.addEventListener('selectionchange', saveCurrentCaret);
});


// ========================================================
// 1. ШАПКА И РОЛИ (ПОЛНОЭКРАННЫЙ РЕЖИМ ПРОВЕРЯЮЩЕГО БЕЗ БОКОВЫХ ОКОН)
// ========================================================

function switchRole(role) {
  currentRole = role;
  const btnAuthor = document.getElementById('btnRoleAuthor');
  const btnReviewer = document.getElementById('btnRoleReviewer');
  const authorWorkspace = document.getElementById('authorWorkspace');
  const reviewerWorkspace = document.getElementById('reviewerWorkspace');
  const leftPanel = document.getElementById('leftPanel');
  const rightPanel = document.getElementById('rightPanel');
  const mainLayout = document.getElementById('appMainLayout');

  if (role === 'author') {
    btnAuthor.classList.add('active');
    btnReviewer.classList.remove('active');
    if (leftPanel) leftPanel.style.display = 'flex';
    if (rightPanel) rightPanel.style.display = 'flex';
    if (mainLayout) mainLayout.classList.remove('reviewer-mode-active');
    authorWorkspace.style.display = 'flex';
    reviewerWorkspace.style.display = 'none';
  } else {
    btnReviewer.classList.add('active');
    btnAuthor.classList.remove('active');
    // Убираем боковые окна полностью для проверяющего, оставляем только широкое центральное окно
    if (leftPanel) leftPanel.style.display = 'none';
    if (rightPanel) rightPanel.style.display = 'none';
    if (mainLayout) mainLayout.classList.add('reviewer-mode-active');
    authorWorkspace.style.display = 'none';
    reviewerWorkspace.style.display = 'flex';
    loadReviewerQueue();
  }
}

function setupTitleInputsEditTracking() {
  const titleInputIds = [
    'inputOrg',
    'inputDocType',
    'inputTopic',
    'inputAuthorName',
    'inputReviewerName',
    'inputCity',
    'inputYear'
  ];
  titleInputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        triggerAuthorEditTransition();
      });
    }
  });
}

function toggleAuthModal() {
  const modal = document.getElementById('authModal');
  modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
}

function saveUserProfile() {
  currentUser.name = document.getElementById('userFullNameInput').value.trim() || currentUser.name;
  currentUser.login = document.getElementById('userLoginInput').value.trim() || currentUser.login;
  currentUser.role = document.getElementById('userSpecialtySelect').value;
  currentUser.reviewer = document.getElementById('userReviewerInput').value.trim() || currentUser.reviewer;

  document.getElementById('userNameLabel').textContent = currentUser.name;
  document.getElementById('userRoleLabel').textContent = currentUser.role;

  if (currentDoc) {
    document.getElementById('inputAuthorName').value = currentUser.name;
    document.getElementById('inputReviewerName').value = currentUser.reviewer;
  }

  toggleAuthModal();
}


// ========================================================
// 2. ЛЕВАЯ ПАНЕЛЬ: СПЕЦИАЛЬНОСТИ И УНИКАЛЬНЫЕ ШАБЛОНЫ
// ========================================================

async function loadSpecialties() {
  try {
    const res = await fetch('/api/specialties');
    specialtiesList = await res.json();
    renderSpecialties();
    if (specialtiesList.length > 0) {
      await selectSpecialty(specialtiesList[0].id, false);
    }
  } catch (err) {
    console.error('Ошибка загрузки специальностей:', err);
  }
}

function renderSpecialties() {
  const container = document.getElementById('specialtyList');
  container.innerHTML = '';

  specialtiesList.forEach(spec => {
    const div = document.createElement('div');
    div.className = `specialty-item ${spec.id === currentSpecialtyId ? 'active' : ''}`;
    div.onclick = () => selectSpecialty(spec.id, true);

    div.innerHTML = `
      <div class="specialty-icon-box">${spec.icon || '📄'}</div>
      <div class="specialty-item-text">
        <div class="specialty-item-name">${escapeHtml(spec.name)}</div>
        <div class="specialty-item-desc">${escapeHtml(spec.description)}</div>
      </div>
    `;
    container.appendChild(div);
  });
}

/**
 * При выборе специальности:
 * 1. Фильтруется база нормативных документов (свои для профессии + общие)
 * 2. Загружается уникальный шаблон данной профессии
 * 3. Переключается активный отчет на выбранную специальность
 */
async function selectSpecialty(specId, autoSwitchDoc = true) {
  currentSpecialtyId = specId;
  renderSpecialties();

  const spec = specialtiesList.find(s => s.id === specId);
  const specName = spec ? spec.name : 'Работники АЭС';
  document.getElementById('titleSpecialtyLabel').textContent = specName;

  // Обновляем бейдж фильтра документов справа
  const filterBadge = document.getElementById('normSpecialtyFilterBadge');
  if (filterBadge) filterBadge.textContent = `Документы: ${specName}`;

  // Загружаем собственные документы специальности + общие
  await loadNormDocs(specName);
  await loadTemplates(specId);

  if (autoSwitchDoc) {
    // Ищем существующий документ по этой специальности среди пользовательских
    const existingDoc = allUserDocs.find(d => d.specialty_id === specId);
    if (existingDoc) {
      loadDocumentIntoEditor(existingDoc);
    } else {
      createDocumentForSpecialty(specId);
    }
  }
}

async function loadTemplates(specialtyId) {
  try {
    const res = await fetch(`/api/templates?specialty_id=${specialtyId}`);
    const templates = await res.json();
    renderTemplates(templates);
  } catch (err) {
    console.error('Ошибка загрузки шаблонов:', err);
  }
}

function renderTemplates(templates) {
  const container = document.getElementById('templateList');
  container.innerHTML = '';

  templates.forEach(tmpl => {
    const div = document.createElement('div');
    div.className = 'template-item active';
    div.onclick = () => applyTemplateToDocument(tmpl);
    div.innerHTML = `
      <div style="font-weight:700; margin-bottom:2px;">${escapeHtml(tmpl.title)}</div>
      <div style="font-size:10px; color:#64748b;">${escapeHtml(tmpl.doc_type)}</div>
    `;
    container.appendChild(div);
  });
}

function applyTemplateToDocument(tmpl) {
  if (!confirm(`Применить уникальный шаблон «${tmpl.title}»?`)) return;

  document.getElementById('inputDocType').value = tmpl.doc_type;
  document.getElementById('inputTopic').value = tmpl.topic;

  if (currentDoc) {
    currentDoc.title_data.doc_type = tmpl.doc_type;
    currentDoc.title_data.topic = tmpl.topic;
    currentDoc.sections = JSON.parse(JSON.stringify(tmpl.sections));
    currentDoc.bibliography = [...(tmpl.default_bibliography || [])];
    renderSections(currentDoc.sections);
    renderBibliography(currentDoc.bibliography);
  }
}

// Загрузка документов пользователя
async function loadUserDocuments() {
  try {
    const res = await fetch('/api/documents');
    allUserDocs = await res.json();
    renderDocumentHistory(allUserDocs);
    updateReviewerQueueCount();
    const totalCountEl = document.getElementById('archiveTotalCount');
    if (totalCountEl) totalCountEl.textContent = allUserDocs.length;

    if (allUserDocs.length > 0) {
      // Ищем документ текущей специальности или берем первый
      const currentSpecDoc = allUserDocs.find(d => d.specialty_id === currentSpecialtyId);
      loadDocumentIntoEditor(currentSpecDoc || allUserDocs[0]);
    } else {
      createDocumentForSpecialty(currentSpecialtyId);
    }
  } catch (err) {
    console.error('Ошибка загрузки документов:', err);
  }
}

function renderDocumentHistory(docs) {
  const container = document.getElementById('documentHistoryList');
  container.innerHTML = '';

  docs.forEach(doc => {
    const div = document.createElement('div');
    const isActive = currentDoc && currentDoc.id === doc.id;
    div.className = `history-item ${isActive ? 'active' : ''}`;
    div.onclick = () => {
      // Синхронизируем специальность слева при выборе отчета
      if (doc.specialty_id && doc.specialty_id !== currentSpecialtyId) {
        selectSpecialty(doc.specialty_id, false);
      }
      loadDocumentIntoEditor(doc);
    };

    const statusBadgeHtml = getStatusBadgeHtml(doc.status);
    const specClass = getSpecialtyBadgeClass(doc.specialty_id);

    div.innerHTML = `
      <div class="history-item-top">
        <span class="history-item-specialty-badge ${specClass}">${escapeHtml(doc.author_specialty || 'Специалист')}</span>
        ${statusBadgeHtml}
      </div>
      <div style="font-weight:600; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${escapeHtml(doc.title_data?.topic || 'Без темы')}
      </div>
    `;
    container.appendChild(div);
  });
}

function getSpecialtyBadgeClass(specId) {
  const map = {
    'npp': 'spec-badge-npp',
    'electrician': 'spec-badge-electrician',
    'welder': 'spec-badge-welder',
    'accountant': 'spec-badge-accountant'
  };
  return map[specId] || 'spec-badge-npp';
}

function getStatusBadgeHtml(status) {
  const map = {
    'draft': '<span class="status-badge status-draft">Черновик</span>',
    'review': '<span class="status-badge status-review">Ждет проверку</span>',
    'returned': '<span class="status-badge status-returned">На доработке</span>',
    'approved': '<span class="status-badge status-approved">Утвержден</span>'
  };
  return map[status] || map['draft'];
}

async function createDocumentForSpecialty(specId) {
  const spec = specialtiesList.find(s => s.id === specId) || { name: 'Работники АЭС' };
  
  // Получаем шаблон для этой специальности
  const res = await fetch(`/api/templates?specialty_id=${specId}`);
  const tmpls = await res.json();
  const tmpl = tmpls[0] || {};

  currentDoc = {
    id: `doc-${specId}-${Date.now().toString().slice(-4)}`,
    author_id: currentUser.id,
    author_name: currentUser.name,
    author_specialty: spec.name,
    specialty_id: specId,
    status: 'draft',
    current_version: 1,
    versions: [],
    title_data: {
      org: 'МИНИСТЕРСТВО НАУКИ И ВЫСШЕГО ОБРАЗОВАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ\nВИТИ НИЯУ МИФИ',
      doc_type: tmpl.doc_type || 'ТЕХНИЧЕСКИЙ ОТЧЕТ',
      topic: tmpl.topic || `Отчет по направлению «${spec.name}»`,
      author_name: currentUser.name,
      author_specialty: spec.name,
      reviewer_name: currentUser.reviewer,
      city: 'Волгодонск',
      year: 2026
    },
    sections: tmpl.sections ? JSON.parse(JSON.stringify(tmpl.sections)) : [
      { title: '1. Назначение и цель работы', content: 'Целью работы является: [ВВЕДИТЕ ЦЕЛЬ].' }
    ],
    bibliography: tmpl.default_bibliography ? [...tmpl.default_bibliography] : [],
    used_doc_ids: [],
    reviews: []
  };

  loadDocumentIntoEditor(currentDoc);
}

function createNewDocument() {
  createDocumentForSpecialty(currentSpecialtyId);
}


// ========================================================
// 3. ЦЕНТРАЛЬНАЯ ПАНЕЛЬ: ОФОРМЛЕНИЕ В СТИЛЕ WORD И СИСТЕМА ВЕРСИЙ (v1 -> v2 -> v3)
// ========================================================

function loadDocumentIntoEditor(doc) {
  currentDoc = doc;
  if (!currentDoc.current_version) {
    currentDoc.current_version = (currentDoc.versions && currentDoc.versions.length > 0)
      ? currentDoc.versions[currentDoc.versions.length - 1].version_number
      : 1;
  }
  if (!Array.isArray(currentDoc.versions)) {
    currentDoc.versions = [];
  }

  updateHeaderStatus(doc.status, doc.title_data?.topic);

  // Титульный лист на белом листе
  const t = doc.title_data || {};
  document.getElementById('inputOrg').value = t.org || 'ВИТИ НИЯУ МИФИ';
  document.getElementById('inputDocType').value = t.doc_type || 'ТЕХНИЧЕСКИЙ ОТЧЕТ';
  document.getElementById('titleSpecialtyLabel').textContent = t.author_specialty || 'Специалист';
  document.getElementById('inputTopic').value = t.topic || 'Без темы';
  document.getElementById('inputAuthorName').value = t.author_name || currentUser.name;
  document.getElementById('inputReviewerName').value = t.reviewer_name || currentUser.reviewer;
  document.getElementById('inputCity').value = t.city || 'Волгодонск';
  document.getElementById('inputYear').value = t.year || 2026;

  // Содержательная часть (абзацы Word на белом листе)
  renderSections(doc.sections || []);

  // Библиография на белом листе
  renderBibliography(doc.bibliography || []);

  // Проверка замечаний проверяющего
  handleReviewFeedbackBanner(doc);

  // Обновление рабочей версии и количества прошлых версий в истории
  updateDocumentVersionTags(doc);
}

function updateDocumentVersionTags(doc) {
  const curVer = doc.current_version || 1;
  const pastVersionsCount = Array.isArray(doc.versions) ? doc.versions.length : 0;

  const rulerVerChip = document.getElementById('rulerCurrentVerChip');
  if (rulerVerChip) {
    rulerVerChip.textContent = `Рабочая версия: v${curVer}`;
  }

  const versionCount = document.getElementById('versionCountLabel');
  if (versionCount) {
    versionCount.textContent = `${pastVersionsCount}`;
  }

  const inspectVerBadge = document.getElementById('inspectDocVersionBadge');
  if (inspectVerBadge) {
    inspectVerBadge.textContent = `v${curVer}`;
  }
}

/**
 * Как только автор начинает редактировать документ после возврата на доработку (status === 'returned'),
 * версия документа автоматически увеличивается на +1 (v1 -> v2, v2 -> v3),
 * а проверенная прошлая версия остается в «Истории изменений» со всеми ошибками.
 */
function triggerAuthorEditTransition() {
  if (!currentDoc) return;
  if (currentDoc.status === 'returned') {
    const prevVer = currentDoc.current_version || 1;
    const nextVer = prevVer + 1;
    currentDoc.current_version = nextVer;
    currentDoc.status = 'draft';
    currentDoc.active_review_comments = [];

    updateHeaderStatus(currentDoc.status, currentDoc.title_data?.topic);
    updateDocumentVersionTags(currentDoc);
    handleReviewFeedbackBanner(currentDoc);

    // Убираем пометки с текущего рабочего листа, так как они уже сохранены в Истории изменений (v1)
    document.querySelectorAll('.author-error-red-mark, .ann-highlight-red, .ann-highlight-yellow, .ann-strikethrough, .ann-underline, .ann-comment').forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        const badge = mark.querySelector('.ann-badge-note');
        if (badge) badge.remove();
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
      }
    });

    showToastNotification(`Начато редактирование: документу назначена версия v${nextVer}. Прошлая версия v${prevVer} с пометками сохранена в «Истории изменений».`);
    saveCurrentDocument(false);
  }
}

// ========================================================
// УПРАВЛЕНИЕ МАСШТАБОМ СТРАНИЦЫ WORD (ЗАЩИТА ОТ СЖАТИЯ)
// ========================================================

function setZoom(pct) {
  currentZoom = pct;
  applyZoom();
}

function changeZoom(delta) {
  currentZoom = Math.min(130, Math.max(60, currentZoom + delta));
  applyZoom();
}

function applyZoom() {
  const container = document.getElementById('wordPagesContainer');
  const label = document.getElementById('zoomLevelLabel');
  if (container) {
    container.style.transform = `scale(${currentZoom / 100})`;
  }
  if (label) {
    label.textContent = `${currentZoom}%`;
  }
}

function updateHeaderStatus(status, topic) {
  const badge = document.getElementById('statusBadge');
  badge.className = `status-badge status-${status || 'draft'}`;
  
  const statusLabels = {
    'draft': 'Черновик',
    'review': 'Ждет проверку',
    'returned': 'На доработке',
    'approved': 'Утвержден'
  };
  badge.textContent = statusLabels[status] || 'Черновик';
  document.getElementById('docTopicPreview').textContent = topic || 'Документ';
}

function renderSections(sections) {
  const container = document.getElementById('sectionsContainer');
  container.innerHTML = '';

  sections.forEach((sec, idx) => {
    const box = document.createElement('div');
    box.className = 'word-section-box';
    box.id = `section-box-${idx}`;

    box.innerHTML = `
      <div class="word-section-header">
        <input type="text" class="word-section-title-input" value="${escapeHtml(sec.title)}" 
          placeholder="НАИМЕНОВАНИЕ РАЗДЕЛА" oninput="triggerAuthorEditTransition()" onchange="updateSectionTitle(${idx}, this.value)">
        <button class="btn-icon" title="Удалить раздел" onclick="deleteSection(${idx})">✕</button>
      </div>
      <div class="word-section-body-text" contenteditable="true" 
        data-section-index="${idx}">
        ${formatContentWithWordFields(sec.content, idx)}
      </div>
    `;

    container.appendChild(box);
  });

  attachCaretTracking();
  attachInlineFieldListeners();
}

function saveCurrentCaret() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const editable = container.nodeType === 1 
    ? container.closest('.word-section-body-text') 
    : container.parentElement?.closest('.word-section-body-text');

  if (editable) {
    savedActiveEditableElement = editable;
    savedSelectionRange = range.cloneRange();
  }
}

/**
 * Сериализует DOM-элемент раздела обратно в текст с сохранением квадратных скобок [...]
 * для всех голубых окошек .word-inline-field, чтобы окошки не пропадали на сайте.
 */
function serializeSectionElementToBracketText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.ann-badge-note').forEach(b => b.remove());
  clone.querySelectorAll('.word-inline-field').forEach(span => {
    const rawVal = (span.innerText || span.textContent || '').replace(/[\r\n]+/g, ' ').trim();
    const placeholder = span.getAttribute('data-placeholder') || 'ВВЕДИТЕ ДАННЫЕ';
    const finalInside = rawVal || placeholder;
    span.replaceWith(document.createTextNode(`[${finalInside}]`));
  });
  return clone.innerText;
}

function attachCaretTracking() {
  document.querySelectorAll('.word-section-body-text').forEach(el => {
    el.addEventListener('keyup', saveCurrentCaret);
    el.addEventListener('mouseup', saveCurrentCaret);
    el.addEventListener('focus', saveCurrentCaret);
    el.addEventListener('input', () => {
      triggerAuthorEditTransition();
      saveCurrentCaret();
      const idx = parseInt(el.getAttribute('data-section-index'));
      if (!isNaN(idx) && currentDoc && currentDoc.sections[idx]) {
        currentDoc.sections[idx].content = serializeSectionElementToBracketText(el);
      }
    });
    el.addEventListener('blur', () => {
      const idx = parseInt(el.getAttribute('data-section-index'));
      if (!isNaN(idx) && currentDoc && currentDoc.sections[idx]) {
        currentDoc.sections[idx].content = serializeSectionElementToBracketText(el);
      }
    });
  });
}

function isPlaceholderFieldText(text) {
  if (!text) return true;
  const t = String(text).trim();
  if (!t) return true;
  const upper = t.toUpperCase();
  if (
    upper.startsWith('ВВЕДИТЕ ') ||
    upper.startsWith('УКАЖИТЕ ') ||
    upper.startsWith('ТОК ') ||
    upper.startsWith('ТЕМПЕРАТУРА ') ||
    upper.startsWith('ФИО ') ||
    upper.startsWith('НОМЕР ') ||
    upper.startsWith('ФАКТИЧЕСКАЯ ') ||
    upper.startsWith('УЧЕТНАЯ ') ||
    upper.startsWith('СУММА ') ||
    upper === 'ВВЕДИТЕ ДАННЫЕ' ||
    upper === 'ВВЕДИТЕ ЦЕЛЬ' ||
    upper === 'ВВЕДИТЕ РЕЗУЛЬТАТЫ РАСЧЕТА'
  ) {
    return true;
  }
  return false;
}

function attachInlineFieldListeners() {
  document.querySelectorAll('.word-inline-field').forEach(field => {
    // При вводе или стирании пояснения в голубом окошке:
    field.addEventListener('keydown', (e) => {
      if (field.classList.contains('is-placeholder')) {
        const placeholder = field.getAttribute('data-placeholder') || '';
        const currentText = (field.innerText || '').trim();
        // Если пользователь начинает печатать символ поверх исходного пояснения, сразу очищаем серое пояснение
        if (currentText === placeholder && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          field.innerText = '';
          field.classList.remove('is-placeholder', 'is-saved-gost');
          field.classList.add('is-filled');
        }
      }
    });

    field.addEventListener('paste', (e) => {
      e.preventDefault();
      triggerAuthorEditTransition();
      const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/[\r\n]+/g, ' ').trim();
      if (field.classList.contains('is-placeholder')) {
        field.innerText = pasted;
      } else {
        document.execCommand('insertText', false, pasted);
      }
      field.classList.remove('is-placeholder', 'is-saved-gost');
      field.classList.add('is-filled');
      syncAllSectionsFromDom();
    });

    field.addEventListener('input', () => {
      triggerAuthorEditTransition();
      const placeholder = field.getAttribute('data-placeholder') || '';
      const currentText = (field.innerText || '').trim();
      if (currentText !== placeholder && currentText !== '') {
        field.classList.remove('is-placeholder', 'is-saved-gost');
        field.classList.add('is-filled');
      } else if (currentText === '') {
        // Пока человек стер пояснения и пишет свой текст, шрифт черный обычный, окошко голубое
        field.classList.remove('is-placeholder', 'is-saved-gost');
        field.classList.add('is-filled');
      }
    });

    field.addEventListener('blur', () => {
      const placeholder = field.getAttribute('data-placeholder') || 'ВВЕДИТЕ ДАННЫЕ';
      const currentText = (field.innerText || '').trim();
      if (!currentText) {
        field.innerText = placeholder;
        field.classList.remove('is-filled', 'is-saved-gost');
        field.classList.add('is-placeholder');
      }
      syncAllSectionsFromDom();
    });
  });
}

function syncAllSectionsFromDom() {
  document.querySelectorAll('.word-section-body-text').forEach(el => {
    const idx = parseInt(el.getAttribute('data-section-index'));
    if (!isNaN(idx) && currentDoc && currentDoc.sections[idx]) {
      currentDoc.sections[idx].content = serializeSectionElementToBracketText(el);
    }
  });
}

function renderAnnotationTagHtml(targetEscaped, comm) {
  const tool = comm.tool || 'highlight-red';
  const note = escapeHtml(comm.note || 'Замечание проверяющего');
  if (tool === 'highlight-yellow') {
    return `<mark class="ann-highlight-yellow" title="${note}">${targetEscaped}</mark>`;
  } else if (tool === 'strikethrough') {
    return `<span class="ann-strikethrough" title="${note}">${targetEscaped}</span>`;
  } else if (tool === 'underline') {
    return `<span class="ann-underline" title="${note}">${targetEscaped}</span>`;
  } else if (tool === 'comment') {
    return `<span class="ann-comment" title="${note}">${targetEscaped}<span class="ann-badge-note">💬 ${note}</span></span>`;
  }
  return `<mark class="ann-highlight-red author-error-red-mark" title="${note}">${targetEscaped}</mark>`;
}

function formatContentWithWordFields(rawText, secIdx) {
  if (!rawText) return '';
  let formatted = escapeHtml(rawText);

  // Если у документа статус 'returned' и есть замечания проверяющего - отображаем все пометки!
  if (currentDoc && currentDoc.status === 'returned') {
    const comments = currentDoc.active_review_comments || 
      (currentDoc.reviews && currentDoc.reviews.length > 0 ? currentDoc.reviews[currentDoc.reviews.length - 1].comments : []);

    if (comments && comments.length > 0) {
      comments.forEach(c => {
        if ((c.section_index === undefined || c.section_index === secIdx) && c.target_text) {
          const escapedTarget = escapeHtml(c.target_text);
          if (formatted.includes(escapedTarget)) {
            const replaceTag = renderAnnotationTagHtml(escapedTarget, c);
            formatted = formatted.split(escapedTarget).join(replaceTag);
          }
        }
      });
    }
  }

  // Окошки для ввода текста [ПОЛЕ]: голубой фон, серые отцентрированные пояснения или черный текст (и ГОСТ после сохранения)
  const isSavedGost = Boolean(currentDoc && currentDoc._savedGostMode);
  formatted = formatted.replace(/\[(.*?)\]/g, (match, p1) => {
    const trimmed = p1.trim();
    const isPh = isPlaceholderFieldText(trimmed);
    if (isPh) {
      return `<span class="word-inline-field is-placeholder" contenteditable="true" data-placeholder="${trimmed}" title="Сотрите пояснение и введите свой текст">${trimmed}</span>`;
    } else {
      const gostClass = isSavedGost ? 'is-saved-gost' : '';
      return `<span class="word-inline-field is-filled ${gostClass}" contenteditable="true" data-placeholder="ВВЕДИТЕ ДАННЫЕ" title="Введенное значение (голубое поле)">${trimmed}</span>`;
    }
  });

  return formatted;
}

function updateSectionTitle(index, newTitle) {
  triggerAuthorEditTransition();
  if (currentDoc && currentDoc.sections[index]) {
    currentDoc.sections[index].title = newTitle;
  }
}

function updateSectionContent(index, newHtml) {
  if (currentDoc && currentDoc.sections[index]) {
    const el = document.querySelector(`.word-section-body-text[data-section-index="${index}"]`);
    if (el) {
      currentDoc.sections[index].content = serializeSectionElementToBracketText(el);
    }
  }
}

function addNewSection() {
  if (!currentDoc) return;
  triggerAuthorEditTransition();
  syncAllSectionsFromDom();
  const newSec = {
    title: `${currentDoc.sections.length + 1}. Дополнительный расчетный раздел`,
    content: 'В данном разделе проведены расчеты согласно отраслевому стандарту. Полученные результаты: [ВВЕДИТЕ РЕЗУЛЬТАТЫ РАСЧЕТА].'
  };
  currentDoc.sections.push(newSec);
  renderSections(currentDoc.sections);
}

function deleteSection(index) {
  if (!confirm('Удалить данный раздел?')) return;
  triggerAuthorEditTransition();
  syncAllSectionsFromDom();
  currentDoc.sections.splice(index, 1);
  renderSections(currentDoc.sections);
}

function renderBibliography(bibList) {
  const listEl = document.getElementById('bibList');
  listEl.innerHTML = '';

  if (bibList.length === 0) {
    listEl.innerHTML = '<li style="color:#94a3b8; font-style:italic; list-style:none;">Источники автоматически появятся здесь при вставке текста из документов справа.</li>';
    return;
  }

  bibList.forEach((bib, idx) => {
    const li = document.createElement('li');
    li.className = 'word-bib-item';
    li.innerHTML = `
      ${escapeHtml(bib)}
      <button class="btn-bib-delete" title="Удалить источник" onclick="removeBibCitation(${idx})">✕</button>
    `;
    listEl.appendChild(li);
  });
}

function removeBibCitation(index) {
  triggerAuthorEditTransition();
  currentDoc.bibliography.splice(index, 1);
  renderBibliography(currentDoc.bibliography);
}

function promptAddCustomCitation() {
  const citation = prompt('Введите библиографическое описание источника по ГОСТ:');
  if (citation && citation.trim()) {
    triggerAuthorEditTransition();
    currentDoc.bibliography.push(citation.trim());
    renderBibliography(currentDoc.bibliography);
  }
}

function handleReviewFeedbackBanner(doc) {
  const banner = document.getElementById('reviewFeedbackBanner');
  if (doc.status === 'returned' && doc.reviews && doc.reviews.length > 0) {
    const latestReview = doc.reviews[doc.reviews.length - 1];
    banner.style.display = 'block';
    const revVer = latestReview.version_reviewed || doc.current_version || 1;
    document.getElementById('bannerReviewerStamp').textContent = `Проверил: ${latestReview.reviewer_name} (Версия v${revVer})`;
    document.getElementById('bannerFeedbackText').textContent = latestReview.general_feedback || 'Требуются исправления перед повторной отправкой.';

    const commentsList = document.getElementById('bannerCommentsList');
    commentsList.innerHTML = '';
    const comments = (doc.active_review_comments && doc.active_review_comments.length > 0)
      ? doc.active_review_comments 
      : (latestReview.comments || []);

    comments.forEach((c, idx) => {
      const chip = document.createElement('div');
      chip.className = 'feedback-comment-chip';
      chip.style.cursor = 'pointer';
      chip.title = 'Нажмите, чтобы перейти к пометке в тексте отчета';
      chip.onclick = () => scrollToErrorSection(c.target_text);
      chip.innerHTML = `<b>Пометка ${idx + 1}:</b> «${escapeHtml(c.target_text)}» — <i style="color:#dc2626;">${escapeHtml(c.note)}</i> <span style="font-size:9px; color:#2563eb; margin-left:4px;">(найти в тексте)</span>`;
      commentsList.appendChild(chip);
    });
  } else {
    banner.style.display = 'none';
  }
}

function scrollToErrorSection(targetText) {
  if (!targetText) return;
  const editableBlocks = document.querySelectorAll('.word-section-body-text');
  for (const block of editableBlocks) {
    if (block.innerText.includes(targetText)) {
      block.scrollIntoView({ behavior: 'smooth', block: 'center' });
      block.style.boxShadow = '0 0 0 3px #ef4444';
      setTimeout(() => { block.style.boxShadow = ''; }, 2200);
      showToastNotification(`Переход к фрагменту: «${targetText.substring(0, 30)}...»`);
      break;
    }
  }
}

// Сохранение текущего документа: форматирует введенный текст в голубых полях по ГОСТу (Times New Roman 14pt), оставляя голубой фон на сайте
async function saveCurrentDocument(showToast = false) {
  syncAllSectionsFromDom();
  collectCurrentDocData();
  currentDoc._savedGostMode = true;

  // Переводим все заполненные голубые окошки в шрифт по стандарту ГОСТ (фон на сайте остается голубым!)
  document.querySelectorAll('.word-inline-field.is-filled').forEach(field => {
    field.classList.add('is-saved-gost');
  });

  try {
    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentDoc)
    });
    const data = await res.json();
    if (data.success) {
      currentDoc = data.document;
      currentDoc._savedGostMode = true;
      updateHeaderStatus(currentDoc.status, currentDoc.title_data.topic);
      updateDocumentVersionTags(currentDoc);
      await loadUserDocuments();
      if (showToast) {
        showToastNotification('Черновик сохранен: введенный в голубые окошки текст оформлен шрифтом по ГОСТу');
      }
    }
  } catch (err) {
    console.error('Ошибка сохранения документа:', err);
  }
}

function collectCurrentDocData() {
  currentDoc.title_data = {
    org: document.getElementById('inputOrg').value.trim(),
    doc_type: document.getElementById('inputDocType').value.trim(),
    topic: document.getElementById('inputTopic').value.trim(),
    author_name: document.getElementById('inputAuthorName').value.trim(),
    author_specialty: document.getElementById('titleSpecialtyLabel').textContent.trim(),
    reviewer_name: document.getElementById('inputReviewerName').value.trim(),
    city: document.getElementById('inputCity').value.trim(),
    year: parseInt(document.getElementById('inputYear').value) || 2026
  };
  return currentDoc;
}

// ========================================================
// 3.1. ОТПРАВКА НА ПРОВЕРКУ (ВЕРСИЯ НЕ МЕНЯЕТСЯ ПРИ ОТПРАВКЕ)
// ========================================================

function openSubmitModal() {
  if (!currentDoc || !currentDoc.id) {
    showToastNotification('Сначала выберите или сохраните документ.');
    return;
  }
  const modal = document.getElementById('submitModal');
  const input = document.getElementById('submitChangelogInput');
  const badge = document.getElementById('submitNextVerBadge');
  const text = document.getElementById('submitNextVerText');
  
  const curVer = currentDoc.current_version || 1;

  if (badge) badge.textContent = `v${curVer}`;
  if (text) text.textContent = `v${curVer}`;

  if (curVer === 1) {
    input.value = 'Версия v1: Первоначальная отправка отчета на проверку';
  } else {
    input.value = `Версия v${curVer}: Доработанная редакция после исправления замечаний`;
  }

  modal.style.display = 'flex';
}

function closeSubmitModal() {
  document.getElementById('submitModal').style.display = 'none';
}

async function confirmSubmitForReview() {
  const changelog = document.getElementById('submitChangelogInput').value.trim();
  closeSubmitModal();
  await submitDocumentWithChangelog(changelog);
}

async function submitDocumentWithChangelog(changelog = '') {
  await saveCurrentDocument(false);
  if (!currentDoc || !currentDoc.id) return;

  try {
    const res = await fetch(`/api/documents/${currentDoc.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changelog: changelog || 'Отправка отчета проверяющему' })
    });
    const data = await res.json();
    if (data.success) {
      currentDoc = data.document;
      const curVer = currentDoc.current_version || 1;
      updateHeaderStatus(currentDoc.status, currentDoc.title_data?.topic);
      updateDocumentVersionTags(currentDoc);
      handleReviewFeedbackBanner(currentDoc);
      await loadUserDocuments();

      showToastNotification(`Отчет (версия v${curVer}) передан проверяющему на нормоконтроль`);
    }
  } catch (err) {
    console.error('Ошибка отправки отчета:', err);
  }
}

async function submitDocumentForReview() {
  openSubmitModal();
}

async function exportDocument(format) {
  if (!currentDoc || !currentDoc.id) {
    showToastNotification('Сначала сохраните документ.');
    return;
  }
  await saveCurrentDocument(false);
  window.location.href = `/api/documents/${currentDoc.id}/export/${format}`;
}


// ========================================================
// 3.2. ИСТОРИЯ ИЗМЕНЕНИЙ (ПАМЯТЬ ПРОШЛЫХ ВЕРСИЙ И ОШИБОК)
// ========================================================

let cachedPastVersions = [];

function openVersionHistoryModal() {
  if (!currentDoc || !currentDoc.id) {
    showToastNotification('Сначала выберите или создайте документ.');
    return;
  }
  const modal = document.getElementById('versionHistoryModal');
  const titleEl = document.getElementById('versionHistoryDocTitle');
  const curVer = currentDoc.current_version || 1;
  if (titleEl) {
    titleEl.textContent = `«${currentDoc.title_data?.topic || 'Без темы'}» — текущая рабочая версия: v${curVer}`;
  }
  const viewer = document.getElementById('pastVersionSheetViewer');
  if (viewer) viewer.style.display = 'none';

  modal.style.display = 'flex';
  loadVersionTimeline();
}

function closeVersionHistoryModal() {
  document.getElementById('versionHistoryModal').style.display = 'none';
}

async function loadVersionTimeline() {
  const container = document.getElementById('versionTimelineList');
  if (!container) return;
  container.innerHTML = '<div style="font-size:12px; color:#64748b; padding:16px; text-align:center;">Загрузка прошлых версий...</div>';

  try {
    const res = await fetch(`/api/documents/${currentDoc.id}/versions`);
    const versions = await res.json();
    cachedPastVersions = versions || [];
    renderVersionTimeline(cachedPastVersions);
  } catch (err) {
    container.innerHTML = '<div style="color:#ef4444; font-size:12px; padding:16px; text-align:center;">Не удалось загрузить историю изменений.</div>';
  }
}

function renderVersionTimeline(versions) {
  const container = document.getElementById('versionTimelineList');
  if (!container) return;
  container.innerHTML = '';

  const curVer = currentDoc.current_version || 1;

  if (!versions || versions.length === 0) {
    container.innerHTML = `
      <div style="font-size:12px; color:#475569; padding:24px; text-align:center; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:6px;">
        <b>Вы сейчас работаете над версией v${curVer}.</b><br>
        Прошлых версий с ошибками пока нет. Когда проверяющий проверит версию v${curVer} и вернет ее на доработку, она автоматически сохранится здесь со всеми его пометками (например: при работе над v2 здесь хранится v1; при работе над v3 — хранятся v1 и v2).
      </div>`;
    return;
  }

  // Сортируем по порядку номеров версий (v1, v2...)
  const sorted = [...versions].sort((a, b) => a.version_number - b.version_number);

  sorted.forEach(v => {
    const card = document.createElement('div');
    card.className = 'version-timeline-card';
    card.id = `version-card-${v.version_number}`;
    card.onclick = () => openPastVersionViewer(v.version_number);

    const dateFormatted = new Date(v.reviewed_at || v.created_at).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const commentsCount = (v.review_comments || []).length;

    card.innerHTML = `
      <div class="version-card-header">
        <div class="version-tag-row">
          <span class="version-tag">Прошлая версия v${v.version_number}</span>
          <span class="version-badge-errors">Пометок проверяющего: ${commentsCount}</span>
          <span class="version-date">Проверено: ${dateFormatted}</span>
        </div>
        <div class="version-actions-btns" onclick="event.stopPropagation();">
          <button class="btn-v-view" onclick="openPastVersionViewer(${v.version_number})">Открыть лист v${v.version_number} с ошибками</button>
          <button class="btn-v-export" onclick="exportVersionDoc(${v.version_number}, 'docx')" title="Скачать DOCX версии v${v.version_number}">DOCX</button>
          <button class="btn-v-export" onclick="exportVersionDoc(${v.version_number}, 'txt')" title="Скачать TXT версии v${v.version_number}">TXT</button>
        </div>
      </div>
      <div class="version-changelog">${escapeHtml(v.general_feedback || v.changelog || 'Возвращено на доработку')}</div>
      <div class="version-meta">
        Проверяющий: <b>${escapeHtml(v.reviewer_name || 'Профессор Смирнов А.В.')}</b> • Нажмите на карточку, чтобы просмотреть лист версии v${v.version_number} со всеми выделениями и замечаниями
      </div>
    `;
    container.appendChild(card);
  });

  // Автоматически открываем последнюю сохраненную прошлую версию для удобства
  if (sorted.length > 0) {
    openPastVersionViewer(sorted[sorted.length - 1].version_number);
  }
}

function openPastVersionViewer(versionNum) {
  const v = cachedPastVersions.find(item => item.version_number === versionNum);
  const viewer = document.getElementById('pastVersionSheetViewer');
  if (!v || !viewer) return;

  document.querySelectorAll('.version-timeline-card').forEach(c => c.classList.remove('version-card-active'));
  const activeCard = document.getElementById(`version-card-${versionNum}`);
  if (activeCard) activeCard.classList.add('version-card-active');

  const comments = v.review_comments || [];
  let sectionsHtml = '';

  (v.sections || []).forEach((sec, idx) => {
    let contentHtml = escapeHtml(sec.content || '');
    comments.forEach(c => {
      if ((c.section_index === undefined || c.section_index === idx) && c.target_text) {
        const escapedTarget = escapeHtml(c.target_text);
        if (contentHtml.includes(escapedTarget)) {
          contentHtml = contentHtml.split(escapedTarget).join(renderAnnotationTagHtml(escapedTarget, c));
        }
      }
    });

    // Очищаем скобки для наглядного чтения листа
    contentHtml = contentHtml.replace(/\[(.*?)\]/g, '$1');

    sectionsHtml += `
      <div class="inspect-section-block">
        <span class="inspect-section-title-tag">${idx + 1}. ${escapeHtml((sec.title || '').toUpperCase())}</span>
        <div class="inspect-section-text">${contentHtml}</div>
      </div>
    `;
  });

  let commentsSummaryHtml = '';
  if (comments.length > 0) {
    commentsSummaryHtml = `
      <div style="margin-top:16px; background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:12px 16px;">
        <div style="font-size:11px; font-weight:700; color:#991b1b; margin-bottom:6px;">Список замечаний проверяющего в версии v${v.version_number}:</div>
        <ul style="padding-left:18px; margin:0; font-size:11px; color:#7f1d1d;">
          ${comments.map(c => `<li style="margin-bottom:4px;"><b>«${escapeHtml(c.target_text)}»</b> — ${escapeHtml(c.note)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  viewer.style.display = 'block';
  viewer.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
      <div style="font-size:12px; font-weight:700; color:#1e40af;">
        Просмотр архивного листа: Версия v${v.version_number} (со всеми пометками проверяющего)
      </div>
      <div style="font-size:11px; color:#475569;">
        Заключение: <b>${escapeHtml(v.general_feedback || 'На доработку')}</b>
      </div>
    </div>
    <div class="past-version-sheet-paper">
      <div style="text-align:center; border-bottom:1px solid #e2e8f0; padding-bottom:12px; margin-bottom:16px;">
        <div style="font-weight:bold; font-size:12pt;">${escapeHtml(v.title_data?.doc_type || 'ТЕХНИЧЕСКИЙ ОТЧЕТ')} (Версия v${v.version_number})</div>
        <div style="font-weight:bold; font-size:13pt; margin-top:4px;">Тема: «${escapeHtml(v.title_data?.topic || 'Без темы')}»</div>
      </div>
      ${sectionsHtml}
      ${commentsSummaryHtml}
    </div>
  `;
}

function exportVersionDoc(versionNum, format) {
  if (!currentDoc || !currentDoc.id) return;
  window.location.href = `/api/documents/${currentDoc.id}/versions/${versionNum}/export/${format}`;
}


// ========================================================
// 4. ПРАВАЯ ПАНЕЛЬ: БАЗА ДОКУМЕНТОВ + ЦИТИРОВАНИЕ ТОЛЬКО ПРИ ВСТАВКЕ
// ========================================================

function switchRightTab(tab) {
  const tabDocs = document.getElementById('tabDocs');
  const tabAi = document.getElementById('tabAi');
  const contentDocs = document.getElementById('tabContentDocs');
  const contentAi = document.getElementById('tabContentAi');

  if (tab === 'docs') {
    tabDocs.classList.add('active');
    tabAi.classList.remove('active');
    contentDocs.classList.add('active');
    contentAi.classList.remove('active');
  } else {
    tabAi.classList.add('active');
    tabDocs.classList.remove('active');
    contentAi.classList.add('active');
    contentDocs.classList.remove('active');
  }
}

async function loadNormDocs(category = null) {
  try {
    const url = category ? `/api/norm-docs?category=${encodeURIComponent(category)}` : '/api/norm-docs';
    const res = await fetch(url);
    normDocsList = await res.json();
    renderNormDocsList(normDocsList);
  } catch (err) {
    console.error('Ошибка загрузки документов:', err);
  }
}

function renderNormDocsList(docs) {
  const container = document.getElementById('normDocsList');
  container.innerHTML = '';

  if (docs.length === 0) {
    container.innerHTML = '<div style="font-size:11px; color:#94a3b8; padding:8px;">Документов не найдено</div>';
    return;
  }

  docs.forEach(doc => {
    const card = document.createElement('div');
    const isShared = (doc.categories || []).includes('Общий');
    card.className = `norm-doc-card ${activeNormDoc && activeNormDoc.id === doc.id ? 'active' : ''}`;
    card.onclick = () => openDocReader(doc);

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="norm-doc-code">${escapeHtml(doc.code)}</span>
        ${isShared ? '<span style="font-size:9px; background:#f1f5f9; color:#475569; padding:1px 4px; border-radius:3px;">Общий ГОСТ</span>' : ''}
      </div>
      <div class="norm-doc-title">${escapeHtml(doc.title)}</div>
      <div class="norm-doc-summary">${escapeHtml(doc.summary || '')}</div>
    `;
    container.appendChild(card);
  });
}

function filterNormDocs() {
  const query = document.getElementById('normSearchInput').value.toLowerCase();
  const filtered = normDocsList.filter(d => 
    d.title.toLowerCase().includes(query) || 
    d.code.toLowerCase().includes(query) || 
    (d.content && d.content.toLowerCase().includes(query))
  );
  renderNormDocsList(filtered);
}

function openDocReader(doc) {
  activeNormDoc = doc;
  renderNormDocsList(normDocsList);

  const readerCard = document.getElementById('docReaderCard');
  readerCard.style.display = 'flex';
  document.getElementById('readerDocCode').textContent = doc.code;
  document.getElementById('readerDocTitle').textContent = doc.title;
  document.getElementById('readerDocContent').innerText = doc.content;
}

function closeDocReader() {
  document.getElementById('docReaderCard').style.display = 'none';
  activeNormDoc = null;
  renderNormDocsList(normDocsList);
}

// =========================================================================
// ЦИТИРОВАНИЕ ГОСТ Р 7.0.5: ДОБАВЛЯЕТСЯ В БИБЛИОГРАФИЮ ТОЛЬКО ПРИ ВСТАВКЕ В ШАБЛОН!
// (НЕ ПРИ КОПИРОВАНИИ И НЕ ПРИ ВЫДЕЛЕНИИ)
// =========================================================================

function setupCitationTracking() {
  const readerContent = document.getElementById('readerDocContent');
  if (readerContent) {
    // При копировании текста из читалки запоминаем активный документ
    // ВАЖНО: В библиографию ничего НЕ добавляется!
    readerContent.addEventListener('copy', () => {
      if (activeNormDoc) {
        pendingNormCitationDoc = activeNormDoc;
      }
    });
  }

  // Слушатель вставки (Ctrl+V / Cmd+V) внутри документа Word
  const canvas = document.getElementById('wordCanvasWrapper');
  if (canvas) {
    canvas.addEventListener('paste', (e) => {
      // Источник попадает в библиографию ТОЛЬКО если фрагмент вставлен в документ!
      const docToCite = pendingNormCitationDoc || activeNormDoc;
      if (docToCite) {
        setTimeout(() => {
          addCitationAutomatically(docToCite);
          syncAllSectionsFromDom();
        }, 60);
      }
    });
  }
}

function addCitationAutomatically(doc) {
  if (!currentDoc || !doc) return;
  const citation = doc.bib_citation || `${doc.title}. ${doc.code}. – М.: Нормативный сборник, 2024.`;

  if (!currentDoc.bibliography) currentDoc.bibliography = [];

  if (!currentDoc.bibliography.includes(citation)) {
    currentDoc.bibliography.push(citation);
    if (!currentDoc.used_doc_ids) currentDoc.used_doc_ids = [];
    if (!currentDoc.used_doc_ids.includes(doc.id)) {
      currentDoc.used_doc_ids.push(doc.id);
    }
    renderBibliography(currentDoc.bibliography);
    showToastNotification(`Источник «${doc.code}» включен в список использованных источников (ГОСТ Р 7.0.5)`);
  }
}

function useDocFragmentInWork() {
  if (!activeNormDoc) {
    alert('Сначала выберите нормативный документ в базе справа.');
    return;
  }
  const selection = window.getSelection().toString().trim();
  const quoteText = selection || (activeNormDoc.content.split('\n')[0].trim());
  const insertText = ` Согласно требованиям ${activeNormDoc.code}: «${quoteText}». `;

  // 1. Вставка текста точно в место курсора (где пользователь сейчас печатает)
  let inserted = false;
  if (savedActiveEditableElement && savedSelectionRange) {
    try {
      savedActiveEditableElement.focus();
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedSelectionRange);
      document.execCommand('insertText', false, insertText);
      inserted = true;
      syncAllSectionsFromDom();
    } catch (e) {
      inserted = false;
    }
  }

  if (!inserted) {
    // Если курсор не был установлен, добавляем в конец первого раздела
    if (!currentDoc.sections || currentDoc.sections.length === 0) {
      addNewSection();
    }
    const targetSection = currentDoc.sections[0];
    targetSection.content = (targetSection.content || '') + `\n\n${insertText.trim()}`;
    renderSections(currentDoc.sections);
  }

  // 2. Включаем документ в список использованных источников (ГОСТ Р 7.0.5)
  addCitationAutomatically(activeNormDoc);
}

// Всплывающие подсказки Toast
function showToastNotification(message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.4s ease';
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// ИИ-выжимка
async function summarizeCurrentNormDoc() {
  if (!activeNormDoc) return;
  switchRightTab('ai');

  const summaryBox = document.getElementById('aiSummaryBox');
  summaryBox.innerHTML = '<div style="color:#0284c7; padding:12px; font-size:11px;"><span class="status-dot-green"></span> Нейросеть составляет структурированный анализ стандарта...</div>';

  try {
    const res = await fetch('/api/ai/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: activeNormDoc.title,
        code: activeNormDoc.code,
        content: activeNormDoc.content
      })
    });
    const data = await res.json();
    const bulletsHtml = (data.key_requirements || []).map(r => `<li style="margin-bottom:3px;">${escapeHtml(r)}</li>`).join('');

    const formattedSummary = `
      <div class="ai-summary-card-chunk">
        <div class="ai-summary-chunk-title">Стандарт: ${escapeHtml(data.code || activeNormDoc.code)}</div>
        <p class="ai-summary-chunk-text" style="font-weight:600; margin-bottom:6px;">${escapeHtml(data.overview || '')}</p>
        <div style="font-size:10px; font-weight:700; color:#475569; margin:4px 0 2px 0;">Ключевые нормативные положения:</div>
        <ul style="padding-left:16px; margin:0 0 6px 0; font-size:10.5px; color:#334155;">${bulletsHtml}</ul>
        <button type="button" class="btn-ai-insert-inline" onclick="insertAiTextAtCaret('${encodeURIComponent(data.overview + '\n' + (data.key_requirements || []).join('\n'))}')">
          <span>+</span> Вставить выжимку в место курсора
        </button>
      </div>
    `;
    summaryBox.innerHTML = formattedSummary;
  } catch (err) {
    summaryBox.innerHTML = '<div style="color:#ef4444; font-size:11px; padding:10px;">Ошибка анализа документа нейросетью.</div>';
  }
}

async function askAiQuickPreset(presetType) {
  switchRightTab('ai');
  const summaryBox = document.getElementById('aiSummaryBox');
  summaryBox.innerHTML = `
    <div style="padding:14px; text-align:center; color:#0284c7; font-size:11px;">
      <span class="status-dot-green"></span> Обработка инженерного запроса нейросетью...
    </div>`;

  const spec = specialtiesList.find(s => s.id === currentSpecialtyId);
  const specName = spec ? spec.name : 'Работники АЭС';

  const presets = {
    'summary': {
      title: `Инженерная выжимка нормативов (${specName})`,
      query: `Составь краткую инженерную выжимку нормативных требований по специальности ${specName}. Выдели ключевые стандарты и правила оформления.`
    },
    'limits': {
      title: `Пределы безопасности и регламенты (${specName})`,
      query: `Укажи критические параметры и пределы безопасной эксплуатации по регламентам для специальности ${specName}. Назови точные числовые диапазоны (давление, температура, сопротивление, зазоры).`
    },
    'params': {
      title: `Расчетные параметры и допуски (${specName})`,
      query: `Сформируй перечень технологических параметров для технического отчета по специальности ${specName}. Укажи нормативные формулы и диапазоны.`
    },
    'conclusion': {
      title: `Формальное заключение для отчета по ГОСТ (${specName})`,
      query: `Сформулируй строгое академическое заключение для технического отчета по специальности ${specName} в соответствии с ГОСТ 7.32-2017.`
    }
  };

  const selectedPreset = presets[presetType] || presets['summary'];
  const docTitle = activeNormDoc ? activeNormDoc.title : `Нормативная база: ${specName}`;
  const docContent = activeNormDoc ? activeNormDoc.content : normDocsList.map(d => d.content).join('\n');

  try {
    const res = await fetch('/api/ai/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doc_title: docTitle,
        doc_content: docContent,
        question: selectedPreset.query
      })
    });
    const data = await res.json();
    renderStructuredAiSummary(selectedPreset.title, data.answer);
  } catch (err) {
    summaryBox.innerHTML = '<div style="color:#ef4444; font-size:11px; padding:10px;">Ошибка связи с инженерной нейросетью.</div>';
  }
}

function renderStructuredAiSummary(title, content) {
  const summaryBox = document.getElementById('aiSummaryBox');
  summaryBox.innerHTML = `
    <div class="ai-summary-card-chunk">
      <div class="ai-summary-chunk-title">${escapeHtml(title)}</div>
      <p class="ai-summary-chunk-text">${escapeHtml(content)}</p>
      <button type="button" class="btn-ai-insert-inline" onclick="insertAiTextAtCaret('${encodeURIComponent(content)}')">
        <span>+</span> Вставить в место курсора документа
      </button>
    </div>
  `;
}

function insertAiTextAtCaret(encodedText) {
  const text = decodeURIComponent(encodedText);
  if (!text) return;
  
  if (savedActiveEditableElement && savedSelectionRange) {
    savedActiveEditableElement.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedSelectionRange);
    document.execCommand('insertText', false, '\n' + text + '\n');
    syncAllSectionsFromDom();
    showToastNotification('Фрагмент ИИ вставлен в документ на место курсора');
  } else {
    // Если курсор не был установлен, добавляем в конец активного раздела
    if (currentDoc && currentDoc.sections && currentDoc.sections.length > 0) {
      currentDoc.sections[0].content += '\n\n' + text;
      renderSections(currentDoc.sections);
      showToastNotification('Фрагмент ИИ добавлен в Раздел 1');
    } else {
      alert('Поставьте курсор в нужное место текста на листе Word.');
    }
  }
}

async function askAiQuestion() {
  const input = document.getElementById('aiQuestionInput');
  const question = input.value.trim();
  if (!question) return;

  const answerBox = document.getElementById('aiAnswerBox');
  answerBox.style.display = 'block';
  answerBox.innerHTML = '<span style="color:#0284c7;"><span class="status-dot-green"></span> Нейросеть формирует ответ...</span>';

  const docTitle = activeNormDoc ? activeNormDoc.title : 'Нормативная база';
  const docContent = activeNormDoc ? activeNormDoc.content : normDocsList.map(d => d.content).join('\n');

  try {
    const res = await fetch('/api/ai/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc_title: docTitle, doc_content: docContent, question })
    });
    const data = await res.json();
    answerBox.innerHTML = `
      <div style="font-weight:700; color:#0f172a; margin-bottom:4px; font-size:10px;">Ответ инженерной нейросети:</div>
      <div style="font-size:11px; line-height:1.45; color:#1e293b; margin-bottom:6px;">${escapeHtml(data.answer)}</div>
      <button type="button" class="btn-ai-insert-inline" onclick="insertAiTextAtCaret('${encodeURIComponent(data.answer)}')">
        <span>+</span> Вставить ответ в место курсора
      </button>
    `;
    input.value = '';
  } catch (err) {
    answerBox.textContent = 'Ошибка получения ответа от нейросети.';
  }
}

async function runAiGostCheck() {
  collectCurrentDocData();
  switchRightTab('ai');

  const normoBox = document.getElementById('aiNormoBox');
  normoBox.style.display = 'block';
  const scoreBadge = document.getElementById('normoScoreBadge');
  const issuesList = document.getElementById('normoIssuesList');

  scoreBadge.textContent = 'Проверка...';

  try {
    const res = await fetch('/api/ai/check-gost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentDoc)
    });
    const result = await res.json();

    scoreBadge.textContent = `${result.score} / 100`;
    issuesList.innerHTML = '';
    if (result.issues.length === 0) {
      issuesList.innerHTML = '<li style="color:#16a34a;">Документ оформлен строго по ГОСТ 7.32-2017!</li>';
    } else {
      result.issues.forEach(iss => {
        const li = document.createElement('li');
        li.textContent = iss;
        issuesList.appendChild(li);
      });
    }
  } catch (err) {
    console.error('Ошибка проверки по ГОСТ:', err);
  }
}


// ========================================================
// 5. КАБИНЕТ ПРОВЕРЯЮЩЕГО: ОТОБРАЖЕНИЕ МНОЖЕСТВА ФАЙЛОВ
// ========================================================

async function loadReviewerQueue() {
  try {
    const res = await fetch('/api/documents');
    const docs = await res.json();
    renderReviewerQueue(docs);
  } catch (err) {
    console.error('Ошибка очереди проверяющего:', err);
  }
}

function updateReviewerQueueCount() {
  const pendingDocs = allUserDocs.filter(d => d.status === 'review');
  const badge = document.getElementById('headerPendingBadge');
  const pulseBadge = document.getElementById('pendingCountBadge');

  if (badge) {
    badge.textContent = pendingDocs.length;
    badge.style.display = pendingDocs.length > 0 ? 'inline-block' : 'none';
  }
  if (pulseBadge) {
    pulseBadge.textContent = `${pendingDocs.length} отчетов на рассмотрении`;
  }
}

function renderReviewerQueue(docs) {
  const container = document.getElementById('reviewerDocQueue');
  container.innerHTML = '';

  const pendingDocs = docs.filter(d => d.status === 'review');
  updateReviewerQueueCount();

  const inspectCard = document.getElementById('inspectDocumentCard');
  const wordRibbon = document.getElementById('reviewerWordRibbon');

  if (pendingDocs.length === 0) {
    container.innerHTML = `
      <div class="queue-empty-state" style="width:100%; padding:14px;">
        <h4>Очередь нормоконтроля пуста</h4>
        <p>Отчеты появятся здесь после того, как автор нажмет «Отправить на проверку».</p>
      </div>`;
    if (inspectCard) inspectCard.style.display = 'none';
    if (wordRibbon) wordRibbon.style.display = 'none';
    return;
  }

  if (inspectCard) inspectCard.style.display = 'flex';
  if (wordRibbon) wordRibbon.style.display = 'flex';

  pendingDocs.forEach(doc => {
    const card = document.createElement('div');
    const isActive = activeReviewDocId === doc.id;
    card.className = `queue-file-card ${isActive ? 'active' : ''}`;
    card.onclick = () => {
      activeReviewDocId = doc.id;
      renderReviewerQueue(docs);
      inspectDocumentForReview(doc);
    };

    const specClass = getSpecialtyBadgeClass(doc.specialty_id);
    const docVer = doc.current_version || 1;

    card.innerHTML = `
      <div class="queue-file-top">
        <span class="history-item-specialty-badge ${specClass}">${escapeHtml(doc.author_specialty || 'Специалист')}</span>
        <span class="status-badge status-review">Версия v${docVer}</span>
      </div>
      <div class="queue-file-topic">${escapeHtml(doc.title_data?.topic || 'Без темы')}</div>
      <div class="queue-file-meta">
        <span>Автор: ${escapeHtml(doc.author_name || 'Козлов В.А.')}</span>
        <span>${new Date(doc.updated_at || doc.created_at).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'})}</span>
      </div>
    `;
    container.appendChild(card);
  });

  if (!activeReviewDocId || !pendingDocs.find(d => d.id === activeReviewDocId)) {
    inspectDocumentForReview(pendingDocs[0]);
  }
}

let currentInspectedDoc = null;

function inspectDocumentForReview(doc) {
  activeReviewDocId = doc.id;
  currentInspectedDoc = doc;
  stagedReviewComments = [];
  renderStagedReviewComments();

  const vCount = doc.current_version || 1;
  document.getElementById('inspectDocTitle').textContent = doc.title_data?.topic || 'Без темы';
  document.getElementById('inspectDocSpecialtyBadge').textContent = `${doc.author_specialty || 'Специалист'}`;
  document.getElementById('inspectDocMeta').textContent = `Автор: ${doc.author_name || 'Козлов В.А.'} | Поступила на проверку: Версия v${vCount}`;
  
  const vBadge = document.getElementById('inspectDocVersionBadge');
  if (vBadge) vBadge.textContent = `v${vCount}`;

  const vHint = document.getElementById('verdictVersionHint');
  if (vHint) vHint.textContent = `Проверка v${vCount}`;

  renderInspectDocBody(doc);
  updateInspectorErrorCount();
}

function renderInspectDocBody(doc) {
  const container = document.getElementById('inspectDocBody');
  container.innerHTML = '';

  // Блок титульного листа
  const titleBox = document.createElement('div');
  titleBox.className = 'inspect-section-block';
  titleBox.innerHTML = `
    <span class="inspect-section-title-tag">ТИТУЛЬНЫЙ ЛИСТ</span>
    <div class="inspect-section-text" style="font-size:12pt; color:#334155; background:#f8fafc; padding:12px 16px; border-radius:4px; text-indent:0;">
      <b>Организация:</b> ${escapeHtml(doc.title_data?.org || 'ВИТИ НИЯУ МИФИ')}<br>
      <b>Вид документа:</b> ${escapeHtml(doc.title_data?.doc_type || 'ТЕХНИЧЕСКИЙ ОТЧЕТ')}<br>
      <b>Тема работы:</b> ${escapeHtml(doc.title_data?.topic || 'Без темы')}<br>
      <b>Специальность:</b> ${escapeHtml(doc.author_specialty || 'Специалист')}<br>
      <b>Исполнитель:</b> ${escapeHtml(doc.title_data?.author_name || 'Козлов В.А.')} | <b>Проверил:</b> ${escapeHtml(doc.title_data?.reviewer_name || 'Профессор Смирнов А.В.')}
    </div>
  `;
  container.appendChild(titleBox);

  // Разделы отчета с поддержкой инструментов Word (выделение цветом, зачеркивание, подчеркивание, комментарий)
  (doc.sections || []).forEach((sec, idx) => {
    const secBox = document.createElement('div');
    secBox.className = 'inspect-section-block';
    secBox.setAttribute('data-sec-idx', idx);

    // Очищаем квадратные скобки полей ввода для чистого отображения листа проверяющему
    const cleanRaw = (sec.content || '').replace(/\[(.*?)\]/g, '$1');
    let secContentHtml = escapeHtml(cleanRaw);

    stagedReviewComments.forEach(comm => {
      if (comm.section_index === idx && comm.target_text) {
        const escapedTarget = escapeHtml(comm.target_text);
        if (secContentHtml.includes(escapedTarget)) {
          const markHtml = renderAnnotationTagHtml(escapedTarget, comm);
          secContentHtml = secContentHtml.split(escapedTarget).join(markHtml);
        }
      }
    });

    secBox.innerHTML = `
      <span class="inspect-section-title-tag">${idx + 1}. ${escapeHtml(sec.title.toUpperCase())}</span>
      <div class="inspect-section-text" data-sec-idx="${idx}" id="inspectSecText_${idx}">${secContentHtml}</div>
    `;
    container.appendChild(secBox);
  });

  // Библиографический список
  if (doc.bibliography && doc.bibliography.length > 0) {
    const bibBox = document.createElement('div');
    bibBox.className = 'inspect-section-block';
    let bibHtml = '<ol style="padding-left:22px; margin:4px 0; font-size:13pt; color:#0f172a; text-indent:0;">';
    doc.bibliography.forEach(b => {
      bibHtml += `<li style="margin-bottom:4px;">${escapeHtml(b)}</li>`;
    });
    bibHtml += '</ol>';
    bibBox.innerHTML = `
      <span class="inspect-section-title-tag">СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ</span>
      <div class="inspect-section-text" style="text-indent:0;">${bibHtml}</div>
    `;
    container.appendChild(bibBox);
  }
}

function updateInspectorErrorCount() {
  const pill = document.getElementById('errorCounterBadge');
  if (pill) {
    pill.textContent = `Пометок: ${stagedReviewComments.length}`;
  }
}

/**
 * Применение инструмента Word проверяющего к выделенному тексту:
 * - 'highlight-red': Выделение красным маркером
 * - 'highlight-yellow': Выделение желтым маркером
 * - 'strikethrough': Зачеркивание
 * - 'underline': Подчеркивание
 * - 'comment': Текстовый комментарий к выделенному фрагменту
 */
function applyReviewerAnnotation(toolType) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {
    showToastNotification('Сначала выделите фрагмент текста мышкой на листе отчета ниже.');
    return;
  }

  const selectedText = sel.toString().trim();
  if (!selectedText) {
    showToastNotification('Выделенный фрагмент пуст.');
    return;
  }

  let secIdx = 0;
  let anchorEl = sel.anchorNode;
  if (anchorEl) {
    const parentBlock = anchorEl.nodeType === 1 
      ? anchorEl.closest('.inspect-section-block') 
      : anchorEl.parentElement?.closest('.inspect-section-block');
    if (parentBlock && parentBlock.hasAttribute('data-sec-idx')) {
      secIdx = parseInt(parentBlock.getAttribute('data-sec-idx')) || 0;
    }
  }

  const toolDefaultNotes = {
    'highlight-red': 'Выделена ошибка (красный маркер)',
    'highlight-yellow': 'Требует уточнения (желтый маркер)',
    'strikethrough': 'Зачеркнуто проверяющим (удалить/исправить)',
    'underline': 'Подчеркнуто проверяющим (обратить внимание)'
  };

  let note = toolDefaultNotes[toolType] || 'Замечание проверяющего';
  if (toolType === 'comment') {
    const entered = prompt(
      `Введите комментарий проверяющего к фрагменту:\n«${selectedText.substring(0, 80)}${selectedText.length > 80 ? '...' : ''}»`,
      'Несоответствие нормам ГОСТ / уточнить параметр'
    );
    if (entered === null) return;
    note = entered.trim() || 'Замечание проверяющего';
  }

  stagedReviewComments.push({
    section_index: secIdx,
    target_text: selectedText,
    tool: toolType,
    note,
    severity: toolType === 'highlight-red' || toolType === 'strikethrough' ? 'error' : 'warning'
  });

  sel.removeAllRanges();
  renderStagedReviewComments();
  updateInspectorErrorCount();

  if (currentInspectedDoc) {
    renderInspectDocBody(currentInspectedDoc);
  }

  showToastNotification(`Добавлена пометка к фрагменту «${selectedText.substring(0, 25)}...»`);
}

function markSelectedTextAsError() {
  applyReviewerAnnotation('highlight-red');
}

function clearSelectedErrorHighlight() {
  if (stagedReviewComments.length === 0) {
    showToastNotification('Нет добавленных пометок для отмены.');
    return;
  }
  const removed = stagedReviewComments.pop();
  renderStagedReviewComments();
  updateInspectorErrorCount();
  if (currentInspectedDoc) {
    renderInspectDocBody(currentInspectedDoc);
  }
  showToastNotification(`Пометка к «${(removed.target_text || '').substring(0, 20)}...» отменена`);
}

function renderStagedReviewComments() {
  const listEl = document.getElementById('stagedCommentsList');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (stagedReviewComments.length === 0) {
    listEl.innerHTML = '<li style="color:#94a3b8; font-size:11px; font-style:italic;">Пометки пока не добавлены. Выделите текст на листе выше и воспользуйтесь верхней панелью инструментов Word.</li>';
    return;
  }

  const toolBadgeNames = {
    'highlight-red': 'Красный маркер',
    'highlight-yellow': 'Желтый маркер',
    'strikethrough': 'Зачеркивание',
    'underline': 'Подчеркивание',
    'comment': 'Комментарий'
  };

  stagedReviewComments.forEach((c, idx) => {
    const li = document.createElement('li');
    li.className = 'staged-comment-item';
    const label = toolBadgeNames[c.tool] || 'Пометка';
    li.innerHTML = `
      <span><b style="color:#1e40af;">[${label}]</b> «${escapeHtml(c.target_text)}» — <i>${escapeHtml(c.note)}</i></span>
      <button style="border:none; background:none; cursor:pointer; color:#ef4444; font-weight:bold;" title="Удалить пометку" onclick="stagedReviewComments.splice(${idx},1); renderStagedReviewComments(); updateInspectorErrorCount(); if(currentInspectedDoc) renderInspectDocBody(currentInspectedDoc);">✕</button>
    `;
    listEl.appendChild(li);
  });
}

async function submitReviewVerdict(verdictStatus) {
  if (!activeReviewDocId) return;

  const generalFeedback = document.getElementById('reviewerFeedbackInput').value.trim();
  if (verdictStatus === 'returned' && stagedReviewComments.length === 0 && !generalFeedback) {
    showToastNotification('Добавьте хотя бы одну пометку на листе или напишите общее заключение перед возвратом на доработку.');
    return;
  }

  const reviewedVer = (currentInspectedDoc && currentInspectedDoc.current_version) || 1;

  try {
    const res = await fetch(`/api/documents/${activeReviewDocId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: currentUser.reviewer,
        status: verdictStatus,
        general_feedback: generalFeedback || (verdictStatus === 'approved' ? 'Отчет проверен и утвержден нормоконтролем.' : 'Обнаружены замечания. Требуется доработка.'),
        comments: stagedReviewComments
      })
    });
    const data = await res.json();
    if (data.success) {
      showToastNotification(
        verdictStatus === 'returned'
          ? `Версия v${reviewedVer} возвращена на доработку и сохранена в Истории изменений со всеми пометками!`
          : `Отчет (v${reviewedVer}) успешно утвержден нормоконтролем!`
      );
      document.getElementById('reviewerFeedbackInput').value = '';
      stagedReviewComments = [];
      renderStagedReviewComments();
      updateInspectorErrorCount();
      await loadUserDocuments();
      await loadReviewerQueue();
    }
  } catch (err) {
    console.error('Ошибка отправки вердикта:', err);
  }
}

function exportCurrentInspectedDoc(format) {
  if (activeReviewDocId) {
    window.location.href = `/api/documents/${activeReviewDocId}/export/${format}`;
  }
}

function openUploadModal() {
  document.getElementById('uploadModal').style.display = 'flex';
}

function closeUploadModal() {
  document.getElementById('uploadModal').style.display = 'none';
}

async function handleUploadDocSubmit(event) {
  event.preventDefault();
  const form = document.getElementById('uploadDocForm');
  const formData = new FormData(form);

  try {
    const res = await fetch('/api/norm-docs/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      showToastNotification(`Документ «${data.document.title}» загружен в базу знаний`);
      closeUploadModal();
      form.reset();
      const spec = specialtiesList.find(s => s.id === currentSpecialtyId);
      await loadNormDocs(spec ? spec.name : null);
    }
  } catch (err) {
    showToastNotification('Не удалось загрузить документ.');
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
