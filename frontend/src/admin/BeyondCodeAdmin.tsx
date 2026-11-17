import CrudTable from './CrudTable'

export default function BeyondCodeAdmin() {
  return (
    <>
      <h1 className="ad-h1">Beyond the code</h1>
      <CrudTable
        title="Hobbies & interests"
        table="beyond_code_items"
        note="Manage the cards in the public Beyond the Code section. Uncheck “Visible” to hide an item without deleting it."
        fields={[
          { key: 'title', label: 'Title', required: true, wide: true },
          { key: 'category', label: 'Category', required: true },
          { key: 'placeholder_type', label: 'Icon', type: 'select', options: [{ value: 'audio', label: 'Music' }, { value: 'photo', label: 'Cycling / outdoors' }] },
          { key: 'description', label: 'Description', type: 'textarea', required: true, hint: 'Only the first sentence is shown on the public card.' },
          { key: 'sort_order', label: 'Order', type: 'number' },
          { key: 'visible', label: 'Visible', type: 'checkbox' },
        ]}
        defaults={{ title: '', category: '', placeholder_type: 'audio', description: '', sort_order: 1, visible: true }}
        label={(row) => row.title}
        addLabel="Add a hobby or interest"
      />
    </>
  )
}
