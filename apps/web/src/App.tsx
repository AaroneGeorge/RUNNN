import { CalendarDays, Home as HomeIcon, Trophy, User } from 'lucide-react';
import { lazy, Suspense, useEffect } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router';
import { Toaster } from 'sonner';
import { Loading, cx } from './components/ui.tsx';
import { unlockAudio } from './lib/sound.ts';
import { useSettings } from './lib/storage.ts';
import { useTheme } from './lib/theme.ts';
import { Home } from './pages/Home.tsx';
import { Join } from './pages/Join.tsx';
import { Play } from './pages/Play.tsx';
import { Welcome } from './pages/Welcome.tsx';

const Host = lazy(() => import('./pages/Host.tsx').then((m) => ({ default: m.Host })));
const Sim = lazy(() => import('./pages/Sim.tsx').then((m) => ({ default: m.Sim })));
const HQ = lazy(() => import('./pages/HQ.tsx').then((m) => ({ default: m.HQ })));
const HQRound = lazy(() => import('./pages/HQ.tsx').then((m) => ({ default: m.HQRound })));
const Kit = lazy(() => import('./pages/Kit.tsx').then((m) => ({ default: m.Kit })));
const KitPrint = lazy(() => import('./pages/Kit.tsx').then((m) => ({ default: m.KitPrint })));
const GameRules = lazy(() => import('./pages/GameRules.tsx').then((m) => ({ default: m.GameRules })));
const Events = lazy(() => import('./pages/Events.tsx').then((m) => ({ default: m.Events })));
const NewEvent = lazy(() => import('./pages/Events.tsx').then((m) => ({ default: m.NewEvent })));
const EventPage = lazy(() => import('./pages/Events.tsx').then((m) => ({ default: m.EventPage })));
const Me = lazy(() => import('./pages/Profile.tsx').then((m) => ({ default: m.Me })));
const PublicProfile = lazy(() => import('./pages/Profile.tsx').then((m) => ({ default: m.PublicProfile })));
const Leaderboard = lazy(() => import('./pages/Leaderboard.tsx').then((m) => ({ default: m.Leaderboard })));
const Achievements = lazy(() => import('./pages/Achievements.tsx').then((m) => ({ default: m.Achievements })));
const Settings = lazy(() => import('./pages/Settings.tsx').then((m) => ({ default: m.Settings })));

/** Hide all chrome: the game owns the screen. */
const IMMERSIVE = [/^\/play\//, /^\/watch\//, /^\/kit\/print/];
/** Hide the tab bar so these read like a pushed native screen. */
const FLOW = [/^\/host/, /^\/join/, /^\/sim/, /^\/events\/new/, /^\/welcome/];

const TABS = [
  { to: '/', label: 'Play', icon: HomeIcon, end: true },
  { to: '/events', label: 'Events', icon: CalendarDays },
  { to: '/leaderboard', label: 'Ranks', icon: Trophy },
  { to: '/me', label: 'Me', icon: User },
];

function TabBar() {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-night/95 backdrop-blur">
      <div className="mx-auto flex max-w-xl">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => cx('flex flex-1 flex-col items-center gap-0.5 pt-2 text-[11px] font-bold', isActive ? 'text-ink' : 'text-dim')}
          >
            {({ isActive }) => (
              <>
                <span className={cx('grid h-8 w-14 place-items-center rounded-full transition', isActive && 'bg-accent text-accent-ink')}>
                  <Icon className="size-5" />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export function App() {
  useTheme();
  const { theme } = useSettings();
  const { pathname } = useLocation();
  const immersive = IMMERSIVE.some((r) => r.test(pathname));
  const flow = FLOW.some((r) => r.test(pathname));

  useEffect(() => {
    const once = () => {
      unlockAudio();
      window.removeEventListener('pointerdown', once);
    };
    window.addEventListener('pointerdown', once);
    return () => window.removeEventListener('pointerdown', once);
  }, []);

  useEffect(() => {
    if (!immersive) window.scrollTo(0, 0);
  }, [pathname, immersive]);

  return (
    <div className={cx('min-h-[100dvh]', !immersive && 'topo')}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/join" element={<Join />} />
          <Route path="/join/:code" element={<Join />} />
          <Route path="/play/:code" element={<Play />} />
          <Route path="/watch/:code" element={<Play watch />} />
          <Route path="/host" element={<Host />} />
          <Route path="/sim" element={<Sim />} />
          <Route path="/hq" element={<HQ />} />
          <Route path="/hq/games/:id" element={<HQRound />} />
          <Route path="/kit" element={<Kit />} />
          <Route path="/kit/print" element={<KitPrint />} />
          <Route path="/games/:id" element={<GameRules />} />
          <Route path="/events" element={<Events />} />
          <Route path="/events/new" element={<NewEvent />} />
          <Route path="/events/:id" element={<EventPage />} />
          <Route path="/me" element={<Me />} />
          <Route path="/u/:id" element={<PublicProfile />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/achievements" element={<Achievements />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Suspense>
      {!immersive && !flow && <TabBar />}
      <Toaster
        position="top-center"
        theme={theme === 'system' ? 'system' : theme}
        richColors
        toastOptions={{ style: { fontFamily: 'var(--font-sans)', fontWeight: 700, borderRadius: 18 } }}
      />
    </div>
  );
}
