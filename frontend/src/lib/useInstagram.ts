import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Instagram link saved from Admin > Profile > Instagram (stored in social_links with label "Instagram").
// null = not set yet, so the site shows "coming soon".
export function useInstagram(): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    const db = supabase
    let cancelled = false

    ;(async () => {
      const { data, error } = await db
        .from('social_links')
        .select('url,label')
        .eq('visible', true)
        .ilike('label', 'instagram')
        .limit(1)
      if (cancelled || error || !data?.length) return
      const u = String(data[0].url ?? '').trim()
      setUrl(/^https?:\/\//i.test(u) ? u : null)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return url
}
