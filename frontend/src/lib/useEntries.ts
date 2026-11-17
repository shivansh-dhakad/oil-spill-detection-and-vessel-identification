import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface EntryItem {
  id: string
  kind: 'certification' | 'achievement' | 'experience'
  title: string
  issuer: string | null
  description: string | null
  dateLabel: string | null
  url: string | null // optional "verify credential" link
  fileUrl: string | null // uploaded certificate (image or PDF)
  fileType: 'image' | 'pdf' | null
}

const IMAGE_EXT = /\.(png|jpe?g|webp|avif)$/i

// Certifications and achievements from the `entries` table. Empty list = section stays hidden.
export function useEntries(): EntryItem[] {
  const [entries, setEntries] = useState<EntryItem[]>([])

  useEffect(() => {
    if (!supabase) return
    const db = supabase
    let cancelled = false

    ;(async () => {
      const { data, error } = await db
        .from('entries')
        .select('*')
        .eq('visible', true)
        .in('kind', ['certification', 'achievement'])
        .order('sort_order')
      if (cancelled || error || !data) return

      setEntries(
        data.map((row) => {
          const path: string | null = row.file_path ?? null
          return {
            id: row.id,
            kind: row.kind,
            title: row.title,
            issuer: row.issuer ?? null,
            description: row.description ?? null,
            dateLabel: row.date_label ?? null,
            url: row.url ?? null,
            fileUrl: path ? db.storage.from('certificates').getPublicUrl(path).data.publicUrl : null,
            fileType: path ? (IMAGE_EXT.test(path) ? 'image' : 'pdf') : null,
          } as EntryItem
        }),
      )
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return entries
}
