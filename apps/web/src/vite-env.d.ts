/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_RELEASE?: string;
  readonly VITE_BUILD_COMMIT?: string;
  readonly VITE_BUILD_DATE?: string;
}
