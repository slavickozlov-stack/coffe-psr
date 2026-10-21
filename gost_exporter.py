"""
Модуль экспорта документов по стандартам ГОСТ (ГОСТ 7.32-2017, ГОСТ 2.105-2019, ГОСТ Р 7.0.5-2008).
Формирует файлы .docx и .txt со строгим соблюдением:
- Поля: левое 30 мм, правое 15 мм, верхнее 20 мм, нижнее 20 мм
- Шрифт: Times New Roman, 14 pt
- Межстрочный интервал: 1.5
- Абзацный отступ (красная строка): 1.25 см
- Выравнивание основного текста: по ширине
- Титульный лист, нумерация, список источников
"""

import io
import re
from datetime import datetime
from docx import Document
from docx.shared import Inches, Pt, Mm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


def clean_gost_text(text: str) -> str:
    """
    Очищает введенный пользователем текст от квадратных скобок и служебных меток полей:
    - [ВВЕДИТЕ ДАВЛЕНИЕ, МПа] -> если не заполнено, заменяется на нормативный прочерк '—' или наименование параметра без слова ВВЕДИТЕ
    - [16.2 МПа] или [2026] -> переводит в чистый стандартный текст: '16.2 МПа'
    - Устраняет случайные двойные пробелы перед пунктуацией
    """
    if not text:
        return ""

    def replace_bracket(match):
        raw = match.group(1).strip()
        upper_raw = raw.upper()
        if upper_raw.startswith("ВВЕДИТЕ ") or upper_raw.startswith("УКАЖИТЕ "):
            cleaned = re.sub(r'^(ВВЕДИТЕ|УКАЖИТЕ)\s+', '', raw, flags=re.IGNORECASE).strip()
            return cleaned if cleaned else "—"
        return raw

    cleaned_text = re.sub(r'\[(.*?)\]', replace_bracket, text)
    cleaned_text = re.sub(r'\s+([,.:;!?])', r'\1', cleaned_text)
    cleaned_text = re.sub(r'[ \t]+', ' ', cleaned_text)
    return cleaned_text.strip()


def apply_gost_section_margins(section):
    """Устанавливает поля страницы по ГОСТ: левое 30мм, правое 15мм, верхнее 20мм, нижнее 20мм."""
    section.top_margin = Mm(20)
    section.bottom_margin = Mm(20)
    section.left_margin = Mm(30)
    section.right_margin = Mm(15)


def add_gost_paragraph(doc, text="", align=WD_ALIGN_PARAGRAPH.JUSTIFY, bold=False, italic=False, font_size=14, space_after=0, space_before=0, indent=1.25):
    """Добавляет абзац с ГОСТ-параметрами: Times New Roman, 1.5 интервал, отступ 1.25 см."""
    p = doc.add_paragraph()
    p.alignment = align
    p_format = p.paragraph_format
    p_format.line_spacing = 1.5
    p_format.space_after = Pt(space_after)
    p_format.space_before = Pt(space_before)
    if indent > 0:
        p_format.first_line_indent = Mm(indent * 10)  # 1.25 см = 12.5 мм
    else:
        p_format.first_line_indent = Mm(0)

    if text:
        run = p.add_run(text)
        run.font.name = 'Times New Roman'
        run.font.size = Pt(font_size)
        run.bold = bold
        run.italic = italic
        # Принудительно задаем восточно-европейский / кириллический шрифт в XML
        rPr = run._r.get_or_add_rPr()
        rFonts = OxmlElement('w:rFonts')
        rFonts.set(qn('w:ascii'), 'Times New Roman')
        rFonts.set(qn('w:hAnsi'), 'Times New Roman')
        rFonts.set(qn('w:cs'), 'Times New Roman')
        rFonts.set(qn('w:eastAsia'), 'Times New Roman')
        rPr.append(rFonts)

    return p


def build_gost_docx(doc_data: dict) -> io.BytesIO:
    """
    Генерирует бинарный поток .docx документа по стандарту ГОСТ.
    doc_data содержит:
      - title_data: org, faculty, doc_type, topic, author_name, author_specialty, reviewer_name, city, year
      - sections: list of {title: str, content: str}
      - bibliography: list of str (названия и реквизиты источников)
    """
    doc = Document()
    section = doc.sections[0]
    apply_gost_section_margins(section)

    title = doc_data.get("title_data", {})
    org = title.get("org", "МИНИСТЕРСТВО НАУКИ И ВЫСШЕГО ОБРАЗОВАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ\nВИТИ НИЯУ МИФИ")
    doc_type = title.get("doc_type", "ОТЧЕТ О ВЫПОЛНЕНИИ РАБОТЫ").upper()
    topic = title.get("topic", "Без темы")
    author_name = title.get("author_name", "Иванов И.И.")
    specialty = title.get("author_specialty", "Специалист")
    reviewer_name = title.get("reviewer_name", "Петров П.П.")
    city = title.get("city", "Волгодонск")
    year = str(title.get("year", datetime.now().year))

    # --- ТИТУЛЬНЫЙ ЛИСТ ---
    # Шапка организации
    for line in org.split("\n"):
        add_gost_paragraph(doc, line.strip(), align=WD_ALIGN_PARAGRAPH.CENTER, bold=True, font_size=12, indent=0)
    
    # Отступ
    for _ in range(4):
        add_gost_paragraph(doc, "", indent=0)

    # Тип документа и Тема
    add_gost_paragraph(doc, doc_type, align=WD_ALIGN_PARAGRAPH.CENTER, bold=True, font_size=16, indent=0)
    add_gost_paragraph(doc, f"по специальности: «{specialty}»", align=WD_ALIGN_PARAGRAPH.CENTER, bold=False, font_size=14, indent=0)
    add_gost_paragraph(doc, "", indent=0)
    add_gost_paragraph(doc, f"Тема: «{topic}»", align=WD_ALIGN_PARAGRAPH.CENTER, bold=True, font_size=14, indent=0)

    # Отступ перед блоком исполнителей
    for _ in range(5):
        add_gost_paragraph(doc, "", indent=0)

    # Блок автора и проверяющего (выравнивание справа)
    add_gost_paragraph(doc, f"Выполнил: {specialty}", align=WD_ALIGN_PARAGRAPH.RIGHT, font_size=13, indent=0)
    add_gost_paragraph(doc, f"{author_name}", align=WD_ALIGN_PARAGRAPH.RIGHT, bold=True, font_size=13, indent=0)
    add_gost_paragraph(doc, "", indent=0)
    add_gost_paragraph(doc, "Проверил (Руководитель / Эксперт):", align=WD_ALIGN_PARAGRAPH.RIGHT, font_size=13, indent=0)
    add_gost_paragraph(doc, f"{reviewer_name}", align=WD_ALIGN_PARAGRAPH.RIGHT, bold=True, font_size=13, indent=0)

    # Отступ до низа
    for _ in range(4):
        add_gost_paragraph(doc, "", indent=0)

    # Город и год внизу
    add_gost_paragraph(doc, f"{city}, {year}", align=WD_ALIGN_PARAGRAPH.CENTER, font_size=14, indent=0)

    # Разрыв страницы после титульного листа
    doc.add_page_break()

    # --- ОСНОВНЫЕ РАЗДЕЛЫ ---
    sections = doc_data.get("sections", [])
    for idx, sec in enumerate(sections, 1):
        sec_title = sec.get("title", f"Раздел {idx}")
        # Заголовок раздела (по центру или влево с абзаца, ГОСТ допускает по центру полужирным)
        add_gost_paragraph(doc, f"{idx}. {sec_title.upper()}", align=WD_ALIGN_PARAGRAPH.CENTER, bold=True, font_size=14, space_before=12, space_after=6, indent=0)
        
        content = sec.get("content", "")
        for para in content.split("\n"):
            para_clean = clean_gost_text(para)
            if para_clean:
                add_gost_paragraph(doc, para_clean, align=WD_ALIGN_PARAGRAPH.JUSTIFY, font_size=14, indent=1.25)
            else:
                add_gost_paragraph(doc, "", indent=0)

    # --- БИБЛИОГРАФИЯ (СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ) ---
    doc.add_page_break()
    add_gost_paragraph(doc, "СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ", align=WD_ALIGN_PARAGRAPH.CENTER, bold=True, font_size=14, space_before=12, space_after=12, indent=0)
    
    bibliography = doc_data.get("bibliography", [])
    if not bibliography:
        add_gost_paragraph(doc, "Источники не указаны.", align=WD_ALIGN_PARAGRAPH.JUSTIFY, font_size=14, italic=True, indent=1.25)
    else:
        for b_idx, item in enumerate(bibliography, 1):
            add_gost_paragraph(doc, f"{b_idx}. {item}", align=WD_ALIGN_PARAGRAPH.JUSTIFY, font_size=14, indent=1.25)

    stream = io.BytesIO()
    doc.save(stream)
    stream.seek(0)
    return stream


def build_gost_txt(doc_data: dict) -> str:
    """Генерирует текстовое представление документа в соответствии со структурой ГОСТ."""
    title = doc_data.get("title_data", {})
    org = title.get("org", "ВИТИ НИЯУ МИФИ")
    doc_type = title.get("doc_type", "ОТЧЕТ О ВЫПОЛНЕНИИ РАБОТЫ").upper()
    topic = title.get("topic", "Без темы")
    author_name = title.get("author_name", "Иванов И.И.")
    specialty = title.get("author_specialty", "Специалист")
    reviewer_name = title.get("reviewer_name", "Петров П.П.")
    city = title.get("city", "Волгодонск")
    year = str(title.get("year", datetime.now().year))

    lines = []
    lines.append("=" * 80)
    lines.append(f"{org.center(80)}")
    lines.append("\n" * 2)
    lines.append(f"{doc_type.center(80)}")
    lines.append(f"по специальности: «{specialty}»".center(80))
    lines.append(f"Тема: «{topic}»".center(80))
    lines.append("\n" * 3)
    lines.append(f"    Выполнил: {specialty} {author_name}".rjust(78))
    lines.append(f"    Проверил: {reviewer_name}".rjust(78))
    lines.append("\n" * 2)
    lines.append(f"{city}, {year}".center(80))
    lines.append("=" * 80)
    lines.append("\n\n")

    sections = doc_data.get("sections", [])
    for idx, sec in enumerate(sections, 1):
        lines.append(f"{idx}. {sec.get('title', '').upper()}")
        lines.append("-" * 40)
        content = sec.get("content", "")
        for p in content.split("\n"):
            p_clean = clean_gost_text(p)
            if p_clean:
                lines.append(f"    {p_clean}")
            else:
                lines.append("")
        lines.append("\n")

    lines.append("СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ")
    lines.append("-" * 40)
    bibliography = doc_data.get("bibliography", [])
    if bibliography:
        for b_idx, b in enumerate(bibliography, 1):
            lines.append(f"    {b_idx}. {b}")
    else:
        lines.append("    (Источники не добавлены)")

    return "\n".join(lines)
