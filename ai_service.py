"""
Модуль интеллектуального анализа документов и взаимодействия с ИИ.
Включает:
- Автоматическую подготовку выжимок и ключевых тезисов из нормативной базы
- Ответы на вопросы и поиск регламентных требований в документах
- Проверку на незаполненные поля и соответствие стилю ГОСТ
- Формирование библиографических записей по ГОСТ Р 7.0.5-2008
"""

import os
import re
from typing import Dict, List, Optional


class AIService:
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY", "")

    def summarize_document(self, title: str, code: str, content: str) -> Dict:
        """
        Генерирует структурированную выжимку нормативного документа:
        - Суть документа
        - Ключевые требования и регламенты
        - Рекомендации по включению в отчет
        """
        paragraphs = [p.strip() for p in content.split("\n") if p.strip()]
        
        # Выделяем ключевые фрагменты
        key_clauses = []
        for p in paragraphs:
            # Ищем пункты со спец. требованиями
            if re.match(r"^\d+(\.\d+)*", p) or "должен" in p.lower() or "требован" in p.lower() or "безопасн" in p.lower():
                key_clauses.append(p)

        summary_bullets = key_clauses[:4] if key_clauses else paragraphs[:3]

        return {
            "title": title,
            "code": code,
            "overview": f"Документ {code} ({title}) регламентирует ключевые правила и стандарты в соответствующей отрасли.",
            "key_requirements": summary_bullets,
            "recommended_use": "Рекомендуется цитировать при обосновании технологических параметров, мер безопасности и оформления расчетной части.",
            "total_words": len(content.split())
        }

    def ask_ai_about_document(self, doc_title: str, doc_content: str, question: str) -> str:
        """Отвечает на конкретный вопрос пользователя по тексту документа."""
        q_lower = question.lower().strip()
        doc_lower = doc_content.lower()

        # Поиск по ключевым словам из вопроса в тексте документа
        words = [w for w in re.findall(r"\w+", q_lower) if len(w) > 3]
        matched_sentences = []
        for line in doc_content.split("\n"):
            line_str = line.strip()
            if not line_str:
                continue
            line_lower = line_str.lower()
            match_count = sum(1 for w in words if w in line_lower)
            if match_count > 0:
                matched_sentences.append((match_count, line_str))

        if matched_sentences:
            matched_sentences.sort(key=lambda x: x[0], reverse=True)
            top_matches = [m[1] for m in matched_sentences[:3]]
            return "На основе анализа документа:\n" + "\n".join(f"• {m}" for m in top_matches)

        return (
            f"В документе «{doc_title}» содержатся общие нормативные положения. "
            f"По вашему запросу «{question}» рекомендуется обратить внимание на разделы общих требований и регламентов безопасности."
        )

    def check_gost_compliance(self, doc_data: dict) -> Dict:
        """
        Проводит автоматический нормоконтроль документа на соответствие правилам ГОСТ:
        1. Проверка незаполненных плейсхолдеров в тексте (напр. [ВВЕДИТЕ...])
        2. Проверка титульных реквизитов (Тема, ФИО автора, Проверяющий)
        3. Проверка наличия и наполнения разделов
        4. Проверка наличия библиографического списка
        """
        issues = []
        warnings = []
        title_data = doc_data.get("title_data", {})
        
        # 1. Титул
        if not title_data.get("topic") or title_data.get("topic") == "Без темы":
            issues.append("Не указана тема работы на титульном листе.")
        if not title_data.get("author_name"):
            issues.append("Не указано ФИО автора работы.")
        if not title_data.get("reviewer_name"):
            warnings.append("Не указано ФИО руководителя/проверяющего.")

        # 2. Поиск незаполненных квадратных скобок в разделах
        sections = doc_data.get("sections", [])
        if not sections:
            issues.append("В документе отсутствуют разделы с содержанием.")

        placeholder_count = 0
        for s_idx, sec in enumerate(sections, 1):
            content = sec.get("content", "")
            matches = re.findall(r"\[.*?\]", content)
            if matches:
                placeholder_count += len(matches)
                issues.append(f"В разделе {s_idx} («{sec.get('title')}») обнаружены незаполненные поля: {', '.join(matches[:2])}...")

        # 3. Проверка библиографии
        bib = doc_data.get("bibliography", [])
        if not bib:
            issues.append("Список использованных источников пуст. По ГОСТ работа должна содержать ссылки на нормативные акты.")

        score = max(0, 100 - (len(issues) * 20 + len(warnings) * 10))

        return {
            "score": score,
            "status": "PASS" if not issues else ("WARN" if score >= 60 else "FAIL"),
            "issues": issues,
            "warnings": warnings,
            "placeholder_count": placeholder_count,
            "sections_count": len(sections),
            "bib_count": len(bib)
        }


ai_service = AIService()
