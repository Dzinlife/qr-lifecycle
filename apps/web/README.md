# Web management app

Vite + React 管理端，只产出静态文件，不包含独立 Cloudflare Functions。
生产环境应由 API Worker 托管 `dist/`，或将静态产物部署在同域并把 SPA
未知路径回退到 `index.html`。

## Scripts

- `pnpm dev`：启动本地管理端，将 `/api`、`/health` 和 `/q` 代理到
  `http://localhost:8787`。
- `pnpm check`：运行严格 TypeScript 类型检查，不产生文件。
- `pnpm test`：运行 Vitest 与 Testing Library 测试。
- `pnpm test:watch`：监听模式运行测试。
- `pnpm build`：先类型检查，再生成 `dist/` 静态产物。

默认情况下 API 与管理端同源。若必须分离部署，将 `.env.example` 复制为
`.env.local`，并设置 `VITE_API_ORIGIN=https://your-worker.example.com`。
