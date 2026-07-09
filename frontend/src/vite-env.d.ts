/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** SHA-256 hex of the dev-preview password; set only in dev-branch builds. */
  readonly VITE_DEV_GATE_HASH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
