# 部署说明

这套仓库现在走的是“GitHub 触发 + 本地 self-hosted runner 执行部署”的流程。

## 结构

1. `pnpm build`
   - 先编译 `packages/shared`
   - 再编译 `apps/api`
   - 最后编译 `apps/web`
   - 作用：确认代码在发布前可以完整通过编译

2. `docker-compose.prod.yml`
   - `api` 容器负责业务接口
   - `web` 容器负责静态站点和反向代理
   - `qdrant`、`postgres`、`redis` 负责基础设施
   - 作用：把应用和依赖服务一起编排起来

3. `deploy/nginx.conf`
   - 前端走静态文件
   - `/api/*` 转发到后端
   - 作用：让浏览器只访问一个站点地址，减少 CORS 问题

## 你需要准备

- 一台一直在线的本地机器或局域网机器
- Docker 和 Docker Compose
- GitHub 仓库里的 self-hosted runner
- runner 标签：`docs-ans-local`
- 可选环境变量：
  - `OPENAI_BASE_URL`
  - `OPENAI_API_KEY`

## runner 怎么装

在 GitHub 仓库里打开 `Settings -> Actions -> Runners -> New self-hosted runner`，按页面提示下载并配置到你的本地机器。

配置时给它加上标签 `docs-ans-local`，这样 workflow 才会把部署任务派给这台机器。

## CI/CD 流程

1. Pull Request 或 push 到 `main` 时触发 `CI`
   - 安装依赖
   - 执行 `pnpm typecheck`
   - 执行 `pnpm build`
   - 验证 API 和 Web 的 Docker 镜像能成功构建

2. `main` 分支上的 `CI` 成功后触发 `Deploy`
   - 在本地 self-hosted runner 上执行 `docker compose -f docker-compose.prod.yml up -d --build`
   - 重建并启动整套服务
   - 调用 `http://127.0.0.1/api/health` 做部署后健康检查

## 手动启动

如果你不想通过 workflow，也可以在本地机器直接执行：

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

## 回滚

本地部署的回滚最直接，重新执行上一个可用的提交即可。最稳的做法是：

1. 在 GitHub 上找到上一个成功的 commit
2. 把本地 runner 切到那个 commit
3. 重新跑 deploy workflow

## 为什么前端默认走 `/api`

这样开发环境和部署环境可以统一：

- 开发时，Vite 把 `/api` 代理到本地后端
- 部署时，Nginx 把 `/api` 代理到 API 容器

前端代码不需要因为环境不同而改来改去。
