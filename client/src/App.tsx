import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Library from './pages/Library';
import Browse from './pages/Browse';
import SeriesPage from './pages/SeriesPage';
import Reader from './pages/Reader';
import Settings from './pages/Settings';

const links = [
  ['/', 'Library'],
  ['/browse', 'Browse'],
  ['/settings', 'Preferences'],
] as const;

export default function App() {
  const loc = useLocation();
  const nav = useNavigate();
  const reading = loc.pathname.startsWith('/read/');

  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0 || window.history.length > 1) {
      nav(-1);
    } else {
      nav(loc.pathname === '/' ? '/browse' : '/');
    }
  };

  return (
    <div className="min-h-screen">
      {!reading && (
        <header className="sticky top-0 z-20 border-b border-neutral-800/80 bg-neutral-950/85 backdrop-blur-md">
          <nav className="mx-auto flex max-w-7xl items-center gap-1.5 px-4 py-2.5">
            <button
              type="button"
              onClick={goBack}
              title="Go Back (History)"
              className="mr-1 inline-flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900/90 px-2.5 py-1.5 text-xs font-medium text-neutral-300 transition hover:border-neutral-700 hover:bg-neutral-800 hover:text-white active:scale-95"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span>Back</span>
            </button>

            <NavLink to="/" className="mr-4 flex items-center gap-2.5 text-lg font-bold tracking-tight text-white">
              <img src="/icon.svg" alt="" className="h-7 w-7 rounded-lg shadow-md shadow-violet-950/60" />
              <span className="bg-gradient-to-r from-white via-violet-200 to-violet-400 bg-clip-text text-transparent">
                Manga Hub
              </span>
            </NavLink>
            {links.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-violet-600/20 text-violet-200 ring-1 ring-violet-500/40'
                      : 'text-neutral-400 hover:bg-neutral-900 hover:text-white'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </header>
      )}
      <Routes>
        <Route path="/read/:seriesId/:chapterId" element={<Reader />} />
        <Route
          path="*"
          element={
            <main className="mx-auto max-w-7xl px-4 py-6">
              <Routes>
                <Route path="/" element={<Library />} />
                <Route path="/browse" element={<Browse />} />
                <Route path="/discover" element={<Navigate to="/browse" replace />} />
                <Route path="/search" element={<Navigate to="/browse" replace />} />
                <Route path="/series/:id" element={<SeriesPage />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </main>
          }
        />
      </Routes>
    </div>
  );
}
