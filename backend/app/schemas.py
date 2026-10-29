from datetime import datetime
from pydantic import BaseModel, ConfigDict

class DocumentOut(BaseModel):
    id: int
    filename: str
    chunks: int
    status: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class ConversationOut(BaseModel):
    id: int
    title: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class MessageOut(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class ChatRequest(BaseModel):
    question: str
    conversation_id: int | None = None

class SourceOut(BaseModel):
    filename: str
    page: int | None = None
    distance: float | None = None

class ChatResponse(BaseModel):
    answer: str
    conversation_id: int
    sources: list[SourceOut]
