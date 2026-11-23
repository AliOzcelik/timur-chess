// Stroke icons from the design system (24px grid, 1.7 stroke, currentColor).
// Markup comes from design/mockup.html; a few app-only icons are added at the end.
const ICONS: Record<string, string> = {
  "board": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2.2\"/><path d=\"M3 9h18M3 15h18M9 3v18M15 3v18\"/>",
  "review": "<path d=\"M4 4v16h16\"/><path d=\"M7.5 15.5l3.8-4.6 3 3 4.7-6.4\"/><circle cx=\"19\" cy=\"7.5\" r=\"1.4\" fill=\"currentColor\" stroke=\"none\"/>",
  "library": "<path d=\"M4.5 5A1.5 1.5 0 016 3.5h3.5v17H6A1.5 1.5 0 014.5 19zM9.5 3.5H13v17H9.5z\"/><path d=\"M13.6 4.9l3.7.9-3 15-3.7-.9\"/>",
  "notes": "<path d=\"M6 3.5h8.5L19 8v12.5H6z\"/><path d=\"M14 3.5V8h5M9 12h7M9 15.5h5\"/>",
  "endgame": "<path d=\"M4.5 8l4 3.5L12 5l3.5 6.5 4-3.5v9.5h-15z\"/><path d=\"M4.5 20.5h15\"/>",
  "practice": "<circle cx=\"12\" cy=\"12\" r=\"8.2\"/><circle cx=\"12\" cy=\"12\" r=\"4\"/><circle cx=\"12\" cy=\"12\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/>",
  "prep": "<rect x=\"3.5\" y=\"5\" width=\"17\" height=\"15\" rx=\"2\"/><path d=\"M3.5 9.5h17M8 3v4M16 3v4\"/><path d=\"M8.5 14h2M13.5 14h2M8.5 17.2h2\"/>",
  "settings": "<path d=\"M4 7h9.5M17.5 7H20M4 17h2M10 17h10\"/><circle cx=\"15.5\" cy=\"7\" r=\"2.1\"/><circle cx=\"8\" cy=\"17\" r=\"2.1\"/>",
  "search": "<circle cx=\"10.5\" cy=\"10.5\" r=\"6.2\"/><path d=\"M15.3 15.3L20.5 20.5\"/>",
  "plus": "<path d=\"M12 5v14M5 12h14\"/>",
  "flip": "<path d=\"M7.5 4.5v15m0 0l-3-3m3 3l3-3M16.5 19.5v-15m0 0l-3 3m3-3l3 3\"/>",
  "edit": "<path d=\"M4 20l4.2-1L19 8.2 15.8 5 5 15.8z\"/><path d=\"M13.8 6.8l3.4 3.4\"/>",
  "import": "<path d=\"M12 4v10m0 0l-3.6-3.6M12 14l3.6-3.6\"/><path d=\"M4.5 16.5V20h15v-3.5\"/>",
  "copy": "<rect x=\"8.5\" y=\"8.5\" width=\"11.5\" height=\"11.5\" rx=\"2\"/><path d=\"M16 8.5V5A1.5 1.5 0 0014.5 3.5H5A1.5 1.5 0 003.5 5v9.5A1.5 1.5 0 005 16h3.5\"/>",
  "save": "<path d=\"M6.5 3.5h11v17L12 16.8l-5.5 3.7z\"/>",
  "check": "<path d=\"M4.5 12.5l4.8 4.8L19.5 7\"/>",
  "chev": "<path d=\"M9 5l7 7-7 7\"/>",
  "chevd": "<path d=\"M5 9l7 7 7-7\"/>",
  "first": "<path d=\"M18 5v14M15.5 12L6.5 6v12z\"/>",
  "prev": "<path d=\"M15 5.5L7.5 12l7.5 6.5z\"/>",
  "next": "<path d=\"M9 5.5l7.5 6.5L9 18.5z\"/>",
  "last": "<path d=\"M6 5v14M8.5 12l9-6v12z\"/>",
  "target": "<circle cx=\"12\" cy=\"12\" r=\"8\"/><circle cx=\"12\" cy=\"12\" r=\"3.4\"/>",
  "arrow-ur": "<path d=\"M7 17L17 7M9 7h8v8\"/>",
  "dots": "<circle cx=\"6\" cy=\"12\" r=\"1.4\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"12\" cy=\"12\" r=\"1.4\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"18\" cy=\"12\" r=\"1.4\" fill=\"currentColor\" stroke=\"none\"/>",
  "pin": "<path d=\"M9 3.5h6l-1 6 3 3V15H7v-2.5l3-3zM12 15v5.5\"/>",
  "trash": "<path d=\"M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13\"/>",
  "calendar": "<rect x=\"3.5\" y=\"5\" width=\"17\" height=\"15\" rx=\"2\"/><path d=\"M3.5 9.5h17M8 3v4M16 3v4\"/>",
  "clock": "<circle cx=\"12\" cy=\"12\" r=\"8.2\"/><path d=\"M12 7.5V12l3 2\"/>",
  "spark": "<path d=\"M12 3.5l1.9 5.4 5.6 1.9-5.6 1.9L12 18.1l-1.9-5.4L4.5 10.8l5.6-1.9z\"/>",
  "eye": "<path d=\"M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  "info": "<circle cx=\"12\" cy=\"12\" r=\"8.2\"/><path d=\"M12 11v5.5M12 7.7v.4\"/>",
  "download": "<path d=\"M12 4v11m0 0l-4-4m4 4l4-4M4.5 20h15\"/>",
  "upload": "<path d=\"M12 15V4m0 0L8 8m4-4l4 4M4.5 20h15\"/>",
  "close": "<path d=\"M6 6l12 12M18 6L6 18\"/>",
  "menu": "<path d=\"M4 7h16M4 12h16M4 17h16\"/>",
  "play": "<path d=\"M8 5.5l11 6.5-11 6.5z\"/>",
  "refresh": "<path d=\"M19.5 12a7.5 7.5 0 11-2.2-5.3\"/><path d=\"M19.5 4v4h-4\"/>",
  "flame": "<path d=\"M12 3.5c3 4 6 6.3 6 10a6 6 0 11-12 0c0-2.2 1-4.2 2.5-5.7.4 2 1.4 3.2 2.5 3.7C11.5 8.7 12 6 12 3.5z\"/>",
  "link": "<path d=\"M9.5 14.5l5-5M7.8 17.8l-1 .9a3.4 3.4 0 01-4.8-4.8l2.8-2.8A3.4 3.4 0 019.6 11M16.2 6.2l1-.9a3.4 3.4 0 014.8 4.8l-2.8 2.8a3.4 3.4 0 01-4.8 0\"/>",
  "external": "<path d=\"M13 4h7v7M20 4l-8.5 8.5\"/><path d=\"M18 14v5a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 19V7.5A1.5 1.5 0 015 6h5\"/>",
  "grid": "<rect x=\"3.5\" y=\"3.5\" width=\"7\" height=\"7\" rx=\"1.4\"/><rect x=\"13.5\" y=\"3.5\" width=\"7\" height=\"7\" rx=\"1.4\"/><rect x=\"3.5\" y=\"13.5\" width=\"7\" height=\"7\" rx=\"1.4\"/><rect x=\"13.5\" y=\"13.5\" width=\"7\" height=\"7\" rx=\"1.4\"/>",
  "flag": "<path d=\"M6 21V4m0 0c3-2 6 1.5 9 0v8c-3 1.5-6-2-9 0\"/>",
  "book": "<path d=\"M4 5.5A2.5 2.5 0 016.5 3H20v17.5H6.5A2.5 2.5 0 004 23z\"/><path d=\"M4 5.5V23M8 7h8\"/>",
  "people": "<circle cx=\"9\" cy=\"8.5\" r=\"3.2\"/><path d=\"M3.5 19.5c0-3.2 2.4-5.2 5.5-5.2s5.5 2 5.5 5.2\"/><path d=\"M16 5.7a3.2 3.2 0 010 5.7M17 14.4c2.2.5 3.5 2.3 3.5 5.1\"/>",
  "arrows": "<path d=\"M7 17L17 7M9 7h8v8\"/>",
  "retry": "<path d=\"M19.5 12a7.5 7.5 0 11-2.2-5.3\"/><path d=\"M19.5 4v4h-4\"/>",
  "promote": "<path d=\"M12 19V5M6 11l6-6 6 6\"/>",
  "power": "<path d=\"M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0\"/>",
  "bulb": "<path d=\"M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z\"/>",
  "file": "<path d=\"M6 3h9l4 4v14H6zM15 3v4h4\"/>",
}

export function Icon({ name, size = 18, title, className }: { name: string; size?: number; title?: string; className?: string }) {
  return (
    <svg
      className={className ? `i ${className}` : 'i'}
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
      <g dangerouslySetInnerHTML={{ __html: ICONS[name] ?? '' }} />
    </svg>
  )
}
