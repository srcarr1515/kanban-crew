/**
 * True when running against the local Rust backend (no cloud/Electric sync).
 * In local-web dev mode VITE_VK_SHARED_API_BASE is empty string / undefined.
 */
export const IS_LOCAL_MODE =
  !import.meta.env.VITE_VK_SHARED_API_BASE ||
  import.meta.env.VITE_VK_SHARED_API_BASE === '';
