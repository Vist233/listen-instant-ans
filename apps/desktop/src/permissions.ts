/**
 * The window may use the microphone, and nothing else (no camera, location,
 * notifications...), and only for the page this program serves itself.
 */
export interface PermissionDetails {
  readonly requestingUrl?: string
  /** Set on permission requests: which kinds of media the page asked for. */
  readonly mediaTypes?: readonly string[]
  /** Set on permission checks. */
  readonly mediaType?: string
}

function sameOrigin(url: string | undefined, origin: string): boolean {
  if (url === undefined || url === '') return false
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

export function isAllowedPermission(permission: string, details: PermissionDetails, origin: string): boolean {
  if (permission !== 'media') return false
  if (!sameOrigin(details.requestingUrl, origin)) return false
  const types = details.mediaTypes ?? []
  return types.length > 0 && types.every((type) => type === 'audio')
}

export function isAllowedPermissionCheck(permission: string, requestingOrigin: string, details: PermissionDetails, origin: string): boolean {
  if (permission !== 'media') return false
  if (!sameOrigin(details.requestingUrl ?? requestingOrigin, origin)) return false
  return details.mediaType === 'audio'
}
