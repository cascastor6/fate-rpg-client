import type { TemplateChoice } from '../templateSources.ts'

/** Radio list of templates: the GM's first (if any), then the standard ones. */
export function TemplatePicker({
  gm,
  builtin,
  value,
  onChange,
}: {
  gm: TemplateChoice[]
  builtin: TemplateChoice[]
  value: string
  onChange: (key: string) => void
}) {
  const group = (title: string, items: TemplateChoice[]) =>
    items.length > 0 && (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{title}</legend>
        {items.map((t) => (
          <label
            key={t.key}
            className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 bg-[color:var(--card)] px-4 py-3 ${
              value === t.key ? 'border-amber-600' : 'border-[color:var(--border)]'
            }`}
          >
            <input
              type="radio"
              name="template"
              value={t.key}
              checked={value === t.key}
              onChange={() => onChange(t.key)}
              className="size-5 shrink-0 accent-amber-700"
            />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{t.name}</span>
              <span className="block text-sm text-[color:var(--muted)]">{t.blurb}</span>
            </span>
          </label>
        ))}
      </fieldset>
    )
  return (
    <div className="flex flex-col gap-4">
      {group('From your GM', gm)}
      {group('Standard', builtin)}
    </div>
  )
}
