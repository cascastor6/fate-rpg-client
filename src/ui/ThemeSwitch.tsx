import { setTheme, useTheme, type ThemePref } from '../lib/theme.ts'

/** Light / dark / system switch. */
export function ThemeSwitch() {
  const pref = useTheme()
  const opts: [ThemePref, string][] = [['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']]
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-medium">Theme</span>
      <div className="flex rounded-xl border border-[color:var(--border)] p-1" role="radiogroup" aria-label="Theme">
        {opts.map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={pref === v} onClick={() => setTheme(v)}
            className={`min-h-9 rounded-lg px-3 text-sm font-semibold ${pref === v ? 'bg-amber-700 text-white' : ''}`}>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
