import { Route, Routes } from 'react-router-dom'
import GmHome from './pages/GmHome.tsx'
import Home from './pages/Home.tsx'
import JoinPage from './pages/JoinPage.tsx'
import NotFound from './pages/NotFound.tsx'
import PlayerHome from './pages/PlayerHome.tsx'
import SessionLayout, { GmOnly, SessionIndex } from './pages/SessionLayout.tsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/join/:code" element={<JoinPage />} />
      <Route path="/s/:sessionId" element={<SessionLayout />}>
        <Route index element={<SessionIndex player={<PlayerHome />} />} />
        <Route path="gm" element={<GmOnly><GmHome /></GmOnly>} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
