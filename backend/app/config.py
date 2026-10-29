from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
import uvicorn

class Settings(BaseSettings):
    database_url: str = "sqlite:///./rag.db"
    ollama_base_url: str = "http://localhost:11434"
    chat_model: str = "qwen2.5:3b"
    embed_model: str = "nomic-embed-text"
    chroma_path: str = "./chroma_data"
    upload_dir: str = "./uploads"
    frontend_origin: str = "http://localhost:5173"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
Path(settings.chroma_path).mkdir(parents=True, exist_ok=True)