import { describe, expect, it } from 'vitest'

import { buildOAuthRedirectUrl } from './useSupabaseAuth'

describe('buildOAuthRedirectUrl', () => {
  it('returns to the event share path after Google sign-in', () => {
    expect(buildOAuthRedirectUrl({
      origin: 'https://polaris.example',
      pathname: '/e/share-token',
      search: '',
    })).toBe('https://polaris.example/e/share-token')
  })

  it('preserves query parameters without carrying an OAuth hash', () => {
    expect(buildOAuthRedirectUrl({
      origin: 'http://localhost:5173',
      pathname: '/e/share-token',
      search: '?source=line',
    })).toBe('http://localhost:5173/e/share-token?source=line')
  })
})
