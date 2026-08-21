import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import type { UploadedFile } from "./upload-file";

export async function extractPlainText(file: UploadedFile) {
  const name = file.originalname.toLowerCase();
  if (name.endsWith(".md") || name.endsWith(".txt")) {
    return file.buffer.toString("utf8");
  }
  if (name.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }
  if (name.endsWith(".pdf")) {
    const result = await pdfParse(file.buffer);
    return result.text;
  }
  throw new Error("暂不支持该文件格式");
}
