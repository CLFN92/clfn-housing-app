// Shared maintenance-request plumbing for the two MR intake paths:
// tenant-mr (public QR flow) and applicant-intake (member portal report_mr).
// Both must stay byte-compatible on the storage path convention
// (tenants/<unitId>/tenant-mr/<submissionId>/photo-N.<ext>) because staff
// review resolves photos by that exact path (_tenantMrPhotoPaths in
// shared-data.js), and both staff emails are supposed to arrive the same way.
// Source must stay ASCII-only.

export const MR_MAX_PHOTOS = 3
export const MR_MAX_PHOTO_BYTES = 6 * 1024 * 1024
export const MR_PHOTO_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

// Decode a data: URL into { bytes, ext, contentType }, or null if unusable.
// The size cap is enforced on the BASE64 length BEFORE atob so an oversized
// blob is rejected without first being fully decoded into memory.
export function decodePhoto(dataUrl: string): { bytes: Uint8Array; ext: string; contentType: string } | null {
  if (typeof dataUrl !== 'string') return null
  const m = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/)
  if (!m) return null
  const contentType = m[1].toLowerCase()
  const ext = MR_PHOTO_MIME[contentType]
  if (!ext) return null
  if (m[2].length > MR_MAX_PHOTO_BYTES * 4 / 3 + 4) return null
  let bin: string
  try { bin = atob(m[2]) } catch { return null }
  if (bin.length > MR_MAX_PHOTO_BYTES) return null
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, ext, contentType }
}

// Upload validated photos with the service role. Returns the storage paths
// that uploaded cleanly; a failed photo is skipped so it can never sink the
// request. The raw list is bounded up front so an attacker cannot make the
// loop chew through an unbounded array of bad candidates.
export async function uploadMrPhotos(admin: any, bucket: string, unitId: string, submissionId: string, raw: unknown): Promise<string[]> {
  let list: unknown[] = []
  if (Array.isArray(raw)) list = raw
  else if (typeof raw === 'string' && raw) list = [raw]
  list = list.slice(0, MR_MAX_PHOTOS * 2)
  if (!list.length) return []
  const paths: string[] = []
  for (let i = 0; i < list.length && paths.length < MR_MAX_PHOTOS; i++) {
    const dec = decodePhoto(String(list[i] || ''))
    if (!dec) continue
    const path = 'tenants/' + unitId + '/tenant-mr/' + submissionId + '/photo-' + (paths.length + 1) + '.' + dec.ext
    try {
      const { error } = await admin.storage.from(bucket)
        .upload(path, dec.bytes, { contentType: dec.contentType, upsert: true })
      if (!error) paths.push(path)
    } catch (_e) { /* skip this photo, keep the request */ }
  }
  return paths
}

// The urgency-prefixed staff-email subject both MR paths use.
export function mrSubject(urgency: string, address: string): string {
  const urg = (urgency || 'routine').toLowerCase()
  return (urg === 'emergency' ? 'EMERGENCY ' : urg === 'urgent' ? 'Urgent ' : '')
    + 'maintenance request - ' + (address || 'a unit')
}

// Resolve the housing recipients for a staff notification: an explicit
// address list first, then active staff in the configured roles. Deduped,
// lowercased keys. Never throws.
export async function resolveStaffRecipients(
  admin: any, roles: string[], explicitTo: string[],
  isValidEmail: (s: string) => boolean,
): Promise<Array<{ to: string; to_name?: string }>> {
  const seen = new Set<string>()
  const out: Array<{ to: string; to_name?: string }> = []
  for (const e of explicitTo) {
    const k = e.toLowerCase()
    if (!seen.has(k)) { seen.add(k); out.push({ to: e }) }
  }
  try {
    const { data } = await admin.from('staff').select('email, name, role, is_active').eq('is_active', true)
    for (const s of (data || [])) {
      if (roles.indexOf(String(s.role || '').toLowerCase()) === -1) continue
      if (!isValidEmail(s.email)) continue
      const k = String(s.email).toLowerCase()
      if (seen.has(k)) continue
      seen.add(k); out.push({ to: s.email, to_name: s.name || undefined })
    }
  } catch (_e) { /* explicit list only */ }
  return out
}
