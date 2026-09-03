/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** SHA-256 hex of the dev-preview password; set only in dev-branch builds. */
  readonly VITE_DEV_GATE_HASH?: string;
  /**
   * Which deployment this bundle is. `dev` marks the dev preview: it swaps in
   * the DEV app icon (see vite.config.ts) and puts a DEV chip in the header.
   * Anything else — `prod`, or unset as in local dev — is the plain AFISZ mark.
   */
  readonly VITE_APP_VARIANT?: 'dev' | 'prod';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
