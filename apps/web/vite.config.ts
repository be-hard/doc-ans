import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/variables.scss" as vars;
        @use "@/styles/functions.scss" as funcs;
        @use "@/styles/mixins.scss" as mixins;
        `
      }
    }
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom/client",
      "react/jsx-dev-runtime",
      "react-router-dom",
      "react-markdown",
      "remark-gfm",
      "rehype-sanitize",
      "@tiptap/react",
      "@tiptap/starter-kit",
      "@tiptap/extension-placeholder",
      "@tiptap/extension-task-item",
      "@tiptap/extension-task-list",
      "@tiptap/extension-underline"
    ],
  },
  server: {
    port: 5173,
    strictPort: false,
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "./src/router/index.tsx",
        "./src/pages/Login/index.tsx"
      ]
    },
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  }
});
