import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

// Only the public anon key is used here. Row-level security in the database
// decides what visitors can read and who can write.
export const supabase = url && key ? createClient(url, key) : null
