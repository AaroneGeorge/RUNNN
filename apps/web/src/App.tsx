import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Toaster } from 'sonner';
import { BottomNav } from './components/ui.tsx';
import { Home } from './pages/Home.tsx';
import { JoinPage } from './pages/Join.tsx';
import { HostPage } from './pages/Host.tsx';
import { PlayPage } from './pages/Play.tsx';
import { KitPage } from './pages/Kit.tsx';
import { AchievementsPage } from './pages/Achievements.tsx';
import { GameRulesPage } from './pages/GameRules.tsx';
import { EventsPage, EventNewPage, EventPage } from './pages/Events.tsx';
import { ProfilePage, PublicProfilePage, LeaderboardPage } from './pages/Profile.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { SimPage } from './pages/Sim.tsx';
import { WelcomePage } from './pages/Welcome.tsx';
import { HQPage } from './pages/HQ.tsx';
import { WatchBothPage } from './pages/WatchBoth.tsx';
import { getHost } from './lib/storage.ts';
import { applyTheme, watchSystemTheme } from './lib/theme.ts';

const FLOW_PATHS = ['/host', '/sim', '/join', '/events/new', '/welcome'];

/** Only hosts create games, bot tests and events; anyone else goes to the host sign-in, then back here. */
function RequireHost({ children }: { children: ReactNode }) {
  const loc = useLocation();
  if (getHost()) return <>{children}</>;
  return <Navigate to={`/welcome?step=host&next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
}

export function App() {
  const loc = useLocation();
  const immersive = loc.pathname.startsWith('/play/') || loc.pathname.startsWith('/watch/') || loc.pathname.startsWith('/kit/print');
  // Step-by-step flows hide the tab bar, like a pushed screen in a native app; their actions pin to the bottom.
  const flow = FLOW_PATHS.some((f) => loc.pathname === f || loc.pathname.startsWith(`${f}/`));
  const showNav = !immersive && !flow;
  useEffect(() => {
    document.documentElement.dataset.nav = showNav ? 'on' : 'off';
  }, [showNav]);
  useEffect(() => {
    applyTheme();
    return watchSystemTheme();
  }, []);
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="/host" element={<RequireHost><HostPage /></RequireHost>} />
        <Route path="/sim" element={<RequireHost><SimPage /></RequireHost>} />
        <Route path="/hq" element={<RequireHost><HQPage /></RequireHost>} />
        <Route path="/play/:code" element={<PlayPage />} />
        <Route path="/watch/:code" element={<RequireHost><WatchBothPage /></RequireHost>} />
        <Route path="/games/:id" element={<GameRulesPage />} />
        <Route path="/kit" element={<RequireHost><KitPage /></RequireHost>} />
        <Route path="/kit/print" element={<RequireHost><KitPage print /></RequireHost>} />
        <Route path="/achievements" element={<AchievementsPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/new" element={<RequireHost><EventNewPage /></RequireHost>} />
        <Route path="/events/:id" element={<EventPage />} />
        <Route path="/me" element={<ProfilePage />} />
        <Route path="/u/:id" element={<PublicProfilePage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Home />} />
      </Routes>
      {showNav && <BottomNav />}
      <Toaster
        position="top-center"
        theme="light"
        richColors
        visibleToasts={3}
        offset={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
        mobileOffset={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)', left: 12, right: 12 }}
      />
    </>
  );
}
