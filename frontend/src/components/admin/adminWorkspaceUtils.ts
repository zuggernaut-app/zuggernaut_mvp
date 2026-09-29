export function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function readContactFromMethods(contactMethods: unknown): { email: string; phone: string } {
  if (!contactMethods || typeof contactMethods !== 'object') {
    return { email: '', phone: '' }
  }
  const contact = contactMethods as Record<string, unknown>
  const email =
    Array.isArray(contact.emails) && contact.emails[0] ? String(contact.emails[0]) : ''
  const phone =
    Array.isArray(contact.phones) && contact.phones[0] ? String(contact.phones[0]) : ''
  return { email, phone }
}

export function buildContactMethods(email: string, phone: string): Record<string, string[]> {
  const contact: Record<string, string[]> = {}
  const trimmedEmail = email.trim()
  const trimmedPhone = phone.trim()
  if (trimmedEmail) contact.emails = [trimmedEmail]
  if (trimmedPhone) contact.phones = [trimmedPhone]
  return contact
}

export function needsOAuthRepair(reason: string | undefined): boolean {
  return reason === 'needs_reauth' || reason === 'token_expired' || reason === 'missing_tokens'
}
