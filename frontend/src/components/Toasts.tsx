import { useToasts } from '../state/toast'
import { Icon } from './Icon'

export function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <Icon name={t.kind === 'error' ? 'info' : 'check'} size={16} />
          <span>{t.text}</span>
          <button type="button" className="icon-btn" style={{ width: 24, height: 24, marginLeft: 'auto' }} onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
