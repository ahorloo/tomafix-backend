const ADMIN_ALLOWLIST_ENV = 'ADMIN_ALLOWED_EMAILS';

export function getAllowedAdminEmails(): Set<string> | null {
  const raw = process.env[ADMIN_ALLOWLIST_ENV];
  if (!raw) return null;

  const values = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (!values.length) return null;
  return new Set(values);
}

export function isAdminEmailAllowed(email?: string | null): boolean {
  const allowed = getAllowedAdminEmails();
  if (!allowed) return true;
  return !!email && allowed.has(email.trim().toLowerCase());
}

