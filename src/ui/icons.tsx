// Inline SVG icons (no icon library). All are decorative: give the button an aria-label.

type P = { className?: string }
const base = (className = 'size-5') => ({
  className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
})

export const IconDie = ({ className }: P) => (
  <svg {...base(className)}><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" /></svg>
)
export const IconPencil = ({ className }: P) => (
  <svg {...base(className)}><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M14 6l4 4" /></svg>
)
export const IconChevron = ({ className }: P) => (
  <svg {...base(className)}><path d="M6 9l6 6 6-6" /></svg>
)
export const IconMenu = ({ className }: P) => (
  <svg {...base(className)}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
)
export const IconLock = ({ className }: P) => (
  <svg {...base(className)}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
)
export const IconMinus = ({ className }: P) => (
  <svg {...base(className)}><path d="M5 12h14" /></svg>
)
export const IconPlus = ({ className }: P) => (
  <svg {...base(className)}><path d="M12 5v14M5 12h14" /></svg>
)
export const IconRefresh = ({ className }: P) => (
  <svg {...base(className)}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
)
export const IconBack = ({ className }: P) => (
  <svg {...base(className)}><path d="M15 6l-6 6 6 6" /></svg>
)
export const IconX = ({ className }: P) => (
  <svg {...base(className)}><path d="M6 6l12 12M18 6L6 18" /></svg>
)
export const IconGear = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
)
