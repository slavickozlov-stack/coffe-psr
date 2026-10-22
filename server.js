const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  PageBreak,
  convertMillimetersToTwip
} = require('docx');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json({ limit: '10mb' }));
app.use('/static', express.static(path.join(__dirname, 'static')));

const DATA_DIR = path.join(__dirname, 'data');
const DOCS_FILE = path.join(DATA_DIR, 'documents.json');
const NORM_DOCS_FILE = path.join(DATA_DIR, 'norm_docs.json');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const DEFAULT_SPECIALTIES = [
  {
    id: 'npp',
    name: 'Работники АЭС',
    icon: '⚛️',
    description: 'Эксплуатация ВВЭР-1200, РЗА, радиационная безопасность и регламенты атомных станций',
    templates: ['npp_report_1']
  },
  {
    id: 'electrician',
    name: 'Электрик',
    icon: '⚡',
    description: 'Электромонтаж, обслуживание подстанций, наряды-допуски, испытания изоляции и ПУЭ-7',
    templates: ['electric_tech_report']
  },
  {
    id: 'welder',
    name: 'Сварщик',
    icon: '👨‍🏭',
    description: 'Сварочные технологии, ручная дуговая сварка, контроль качества швов (ВИК/УЗК) по ГОСТ 5264-80',
    templates: ['welding_card_report']
  },
  {
    id: 'accountant',
    name: 'Бухгалтер',
    icon: '📊',
    description: 'Первичный учет по 402-ФЗ, акты инвентаризации, сличительные ведомости и стандарты ФСБУ',
    templates: ['accounting_report']
  }
];

function readJson(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// --- ГОСТ Экспорт (.docx и .txt) ---

function cleanGostText(text) {
  if (!text) return '';
  let cleaned = String(text).replace(/\[(.*?)\]/g, (_, rawGroup) => {
    const raw = rawGroup.trim();
    const upper = raw.toUpperCase();
    if (upper.startsWith('ВВЕДИТЕ ') || upper.startsWith('УКАЖИТЕ ')) {
      const stripped = raw.replace(/^(ВВЕДИТЕ|УКАЖИТЕ)\s+/i, '').trim();
      return stripped || '—';
    }
    return raw;
  });
  cleaned = cleaned.replace(/\s+([,.:;!?])/g, '$1');
  cleaned = cleaned.replace(/[ \t]+/g, ' ');
  return cleaned.trim();
}

function createGostParagraph({
  text = '',
  alignment = AlignmentType.JUSTIFIED,
  bold = false,
  italics = false,
  fontSizePt = 14,
  spaceBeforePt = 0,
  spaceAfterPt = 0,
  indentCm = 1.25,
  pageBreakBefore = false
}) {
  return new Paragraph({
    alignment,
    pageBreakBefore,
    spacing: {
      line: 360, // 1.5 межстрочный интервал (240 * 1.5)
      before: spaceBeforePt * 20,
      after: spaceAfterPt * 20
    },
    indent: indentCm > 0 ? { firstLine: convertMillimetersToTwip(indentCm * 10) } : undefined,
    children: text
      ? [
          new TextRun({
            text,
            font: 'Times New Roman',
            size: fontSizePt * 2, // half-points
            bold,
            italics
          })
        ]
      : []
  });
}

async function buildGostDocx(docData) {
  const title = docData.title_data || {};
  const org = title.org || 'МИНИСТЕРСТВО НАУКИ И ВЫСШЕГО ОБРАЗОВАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ\nВИТИ НИЯУ МИФИ';
  const docType = (title.doc_type || 'ОТЧЕТ О ВЫПОЛНЕНИИ РАБОТЫ').toUpperCase();
  const topic = title.topic || 'Без темы';
  const authorName = title.author_name || 'Козлов В.А.';
  const specialty = title.author_specialty || 'Специалист';
  const reviewerName = title.reviewer_name || 'Профессор Смирнов А.В.';
  const city = title.city || 'Волгодонск';
  const year = String(title.year || new Date().getFullYear());

  const children = [];

  // Титульный лист
  for (const line of org.split('\n')) {
    children.push(
      createGostParagraph({
        text: line.trim(),
        alignment: AlignmentType.CENTER,
        bold: true,
        fontSizePt: 12,
        indentCm: 0
      })
    );
  }

  for (let i = 0; i < 4; i++) {
    children.push(createGostParagraph({ text: '', indentCm: 0 }));
  }

  children.push(
    createGostParagraph({
      text: docType,
      alignment: AlignmentType.CENTER,
      bold: true,
      fontSizePt: 16,
      indentCm: 0
    })
  );
  children.push(
    createGostParagraph({
      text: `по специальности: «${specialty}»`,
      alignment: AlignmentType.CENTER,
      bold: false,
      fontSizePt: 14,
      indentCm: 0
    })
  );
  children.push(createGostParagraph({ text: '', indentCm: 0 }));
  children.push(
    createGostParagraph({
      text: `Тема: «${topic}»`,
      alignment: AlignmentType.CENTER,
      bold: true,
      fontSizePt: 14,
      indentCm: 0
    })
  );

  for (let i = 0; i < 5; i++) {
    children.push(createGostParagraph({ text: '', indentCm: 0 }));
  }

  children.push(
    createGostParagraph({
      text: `Выполнил: ${specialty}`,
      alignment: AlignmentType.RIGHT,
      fontSizePt: 13,
      indentCm: 0
    })
  );
  children.push(
    createGostParagraph({
      text: authorName,
      alignment: AlignmentType.RIGHT,
      bold: true,
      fontSizePt: 13,
      indentCm: 0
    })
  );
  children.push(createGostParagraph({ text: '', indentCm: 0 }));
  children.push(
    createGostParagraph({
      text: 'Проверил (Руководитель / Эксперт):',
      alignment: AlignmentType.RIGHT,
      fontSizePt: 13,
      indentCm: 0
    })
  );
  children.push(
    createGostParagraph({
      text: reviewerName,
      alignment: AlignmentType.RIGHT,
      bold: true,
      fontSizePt: 13,
      indentCm: 0
    })
  );

  for (let i = 0; i < 4; i++) {
    children.push(createGostParagraph({ text: '', indentCm: 0 }));
  }

  children.push(
    createGostParagraph({
      text: `${city}, ${year}`,
      alignment: AlignmentType.CENTER,
      fontSizePt: 14,
      indentCm: 0
    })
  );

  // Основные разделы
  const sections = docData.sections || [];
  sections.forEach((sec, idx) => {
    const secTitle = sec.title || `Раздел ${idx + 1}`;
    children.push(
      createGostParagraph({
        text: `${idx + 1}. ${secTitle.toUpperCase()}`,
        alignment: AlignmentType.CENTER,
        bold: true,
        fontSizePt: 14,
        spaceBeforePt: 12,
        spaceAfterPt: 6,
        indentCm: 0,
        pageBreakBefore: idx === 0
      })
    );

    const content = sec.content || '';
    for (const para of content.split('\n')) {
      const paraClean = cleanGostText(para);
      if (paraClean) {
        children.push(
          createGostParagraph({
            text: paraClean,
            alignment: AlignmentType.JUSTIFIED,
            fontSizePt: 14,
            indentCm: 1.25
          })
        );
      } else {
        children.push(createGostParagraph({ text: '', indentCm: 0 }));
      }
    }
  });

  // Библиография
  children.push(
    createGostParagraph({
      text: 'СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ',
      alignment: AlignmentType.CENTER,
      bold: true,
      fontSizePt: 14,
      spaceBeforePt: 12,
      spaceAfterPt: 12,
      indentCm: 0,
      pageBreakBefore: true
    })
  );

  const bibliography = docData.bibliography || [];
  if (bibliography.length === 0) {
    children.push(
      createGostParagraph({
        text: 'Источники не указаны.',
        alignment: AlignmentType.JUSTIFIED,
        italics: true,
        fontSizePt: 14,
        indentCm: 1.25
      })
    );
  } else {
    bibliography.forEach((item, bIdx) => {
      children.push(
        createGostParagraph({
          text: `${bIdx + 1}. ${item}`,
          alignment: AlignmentType.JUSTIFIED,
          fontSizePt: 14,
          indentCm: 1.25
        })
      );
    });
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(20),
              bottom: convertMillimetersToTwip(20),
              left: convertMillimetersToTwip(30),
              right: convertMillimetersToTwip(15)
            }
          }
        },
        children
      }
    ]
  });

  return Packer.toBuffer(doc);
}

function buildGostTxt(docData) {
  const title = docData.title_data || {};
  const org = title.org || 'ВИТИ НИЯУ МИФИ';
  const docType = (title.doc_type || 'ОТЧЕТ О ВЫПОЛНЕНИИ РАБОТЫ').toUpperCase();
  const topic = title.topic || 'Без темы';
  const authorName = title.author_name || 'Козлов В.А.';
  const specialty = title.author_specialty || 'Специалист';
  const reviewerName = title.reviewer_name || 'Профессор Смирнов А.В.';
  const city = title.city || 'Волгодонск';
  const year = String(title.year || new Date().getFullYear());

  const lines = [];
  lines.push('='.repeat(80));
  lines.push(org);
  lines.push('\n');
  lines.push(docType);
  lines.push(`по специальности: «${specialty}»`);
  lines.push(`Тема: «${topic}»`);
  lines.push('\n\n');
  lines.push(`    Выполнил: ${specialty} ${authorName}`);
  lines.push(`    Проверил: ${reviewerName}`);
  lines.push('\n');
  lines.push(`${city}, ${year}`);
  lines.push('='.repeat(80));
  lines.push('\n');

  const sections = docData.sections || [];
  sections.forEach((sec, idx) => {
    lines.push(`${idx + 1}. ${(sec.title || '').toUpperCase()}`);
    lines.push('-'.repeat(40));
    const content = sec.content || '';
    for (const p of content.split('\n')) {
      const pClean = cleanGostText(p);
      if (pClean) {
        lines.push(`    ${pClean}`);
      } else {
        lines.push('');
      }
    }
    lines.push('');
  });

  lines.push('СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ');
  lines.push('-'.repeat(40));
  const bibliography = docData.bibliography || [];
  if (bibliography.length > 0) {
    bibliography.forEach((b, bIdx) => {
      lines.push(`    ${bIdx + 1}. ${b}`);
    });
  } else {
    lines.push('    (Источники не добавлены)');
  }

  return lines.join('\n');
}

// --- ИИ-сервис (Анализ документов и нормоконтроль) ---

function summarizeDocument(title = '', code = '', content = '') {
  const paragraphs = String(content)
    .split('\n')
    .map(p => p.trim())
    .filter(Boolean);

  const keyClauses = paragraphs.filter(
    p =>
      /^\d+(\.\d+)*/.test(p) ||
      p.toLowerCase().includes('должен') ||
      p.toLowerCase().includes('требован') ||
      p.toLowerCase().includes('безопасн')
  );

  const summaryBullets = keyClauses.length > 0 ? keyClauses.slice(0, 4) : paragraphs.slice(0, 3);

  return {
    title,
    code,
    overview: `Документ ${code} (${title}) регламентирует ключевые правила и стандарты в соответствующей отрасли.`,
    key_requirements: summaryBullets,
    recommended_use:
      'Рекомендуется цитировать при обосновании технологических параметров, мер безопасности и оформления расчетной части.',
    total_words: String(content).split(/\s+/).filter(Boolean).length
  };
}

function askAiAboutDocument(docTitle = 'Нормативная база', docContent = '', question = '') {
  const qLower = String(question).toLowerCase().trim();
  const words = (qLower.match(/[a-zA-Zа-яА-ЯёЁ0-9]+/g) || []).filter(w => w.length > 3);

  const matchedSentences = [];
  for (const line of String(docContent).split('\n')) {
    const lineStr = line.trim();
    if (!lineStr) continue;
    const lineLower = lineStr.toLowerCase();
    const matchCount = words.reduce((acc, w) => acc + (lineLower.includes(w) ? 1 : 0), 0);
    if (matchCount > 0) {
      matchedSentences.push({ matchCount, lineStr });
    }
  }

  if (matchedSentences.length > 0) {
    matchedSentences.sort((a, b) => b.matchCount - a.matchCount);
    const topMatches = matchedSentences.slice(0, 3).map(m => `• ${m.lineStr}`);
    return 'На основе анализа документа:\n' + topMatches.join('\n');
  }

  return (
    `В документе «${docTitle}» содержатся общие нормативные положения. ` +
    `По вашему запросу «${question}» рекомендуется обратить внимание на разделы общих требований и регламентов безопасности.`
  );
}

function checkGostCompliance(docData = {}) {
  const issues = [];
  const warnings = [];
  const titleData = docData.title_data || {};

  if (!titleData.topic || titleData.topic === 'Без темы') {
    issues.push('Не указана тема работы на титульном листе.');
  }
  if (!titleData.author_name) {
    issues.push('Не указано ФИО автора работы.');
  }
  if (!titleData.reviewer_name) {
    warnings.push('Не указано ФИО руководителя/проверяющего.');
  }

  const sections = docData.sections || [];
  if (sections.length === 0) {
    issues.push('В документе отсутствуют разделы с содержанием.');
  }

  let placeholderCount = 0;
  sections.forEach((sec, idx) => {
    const content = sec.content || '';
    const matches = content.match(/\[.*?\]/g) || [];
    if (matches.length > 0) {
      placeholderCount += matches.length;
      issues.push(
        `В разделе ${idx + 1} («${sec.title}») обнаружены незаполненные поля: ${matches.slice(0, 2).join(', ')}...`
      );
    }
  });

  const bib = docData.bibliography || [];
  if (bib.length === 0) {
    issues.push('Список использованных источников пуст. По ГОСТ работа должна содержать ссылки на нормативные акты.');
  }

  const score = Math.max(0, 100 - (issues.length * 20 + warnings.length * 10));

  return {
    score,
    status: issues.length === 0 ? 'PASS' : score >= 60 ? 'WARN' : 'FAIL',
    issues,
    warnings,
    placeholder_count: placeholderCount,
    sections_count: sections.length,
    bib_count: bib.length
  };
}

// --- Маршруты HTML и API ---

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

app.get('/api/specialties', (req, res) => {
  res.json(DEFAULT_SPECIALTIES);
});

app.get('/api/templates', (req, res) => {
  const specialtyId = req.query.specialty_id;
  const templates = readJson(TEMPLATES_FILE, []);
  if (specialtyId) {
    return res.json(templates.filter(t => t.specialty_id === specialtyId));
  }
  res.json(templates);
});

app.get('/api/norm-docs', (req, res) => {
  const category = req.query.category;
  const docs = readJson(NORM_DOCS_FILE, []);
  if (!category || category === 'Все') {
    return res.json(docs);
  }
  const filtered = docs.filter(d => {
    const cats = d.categories || (d.category ? [d.category] : []);
    return cats.includes(category) || cats.includes('Общий') || cats.includes('all');
  });
  res.json(filtered);
});

app.post('/api/norm-docs/upload', upload.single('file'), (req, res) => {
  try {
    const { title, code, category } = req.body;
    const fileBuffer = req.file ? req.file.buffer : Buffer.from('');
    let contentText = fileBuffer.toString('utf-8');
    if (contentText.includes('\ufffd')) {
      const decoder = new TextDecoder('windows-1251');
      contentText = decoder.decode(fileBuffer);
    }

    const docs = readJson(NORM_DOCS_FILE, []);
    const docId = `norm-${crypto.randomUUID().slice(0, 8)}`;
    const bibCitation = `${title}. ${code}. – М.: Нормативный сборник, 2024. – 45 с.`;
    const summary = contentText.length > 200 ? contentText.slice(0, 200) + '...' : contentText;

    const newDoc = {
      id: docId,
      title,
      code,
      categories: [category],
      category,
      summary,
      content: contentText,
      bib_citation: bibCitation
    };

    docs.push(newDoc);
    writeJson(NORM_DOCS_FILE, docs);
    res.json({ success: true, document: newDoc });
  } catch (err) {
    res.status(400).json({ detail: `Ошибка загрузки файла: ${err.message}` });
  }
});

app.get('/api/documents', (req, res) => {
  const { user_id, status } = req.query;
  let docs = readJson(DOCS_FILE, []);
  if (user_id) {
    docs = docs.filter(d => d.author_id === user_id);
  }
  if (status) {
    docs = docs.filter(d => d.status === status);
  }
  res.json(docs);
});

app.get('/api/documents/:doc_id', (req, res) => {
  const docs = readJson(DOCS_FILE, []);
  const doc = docs.find(d => d.id === req.params.doc_id);
  if (!doc) {
    return res.status(404).json({ detail: 'Документ не найден' });
  }
  res.json(doc);
});

function saveDocumentToDb(docData) {
  const docs = readJson(DOCS_FILE, []);
  let docId = docData.id;
  const now = new Date().toISOString();

  if (!docId) {
    docId = `doc-${crypto.randomUUID().slice(0, 8)}`;
    docData.id = docId;
    docData.created_at = now;
  }

  const existingIdx = docs.findIndex(d => d.id === docId);
  if (existingIdx !== -1) {
    const existing = docs[existingIdx];
    docData = {
      ...existing,
      ...docData,
      versions: docData.versions !== undefined ? docData.versions : existing.versions || [],
      reviews: docData.reviews !== undefined ? docData.reviews : existing.reviews || [],
      active_review_comments:
        docData.active_review_comments !== undefined
          ? docData.active_review_comments
          : existing.active_review_comments || [],
      current_version:
        docData.current_version !== undefined ? docData.current_version : existing.current_version || 1,
      updated_at: now
    };
    docs[existingIdx] = docData;
  } else {
    docData.created_at = docData.created_at || now;
    docData.updated_at = now;
    docData.versions = docData.versions || [];
    docData.reviews = docData.reviews || [];
    docData.active_review_comments = docData.active_review_comments || [];
    docs.unshift(docData);
  }

  writeJson(DOCS_FILE, docs);
  return docData;
}

app.post('/api/documents', (req, res) => {
  const saved = saveDocumentToDb(req.body || {});
  res.json({ success: true, document: saved });
});

app.post('/api/documents/:doc_id/submit', (req, res) => {
  const docs = readJson(DOCS_FILE, []);
  const doc = docs.find(d => d.id === req.params.doc_id);
  if (!doc) {
    return res.status(404).json({ detail: 'Документ не найден' });
  }

  doc.status = 'review';
  if (!Array.isArray(doc.versions)) {
    doc.versions = [];
  }

  const vNum = doc.versions.length + 1;
  doc.current_version = vNum;

  let changelog = (req.body && req.body.changelog) || '';
  if (!changelog) {
    changelog =
      vNum === 1
        ? 'Версия 1: Первоначальная отправка на нормоконтроль'
        : `Версия ${vNum}: Исправления по замечаниям нормоконтроля`;
  }

  const snapshot = {
    version_number: vNum,
    created_at: new Date().toISOString(),
    changelog,
    title_data: JSON.parse(JSON.stringify(doc.title_data || {})),
    sections: JSON.parse(JSON.stringify(doc.sections || [])),
    bibliography: [...(doc.bibliography || [])],
    author_name: doc.author_name || 'Козлов В.А.',
    author_specialty: doc.author_specialty || 'Специалист'
  };

  doc.versions.push(snapshot);
  doc.active_review_comments = [];

  const saved = saveDocumentToDb(doc);
  res.json({
    success: true,
    message: 'Документ успешно отправлен на проверку',
    document: saved
  });
});

function getVersionsForDoc(docId) {
  const docs = readJson(DOCS_FILE, []);
  const doc = docs.find(d => d.id === docId);
  if (!doc) return null;

  let versions = doc.versions || [];
  if (versions.length === 0 && doc.status === 'review') {
    const v1 = {
      version_number: 1,
      created_at: doc.created_at || new Date().toISOString(),
      changelog: 'Версия 1: Первоначальная отправка на нормоконтроль',
      title_data: doc.title_data || {},
      sections: doc.sections || [],
      bibliography: doc.bibliography || [],
      author_name: doc.author_name || 'Козлов В.А.',
      author_specialty: doc.author_specialty || 'Специалист'
    };
    doc.versions = [v1];
    doc.current_version = 1;
    saveDocumentToDb(doc);
    return [v1];
  }
  return versions;
}

app.get('/api/documents/:doc_id/versions', (req, res) => {
  const versions = getVersionsForDoc(req.params.doc_id);
  res.json(versions || []);
});

app.get('/api/documents/:doc_id/versions/:version_number', (req, res) => {
  const versions = getVersionsForDoc(req.params.doc_id) || [];
  const vNum = parseInt(req.params.version_number, 10);
  const v = versions.find(item => item.version_number === vNum);
  if (!v) {
    return res.status(404).json({ detail: 'Версия не найдена' });
  }
  res.json(v);
});

app.post('/api/documents/:doc_id/versions/:version_number/restore', (req, res) => {
  const docs = readJson(DOCS_FILE, []);
  const doc = docs.find(d => d.id === req.params.doc_id);
  if (!doc) {
    return res.status(404).json({ detail: 'Документ не найден' });
  }

  const versions = getVersionsForDoc(req.params.doc_id) || [];
  const vNum = parseInt(req.params.version_number, 10);
  const targetV = versions.find(item => item.version_number === vNum);
  if (!targetV) {
    return res.status(404).json({ detail: 'Не удалось восстановить версию' });
  }

  doc.title_data = JSON.parse(JSON.stringify(targetV.title_data || {}));
  doc.sections = JSON.parse(JSON.stringify(targetV.sections || []));
  doc.bibliography = [...(targetV.bibliography || [])];
  doc.status = 'draft';
  doc.active_review_comments = [];

  const newVNum = (doc.versions ? doc.versions.length : 0) + 1;
  doc.current_version = newVNum;
  if (!Array.isArray(doc.versions)) doc.versions = [];
  doc.versions.push({
    version_number: newVNum,
    created_at: new Date().toISOString(),
    changelog: `Восстановлено из Версии ${vNum}`,
    title_data: JSON.parse(JSON.stringify(doc.title_data)),
    sections: JSON.parse(JSON.stringify(doc.sections)),
    bibliography: [...doc.bibliography],
    author_name: doc.author_name || 'Козлов В.А.',
    author_specialty: doc.author_specialty || 'Специалист'
  });

  const saved = saveDocumentToDb(doc);
  res.json({
    success: true,
    message: `Документ восстановлен из версии ${vNum}`,
    document: saved
  });
});

app.get('/api/documents/:doc_id/versions/:version_number/export/:format', async (req, res) => {
  const { doc_id, version_number, format } = req.params;
  const versions = getVersionsForDoc(doc_id) || [];
  const vNum = parseInt(version_number, 10);
  const v = versions.find(item => item.version_number === vNum);
  if (!v) {
    return res.status(404).json({ detail: 'Версия не найдена' });
  }

  const mockDoc = {
    id: `${doc_id}_v${vNum}`,
    title_data: v.title_data || {},
    sections: v.sections || [],
    bibliography: v.bibliography || []
  };

  if (format === 'docx') {
    const buffer = await buildGostDocx(mockDoc);
    const filename = encodeURIComponent(`${doc_id}_v${vNum}.docx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    return res.send(buffer);
  } else {
    const txt = buildGostTxt(mockDoc);
    const filename = encodeURIComponent(`${doc_id}_v${vNum}.txt`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    return res.send(Buffer.from(txt, 'utf-8'));
  }
});

app.post('/api/documents/:doc_id/review', (req, res) => {
  const docs = readJson(DOCS_FILE, []);
  const doc = docs.find(d => d.id === req.params.doc_id);
  if (!doc) {
    return res.status(404).json({ detail: 'Документ не найден' });
  }

  const { reviewer_name, status, general_feedback, comments = [] } = req.body || {};
  doc.status = status;
  const currentV = doc.current_version || (doc.versions && doc.versions.length) || 1;

  const reviewEntry = {
    id: `rev-${crypto.randomUUID().slice(0, 8)}`,
    reviewer_name: reviewer_name || 'Профессор Смирнов А.В.',
    status,
    date: new Date().toISOString(),
    general_feedback: general_feedback || '',
    comments,
    version_reviewed: currentV
  };

  if (!Array.isArray(doc.reviews)) doc.reviews = [];
  doc.reviews.push(reviewEntry);

  if (status === 'returned') {
    doc.active_review_comments = comments;
  }

  const updatedDoc = saveDocumentToDb(doc);
  res.json({ success: true, document: updatedDoc });
});

app.post('/api/ai/summarize', (req, res) => {
  const { title = '', code = '', content = '' } = req.body || {};
  res.json(summarizeDocument(title, code, content));
});

app.post('/api/ai/ask', (req, res) => {
  const { doc_title = 'Нормативная база', doc_content = '', context = '', question = '' } = req.body || {};
  const effectiveContent = doc_content || context || '';
  const answer = askAiAboutDocument(doc_title, effectiveContent, question);
  res.json({ answer });
});

app.post('/api/ai/check-gost', (req, res) => {
  const result = checkGostCompliance(req.body || {});
  res.json(result);
});

app.get('/api/documents/:doc_id/export/docx', async (req, res) => {
  const docs = readJson(DOCS_FILE, []);
  const doc = docs.find(d => d.id === req.params.doc_id);
  if (!doc) {
    return res.status(404).json({ detail: 'Документ не найден' });
  }

  const buffer = await buildGostDocx(doc);
  const filename = encodeURIComponent(`report_${doc.id || 'gost'}.docx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
  res.send(buffer);
});

app.get('/api/documents/:doc_id/export/txt', (req, res) => {
  const docs = readJson(DOCS_FILE, []);
  const doc = docs.find(d => d.id === req.params.doc_id);
  if (!doc) {
    return res.status(404).json({ detail: 'Документ не найден' });
  }

  const txtContent = buildGostTxt(doc);
  const filename = encodeURIComponent(`report_${doc.id || 'gost'}.txt`);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
  res.send(Buffer.from(txtContent, 'utf-8'));
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ГОСТ-Документ сервер запущен на http://0.0.0.0:${PORT}`);
});
