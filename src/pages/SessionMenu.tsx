import { Link } from 'react-router-dom'
import { useSession } from '../session/SessionProvider.tsx'
import { MembersList, YouPanel } from '../session/SessionWidgets.tsx'
import { BottomSheet } from '../ui/BottomSheet.tsx'

/** The ☰ menu: you (name, colour, leave), who's at the table, and navigation. */
export function SessionMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { isGm, session } = useSession()
  return (
    <BottomSheet open={open} title="Menu" onDismiss={onClose}>
      <div className="flex flex-col gap-4">
        {isGm && (
          <Link
            to={`/s/${session.id}/gm`}
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-700 px-4 font-medium text-white"
          >
            GM screen
          </Link>
        )}
        <YouPanel />
        <MembersList />
      </div>
    </BottomSheet>
  )
}
