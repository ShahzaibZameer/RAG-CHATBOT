import hashlib
import json
import logging
from pathlib import Path
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.config import settings
from app.database import Base, SessionLocal, engine, get_db
from app.models import Conversation, Document, Message
from app.schemas import ChatRequest, ChatResponse, ConversationOut, DocumentOut, MessageOut, SourceOut
from app.rag import answer_question, index_file, retrieve, stream_answer

Base.metadata.create_all(bind=engine)
logger = logging.getLogger(__name__)

app = FastAPI(title="Local RAG Chatbot API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED = {".pdf", ".docx", ".txt"}
MAX_BYTES = 20 * 1024 * 1024

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "local-rag-api"}

@app.get("/api/documents", response_model=list[DocumentOut])
def list_documents(db: Session = Depends(get_db)):
    return db.query(Document).order_by(Document.created_at.desc()).all()

def collect_sources(hits: list[dict]) -> list[SourceOut]:
    sources = []
    seen = set()
    for hit in hits:
        meta = hit["metadata"]
        filename = meta.get("filename", "Unknown")
        page = meta.get("page")
        key = (filename, page)
        if key in seen:
            continue
        seen.add(key)
        sources.append(SourceOut(filename=filename, page=page, distance=hit.get("distance")))
    return sources

@app.post("/api/documents/upload", response_model=DocumentOut)
async def upload_document(file: UploadFile = File(...), db: Session = Depends(get_db)):
    filename = Path(file.filename or "upload").name
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(400, "Only PDF, DOCX, and TXT files are supported.")
    content = await file.read()
    if not content:
        raise HTTPException(400, "Uploaded file is empty.")
    if len(content) > MAX_BYTES:
        raise HTTPException(413, "Maximum upload size is 20 MB.")
    digest = hashlib.sha256(content).hexdigest()
    existing = db.query(Document).filter(Document.file_hash == digest).first()
    if existing:
        return existing

    destination = Path(settings.upload_dir) / f"{digest}{suffix}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)

    try:
        chunks = index_file(destination, filename, digest)
    except Exception as exc:
        destination.unlink(missing_ok=True)
        raise HTTPException(500, f"Indexing failed: {exc}") from exc

    record = Document(filename=filename, file_hash=digest, chunks=chunks, status="indexed")
    db.add(record)
    db.commit()
    db.refresh(record)
    return record

@app.get("/api/conversations", response_model=list[ConversationOut])
def list_conversations(db: Session = Depends(get_db)):
    return db.query(Conversation).order_by(Conversation.created_at.desc()).all()

@app.post("/api/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, db: Session = Depends(get_db)):
    question = payload.question.strip()
    if not question:
        raise HTTPException(400, "Question cannot be empty.")
    if len(question) > 8000:
        raise HTTPException(400, "Question is too long.")

    conversation = None
    if payload.conversation_id is not None:
        conversation = db.get(Conversation, payload.conversation_id)
        if conversation is None:
            raise HTTPException(404, "Conversation not found.")
    else:
        conversation = Conversation(title=question[:80])
        db.add(conversation)
        db.commit()
        db.refresh(conversation)

    db.add(Message(conversation_id=conversation.id, role="user", content=question))
    hits = retrieve(question)
    answer = answer_question(question, hits)
    db.add(Message(conversation_id=conversation.id, role="assistant", content=answer))
    db.commit()

    return ChatResponse(answer=answer, conversation_id=conversation.id, sources=collect_sources(hits))

@app.post("/api/chat/stream")
def chat_stream(payload: ChatRequest, db: Session = Depends(get_db)):
    question = payload.question.strip()
    if not question:
        raise HTTPException(400, "Question cannot be empty.")
    if len(question) > 8000:
        raise HTTPException(400, "Question is too long.")

    conversation = None
    if payload.conversation_id is not None:
        conversation = db.get(Conversation, payload.conversation_id)
        if conversation is None:
            raise HTTPException(404, "Conversation not found.")

    hits = retrieve(question)
    if conversation is None:
        conversation = Conversation(title=question[:80])
        db.add(conversation)
        db.commit()
        db.refresh(conversation)

    db.add(Message(conversation_id=conversation.id, role="user", content=question))
    db.commit()

    sources = collect_sources(hits)

    conversation_id = conversation.id

    def generate():
        answer_parts = []
        try:
            for token in stream_answer(question, hits):
                answer_parts.append(token)
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

            with SessionLocal() as stream_db:
                stream_db.add(Message(
                    conversation_id=conversation_id,
                    role="assistant",
                    content="".join(answer_parts),
                ))
                stream_db.commit()

            yield f"data: {json.dumps({'type': 'done', 'conversation_id': conversation_id, 'sources': [source.model_dump() for source in sources]})}\n\n"
        except Exception:
            logger.exception("Chat response streaming failed")
            yield f"data: {json.dumps({'type': 'error', 'message': 'The response could not be completed. Please try again.'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@app.get("/api/conversations/{conversation_id}/messages", response_model=list[MessageOut])
def get_messages(conversation_id: int, db: Session = Depends(get_db)):
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(404, "Conversation not found.")
    return (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
        .all()
    )
