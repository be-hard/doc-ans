import { Suspense, lazy, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { api } from "@/services/index";
import "./index.scss";
import styles from "./index-2.module.css"

type AiAskModel = "sensenova-6.8-flash-lite" | "kimi-k3" | "glm-5.2";

type AiAskAttachment =
  | { type: "image_url"; image_url: string }
  | { type: "image_file_id"; image_file_id: string }
  | { type: "image_base64"; image_base64: string }
  | { type: "video_url"; video_url: string }
  | { type: "video_file_id"; video_file_id: string };

const MarkdownResponse = lazy(() =>
  import("@/components/MarkdownResponse").then((module) => ({ default: module.MarkdownResponse })),
);

const modelOptions: Array<{ value: AiAskModel; label: string; note: string; multimodal: boolean }> = [
  { value: "sensenova-6.8-flash-lite", label: "sensenova-6.8-flash-lite", note: "轻快，多模态", multimodal: true },
  { value: "kimi-k3", label: "kimi-k3", note: "推理更强，多模态", multimodal: true },
  { value: "glm-5.2", label: "glm-5.2", note: "纯文本，不支持多模态", multimodal: false },
];

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.split(",")[1] ?? "" : value);
    };
    reader.onerror = () => reject(new Error(`无法读取文件 ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export default function Login() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [model, setModel] = useState<AiAskModel>("sensenova-6.8-flash-lite");
  const [imageUrl, setImageUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [imageFiles, setImageFiles] = useState<Array<{ name: string; base64: string }>>([]);

  const supportsMultimodal = model !== "glm-5.2";

  useEffect(() => {
    // 切到纯文本模型时，企业里最好把多模态附件直接清掉，避免用户误以为还会生效。
    if (supportsMultimodal) return;
    setImageUrl("");
    setVideoUrl("");
    setImageFiles([]);
  }, [supportsMultimodal]);

  const attachments: AiAskAttachment[] = useMemo(() => {
    if (!supportsMultimodal) return [];
    return [
      ...(imageUrl.trim() ? [{ type: "image_url", image_url: imageUrl.trim() } as AiAskAttachment] : []),
      ...imageFiles.map((file) => ({ type: "image_base64", image_base64: file.base64 } as AiAskAttachment)),
      ...(videoUrl.trim() ? [{ type: "video_url", video_url: videoUrl.trim() } as AiAskAttachment] : []),
    ];
  }, [supportsMultimodal, imageFiles, imageUrl, videoUrl]);

  const handleClickSubmit = async () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isLoading) return;

    setIsLoading(true);
    setAnswer("");
    setError("");

    try {
      const result = await api.aiAsk(
        { question: trimmedQuestion, model, attachments },
        (text) => {
          setAnswer((prev) => prev + text);
        },
      );
      setAnswer(result.answer);
    } catch (error) {
      setError(error instanceof Error ? error.message : "请求失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    const nextFiles = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        base64: await fileToBase64(file),
      })),
    );
    setImageFiles(nextFiles);
    event.target.value = "";
  };

  return (
    <main style={{ maxWidth: 760, margin: "48px auto", padding: "0 20px" }}>
      <div className="bg">
        <div className="left-side">124</div>
        <div className="bg-right">456</div>
        <div className={styles.module}>890</div>
      </div>
      <h1>AI Ask</h1>

      <section style={{ marginTop: 20 }}>
        <div style={{ marginBottom: 8, fontSize: 13, color: "#475569" }}>选择模型</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {modelOptions.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setModel(item.value)}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: item.value === model ? "1px solid #2563eb" : "1px solid #d7e4f5",
                background: item.value === model ? "#eff6ff" : "#fff",
                color: "#0f172a",
                textAlign: "left",
              }}
            >
              <div style={{ fontWeight: 700 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{item.note}</div>
            </button>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 20 }}>
        <label htmlFor="ai-question">问题</label>
        <textarea
          id="ai-question"
          placeholder="请输入问题"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={6}
          style={{
            display: "block",
            width: "100%",
            marginTop: 8,
            padding: 12,
            resize: "vertical",
          }}
        />
      </section>

      {supportsMultimodal ? (
        <section style={{ marginTop: 16, display: "grid", gap: 12 }}>
          <label>
            图片 URL
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              style={{ display: "block", width: "100%", marginTop: 8, padding: 10 }}
            />
          </label>
          <label>
            图片文件
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageFiles}
              style={{ display: "block", width: "100%", marginTop: 8 }}
            />
          </label>
          <label>
            视频 URL
            <input
              type="url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://..."
              style={{ display: "block", width: "100%", marginTop: 8, padding: 10 }}
            />
          </label>
          {(imageFiles.length > 0 || imageUrl.trim() || videoUrl.trim()) && (
            <div style={{ marginTop: 4, fontSize: 13, color: "#475569" }}>
              已附加 {imageFiles.length + (imageUrl.trim() ? 1 : 0) + (videoUrl.trim() ? 1 : 0)} 个多模态输入
              {imageFiles.length > 0 ? `，文件：${imageFiles.map((file) => file.name).join("、")}` : ""}
            </div>
          )}
        </section>
      ) : (
        <div style={{ marginTop: 16, fontSize: 13, color: "#475569" }}>
          当前模型不支持多模态，图片和视频输入已关闭。
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={handleClickSubmit}
          disabled={isLoading || !question.trim()}
          style={{ padding: "8px 18px" }}
        >
          {isLoading ? "生成中..." : "提交"}
        </button>

        {supportsMultimodal ? (
          <button
            type="button"
            onClick={() => {
              setImageUrl("");
              setVideoUrl("");
              setImageFiles([]);
            }}
            style={{ marginLeft: 8, padding: "8px 18px" }}
          >
            清空附件
          </button>
        ) : null}
      </div>

      <section
        aria-live="polite"
        style={{
          marginTop: 24,
          minHeight: 180,
          padding: 16,
          border: "1px solid #d7e4f5",
          borderRadius: 8,
          background: "#fff",
          whiteSpace: "pre-wrap",
          lineHeight: 1.7,
        }}
      >
        <strong>答案</strong>
        <div style={{ marginTop: 12 }}>
          {error ? (
            <div style={{ color: "#b91c1c", whiteSpace: "pre-wrap" }}>{error}</div>
          ) : !answer.trim() ? (
            <div style={{ color: "#0f172a", lineHeight: 1.75, wordBreak: "break-word" }}>
              {isLoading ? "正在连接 AI..." : "提交问题后会在这里流式显示回答。"}
            </div>
          ) : (
            // 这里保留原始文本流，渲染时再交给 Markdown 组件。
            // 这样既能边生成边显示，也能安全地支持标题、列表、表格和代码块。
            <Suspense fallback={<div style={{ color: "#0f172a", lineHeight: 1.75 }}>{answer}</div>}>
              <MarkdownResponse
                content={answer}
                placeholder={isLoading ? "正在连接 AI..." : "提交问题后会在这里流式显示回答。"}
              />
            </Suspense>
          )}
        </div>
      </section>
    </main>
  );
}
