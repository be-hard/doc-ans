import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import type {
  Citation,
  DocumentRecord,
  DocumentStatus,
  KnowledgeEvent,
  KnowledgeScope,
} from "@docs-ans/shared";
import { api } from "./api";

type Mode = "question" | "source";

const scopeLabels: Record<KnowledgeScope, string> = {
  current: "当前文档",
  all: "全部知识库",
};

interface SidebarSearchHit {
  kind: "标题" | "正文";
  location: string;
  snippet: string;
}

const seedPrompt = `#   Typescript 教程

TypeScript 在 JavaScript 基础上增加了静态类型系统。它最适合中大型项目，因为它可以把很多类型错误提前暴露在开发阶段。

## LangChain 怎么看

LangChain 更适合复杂工具调用、Agent 和多供应商编排，但在文档工作台里，第一优先级不是抽象层，而是稳定的检索、引用和流式返回。

> 第一版先把链路打通，再把抽象加上去。
`;

function statusLabel(status: DocumentStatus) {
  switch (status) {
    case "draft":
      return "草稿";
    case "saved":
      return "未入库";
    case "indexing":
      return "入库中";
    case "indexed":
      return "已入库";
    case "failed":
      return "失败";
  }
}

function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function lineForOffset(text: string, offset: number) {
  return text.slice(0, Math.max(0, offset)).split("\n").length;
}

function snippetAround(text: string, query: string) {
  const lowered = text.toLowerCase();
  const index = lowered.indexOf(query.toLowerCase());
  if (index < 0) return "";
  const start = Math.max(0, index - 36);
  const end = Math.min(text.length, index + query.length + 52);
  return `${start > 0 ? "..." : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "..." : ""}`;
}

function findSidebarHits(
  title: string,
  contentText: string,
  query: string,
): SidebarSearchHit[] {
  const keyword = query.trim();
  if (!keyword) return [];
  const hits: SidebarSearchHit[] = [];
  if (title.toLowerCase().includes(keyword.toLowerCase())) {
    hits.push({ kind: "标题", location: "标题", snippet: title });
  }
  const contentIndex = contentText.toLowerCase().indexOf(keyword.toLowerCase());
  if (contentIndex >= 0) {
    hits.push({
      kind: "正文",
      location: `第 ${lineForOffset(contentText, contentIndex)} 行`,
      snippet: snippetAround(contentText, keyword),
    });
  }
  return hits.slice(0, 2);
}

function ToolbarButton(props: {
  active?: boolean;
  label: string;
  title: string;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      className={`tool-btn ${props.active ? "active" : ""} ${props.compact ? "compact" : ""}`}
      title={props.title}
      onClick={props.onClick}
      type="button"
    >
      {props.label}
    </button>
  );
}

export function App() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("Typescript");
  const [mode, setMode] = useState<Mode>("question");
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [saving, setSaving] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [knowledgeScope, setKnowledgeScope] =
    useState<KnowledgeScope>("current");
  const [sessionId] = useState(() => crypto.randomUUID());
  const editorRef = useRef<string>(seedPrompt);

  const activeDocument = useMemo(
    () => documents.find((doc) => doc.id === activeDocumentId) ?? documents[0],
    [documents, activeDocumentId],
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: "在这里编辑文档内容，保存后可以入库并参与右侧知识库问答。",
      }),
    ],
    content: activeDocument?.contentText || seedPrompt,
    onUpdate({ editor }) {
      // 编辑器内容只在这里同步到本地缓存，不要每次打 API，避免把输入过程变成网络抖动。
      editorRef.current = editor.getText();
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    void api.listDocuments().then((docs) => {
      setDocuments(docs);
      setActiveDocumentId((current) => current || docs[0]?.id || "");
    });
  }, []);

  useEffect(() => {
    if (!editor || !activeDocument) return;
    editor.commands.setContent(
      activeDocument.contentJson
        ? JSON.parse(activeDocument.contentJson)
        : activeDocument.contentText,
    );
    editorRef.current = activeDocument.contentText;
    setTitleDraft(activeDocument.title);
  }, [activeDocumentId, editor, activeDocument]);

  const filteredDocuments = useMemo(
    () =>
      documents.filter((doc) => {
        const haystack =
          `${doc.title} ${doc.tags.join(" ")} ${doc.contentText}`.toLowerCase();
        return haystack.includes(search.toLowerCase());
      }),
    [documents, search],
  );

  const documentSearchHits = useMemo(
    () =>
      new Map(
        filteredDocuments.map((doc) => [
          doc.id,
          findSidebarHits(
            doc.id === activeDocument?.id ? titleDraft : doc.title,
            doc.id === activeDocument?.id ? editorRef.current : doc.contentText,
            search,
          ),
        ]),
      ),
    [filteredDocuments, search],
  );

  const refreshDocuments = async (nextActiveId?: string) => {
    const docs = await api.listDocuments();
    setDocuments(docs);
    setActiveDocumentId(nextActiveId ?? docs[0]?.id ?? "");
  };

  const saveDocument = async () => {
    if (!activeDocument || !editor) return;
    setSaving(true);
    try {
      const json = editor.getJSON();
      const text = editor.getText();
      const updated = await api.saveDocument(activeDocument.id, {
        title: titleDraft.trim() || "未命名文档",
        contentJson: JSON.stringify(json),
        contentText: text,
      });
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === updated.document.id ? updated.document : doc,
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const syncDocument = async () => {
    if (!activeDocument || !editor) return;
    setSyncing(true);
    try {
      const updated = await api.updateDocument(activeDocument.id, {
        title: titleDraft.trim() || "未命名文档",
        contentJson: JSON.stringify(editor.getJSON()),
        contentText: editor.getText(),
      });
      setDocuments((prev) =>
        prev.map((doc) => (doc.id === updated.id ? updated : doc)),
      );
    } finally {
      setSyncing(false);
    }
  };

  const ingestDocument = async () => {
    if (!activeDocument || !editor) return;
    setIndexing(true);
    try {
      await api.updateDocument(activeDocument.id, {
        title: titleDraft.trim() || "未命名文档",
        contentJson: JSON.stringify(editor.getJSON()),
        contentText: editor.getText(),
      });
      const result = await api.ingestDocument(activeDocument.id);
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === activeDocument.id
            ? {
                ...doc,
                title: titleDraft.trim() || "未命名文档",
                contentJson: JSON.stringify(editor.getJSON()),
                contentText: editor.getText(),
                status: "indexed",
                versionNo: doc.versionNo + 1,
                updatedAt: new Date().toISOString(),
              }
            : doc,
        ),
      );
      setCitations((prev) => prev.slice(0, 0));
      void result;
    } finally {
      setIndexing(false);
    }
  };

  const outgestDocument = async () => {
    if (!activeDocument) return;
    const result = await api.outgestDocument(activeDocument.id);
    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === result.document.id ? result.document : doc,
      ),
    );
    setCitations([]);
    setStreamingAnswer("当前文档已出库，不再参与知识库检索。");
  };

  const deleteDocument = async (id: string) => {
    const target = documents.find((doc) => doc.id === id);
    if (!target) return;
    const confirmed = window.confirm(
      `确定删除「${target.title}」吗？此操作会同时清理版本和索引。`,
    );
    if (!confirmed) return;
    const result = await api.deleteDocument(id);
    let nextDocuments: DocumentRecord[] = [];
    setDocuments((prev) => {
      nextDocuments = prev.filter((doc) => doc.id !== id);
      return nextDocuments;
    });
    setCitations([]);
    if (activeDocument?.id === id) {
      setActiveDocumentId(nextDocuments[0]?.id ?? "");
    }
    setStreamingAnswer(result.message);
  };

  const createDocument = async () => {
    const created = await api.createDocument("未命名文档");
    await refreshDocuments(created.id);
  };

  const runQuestion = async () => {
    setStreamingAnswer("");
    setMode("question");
    setCitations([]);
    const draftTitle = titleDraft.trim() || activeDocument?.title;
    for await (const event of api.askKnowledge({
      question: query,
      scope: knowledgeScope,
      sessionId,
      documentText: editorRef.current,
      ...(draftTitle ? { documentTitle: draftTitle } : {}),
      ...(activeDocument?.id ? { documentId: activeDocument.id } : {}),
    })) {
      if (event.type === "searching") {
        setStreamingAnswer(`${event.message}...\n\n`);
      }
      if (event.type === "citation") {
        setCitations(event.citations);
      }
      if (event.type === "delta") {
        setStreamingAnswer((current) => current + event.text);
      }
      if (event.type === "done") {
        setStreamingAnswer(event.answer);
      }
      if (event.type === "error") {
        setStreamingAnswer(`错误：${event.message}`);
      }
    }
  };

  const loadSources = async () => {
    if (!query.trim()) return;
    const result = await api.searchKnowledge(
      query,
      knowledgeScope,
      activeDocument?.id,
      editorRef.current,
      titleDraft.trim() || activeDocument?.title,
    );
    setMode("source");
    setCitations(result.citations);
  };

  const handleImport = async (file: File) => {
    const imported = await api.importFile(
      file,
      file.name.replace(/\.[^.]+$/, ""),
    );
    await refreshDocuments(imported.document.id);
  };

  const handleSetHeading = (level: 1 | 2) => {
    editor?.chain().focus().toggleHeading({ level }).run();
  };

  const handleSetList = (kind: "bullet" | "ordered" | "task") => {
    if (!editor) return;
    if (kind === "bullet") {
      editor.chain().focus().toggleBulletList().run();
      return;
    }
    if (kind === "ordered") {
      editor.chain().focus().toggleOrderedList().run();
      return;
    }
    editor.chain().focus().toggleTaskList().run();
  };

  const clearFormatting = () => {
    if (!editor) return;
    editor.chain().focus().clearNodes().unsetAllMarks().run();
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span className="brand-mark-core">M</span>
            <span className="brand-mark-accent" />
          </div>
          <div className="brand-copy">
            <div className="brand-title">docs-ans Atlas</div>
            <div className="brand-subtitle">
              轻蓝知识工作台 · 文档、检索、引用一体
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="status-pill">{documents.length} 文档</span>
          <span className="status-pill">
            {documents.filter((doc) => doc.status === "indexed").length} 已入库
          </span>
          <button
            className="ghost-pill"
            onClick={() => void api.login("demo@docs-ans.dev", "Demo User")}
          >
            登录演示
          </button>
        </div>
      </header>

      <main className="layout">
        <aside className="panel sidebar">
          <div className="brand-title">工作台</div>
          <input
            className="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索文档"
          />

          <div className="section-label">工作区</div>
          <div className="doc-list">
            <div className="menu-item active">
              <span>全部文档</span>
              <span>{documents.length}</span>
            </div>
            <div className="menu-item">
              <span>已入库</span>
              <span>
                {documents.filter((doc) => doc.status === "indexed").length}
              </span>
            </div>
            <div className="menu-item">
              <span>AI 补全</span>
              <span>+</span>
            </div>
          </div>

          <div className="section-label">文档</div>
          <button
            className="dark-btn"
            style={{ width: "100%", marginBottom: 12 }}
            onClick={() => void createDocument()}
          >
            + 新建文档
          </button>
          <div className="doc-list">
            {filteredDocuments.map((doc) => (
              <div
                key={doc.id}
                className={`doc-card ${doc.id === activeDocument?.id ? "active" : ""}`}
              >
                <button
                  className={`menu-item doc-item ${doc.id === activeDocument?.id ? "active" : ""}`}
                  onClick={() => setActiveDocumentId(doc.id)}
                  type="button"
                >
                  <div className="doc-main">
                    <div className="doc-title-row">
                      <div className="doc-title">{doc.title}</div>
                      <span className="doc-state">
                        {statusLabel(doc.status)}
                      </span>
                    </div>
                    <div className="doc-meta">
                      {shortTime(doc.updatedAt)} · {doc.tags[0] || "文档"}
                    </div>
                    {search.trim() ? (
                      <div className="doc-hit-list">
                        {(documentSearchHits.get(doc.id) ?? []).map((hit) => (
                          <div
                            key={`${hit.kind}-${hit.location}`}
                            className="doc-hit"
                          >
                            <span>
                              {hit.kind} · {hit.location}
                            </span>
                            <strong>{hit.snippet}</strong>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </button>
                <button
                  className="doc-delete"
                  title={`删除 ${doc.title}`}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteDocument(doc.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="section-label">导入</div>
          <label
            className="secondary-btn"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            导入 Markdown / PDF / Docx
            <input
              type="file"
              accept=".md,.txt,.pdf,.docx"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImport(file);
              }}
            />
          </label>

          <div className="footer-note">
            所有关键状态都用注释标了职责，方便后续接 Prisma、Qdrant
            和真实模型服务。
          </div>
        </aside>

        <section className="panel editor-panel">
          <div className="editor-head">
            <div>
              <input
                className="editor-title-input"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => void syncDocument()}
                placeholder="未命名文档"
              />
              <div className="editor-subtitle">
                {activeDocument
                  ? `最后更新 ${shortTime(activeDocument.updatedAt)} · `
                  : ""}
                Tab 接受补全，Esc 取消
              </div>
            </div>
            <div className="editor-actions">
              <span className="status-pill">
                {activeDocument ? statusLabel(activeDocument.status) : "未选中"}
              </span>
              <button
                className="secondary-btn"
                onClick={() => void syncDocument()}
                disabled={!activeDocument || syncing}
              >
                {syncing ? "同步中..." : "同步"}
              </button>
              {activeDocument?.status === "indexed" ? (
                <button
                  className="secondary-btn"
                  onClick={() => void outgestDocument()}
                  disabled={!activeDocument}
                >
                  出库
                </button>
              ) : (
                <button
                  className="secondary-btn"
                  onClick={() => void ingestDocument()}
                  disabled={!activeDocument || indexing}
                >
                  {indexing ? "入库中..." : "入库"}
                </button>
              )}
              <button
                className="secondary-btn"
                onClick={() => void saveDocument()}
                disabled={!activeDocument || saving}
              >
                {saving ? "保存中..." : "保存"}
              </button>
              <button
                className="primary-btn"
                onClick={async () => {
                  if (!editor) return;
                  editor.commands.focus("end");
                  editor.commands.insertContent(
                    "\n\n" + "继续写作：这部分内容可以沿着当前段落展开。",
                  );
                }}
              >
                续写
              </button>
            </div>
          </div>

          <div className="toolbar">
            <ToolbarButton
              title="撤销"
              label="↶"
              onClick={() => {
                editor?.chain().focus().undo().run();
              }}
            />
            <ToolbarButton
              title="重做"
              label="↷"
              onClick={() => {
                editor?.chain().focus().redo().run();
              }}
            />
            <span className="toolbar-divider" />
            <ToolbarButton
              title="加粗"
              label="B"
              active={Boolean(editor?.isActive("bold"))}
              onClick={() => {
                editor?.chain().focus().toggleBold().run();
              }}
            />
            <ToolbarButton
              title="斜体"
              label="I"
              active={Boolean(editor?.isActive("italic"))}
              onClick={() => {
                editor?.chain().focus().toggleItalic().run();
              }}
            />
            <ToolbarButton
              title="下划线"
              label="U"
              active={Boolean(editor?.isActive("underline"))}
              onClick={() => {
                editor?.chain().focus().toggleUnderline().run();
              }}
            />
            <span className="toolbar-divider" />
            <ToolbarButton
              title="一级标题"
              label="H1"
              active={Boolean(editor?.isActive("heading", { level: 1 }))}
              onClick={() => handleSetHeading(1)}
            />
            <ToolbarButton
              title="二级标题"
              label="H2"
              active={Boolean(editor?.isActive("heading", { level: 2 }))}
              onClick={() => handleSetHeading(2)}
            />
            <span className="toolbar-divider" />
            <ToolbarButton
              title="无序列表"
              label="•"
              active={Boolean(editor?.isActive("bulletList"))}
              onClick={() => handleSetList("bullet")}
            />
            <ToolbarButton
              title="有序列表"
              label="1."
              active={Boolean(editor?.isActive("orderedList"))}
              onClick={() => handleSetList("ordered")}
            />
            <ToolbarButton
              title="待办列表"
              label="☑"
              active={Boolean(editor?.isActive("taskList"))}
              onClick={() => handleSetList("task")}
            />
            <span className="toolbar-divider" />
            <ToolbarButton
              title="引用块"
              label="❝"
              active={Boolean(editor?.isActive("blockquote"))}
              onClick={() => {
                editor?.chain().focus().toggleBlockquote().run();
              }}
            />
            <ToolbarButton
              title="代码块"
              label="</>"
              active={Boolean(editor?.isActive("codeBlock"))}
              onClick={() => {
                editor?.chain().focus().toggleCodeBlock().run();
              }}
            />
            <ToolbarButton
              title="分割线"
              label="—"
              onClick={() => {
                editor?.chain().focus().setHorizontalRule().run();
              }}
            />
            <ToolbarButton
              title="清除格式"
              label="✕"
              onClick={clearFormatting}
            />
          </div>

          <div className="editor-stage">
            <div className="editor-canvas">
              <div className="editor-paper">
                <EditorContent editor={editor} />
              </div>
            </div>
          </div>
        </section>

        <aside className="panel knowledge-panel">
          <div className="knowledge-head">
            <div>
              <div className="title">AI 知识库</div>
              <div className="blue-dim" style={{ fontSize: 12, marginTop: 4 }}>
                搜索、引用与文件入库
              </div>
            </div>
            <button className="ghost-pill">+</button>
          </div>

          <div className="tabs">
            <button
              className={`tab ${mode === "question" ? "active" : ""}`}
              onClick={() => setMode("question")}
            >
              问答
            </button>
            <button
              className={`tab ${mode === "source" ? "active" : ""}`}
              onClick={() => setMode("source")}
            >
              来源
            </button>
          </div>

          <div className="knowledge-body">
            <div className="note-card">
              <div className="card-title">
                <span>知识检索</span>
                <span className="badge">基于向量检索</span>
              </div>
              <div
                className="scope-switch"
                role="tablist"
                aria-label="知识检索范围"
              >
                {(Object.keys(scopeLabels) as KnowledgeScope[]).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    className={`chip scope-chip ${knowledgeScope === scope ? "active" : ""}`}
                    aria-pressed={knowledgeScope === scope}
                    onClick={() => setKnowledgeScope(scope)}
                  >
                    {scopeLabels[scope]}
                  </button>
                ))}
              </div>
              <div className="search-row">
                <textarea
                  className="textarea"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="输入要检索的问题或关键词"
                />
                <button
                  className="search-button"
                  onClick={() => void runQuestion()}
                >
                  {knowledgeScope === "current"
                    ? "搜索当前文档并回答"
                    : "搜索全库并回答"}
                </button>
                <button
                  className="secondary-btn"
                  onClick={() => void loadSources()}
                >
                  仅看来源
                </button>
              </div>
            </div>

            <div className="answer-card">
              <div className="card-title">
                <span>回答</span>
                <span className="badge">{citations.length} 条引用</span>
              </div>
              <div className="streaming-text">
                {streamingAnswer || "点击搜索后，SSE 会边生成边返回答案。"}{" "}
              </div>
            </div>

            <div className="source-card">
              <div className="card-title">
                <span>{mode === "source" ? "来源" : "引用片段"}</span>
                <span className="badge">{citations.length}</span>
              </div>
              <div className="citation-list">
                {citations.map((citation, index) => (
                  <div key={citation.chunkId} className="citation-item">
                    <div className="head">
                      <span>
                        [{index + 1}] {citation.documentTitle}
                      </span>
                      <span>score {(citation.score * 100).toFixed(0)}%</span>
                    </div>
                    <div className="citation-location">
                      {citation.locationLabel}
                    </div>
                    <div className="quote">{citation.quote}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="note-card">
              <div className="card-title">
                <span>设计说明</span>
                <span className="badge">蓝色调</span>
              </div>
              <div
                className="blue-dim"
                style={{ fontSize: 13, lineHeight: 1.7 }}
              >
                这版把截图里的“工作台感”保留下来，但主色改成冷蓝灰。黑色按钮用于主动作，蓝色系用于状态、强调和引用，避免整屏发暖。
              </div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
