export default function StateNotice({ kind, message }: { kind: 'loading' | 'error'; message?: string }) {
  return (
    <p className={`notice notice-${kind}`} role="status">
      {kind === 'loading' ? 'Loading the latest content…' : message || 'Could not load the latest content from Supabase.'}
    </p>
  )
}
