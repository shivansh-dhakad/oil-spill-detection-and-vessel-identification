import { supabase } from '../lib/supabase'

export function client() {
  if (!supabase) throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  return supabase
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

// Unwraps a Supabase response or throws a readable error.
export async function run<T = any>(
  req: PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await req
  if (error) throw new Error(error.message)
  return data as T
}

export async function count(table: string, filter?: (q: any) => any): Promise<number> {
  let q: any = client().from(table).select('id', { count: 'exact', head: true })
  if (filter) q = filter(q)
  const { count: n, error } = await q
  if (error) throw new Error(error.message)
  return n ?? 0
}
