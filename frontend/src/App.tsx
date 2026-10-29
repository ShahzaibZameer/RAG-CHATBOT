import { FormEvent, useEffect, useRef, useState } from "react";
import { Bot, FileText, MessageSquare, Plus, Send, UploadCloud, User, Database, LoaderCircle } from "lucide-react";
import "./chat-layout.css";

const API = "/api";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt"];

type Doc = { id: number; filename: string; chunks: number; status: string; created_at: string };
type Source = { filename: string; page: number | null; distance: number | null };
type ChatMessage = { role: "user" | "assistant"; content: string; sources?: Source[] };
type Conversation = { id: number; title: string; created_at: string };
type ChatStreamEvent =
  | { type: "token"; content: string }
  | { type: "done"; conversation_id: number; sources: Source[] }
  | { type: "error"; message: string };

async function getErrorMessage(response: Response, fallback: string) {
  const body = await response.text();
  try {
    const data = JSON.parse(body);
    if (typeof data.detail === "string") return data.detail;
  } catch {
    // Non-JSON proxy and server errors are reported with their HTTP status below.
  }
  return `${fallback} (HTTP ${response.status}).`;
}

export default function App() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadData(): Promise<boolean> {
    try {
      const [d, c] = await Promise.all([
        fetch(`${API}/documents`), fetch(`${API}/conversations`)
      ]);
      if (!d.ok) throw new Error(await getErrorMessage(d, "Could not load documents"));
      if (!c.ok) throw new Error(await getErrorMessage(c, "Could not load conversations"));
      setDocs(await d.json());
      setConversations(await c.json());
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not connect to the backend. Check that the API server is running.");
      return false;
    }
  }

  useEffect(() => { void loadData(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setQuestion("");
    setNotice("");
  }

  async function openConversation(id: number) {
    setNotice("");
    try {
      const response = await fetch(`${API}/conversations/${id}/messages`);
      if (!response.ok) throw new Error(await getErrorMessage(response, "Could not load conversation"));
      const data = await response.json();
      setConversationId(id);
      setMessages(data.map((m: { role: "user" | "assistant"; content: string }) => ({ role: m.role, content: m.content })));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Error");
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    const invalidFile = selectedFiles.find((file) => !ALLOWED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension)));
    if (invalidFile) {
      setNotice(`${invalidFile.name}: only PDF, DOCX, and TXT files are supported.`);
      return;
    }
    const oversizedFile = selectedFiles.find((file) => file.size > MAX_FILE_BYTES);
    if (oversizedFile) {
      setNotice(`${oversizedFile.name}: the maximum file size is 20 MB.`);
      return;
    }
    const emptyFile = selectedFiles.find((file) => file.size === 0);
    if (emptyFile) {
      setNotice(`${emptyFile.name}: the selected file is empty.`);
      return;
    }

    setUploading(true);
    setNotice("");
    try {
      for (const file of selectedFiles) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(`${API}/documents/upload`, { method: "POST", body: form });
        if (!response.ok) throw new Error(await getErrorMessage(response, `Upload failed for ${file.name}`));
      }
      if (await loadData()) {
        setNotice(`Successfully uploaded and indexed ${selectedFiles.length} ${selectedFiles.length === 1 ? "document" : "documents"}.`);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setQuestion("");
    setMessages((old) => [...old, { role: "user", content: q }]);
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`${API}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, conversation_id: conversationId }),
      });
      if (!response.ok) throw new Error(await getErrorMessage(response, "Chat request failed"));
      if (!response.body) throw new Error("The browser could not read the streaming response.");

      setMessages((old) => [...old, { role: "assistant", content: "" }]);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      const processFrame = async (frame: string) => {
        const data = frame.split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) return;

        const event = JSON.parse(data) as ChatStreamEvent;
        if (event.type === "token") {
          setMessages((old) => {
            const updated = [...old];
            const lastIndex = updated.length - 1;
            const last = updated[lastIndex];
            if (last?.role === "assistant") {
              updated[lastIndex] = { ...last, content: last.content + event.content };
            }
            return updated;
          });
        } else if (event.type === "done") {
          completed = true;
          setConversationId(event.conversation_id);
          setMessages((old) => {
            const updated = [...old];
            const lastIndex = updated.length - 1;
            const last = updated[lastIndex];
            if (last?.role === "assistant") {
              updated[lastIndex] = { ...last, sources: event.sources };
            }
            return updated;
          });
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) await processFrame(frame);
      }

      if (buffer.trim()) await processFrame(buffer);
      if (!completed) throw new Error("The response stream ended unexpectedly. Please try again.");
      await loadData();
    } catch (e) {
      const message = e instanceof Error ? e.message : "The request failed. Please check the backend and try again.";
      setMessages((old) => {
        const updated = [...old];
        const lastIndex = updated.length - 1;
        const last = updated[lastIndex];
        if (last?.role === "assistant") {
          updated[lastIndex] = { ...last, content: last.content ? `${last.content}\n\n${message}` : message };
        } else {
          updated.push({ role: "assistant", content: message });
        }
        return updated;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Bot size={22}/></div><div><strong>Local RAG</strong><span>Knowledge assistant</span></div></div>
        <button className="new-chat" onClick={newChat}><Plus size={17}/> New chat</button>

        <div className="side-section">
          <div className="section-heading"><FileText size={15}/> Knowledge base <span>{docs.length}</span></div>
          <label className={`upload-box ${uploading ? "disabled" : ""}`}>
            {uploading ? <LoaderCircle className="spin" size={21}/> : <UploadCloud size={21}/>}
            <strong>{uploading ? "Indexing document..." : "Upload documents"}</strong>
            <small>PDF, DOCX, or TXT · max 20 MB</small>
            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt" multiple disabled={uploading} onChange={(e) => void uploadFiles(e.target.files)}/>
          </label>
          <div className="doc-list">
            {docs.map((doc) => <div className="doc-item" key={doc.id}><FileText size={16}/><div><strong title={doc.filename}>{doc.filename}</strong><small>{doc.chunks} chunks · {doc.status}</small></div></div>)}
            {!docs.length && <p className="muted small">No documents indexed yet.</p>}
          </div>
        </div>

        <div className="side-section history">
          <div className="section-heading"><MessageSquare size={15}/> Recent chats</div>
          {conversations.map((c) => <button className={`history-item ${conversationId === c.id ? "active" : ""}`} key={c.id} onClick={() => void openConversation(c.id)} title={c.title}><MessageSquare size={15}/><span>{c.title}</span></button>)}
        </div>
        <div className="sidebar-footer"><Database size={15}/><span>ChromaDB vector search · Local storage</span></div>
      </aside>

      <main className="main-panel">
        <header className="topbar"><div><span className="status-dot"/> <span>Local AI environment</span></div><span className="model-pill">Ollama · RAG</span></header>
        <section className="chat-area">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-icon"><Bot size={30}/></div>
              <p className="eyebrow">YOUR COMPANY KNOWLEDGE, SEARCHABLE</p>
              <h1>What would you like<br/>to know?</h1>
              <p className="welcome-copy">Upload your documents, then ask questions about their contents.</p>
              <div className="suggestions">
                {["Summarize the uploaded documents", "What are the main policies?", "Find key dates and numbers"].map((s) => <button key={s} onClick={() => setQuestion(s)}>{s}<span>↗</span></button>)}
              </div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((m, i) => <div className={`message-row ${m.role}`} key={`${i}-${m.role}`}>
                <div className={`avatar ${m.role}`}>{m.role === "assistant" ? <Bot size={18}/> : <User size={18}/>}</div>
                <div className="message-content"><div className="message-label">{m.role === "assistant" ? "RAG ASSISTANT" : "YOU"}</div><div className="message-text">{m.content}</div>
                  {!!m.sources?.length && <div className="sources"><strong>Sources</strong>{m.sources.map((s, j) => <span key={`${s.filename}-${s.page}-${j}`}><FileText size={13}/>{s.filename}{s.page ? ` · page ${s.page}` : ""}</span>)}</div>}
                </div>
              </div>)}
              {busy && <div className="message-row assistant"><div className="avatar assistant"><Bot size={18}/></div><div className="typing"><i/><i/><i/></div></div>}
              <div ref={bottomRef}/>
            </div>
          )}
        </section>

        <footer className="composer-wrap">
          {notice && <div className="notice">{notice}</div>}
          <form className="composer" onSubmit={sendMessage}>
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question about your documents..." rows={1} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(e as unknown as FormEvent); } }}/>
            <button type="submit" disabled={!question.trim() || busy} aria-label="Send message"><Send size={18}/></button>
          </form>
          <p className="disclaimer">AI can make mistakes. Verify important answers against the cited source documents.</p>
        </footer>
      </main>
    </div>
  );
}
