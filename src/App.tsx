import { Route, Routes } from 'react-router-dom'
import GmHome from './pages/GmHome.tsx'
import Home from './pages/Home.tsx'
import JoinPage from './pages/JoinPage.tsx'
import NewCharacterPage from './pages/NewCharacterPage.tsx'
import NotFound from './pages/NotFound.tsx'
import SessionLayout, { GmOnly, SessionIndex } from './pages/SessionLayout.tsx'
import SheetPage from './pages/SheetPage.tsx'
import TablePage from './pages/TablePage.tsx'
import { Toaster } from './ui/toast.tsx'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="/s/:sessionId" element={<SessionLayout />}>
          <Route index element={<SessionIndex />} />
          <Route path="new-character" element={<NewCharacterPage />} />
          <Route path="c/:characterId" element={<SheetPage />} />
          <Route path="table" element={<TablePage />} />
          <Route path="gm" element={<GmOnly><GmHome /></GmOnly>} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster />
    </>
  )
}
