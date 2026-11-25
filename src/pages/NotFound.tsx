import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex min-h-full max-w-screen-sm flex-col items-start gap-4 px-4 py-10">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <Link to="/" className="inline-flex min-h-11 items-center rounded-xl bg-amber-700 px-4 font-medium text-white">
        Go home
      </Link>
    </main>
  )
}
