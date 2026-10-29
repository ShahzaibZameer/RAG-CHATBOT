# Local RAG Chatbot — Full-stack starter

Stack:
- Frontend: React + Vite + TypeScript
- UI styling: plain CSS (easy to replace with Tailwind/shadcn)
- Backend: FastAPI + Pydantic
- ORM / relational DB: SQLAlchemy + SQLite (PostgreSQL is optional)
- Vector DB: ChromaDB persistent local storage
- Local AI: Ollama (`qwen2.5:3b`, `nomic-embed-text`)
- Document parsing: PyMuPDF, python-docx

## Prerequisites
- Python 3.11+
- Node.js 20+
- Ollama installed: https://ollama.com/download

## 1. Download local models
```bash
ollama pull qwen2.5:3b
ollama pull nomic-embed-text
```
Make sure Ollama is running. Its local API is normally available at `http://localhost:11434`.

## 2. Optional: Start PostgreSQL
SQLite is used by default, so Docker/PostgreSQL is not required for local development. To use PostgreSQL instead, start Docker and run this from the project folder:
```bash
docker compose up -d db
```
Then set `DATABASE_URL` in `backend/.env` to `postgresql+psycopg://raguser:localdevpassword@localhost:5432/ragdb`.

## 3. Backend setup
Windows PowerShell:
```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
uvicorn app.main:app --reload --port 8001
```
macOS/Linux:
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
if [ ! -f .env ]; then cp .env.example .env; fi
uvicorn app.main:app --reload --port 8001
```
Backend docs: http://localhost:8001/docs

## 4. Frontend setup
Open a second terminal:
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173

## How to use
1. Open the frontend.
2. Upload PDF, DOCX or TXT in the sidebar.
3. Wait for indexing to finish.
4. Ask questions in the chat.
5. Sources appear below the answer.

The assistant replies in concise English and streams answers as they are generated. Ollama keeps the chat and embedding models loaded for 30 minutes after use to reduce repeated model startup delays. PDFs must contain selectable text; scanned PDFs need OCR before they can be indexed. Uploaded text is chunked, embedded with Ollama, and stored in the local ChromaDB vector database.

## Architecture notes
- SQLite stores document records, conversations, and messages in `backend/rag.db` by default. PostgreSQL can be selected with `DATABASE_URL`.
- ChromaDB stores text chunks and embeddings under `backend/chroma_data`.
- Original uploaded files are stored under `backend/uploads`.
- Ollama runs the LLM and embedding model locally.
- This is a local development starter, not a hardened production deployment.

## Important production work still required
Before exposing this to a company network, add authentication/authorization, per-user or per-team document isolation, upload size/type limits, malware scanning, rate limits, backups, HTTPS, retention policies, audit logging, and robust ingestion jobs. The demo endpoints currently do not enforce user access controls.
