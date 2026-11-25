import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import Home from './pages/Home.tsx'
import JoinPage from './pages/JoinPage.tsx'
import NotFound from './pages/NotFound.tsx'
import SessionLayout, { GmOnly, SessionIndex } from './pages/SessionLayout.tsx'
import { ErrorBoundary } from './ui/ErrorBoundary.tsx'
import { FullScreenSpinner } from './ui/primitives.tsx'
import { Toaster } from './ui/toast.tsx'

// Screens load on demand so the first load (home / join) stays small.
const NewCharacterPage = lazy(() => import('./pages/NewCharacterPage.tsx'))
const SheetPage = lazy(() => import('./pages/SheetPage.tsx'))
const TablePage = lazy(() => import('./pages/TablePage.tsx'))
const ScenePage = lazy(() => import('./pages/ScenePage.tsx'))
const GmLayout = lazy(() => import('./gm/GmLayout.tsx'))
const PlayersTab = lazy(() => import('./gm/PlayersTab.tsx'))
const ScenesTab = lazy(() => import('./gm/ScenesTab.tsx'))

export default function App() {
  return (
    <ErrorBoundary>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[100] focus:rounded-lg focus:bg-amber-700 focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <Suspense fallback={<FullScreenSpinner />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/join/:code" element={<JoinPage />} />
          <Route path="/s/:sessionId" element={<SessionLayout />}>
            <Route index element={<SessionIndex />} />
            <Route path="new-character" element={<NewCharacterPage />} />
            <Route path="c/:characterId" element={<SheetPage />} />
            <Route path="table" element={<TablePage />} />
            <Route path="scene" element={<ScenePage />} />
            <Route path="gm" element={<GmOnly><GmLayout /></GmOnly>}>
              <Route index element={<PlayersTab />} />
              <Route path="scenes" element={<ScenesTab />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <Toaster />
    </ErrorBoundary>
  )
}
