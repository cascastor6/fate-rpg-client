import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { downloadJson, slug } from '../lib/download.ts'
import { friendlyError } from '../lib/errors.ts'
import { clearLastSession } from '../lib/storage.ts'
import { supabase } from '../lib/supabase.ts'
import { useScenes } from '../scenes/store.ts'
import { leavingSessions } from '../session/realtime.ts'
import { useSession } from '../session/SessionProvider.tsx'
import { templateBundle } from '../sheet/io.ts'
import { fetchTemplateSheet } from '../sheet/templateSources.ts'
import { Button, Card, Notice } from '../ui/primitives.tsx'

/**
 * Danger zone (GM): delete the whole session. Its templates are downloaded first as one
 * .fate.json bundle that can be imported into any later session (SPEC §5.7).
 */
export function DeleteSession() {
  const { session, members, characters } = useSession()
  const { scenes } = useScenes(session.id)
  const navigate = useNavigate()
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle')
  const [error, setError] = useState<string | null>(null)
  const templates = characters.filter((c) => c.kind === 'template')
  const pcs = characters.filter((c) => c.kind === 'pc').length
  const npcs = characters.filter((c) => c.kind === 'npc').length
  const players = members.filter((m) => m.role === 'player').length
  const file = `${slug(session.name, 'session')}-templates.fate.json`

  const run = async () => {
    setStep('busy')
    setError(null)
    try {
      if (templates.length) {
        const sheets = await Promise.all(templates.map(async (t) => ({ sheet: await fetchTemplateSheet(t.id), offered: t.visible_to_players })))
        downloadJson(file, templateBundle(session.name, sheets))
      }
      // Everything in the session cascades from this row (RLS: GM only).
      leavingSessions.add(session.id)
      const { data, error: err } = await supabase.from('sessions').delete().eq('id', session.id).select('id')
      if (err) throw err
      if (!data?.length) throw new Error('not_gm')
      clearLastSession(session.id)
      navigate('/', {
        replace: true,
        state: { notice: templates.length
          ? `“${session.name}” was deleted. Its ${templates.length} template${templates.length === 1 ? ' was' : 's were'} saved to ${file}.`
          : `“${session.name}” was deleted.` },
      })
    } catch (e) {
      leavingSessions.delete(session.id)
      setError(friendlyError(e))
      setStep('confirm')
    }
  }

  return (
    <Card className="border-red-300 dark:border-red-900">
      <h3 className="text-lg font-semibold text-red-800 dark:text-red-300">Danger zone</h3>
      {step === 'idle' ? (
        <Button variant="ghost" className="mt-2 text-red-700 dark:text-red-400" onClick={() => setStep('confirm')}>Delete session…</Button>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          <p>Delete <strong>{session.name}</strong> for everyone? This removes:</p>
          <ul className="list-disc pl-5 text-sm">
            <li>{players} player{players === 1 ? '' : 's'} (they’re sent back to the home screen)</li>
            <li>{pcs} character{pcs === 1 ? '' : 's'} and {npcs} NPC{npcs === 1 ? '' : 's'}</li>
            <li>{scenes.length || 'all'} scene{scenes.length === 1 ? '' : 's'}, the roll log, and the GM code</li>
          </ul>
          {templates.length > 0 ? (
            <Notice>Your {templates.length} template{templates.length === 1 ? '' : 's'} will download first as <strong>{file}</strong>. Import it into a new session from Templates → Import.</Notice>
          ) : (
            <p className="text-sm text-[color:var(--muted)]">This session has no templates to save.</p>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" busy={step === 'busy'} onClick={() => void run()}>
              {templates.length ? 'Download templates and delete' : 'Delete session'}
            </Button>
            <Button variant="secondary" onClick={() => setStep('idle')} disabled={step === 'busy'}>Keep it</Button>
          </div>
          <p className="text-xs text-[color:var(--muted)]">This can’t be undone.</p>
        </div>
      )}
    </Card>
  )
}
