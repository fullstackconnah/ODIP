import { PLATFORM_INFO, type PlatformInfo } from '../src/lib/platformInfo'
import { platformFacts } from '../src/lib/platformFacts'

/**
 * Fills the landing's config-bound elements ([data-platform], in the footer and the form's notice) from the app's own facts module.
 * Each ships `hidden` (and a fact ships empty), and shows only when its value passes platformFacts' check, so with JavaScript off, or a value
 * missing or malformed, nothing false shows. A column ([data-platform-group]) shows only when something in it does.
 */
export function initPlatformFacts(root: ParentNode = document, info: PlatformInfo = PLATFORM_INFO, today = new Date()): void {
  const { company, abn, copyright, supportEmail, statusUrl, legal } = platformFacts(info, today)
  const show = (key: string, fill: (el: HTMLElement) => void = () => {}) => {
    root.querySelectorAll<HTMLElement>(`[data-platform="${key}"]`).forEach((el) => {
      fill(el)
      el.hidden = false
    })
  }
  if (company) {
    show('companyName', (el) => (el.textContent = company))
    show('collector', (el) => (el.textContent = ' (' + company + ')'))
  }
  if (abn) show('abn', (el) => (el.textContent = `ABN ${abn}`))
  if (copyright) show('copyright', (el) => (el.textContent = copyright))
  if (supportEmail) {
    show('supportEmail', (el) => {
      const link = el.querySelector('a')!
      link.href = `mailto:${supportEmail}`
      link.textContent = supportEmail
    })
  }
  if (statusUrl) show('statusUrl', (el) => (el.querySelector('a')!.href = statusUrl))
  if (legal) ['privacy', 'terms', 'privacyNotice'].forEach((key) => show(key))
  root.querySelectorAll<HTMLElement>('[data-platform-group]').forEach((group) => {
    group.hidden = !group.querySelector('[data-platform]:not([hidden])')
  })
}
