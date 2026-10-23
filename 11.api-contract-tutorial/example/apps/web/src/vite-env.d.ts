/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 跨源部署时 API 的源，例如 https://api.example.com；同源部署不设置 */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
