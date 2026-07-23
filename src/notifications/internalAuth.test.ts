import { describe, expect, it } from 'vitest'
import { matchesServiceRoleAuthorization } from '../../supabase/functions/_shared/internal-auth'

describe('matchesServiceRoleAuthorization', () => {
  const serviceRoleKey = 'service-role-secret'

  it('accepts the exact service-role bearer', () => {
    expect(matchesServiceRoleAuthorization(`Bearer ${serviceRoleKey}`, serviceRoleKey)).toBe(true)
  })

  it('rejects a different bearer', () => {
    expect(matchesServiceRoleAuthorization('Bearer another-secret', serviceRoleKey)).toBe(false)
  })

  it('rejects bearer prefixes and suffixes', () => {
    expect(matchesServiceRoleAuthorization(`prefix Bearer ${serviceRoleKey}`, serviceRoleKey)).toBe(false)
    expect(matchesServiceRoleAuthorization(`Bearer ${serviceRoleKey} suffix`, serviceRoleKey)).toBe(false)
  })

  it('rejects missing values and an empty configured secret', () => {
    expect(matchesServiceRoleAuthorization(null, serviceRoleKey)).toBe(false)
    expect(matchesServiceRoleAuthorization('', serviceRoleKey)).toBe(false)
    expect(matchesServiceRoleAuthorization('Bearer ', '')).toBe(false)
  })
})
