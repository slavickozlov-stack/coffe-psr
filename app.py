"""
Главное приложение FastAPI для платформы подготовки и нормоконтроля документов по ГОСТ.
"""

import os
from typing import Dict, List, Optional
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form, Depends
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from database import db
from gost_exporter import build_gost_docx, build_gost_txt
from ai_service import ai_service

app = FastAPI(
    title="Платформа подготовки и нормоконтроля документов по ГОСТ",
    description="Инструмент для студентов, специалистов (АЭС, сварщиков, электриков, бухгалтеров) и нормоконтролеров.",
    version="1.0.0"
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")

os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "css"), exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "js"), exist_ok=True)
os.makedirs(TEMPLATES_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)


# --- СХЕМЫ ДАННЫХ ---

class TitleDataModel(BaseModel):
    org: Optional[str] = "МИНИСТЕРСТВО НАУКИ И ВЫСШЕГО ОБРАЗОВАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ\nВИТИ НИЯУ МИФИ"
    doc_type: Optional[str] = "ТЕХНИЧЕСКИЙ ОТЧЕТ"
    topic: Optional[str] = "Без темы"
    author_name: Optional[str] = "Козлов В.А."
    author_specialty: Optional[str] = "Работники АЭС"
    reviewer_name: Optional[str] = "Профессор Смирнов А.В."
    city: Optional[str] = "Волгодонск"
    year: Optional[int] = 2026


class SectionModel(BaseModel):
    title: str
    content: str


class DocumentSaveModel(BaseModel):
    id: Optional[str] = None
    author_id: Optional[str] = "slavickozlov"
    author_name: Optional[str] = "Козлов В.А."
    author_specialty: Optional[str] = "Работники АЭС"
    specialty_id: Optional[str] = "npp"
    status: Optional[str] = "draft"
    current_version: Optional[int] = None
    versions: Optional[List[Dict]] = None
    active_review_comments: Optional[List[Dict]] = None
    reviews: Optional[List[Dict]] = None
    title_data: TitleDataModel
    sections: List[SectionModel]
    bibliography: List[str] = []
    used_doc_ids: List[str] = []


class ReviewCommentModel(BaseModel):
    section_index: Optional[int] = 0
    target_text: str
    tool: Optional[str] = "highlight-red"
    note: str
    severity: Optional[str] = "error"  # error, warning, info


class ReviewSubmissionModel(BaseModel):
    reviewer_name: str
    status: str  # 'returned' или 'approved'
    general_feedback: str
    comments: List[ReviewCommentModel] = []


class AIAskModel(BaseModel):
    doc_title: Optional[str] = "Нормативная база"
    doc_content: Optional[str] = ""
    context: Optional[str] = ""
    question: str


# --- МАРШРУТЫ HTML ---

@app.get("/", response_class=HTMLResponse)
async def index_page(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


# --- API ЭНДПОИНТЫ ---

@app.get("/api/specialties")
def get_specialties():
    return db.get_specialties()


@app.get("/api/templates")
def get_templates(specialty_id: Optional[str] = None):
    return db.get_templates(specialty_id)


@app.get("/api/norm-docs")
def get_norm_docs(category: Optional[str] = None):
    return db.get_norm_docs(category)


@app.post("/api/norm-docs/upload")
async def upload_norm_doc(
    title: str = Form(...),
    code: str = Form(...),
    category: str = Form(...),
    file: UploadFile = File(...)
):
    try:
        content_bytes = await file.read()
        try:
            content_text = content_bytes.decode("utf-8")
        except UnicodeDecodeError:
            content_text = content_bytes.decode("cp1251", errors="ignore")

        new_doc = db.add_norm_doc(
            title=title,
            code=code,
            category=category,
            content=content_text
        )
        return {"success": True, "document": new_doc}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Ошибка загрузки файла: {str(e)}")


@app.get("/api/documents")
def get_documents(user_id: Optional[str] = None, status: Optional[str] = None):
    return db.get_documents(user_id=user_id, status=status)


@app.get("/api/documents/{doc_id}")
def get_document(doc_id: str):
    doc = db.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    return doc


@app.post("/api/documents")
def save_document(payload: DocumentSaveModel):
    saved = db.save_document(payload.model_dump())
    return {"success": True, "document": saved}


class SubmitPayload(BaseModel):
    changelog: Optional[str] = ""


@app.post("/api/documents/{doc_id}/submit")
def submit_for_review(doc_id: str, payload: Optional[SubmitPayload] = None):
    changelog = payload.changelog if payload else ""
    saved = db.submit_document(doc_id, changelog=changelog)
    if not saved:
        raise HTTPException(status_code=404, detail="Документ не найден")
    return {"success": True, "message": "Документ успешно отправлен на проверку", "document": saved}


@app.get("/api/documents/{doc_id}/versions")
def get_document_versions(doc_id: str):
    return db.get_versions(doc_id)


@app.get("/api/documents/{doc_id}/versions/{version_number}")
def get_document_version(doc_id: str, version_number: int):
    v = db.get_version(doc_id, version_number)
    if not v:
        raise HTTPException(status_code=404, detail="Версия не найдена")
    return v


@app.post("/api/documents/{doc_id}/versions/{version_number}/restore")
def restore_document_version(doc_id: str, version_number: int):
    doc = db.restore_version(doc_id, version_number)
    if not doc:
        raise HTTPException(status_code=404, detail="Не удалось восстановить версию")
    return {"success": True, "message": f"Документ восстановлен из версии {version_number}", "document": doc}


@app.get("/api/documents/{doc_id}/versions/{version_number}/export/{format}")
def export_version(doc_id: str, version_number: int, format: str):
    v = db.get_version(doc_id, version_number)
    if not v:
        raise HTTPException(status_code=404, detail="Версия не найдена")
    
    mock_doc = {
        "id": f"{doc_id}_v{version_number}",
        "title_data": v.get("title_data", {}),
        "sections": v.get("sections", []),
        "bibliography": v.get("bibliography", [])
    }
    if format == "docx":
        stream = build_gost_docx(mock_doc)
        filename = f"{doc_id}_v{version_number}.docx"
        return StreamingResponse(
            stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"}
        )
    else:
        txt = build_gost_txt(mock_doc)
        filename = f"{doc_id}_v{version_number}.txt"
        return StreamingResponse(
            iter([txt.encode("utf-8")]),
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"}
        )


@app.post("/api/documents/{doc_id}/review")
def review_document(doc_id: str, payload: ReviewSubmissionModel):
    doc = db.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")

    updated_doc = db.add_review(
        doc_id=doc_id,
        reviewer_name=payload.reviewer_name,
        status=payload.status,
        comments=[c.model_dump() for c in payload.comments],
        general_feedback=payload.general_feedback
    )
    return {"success": True, "document": updated_doc}


@app.post("/api/ai/summarize")
def summarize_doc(payload: Dict[str, str]):
    title = payload.get("title", "")
    code = payload.get("code", "")
    content = payload.get("content", "")
    summary = ai_service.summarize_document(title, code, content)
    return summary


@app.post("/api/ai/ask")
def ask_ai(payload: AIAskModel):
    answer = ai_service.ask_ai_about_document(payload.doc_title, payload.doc_content, payload.question)
    return {"answer": answer}


@app.post("/api/ai/check-gost")
def check_gost(payload: DocumentSaveModel):
    result = ai_service.check_gost_compliance(payload.model_dump())
    return result


@app.get("/api/documents/{doc_id}/export/docx")
def export_docx(doc_id: str):
    doc = db.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")

    stream = build_gost_docx(doc)
    filename = f"report_{doc.get('id', 'gost')}.docx"
    
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"}
    )


@app.get("/api/documents/{doc_id}/export/txt")
def export_txt(doc_id: str):
    doc = db.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")

    txt_content = build_gost_txt(doc)
    filename = f"report_{doc.get('id', 'gost')}.txt"

    return StreamingResponse(
        iter([txt_content.encode("utf-8")]),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"}
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "3000"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
