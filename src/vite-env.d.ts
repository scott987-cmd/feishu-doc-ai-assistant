/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEISHU_APP_ID?: string
  readonly VITE_FEISHU_APP_SECRET?: string
  readonly VITE_DEFAULT_REGISTRY_URL?: string
  readonly VITE_ALLOWED_CIDRS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
