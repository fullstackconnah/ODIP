import type { MicrosoftRole } from '@/api/types'

/**
 * The server's start URL for Microsoft (GET /auth/config: ".../auth/microsoft/start?intent=signin") with another intent. link-tenant also says which role new
 * people get. The start must be a top-level GET on the server's public host, because the session cookie it needs is Secure and SameSite=Strict.
 */
export function microsoftStartHref(startUrl: string, intent: 'link-tenant' | 'link-account', defaultRole?: MicrosoftRole): string {
  const url = new URL(startUrl)
  url.searchParams.set('intent', intent)
  if (defaultRole) url.searchParams.set('defaultRole', defaultRole)
  return url.toString()
}
