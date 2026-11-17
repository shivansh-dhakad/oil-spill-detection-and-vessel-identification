import { useState } from 'react'
import { client, run } from './api'
import CrudTable, { type Row } from './CrudTable'
import { publicUrl, removeFile, uploadCertificate } from './upload'
import { Notice, useTask } from './ui'

type Tab = 'education' | 'certification' | 'achievement' | 'experience'
const TABS: { id: Tab; label: string }[] = [
  { id: 'education', label: 'Education' },
  { id: 'certification', label: 'Certifications' },
  { id: 'achievement', label: 'Achievements' },
  { id: 'experience', label: 'Experience' },
]

function FileControl({ row, patch }: { row: Row; patch: (p: Row) => void }) {
  const { busy, notice, task } = useTask()
  const apply = (path: string | null) =>
    task(async () => {
      const old = row.file_path
      await run(client().from('entries').update({ file_path: path }).eq('id', row.id))
      patch({ file_path: path })
      await removeFile('certificates', old)
      return path ? 'File attached.' : 'File removed.'
    })
  return (
    <div className="ad-filebox">
      {row.file_path ? (
        <p><a href={publicUrl('certificates', row.file_path)} target="_blank" rel="noopener noreferrer">Attached file ↗</a></p>
      ) : (
        <p className="ad-muted">No file attached.</p>
      )}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,application/pdf"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void task(async () => { const path = await uploadCertificate(f); await apply(path) })
        }}
      />
      {row.file_path && <button type="button" className="ad-btn danger" disabled={busy} onClick={() => void apply(null)}>Remove file</button>}
      <Notice n={notice} />
    </div>
  )
}

export default function ContentAdmin() {
  const [tab, setTab] = useState<Tab>('education')
  return (
    <>
      <h1 className="ad-h1">Education &amp; credentials</h1>
      <div className="ad-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`ad-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'education' ? (
        <CrudTable
          key="edu"
          title="Education entries"
          table="education"
          note="Shown publicly as College / School cards. Uncheck “Visible” to hide an entry."
          fields={[
            { key: 'institute', label: 'Institute', required: true, wide: true },
            { key: 'degree', label: 'Degree / what you studied', wide: true },
            { key: 'level', label: 'Type', type: 'select', options: [{ value: 'college', label: 'College' }, { value: 'school', label: 'School' }] },
            { key: 'start_year', label: 'Start year', type: 'number', nullable: true },
            { key: 'end_year', label: 'End year', type: 'number', nullable: true },
            { key: 'sort_order', label: 'Order', type: 'number' },
            { key: 'visible', label: 'Visible', type: 'checkbox' },
          ]}
          defaults={{ institute: '', degree: '', level: 'college', start_year: '', end_year: '', sort_order: 1, visible: true }}
          label={(r) => r.institute}
          addLabel="Add education"
        />
      ) : (
        <CrudTable
          key={tab}
          title={TABS.find((t) => t.id === tab)!.label}
          table="entries"
          filter={['kind', tab]}
          note={tab === 'experience' ? 'Experience is stored here; the public site currently shows certifications and achievements only.' : 'The public section stays hidden until at least one visible entry exists.'}
          fields={[
            { key: 'title', label: 'Title', required: true, wide: true },
            { key: 'issuer', label: 'Issuer / organisation' },
            { key: 'date_label', label: 'Date label', hint: 'e.g. “Aug 2025”' },
            { key: 'url', label: 'Verification link', type: 'url' },
            { key: 'sort_order', label: 'Order', type: 'number' },
            { key: 'visible', label: 'Visible', type: 'checkbox' },
            { key: 'description', label: 'Description', type: 'textarea' },
          ]}
          defaults={{ title: '', issuer: '', date_label: '', url: '', description: '', sort_order: 1, visible: true }}
          extraKeys={['file_path']}
          extra={(row, patch) => <FileControl row={row} patch={patch} />}
          label={(r) => r.title}
          addLabel={`Add ${tab}`}
        />
      )}
    </>
  )
}
