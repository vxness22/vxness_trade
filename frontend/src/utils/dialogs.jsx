// Toast-based replacements for the native window.confirm / window.prompt dialogs,
// styled to match the app's dark theme. Both return Promises.
//
//   if (!(await confirmToast('Delete this?'))) return
//   const reason = await promptToast('Enter reason:')   // null if cancelled
import toast from 'react-hot-toast'

const boxStyle = {
  background: '#1a1a1a',
  color: '#fff',
  border: '1px solid #333',
  maxWidth: '380px',
  padding: '14px',
}

const btnBase = {
  padding: '6px 14px',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
}

export function confirmToast(message, opts = {}) {
  const { confirmText = 'Confirm', cancelText = 'Cancel', danger = true } = opts
  return new Promise((resolve) => {
    toast(
      (t) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <span style={{ fontSize: '14px', lineHeight: 1.4, whiteSpace: 'pre-line' }}>{message}</span>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              style={{ ...btnBase, background: '#3a3a3a', color: '#fff' }}
              onClick={() => { toast.dismiss(t.id); resolve(false) }}
            >
              {cancelText}
            </button>
            <button
              style={{ ...btnBase, background: danger ? '#dc2626' : '#2563eb', color: '#fff' }}
              onClick={() => { toast.dismiss(t.id); resolve(true) }}
            >
              {confirmText}
            </button>
          </div>
        </div>
      ),
      { duration: Infinity, style: boxStyle }
    )
  })
}

export function promptToast(message, opts = {}) {
  const { defaultValue = '', confirmText = 'Submit', cancelText = 'Cancel', placeholder = '' } = opts
  return new Promise((resolve) => {
    let value = defaultValue
    toast(
      (t) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '300px' }}>
          <span style={{ fontSize: '14px', lineHeight: 1.4, whiteSpace: 'pre-line' }}>{message}</span>
          <input
            autoFocus
            defaultValue={defaultValue}
            placeholder={placeholder}
            onChange={(e) => { value = e.target.value }}
            onKeyDown={(e) => { if (e.key === 'Enter') { toast.dismiss(t.id); resolve(value) } }}
            style={{ background: '#0d0d0d', border: '1px solid #444', borderRadius: '6px', padding: '7px 10px', fontSize: '13px', color: '#fff', outline: 'none' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              style={{ ...btnBase, background: '#3a3a3a', color: '#fff' }}
              onClick={() => { toast.dismiss(t.id); resolve(null) }}
            >
              {cancelText}
            </button>
            <button
              style={{ ...btnBase, background: '#2563eb', color: '#fff' }}
              onClick={() => { toast.dismiss(t.id); resolve(value) }}
            >
              {confirmText}
            </button>
          </div>
        </div>
      ),
      { duration: Infinity, style: boxStyle }
    )
  })
}
