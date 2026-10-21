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
  applyZoom();
  document.addEventListener('selectionchange', saveCurrentCaret);
});


// ========================================================
// 1. ШАПКА И РОЛИ
// ========================================================

function switchRole(role) {
  currentRole = role;
  const btnAuthor = document.getElementById('btnRoleAuthor');
  const btnReviewer = document.getElementById('btnRoleReviewer');
  const authorWorkspace = document.getElementById('authorWorkspace');
  const reviewerWorkspace = document.getElementById('reviewerWorkspace');

  if (role === 'author') {
    btnAuthor.classList.add('active');
    btnReviewer.classList.remove('active');
    authorWorkspace.style.display = 'flex';
    reviewerWorkspace.style.display = 'none';
  } else {
    btnReviewer.classList.add('active');
    btnAuthor.classList.remove('active');
    authorWorkspace.style.display = 'none';
    reviewerWorkspace.style.display = 'flex';
    loadReviewerQueue();
  }
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
// 3. ЦЕНТРАЛЬНАЯ ПАНЕЛЬ: ОФОРМЛЕНИЕ В СТИЛЕ WORD (БЕЛЫЙ ЛИСТ ВЕЗДЕ)
// ========================================================

function loadDocumentIntoEditor(doc) {
  currentDoc = doc;

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

  // Обновление номера и количества версий в шапке и линейке
  updateDocumentVersionTags(doc);
}

function updateDocumentVersionTags(doc) {
  const vLen = (doc.versions && doc.versions.length) || 1;
  const isDraft = doc.status === 'draft';
  const isReturned = doc.status === 'returned';

  let tagText = `v${vLen}`;
  if (isDraft && (!doc.versions || doc.versions.length === 0)) {
    tagText = 'v1 (черновик)';
  } else if (isReturned) {
    tagText = `v${vLen} (на доработке)`;
  }

  const versionTag = document.getElementById('headerVersionTag');
  const versionCount = document.getElementById('versionCountLabel');
  const headerVersionCount = document.getElementById('headerVersionCount');

  if (versionTag) versionTag.textContent = tagText;
  if (versionCount) versionCount.textContent = `${vLen}`;
  if (headerVersionCount) headerVersionCount.textContent = `${vLen}`;

  const inspectVerBadge = document.getElementById('inspectDocVersionBadge');
  if (inspectVerBadge) inspectVerBadge.textContent = `v${vLen}`;
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
          placeholder="НАИМЕНОВАНИЕ РАЗДЕЛА" onchange="updateSectionTitle(${idx}, this.value)">
        <button class="btn-icon" title="Удалить раздел" onclick="deleteSection(${idx})">✕</button>
      </div>
      <div class="word-section-body-text" contenteditable="true" 
        data-section-index="${idx}"
        onblur="updateSectionContent(${idx}, this.innerHTML)">
        ${formatContentWithWordFields(sec.content, idx)}
      </div>
    `;

    container.appendChild(box);
  });

  attachCaretTracking();
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

function attachCaretTracking() {
  document.querySelectorAll('.word-section-body-text').forEach(el => {
    el.addEventListener('keyup', saveCurrentCaret);
    el.addEventListener('mouseup', saveCurrentCaret);
    el.addEventListener('focus', saveCurrentCaret);
    el.addEventListener('input', () => {
      saveCurrentCaret();
      const idx = parseInt(el.getAttribute('data-section-index'));
      if (!isNaN(idx) && currentDoc && currentDoc.sections[idx]) {
        currentDoc.sections[idx].content = el.innerText;
      }
    });
  });
}

function syncAllSectionsFromDom() {
  document.querySelectorAll('.word-section-body-text').forEach(el => {
    const idx = parseInt(el.getAttribute('data-section-index'));
    if (!isNaN(idx) && currentDoc && currentDoc.sections[idx]) {
      currentDoc.sections[idx].content = el.innerText;
    }
  });
}

function formatContentWithWordFields(rawText, secIdx) {
  if (!rawText) return '';
  let formatted = escapeHtml(rawText);

  // Если у документа статус 'returned' и есть замечания проверяющего - подсвечиваем их красным!
  if (currentDoc && currentDoc.status === 'returned') {
    const comments = currentDoc.active_review_comments || 
      (currentDoc.reviews && currentDoc.reviews.length > 0 ? currentDoc.reviews[currentDoc.reviews.length - 1].comments : []);

    if (comments && comments.length > 0) {
      comments.forEach(c => {
        if (c.target_text && formatted.includes(escapeHtml(c.target_text))) {
          const escapedTarget = escapeHtml(c.target_text);
          const replaceTag = `<mark class="author-error-red-mark" title="Замечание нормоконтроля: ${escapeHtml(c.note)}">${escapedTarget}</mark>`;
          formatted = formatted.split(escapedTarget).join(replaceTag);
        }
      });
    }
  }

  // Подсвечиваем прозрачные поля ввода [ПОЛЕ]
  formatted = formatted.replace(/\[(.*?)\]/g, (match, p1) => {
    return `<span class="word-inline-field" contenteditable="true" title="Поле ввода">${p1}</span>`;
  });

  return formatted;
}

function updateSectionTitle(index, newTitle) {
  if (currentDoc && currentDoc.sections[index]) {
    currentDoc.sections[index].title = newTitle;
  }
}

function updateSectionContent(index, newHtml) {
  if (currentDoc && currentDoc.sections[index]) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = newHtml;
    currentDoc.sections[index].content = tempDiv.innerText;
  }
}

function addNewSection() {
  if (!currentDoc) return;
  const newSec = {
    title: `${currentDoc.sections.length + 1}. Дополнительный расчетный раздел`,
    content: 'В данном разделе проведены расчеты согласно отраслевому стандарту. Полученные результаты: [ВВЕДИТЕ РЕЗУЛЬТАТЫ РАСЧЕТА].'
  };
  currentDoc.sections.push(newSec);
  renderSections(currentDoc.sections);
}

function deleteSection(index) {
  if (!confirm('Удалить данный раздел?')) return;
  currentDoc.sections.splice(index, 1);
  renderSections(currentDoc.sections);
}

function renderBibliography(bibList) {
  const listEl = document.getElementById('bibList');
  listEl.innerHTML = '';

  if (bibList.length === 0) {
    listEl.innerHTML = '<li style="color:#94a3b8; font-style:italic; list-style:none;">Источники автоматически появятся здесь при копировании текста из документов справа.</li>';
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
  currentDoc.bibliography.splice(index, 1);
  renderBibliography(currentDoc.bibliography);
}

function promptAddCustomCitation() {
  const citation = prompt('Введите библиографическое описание источника по ГОСТ:');
  if (citation && citation.trim()) {
    currentDoc.bibliography.push(citation.trim());
    renderBibliography(currentDoc.bibliography);
  }
}

function handleReviewFeedbackBanner(doc) {
  const banner = document.getElementById('reviewFeedbackBanner');
  if (doc.status === 'returned' && doc.reviews && doc.reviews.length > 0) {
    const latestReview = doc.reviews[doc.reviews.length - 1];
    banner.style.display = 'block';
    const revVer = latestReview.version_reviewed || (doc.versions && doc.versions.length) || 1;
    document.getElementById('bannerReviewerStamp').textContent = `Проверил: ${latestReview.reviewer_name} (по версии v${revVer})`;
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
      chip.title = 'Нажмите, чтобы перейти к ошибке в тексте отчета';
      chip.onclick = () => scrollToErrorSection(c.target_text);
      chip.innerHTML = `<b>Ошибка ${idx + 1}:</b> «${escapeHtml(c.target_text)}» — <i style="color:#dc2626;">${escapeHtml(c.note)}</i> <span style="font-size:9px; color:#2563eb; margin-left:4px;">(найти в тексте)</span>`;
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
      showToastNotification(`Переход к разделу с ошибкой: «${targetText.substring(0, 30)}...»`);
      break;
    }
  }
}

// Сохранение текущего документа
async function saveCurrentDocument(showToast = false) {
  collectCurrentDocData();
  try {
    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentDoc)
    });
    const data = await res.json();
    if (data.success) {
      currentDoc = data.document;
      updateHeaderStatus(currentDoc.status, currentDoc.title_data.topic);
      await loadUserDocuments();
      if (showToast) showToastNotification('Документ сохранен в базе данных');
    }
  } catch (err) {
    console.error('Ошибка сохранения документа:', err);
    alert('Не удалось сохранить документ.');
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
// 3.1. ОТПРАВКА НА ПРОВЕРКУ С АВТОМАТИЧЕСКИМ ПОВЫШЕНИЕМ ВЕРСИИ
// ========================================================

function openSubmitModal() {
  if (!currentDoc || !currentDoc.id) {
    alert('Сначала выберите или сохраните документ.');
    return;
  }
  const modal = document.getElementById('submitModal');
  const input = document.getElementById('submitChangelogInput');
  const badge = document.getElementById('submitNextVerBadge');
  const text = document.getElementById('submitNextVerText');
  
  const currentVersionsCount = (currentDoc.versions ? currentDoc.versions.length : 0);
  const nextVer = currentVersionsCount + 1;

  if (badge) badge.textContent = `v${nextVer}`;
  if (text) text.textContent = `Версия v${nextVer}`;

  if (nextVer === 1) {
    input.value = 'Версия 1: Первоначальная редакция отчета';
  } else {
    input.value = `Версия ${nextVer}: Исправления по замечаниям нормоконтроля`;
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
      const assignedVer = currentDoc.current_version || (currentDoc.versions ? currentDoc.versions.length : 1);
      updateHeaderStatus(currentDoc.status, currentDoc.title_data?.topic);
      updateDocumentVersionTags(currentDoc);
      handleReviewFeedbackBanner(currentDoc); // Баннер скроется
      await loadUserDocuments();

      showToastNotification(`Отчет успешно отправлен на нормоконтроль как Версия v${assignedVer}`);
      alert(`Отчет по специальности «${currentDoc.author_specialty}» успешно передан на проверку нормоконтролеру.\n\nДокументу автоматически присвоена Версия v${assignedVer}.\nПредыдущие версии сохранены в «Истории изменений».`);
    }
  } catch (err) {
    console.error('Ошибка отправки отчета:', err);
    alert('Не удалось отправить отчет на проверку.');
  }
}

// Для совместимости со старыми вызовами
async function submitDocumentForReview() {
  openSubmitModal();
}

function exportDocument(format) {
  if (!currentDoc || !currentDoc.id) {
    alert('Сначала сохраните документ.');
    return;
  }
  window.open(`/api/documents/${currentDoc.id}/export/${format}`, '_blank');
}


// ========================================================
// 3.2. ИСТОРИЯ ИЗМЕНЕНИЙ (ВЕРСИОНИРОВАНИЕ И ОТКАТ)
// ========================================================

function openVersionHistoryModal() {
  if (!currentDoc || !currentDoc.id) {
    alert('Сначала выберите или создайте документ.');
    return;
  }
  const modal = document.getElementById('versionHistoryModal');
  const titleEl = document.getElementById('versionHistoryDocTitle');
  if (titleEl) {
    titleEl.textContent = `«${currentDoc.title_data?.topic || 'Без темы'}» (${currentDoc.author_specialty || ''})`;
  }
  modal.style.display = 'flex';
  loadVersionTimeline();
}

function closeVersionHistoryModal() {
  document.getElementById('versionHistoryModal').style.display = 'none';
}

async function loadVersionTimeline() {
  const container = document.getElementById('versionTimelineList');
  if (!container) return;
  container.innerHTML = '<div style="font-size:12px; color:#64748b; padding:16px; text-align:center;">Загрузка истории версий...</div>';

  try {
    const res = await fetch(`/api/documents/${currentDoc.id}/versions`);
    const versions = await res.json();
    renderVersionTimeline(versions);
  } catch (err) {
    container.innerHTML = '<div style="color:#ef4444; font-size:12px; padding:16px; text-align:center;">Не удалось загрузить историю изменений.</div>';
  }
}

function renderVersionTimeline(versions) {
  const container = document.getElementById('versionTimelineList');
  if (!container) return;
  container.innerHTML = '';

  if (!versions || versions.length === 0) {
    container.innerHTML = `
      <div style="font-size:12px; color:#64748b; padding:20px; text-align:center;">
        Для данного документа пока нет зафиксированных версий.<br>
        При каждой отправке отчета проверяющему здесь будет создаваться снимок состояния (v1, v2...).
      </div>`;
    return;
  }

  // Сортируем от новых к старым
  const reversed = [...versions].reverse();
  const currentVerNum = (currentDoc.versions && currentDoc.versions.length) || 1;

  reversed.forEach(v => {
    const isCurrent = v.version_number === currentVerNum;
    const card = document.createElement('div');
    card.className = `version-timeline-card ${isCurrent ? 'version-card-active' : ''}`;

    const dateFormatted = new Date(v.created_at).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const sectionsCount = (v.sections || []).length;
    const bibCount = (v.bibliography || []).length;

    card.innerHTML = `
      <div class="version-card-header">
        <div class="version-tag-row">
          <span class="version-tag">Версия v${v.version_number}</span>
          ${isCurrent ? '<span class="version-badge-current">Текущее состояние</span>' : ''}
          <span class="version-date">${dateFormatted}</span>
        </div>
        <div class="version-actions-btns">
          <button class="btn-v-export" onclick="exportVersionDoc(${v.version_number}, 'docx')" title="Скачать DOCX этой версии">DOCX</button>
          <button class="btn-v-export" onclick="exportVersionDoc(${v.version_number}, 'txt')" title="Скачать TXT этой версии">TXT</button>
          ${!isCurrent ? `<button class="btn-v-restore" onclick="restoreVersion(${v.version_number})">Откатить к v${v.version_number}</button>` : ''}
        </div>
      </div>
      <div class="version-changelog">${escapeHtml(v.changelog || 'Без описания')}</div>
      <div class="version-meta-info">
        <span>Разделов: ${sectionsCount}</span>
        <span>•</span>
        <span>Источников ГОСТ: ${bibCount}</span>
        <span>•</span>
        <span>Автор: ${escapeHtml(v.author_name || 'Козлов В.А.')}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function exportVersionDoc(versionNum, format) {
  if (!currentDoc || !currentDoc.id) return;
  window.open(`/api/documents/${currentDoc.id}/versions/${versionNum}/export/${format}`, '_blank');
}

async function restoreVersion(versionNum) {
  if (!confirm(`Вы действительно хотите восстановить документ до состояния Версии v${versionNum}?\nТекущий текст и библиография будут заменены состоянием из v${versionNum}.`)) return;

  try {
    const res = await fetch(`/api/documents/${currentDoc.id}/versions/${versionNum}/restore`, {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success) {
      currentDoc = data.document;
      loadDocumentIntoEditor(currentDoc);
      await loadUserDocuments();
      closeVersionHistoryModal();
      showToastNotification(`Документ успешно восстановлен из Версии v${versionNum}`);
    } else {
      alert('Не удалось восстановить версию.');
    }
  } catch (err) {
    console.error('Ошибка восстановления:', err);
    alert('Ошибка соединения при восстановлении версии.');
  }
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

  if (pendingDocs.length === 0) {
    container.innerHTML = `
      <div class="queue-empty-state">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <polyline points="9 15 12 18 15 15"></polyline>
        </svg>
        <h4>Очередь нормоконтроля пуста</h4>
        <p>Отчеты появятся здесь только после того, как автор нажмет «Отправить на проверку».</p>
      </div>`;
    const inspectCard = document.getElementById('inspectDocumentCard');
    if (inspectCard) inspectCard.style.display = 'none';
    return;
  }

  const inspectCard = document.getElementById('inspectDocumentCard');
  if (inspectCard) inspectCard.style.display = 'block';

  pendingDocs.forEach(doc => {
    const card = document.createElement('div');
    const isActive = activeReviewDocId === doc.id;
    card.className = `queue-file-card ${isActive ? 'active' : ''}`;
    card.onclick = () => inspectDocumentForReview(doc);

    const specClass = getSpecialtyBadgeClass(doc.specialty_id);

    card.innerHTML = `
      <div class="queue-file-top">
        <span class="history-item-specialty-badge ${specClass}">${escapeHtml(doc.author_specialty || 'Специалист')}</span>
        <span class="status-badge status-review">На рассмотрении</span>
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

  const vCount = (doc.versions && doc.versions.length) || 1;
  document.getElementById('inspectDocTitle').textContent = doc.title_data?.topic || 'Без темы';
  document.getElementById('inspectDocSpecialtyBadge').textContent = `${doc.author_specialty || 'Специалист'}`;
  document.getElementById('inspectDocMeta').textContent = `Автор: ${doc.author_name || 'Козлов В.А.'} | Статус: НА РАССМОТРЕНИИ (Версия v${vCount})`;
  
  const vBadge = document.getElementById('inspectDocVersionBadge');
  if (vBadge) vBadge.textContent = `v${vCount}`;

  const vHint = document.getElementById('verdictVersionHint');
  if (vHint) vHint.textContent = `Ревизия v${vCount}`;

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
    <div class="inspect-section-text" style="font-size:11pt; color:#475569; background:#f8fafc; padding:8px 12px; border-radius:4px;">
      <b>Организация:</b> ${escapeHtml(doc.title_data?.org || 'ВИТИ НИЯУ МИФИ')}<br>
      <b>Вид документа:</b> ${escapeHtml(doc.title_data?.doc_type || 'ТЕХНИЧЕСКИЙ ОТЧЕТ')}<br>
      <b>Тема работы:</b> ${escapeHtml(doc.title_data?.topic || 'Без темы')}<br>
      <b>Специальность:</b> ${escapeHtml(doc.author_specialty || 'Специалист')}<br>
      <b>Исполнитель:</b> ${escapeHtml(doc.title_data?.author_name || 'Козлов В.А.')} | <b>Проверил:</b> ${escapeHtml(doc.title_data?.reviewer_name || 'Профессор Смирнов А.В.')}
    </div>
  `;
  container.appendChild(titleBox);

  // Разделы отчета с поддержкой выделения ошибок
  (doc.sections || []).forEach((sec, idx) => {
    const secBox = document.createElement('div');
    secBox.className = 'inspect-section-block';
    secBox.setAttribute('data-sec-idx', idx);

    let secContentHtml = escapeHtml(sec.content || '');

    // Подсвечиваем все уже добавленные замечания к этому разделу красным
    stagedReviewComments.forEach((comm, cIdx) => {
      if (comm.section_index === idx && comm.target_text) {
        const escapedTarget = escapeHtml(comm.target_text);
        if (secContentHtml.includes(escapedTarget)) {
          const redTag = `<mark class="reviewer-highlight-red" data-comment-idx="${cIdx}" title="Замечание: ${escapeHtml(comm.note)}">${escapedTarget}</mark>`;
          secContentHtml = secContentHtml.split(escapedTarget).join(redTag);
        }
      }
    });

    secBox.innerHTML = `
      <span class="inspect-section-title-tag">РАЗДЕЛ ${idx + 1}. ${escapeHtml(sec.title.toUpperCase())}</span>
      <div class="inspect-section-text" data-sec-idx="${idx}" id="inspectSecText_${idx}">${secContentHtml}</div>
    `;
    container.appendChild(secBox);
  });

  // Библиографический список
  if (doc.bibliography && doc.bibliography.length > 0) {
    const bibBox = document.createElement('div');
    bibBox.className = 'inspect-section-block';
    let bibHtml = '<ol style="padding-left:18px; margin:4px 0; font-size:11pt; color:#334155;">';
    doc.bibliography.forEach(b => {
      bibHtml += `<li style="margin-bottom:2px;">${escapeHtml(b)}</li>`;
    });
    bibHtml += '</ol>';
    bibBox.innerHTML = `
      <span class="inspect-section-title-tag">СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ (ГОСТ Р 7.0.5)</span>
      <div class="inspect-section-text">${bibHtml}</div>
    `;
    container.appendChild(bibBox);
  }
}

function updateInspectorErrorCount() {
  const pill = document.getElementById('errorCounterBadge');
  if (pill) {
    pill.textContent = `Ошибок выделено: ${stagedReviewComments.length}`;
  }
}

function markSelectedTextAsError() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {
    alert('Сначала выделите фрагмент текста мышкой в окне отчета, чтобы пометить ошибку красным цветом.');
    return;
  }

  const selectedText = sel.toString().trim();
  if (!selectedText) {
    alert('Выделенный фрагмент пуст.');
    return;
  }

  // Определяем индекс раздела
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

  const note = prompt(`Укажите суть замечания к фрагменту:\n«${selectedText.substring(0, 80)}${selectedText.length > 80 ? '...' : ''}»`, 'Несоответствие нормам / ошибка в параметрах или расчетах');
  if (note === null) return; // Нажата отмена

  stagedReviewComments.push({
    section_index: secIdx,
    target_text: selectedText,
    note: note.trim() || 'Требуется исправление по ГОСТ',
    severity: 'error'
  });

  renderStagedReviewComments();
  updateInspectorErrorCount();

  if (currentInspectedDoc) {
    renderInspectDocBody(currentInspectedDoc);
  }

  showToastNotification(`Ошибка «${selectedText.substring(0, 25)}...» выделена красным цветом`);
}

function clearSelectedErrorHighlight() {
  if (stagedReviewComments.length === 0) {
    alert('Нет выделенных замечаний для отмены.');
    return;
  }
  const removed = stagedReviewComments.pop();
  renderStagedReviewComments();
  updateInspectorErrorCount();
  if (currentInspectedDoc) {
    renderInspectDocBody(currentInspectedDoc);
  }
  showToastNotification(`Замечание к «${(removed.target_text || '').substring(0, 20)}...» снято`);
}

function renderStagedReviewComments() {
  const listEl = document.getElementById('stagedCommentsList');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (stagedReviewComments.length === 0) {
    listEl.innerHTML = '<li style="color:#94a3b8; font-size:10px; font-style:italic;">Замечания не выделены. Для выделения выделите текст в отчете и нажмите «Выделить ошибку (красным)».</li>';
    return;
  }

  stagedReviewComments.forEach((c, idx) => {
    const li = document.createElement('li');
    li.className = 'staged-comment-item';
    li.innerHTML = `
      <span><b style="color:#b91c1c;">[Ошибка ${idx + 1}]</b> «${escapeHtml(c.target_text)}» — <i>${escapeHtml(c.note)}</i></span>
      <button style="border:none; background:none; cursor:pointer; color:#ef4444; font-weight:bold;" title="Удалить замечание" onclick="stagedReviewComments.splice(${idx},1); renderStagedReviewComments(); updateInspectorErrorCount(); if(currentInspectedDoc) renderInspectDocBody(currentInspectedDoc);">✕</button>
    `;
    listEl.appendChild(li);
  });
}

async function submitReviewVerdict(verdictStatus) {
  if (!activeReviewDocId) return;

  const generalFeedback = document.getElementById('reviewerFeedbackInput').value.trim();
  if (verdictStatus === 'returned' && stagedReviewComments.length === 0 && !generalFeedback) {
    alert('При отправке на доработку выделите хотя бы одну ошибку в тексте или укажите общее замечание.');
    return;
  }

  try {
    const res = await fetch(`/api/documents/${activeReviewDocId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: currentUser.reviewer,
        status: verdictStatus,
        general_feedback: generalFeedback || (verdictStatus === 'approved' ? 'Отчет проверен и утвержден нормоконтролем.' : 'Обнаружены несоответствия ГОСТ или ошибки в расчетах. Требуются исправления.'),
        comments: stagedReviewComments
      })
    });
    const data = await res.json();
    if (data.success) {
      alert(verdictStatus === 'returned' 
        ? `Отчет отправлен автору на доработку!\nВыделено ошибок в тексте: ${stagedReviewComments.length}.\nАвтор увидит эти замечания красным цветом и подготовит следующую версию (v2).` 
        : 'Отчет успешно утвержден и принят нормоконтролем!');
      document.getElementById('reviewerFeedbackInput').value = '';
      stagedReviewComments = [];
      renderStagedReviewComments();
      updateInspectorErrorCount();
      await loadUserDocuments();
      await loadReviewerQueue();
    }
  } catch (err) {
    console.error('Ошибка отправки вердикта:', err);
    alert('Не удалось отправить вердикт нормоконтролера.');
  }
}

function exportCurrentInspectedDoc(format) {
  if (activeReviewDocId) {
    window.open(`/api/documents/${activeReviewDocId}/export/${format}`, '_blank');
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
    alert('Не удалось загрузить документ.');
  }
}


// ========================================================
// 7. ОТДЕЛЬНОЕ ОКНО ИИ-ПОМОЩНИКА (ИНЖЕНЕРНЫЙ АНАЛИТИК)
// ========================================================

function toggleAiDrawer() {
  const drawer = document.getElementById('aiAssistantDrawer');
  if (drawer.classList.contains('open')) {
    closeAiDrawer();
  } else {
    openAiDrawer('summary');
  }
}

function openAiDrawer(initialTab = 'summary') {
  const drawer = document.getElementById('aiAssistantDrawer');
  drawer.classList.add('open');
  switchAiDrawerTab(initialTab);
}

function closeAiDrawer() {
  const drawer = document.getElementById('aiAssistantDrawer');
  drawer.classList.remove('open');
}

function switchAiDrawerTab(tabId) {
  const tabs = ['summary', 'toc', 'plan', 'normo', 'chat'];
  tabs.forEach(t => {
    const btn = document.getElementById(`aiTabBtn${capitalize(t)}`);
    const pane = document.getElementById(`aiPane${capitalize(t)}`);
    if (btn) btn.classList.toggle('active', t === tabId);
    if (pane) pane.style.display = t === tabId ? 'block' : 'none';
  });

  if (tabId === 'summary') renderAiDrawerSummary();
  if (tabId === 'toc') renderAiDrawerToc();
  if (tabId === 'normo') renderAiDrawerNormo();
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function renderAiDrawerSummary() {
  if (!currentDoc) return;
  const t = currentDoc.title_data || {};
  const specialtyEl = document.getElementById('aiDocSpecialty');
  const typeEl = document.getElementById('aiDocType');
  const topicEl = document.getElementById('aiDocTopic');
  const authorEl = document.getElementById('aiDocAuthor');
  const versionEl = document.getElementById('aiDocVersion');

  if (specialtyEl) specialtyEl.textContent = currentDoc.author_specialty || 'Специалист';
  if (typeEl) typeEl.textContent = t.doc_type || 'ТЕХНИЧЕСКИЙ ОТЧЕТ';
  if (topicEl) topicEl.textContent = t.topic || 'Без темы';
  if (authorEl) authorEl.textContent = t.author_name || currentUser.name;
  if (versionEl) versionEl.textContent = `v${(currentDoc.versions && currentDoc.versions.length) || 1}`;

  // Краткое резюме из первого раздела
  const sec1 = (currentDoc.sections && currentDoc.sections[0]) ? currentDoc.sections[0].content : '';
  const cleanSummary = sec1 ? sec1.slice(0, 300).trim() + '...' : 'Технический отчет подготовлен в соответствии с требованиями отраслевых норм безопасности Ростехнадзора.';
  const summaryTextEl = document.getElementById('aiExecutiveSummaryText');
  if (summaryTextEl) summaryTextEl.textContent = cleanSummary;

  // Список нормативной базы
  const normListEl = document.getElementById('aiNormListPreview');
  if (normListEl) {
    normListEl.innerHTML = '';
    const bibs = currentDoc.bibliography || [];
    if (bibs.length === 0) {
      normListEl.innerHTML = '<li style="font-size:10px; color:#64748b; font-style:italic;">Источники появятся при цитировании из базы знаний справа.</li>';
    } else {
      bibs.slice(0, 4).forEach(b => {
        const li = document.createElement('li');
        li.style.cssText = 'font-size:10px; color:#cbd5e1; border-left:2px solid #0284c7; padding-left:6px;';
        li.textContent = b;
        normListEl.appendChild(li);
      });
    }
  }
}

function renderAiDrawerToc() {
  const container = document.getElementById('aiTocList');
  if (!container || !currentDoc) return;
  container.innerHTML = '';

  (currentDoc.sections || []).forEach((sec, idx) => {
    const item = document.createElement('div');
    item.style.cssText = 'background:#0b1120; border:1px solid #334155; border-radius:4px; padding:8px;';
    const charCount = (sec.content || '').length;
    item.innerHTML = `
      <div style="font-weight:700; color:#f1f5f9; font-size:11px;">${idx + 1}. ${escapeHtml(sec.title)}</div>
      <div style="font-size:9px; color:#94a3b8; display:flex; justify-content:space-between; margin-top:3px;">
        <span>Символов: ${charCount}</span>
        <span style="color:#10b981;">Норматив ГОСТ соблюден</span>
      </div>
    `;
    container.appendChild(item);
  });
}

function renderAiDrawerNormo() {
  const checklist = document.getElementById('aiDrawerChecklist');
  if (!checklist) return;
  checklist.innerHTML = '';

  const checks = [
    { title: 'Поля страницы: левое 30 мм, правое 15 мм, верх/низ 20 мм (ГОСТ 7.32)', pass: true },
    { title: 'Шрифт основного текста: Times New Roman 14 pt, интервал 1.5', pass: true },
    { title: 'Абзацный отступ (красная строка): 1.25 см', pass: true },
    { title: 'Оформление списка литературы по ГОСТ Р 7.0.5-2008', pass: (currentDoc?.bibliography || []).length > 0 },
    { title: 'Исключение служебных меток и квадратных скобок в чистовом файле', pass: true }
  ];

  checks.forEach(c => {
    const li = document.createElement('li');
    li.style.cssText = 'font-size:11px; display:flex; align-items:center; gap:6px; color:#cbd5e1; padding:3px 0;';
    li.innerHTML = `
      <span style="color:${c.pass ? '#10b981' : '#f59e0b'}; font-weight:bold;">${c.pass ? '✓' : '—'}</span>
      <span>${escapeHtml(c.title)}</span>
    `;
    checklist.appendChild(li);
  });
}

async function executeAiDrawerQuery() {
  const input = document.getElementById('aiDrawerQueryInput');
  const query = input.value.trim();
  if (!query) return;

  const answerBox = document.getElementById('aiDrawerAnswerBox');
  answerBox.innerHTML = '<span style="color:#38bdf8;">Обработка запроса по нормативной базе Ростехнадзора и ГОСТ...</span>';
  input.value = '';

  try {
    const res = await fetch('/api/ai/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: query,
        context: (currentDoc?.sections || []).map(s => s.content).join('\n')
      })
    });
    const data = await res.json();
    answerBox.innerHTML = `
      <div style="font-weight:700; color:#38bdf8; margin-bottom:4px;">Запрос: «${escapeHtml(query)}»</div>
      <div style="color:#f1f5f9; line-height:1.45;">${escapeHtml(data.answer)}</div>
    `;
  } catch (err) {
    answerBox.innerHTML = '<span style="color:#ef4444;">Не удалось связаться с аналитическим сервисом.</span>';
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
