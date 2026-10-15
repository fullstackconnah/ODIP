/** package.json's version, written in by the `define` in vite.config.ts (vitest copies it onto globalThis). */
declare const __APP_VERSION__: string

export type PlatformInfo = {
  companyName: string | null
  abn: string | null
  supportEmail: string | null
  statusUrl: string | null
  legalPublished: boolean
  version: string | undefined
  buildSha: string | undefined
}

/**
 * The platform operator's public facts, shown by PlatformFooter and the /welcome/ footer through platformFacts().
 * null hides whatever shows the value: never put a placeholder here. Data only: the capture script replaces this module.
 */
export const PLATFORM_INFO: PlatformInfo = {
  companyName: null, // the registered legal name; the business isn't registered yet
  abn: null, // 11 digits, spaces allowed
  supportEmail: null, // not given yet
  statusUrl: null, // https only; there is no status page yet
  legalPublished: false, // true only in the PR that commits the approved documents (guarded by src/test/publicRoutes.test.tsx)
  version: __APP_VERSION__, // package.json; hidden while it is 0.0.0
  buildSha: import.meta.env.VITE_BUILD_SHA, // the deploy's build arg; hidden unless it is a hex sha
}
