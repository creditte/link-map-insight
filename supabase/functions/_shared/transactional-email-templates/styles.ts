export const emailStyles = {
  main: {
    backgroundColor: '#ffffff',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  container: { padding: '40px 32px', maxWidth: '480px', margin: '0 auto' },
  brand: {
    fontSize: '18px',
    fontWeight: 'bold' as const,
    color: '#2563c7',
    margin: '0 0 32px',
    letterSpacing: '-0.5px',
  },
  h1: {
    fontSize: '22px',
    fontWeight: 'bold' as const,
    color: '#1a1f2e',
    margin: '0 0 16px',
  },
  text: { fontSize: '14px', color: '#6b7280', lineHeight: '1.6', margin: '0 0 20px' },
  button: {
    backgroundColor: '#2563c7',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '600' as const,
    borderRadius: '10px',
    padding: '12px 24px',
    textDecoration: 'none',
  },
  footer: { fontSize: '12px', color: '#999999', margin: '24px 0 0', lineHeight: '1.5' },
}

export const SITE_NAME = 'strukcha'
export const SITE_URL = 'https://strukcha.app'
/** Single source of truth for the support/feedback inbox. */
export const SUPPORT_EMAIL = 'support@strukcha.app'

export function formatEmailDate(iso?: string | null): string {
  if (!iso) return 'soon'
  try {
    return new Date(iso).toLocaleDateString('en-AU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

export function formatPlanName(plan?: string | null): string {
  if (!plan) return 'your plan'
  const p = plan.toLowerCase()
  if (p === 'pro') return 'Pro'
  if (p === 'starter') return 'Starter'
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

export function formatRoleName(role?: string | null): string {
  if (!role) return 'member'
  if (role === 'owner') return 'Owner'
  if (role === 'admin') return 'Admin'
  if (role === 'user') return 'User'
  return role
}
