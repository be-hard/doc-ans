# docs-ans Doc Beta 1.0

冷蓝调 AI 文档工作台第一版。

## 启动

```bash
pnpm install
pnpm dev
```

- 前端：`http://localhost:5173`
- 后端：`http://localhost:4000`

## 说明

- 左侧：文档列表、新建、导入
- 中间：Tiptap 编辑器、保存、入库、续写
- 右侧：知识库问答、来源、SSE 流式答案

## API

- `GET /health`
- `GET /documents`
- `POST /documents`
- `PATCH /documents/:id`
- `POST /documents/:id/save`
- `POST /documents/:id/ingest`
- `POST /knowledge/search`
- `POST /knowledge/answer`
- `POST /files/import`

## 备注

- 第一版默认使用内存存储，链路完整但不依赖外部数据库。
- 如果配置 `OPENAI_BASE_URL` 和 `OPENAI_API_KEY`，SSE 回答会切换到 OpenAI 兼容接口。
- 关键流程已写注释，方便后续把内存实现替换成 Prisma / Qdrant / BullMQ。
