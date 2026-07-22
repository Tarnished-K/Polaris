import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'

import { getSupabaseClient, readSupabaseConfig } from './supabase'

export interface SupabaseAuthState {
  configured: boolean
  loading: boolean
  user: User | null
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

export function useSupabaseAuth(): SupabaseAuthState {
  const config = useMemo(readSupabaseConfig, [])
  const client = useMemo(() => getSupabaseClient(config), [config])
  const [loading, setLoading] = useState(Boolean(client))
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    if (!client) return
    let active = true

    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) console.error('Supabase session restore failed', error)
      setUser(data.session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [client])

  const signInWithGoogle = useCallback(async () => {
    if (!client) throw new Error('Supabaseの接続設定がありません')
    const redirectTo = new URL('/', window.location.origin).toString()
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (error) throw error
  }, [client])

  const signOut = useCallback(async () => {
    if (!client) return
    const { error } = await client.auth.signOut()
    if (error) throw error
  }, [client])

  return { configured: Boolean(client), loading, user, signInWithGoogle, signOut }
}
