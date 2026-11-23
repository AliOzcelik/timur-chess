import type { ReactNode } from 'react'

/** The page masthead: eyebrow (section / page), title, a meta line and the page's actions. */
export function Masthead({ section, page, title, sub, actions, crumb }: {
  section: 'Study' | 'Train' | 'Settings' | string
  page?: string
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  /** Optional link back, shown in the eyebrow instead of the plain page label. */
  crumb?: { href: string; label: string }
}) {
  return (
    <header className="masthead">
      <div className="masthead-text">
        <p className="eyebrow">
          {section}
          {(page || crumb) && <span className="sep">/</span>}
          {crumb ? <a className="quiet" href={crumb.href}>{crumb.label}</a> : page && <span className="quiet">{page}</span>}
        </p>
        <h1>{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  )
}

/** Meta line pieces separated by small dots. */
export function Meta({ items }: { items: ReactNode[] }) {
  const shown = items.filter((x) => x !== null && x !== undefined && x !== false && x !== '')
  return (
    <>
      {shown.map((item, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <span className="sep" aria-hidden="true" />}
          <span>{item}</span>
        </span>
      ))}
    </>
  )
}
