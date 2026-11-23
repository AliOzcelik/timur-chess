// Small stroke icons drawn for this app (24px grid, currentColor).
const PATHS: Record<string, string> = {
  board: 'M4 4h16v16H4zM4 12h16M12 4v16M4 4l8 8M12 12l8 8',
  review: 'M4 19V5M4 19h16M7 15l4-5 3 3 5-7',
  library: 'M5 4h4v16H5zM10 4h4v16h-4zM15.5 5l3.8-1 3 15.4-3.8 1z',
  notes: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5',
  endgame: 'M12 3v3M10.5 4.5h3M9 9h6l-1 4h-4zM8 17h8l1 4H7z M10 13h4v4h-4z',
  practice: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  prep: 'M7 3v4M17 3v4M4 8h16M5 5h14v15H5zM9 13l2 2 4-4',
  flip: 'M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  import: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  copy: 'M8 8h11v13H8zM5 16V3h11',
  first: 'M6 5v14M18 6l-7 6 7 6z',
  prev: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  last: 'M18 5v14M6 6l7 6-7 6z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  promote: 'M12 19V5M6 11l6-6 6 6',
  target: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  power: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
  arrows: 'M5 19L19 5M19 5h-7M19 5v7',
  retry: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  file: 'M6 3h9l4 4v14H6zM15 3v4h4',
  check: 'M5 12l5 5 9-10',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4',
}

export function Icon({ name, size = 18, title }: { name: keyof typeof PATHS | string; size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name] ?? ''} />
    </svg>
  )
}
