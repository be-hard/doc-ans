import type { CSSProperties } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const components: Components = {
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  code: ({ inline, children }: any) =>
    inline ? (
      <code style={inlineCodeStyle}>{children}</code>
    ) : (
      <code style={blockCodeStyle}>{children}</code>
    ),
  pre: ({ children }) => <pre style={preStyle}>{children}</pre>,
  table: ({ children }) => <table style={tableStyle}>{children}</table>,
  th: ({ children }) => <th style={cellStyle}>{children}</th>,
  td: ({ children }) => <td style={cellStyle}>{children}</td>,
  blockquote: ({ children }) => <blockquote style={blockquoteStyle}>{children}</blockquote>,
  ul: ({ children }) => <ul style={listStyle}>{children}</ul>,
  ol: ({ children }) => <ol style={listStyle}>{children}</ol>,
};

const baseTextStyle: CSSProperties = {
  color: "#0f172a",
  lineHeight: 1.75,
  wordBreak: "break-word",
};

const inlineCodeStyle: CSSProperties = {
  padding: "0.15em 0.35em",
  borderRadius: 6,
  background: "#eef2ff",
  color: "#1e293b",
  fontSize: "0.95em",
};

const blockCodeStyle: CSSProperties = {
  display: "block",
  padding: "12px 14px",
  borderRadius: 8,
  overflowX: "auto",
  background: "#0f172a",
  color: "#e2e8f0",
  fontSize: 13,
  lineHeight: 1.6,
};

const preStyle: CSSProperties = {
  margin: "14px 0",
  padding: 0,
  overflowX: "auto",
  background: "transparent",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  margin: "12px 0",
};

const cellStyle: CSSProperties = {
  border: "1px solid #d7e4f5",
  padding: "8px 10px",
  textAlign: "left",
  verticalAlign: "top",
};

const blockquoteStyle: CSSProperties = {
  margin: "12px 0",
  padding: "8px 14px",
  borderLeft: "4px solid #cbd5e1",
  background: "#f8fafc",
  color: "#334155",
};

const listStyle: CSSProperties = {
  paddingLeft: 20,
  margin: "10px 0",
};

interface MarkdownResponseProps {
  content: string;
  placeholder?: string;
}

export function MarkdownResponse({ content, placeholder = "暂无内容" }: MarkdownResponseProps) {
  // 企业场景里不要直接把 AI 输出当 HTML 注入。
  // 这里保留 Markdown 语义渲染，同时禁用原始 HTML，再用 sanitize 做二次兜底。
  const safeContent = content.trim();
  if (!safeContent) {
    return <div style={baseTextStyle}>{placeholder}</div>;
  }

  return (
    <div style={baseTextStyle}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
        {safeContent}
      </ReactMarkdown>
    </div>
  );
}
