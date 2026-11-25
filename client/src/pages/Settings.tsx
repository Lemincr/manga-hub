import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

type SettingsMap = Record<string, string | number | boolean>;
type ReaderMode = 'strip' | 'single' | 'double';
type ReaderFit = 'width' | 'height' | 'original';
interface ReaderPrefs {
  mode: ReaderMode;
  width: number;
  fit: ReaderFit;
  rtl: boolean;
}

const loadReaderPrefs = (): ReaderPrefs => {
  try {
    return {
      mode: 'strip',
      width: 800,
      fit: 'height',
      rtl: false,
      ...JSON.parse(localStorage.getItem('reader-prefs') ?? '{}'),
    };
  } catch {
    return { mode: 'strip', width: 800, fit: 'height', rtl: false };
  }
};

export default function Settings() {
  const [s, setS] = useState<SettingsMap | null>(null);
  const [prefs, setPrefs] = useState<ReaderPrefs>(loadReaderPrefs);
  const [msg, setMsg] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');

  const load = async () => {
    setS(await api.get<SettingsMap>('/settings'));
  };
  useEffect(() => {
    void load();
  }, []);

  if (!s) return <p className="text-neutral-400">Loading…</p>;

  const updatePref = (patch: Partial<ReaderPrefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...patch };
      localStorage.setItem('reader-prefs', JSON.stringify(next));
      return next;
    });
    setMsg('Reader defaults updated.');
  };

  const setSetting = async (key: string, value: string | number | boolean) => {
    const next = { ...s, [key]: value };
    setS(next);
    setS(await api.put<SettingsMap>('/settings', next));
    setMsg('Preferences saved.');
  };

  const restore = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      const r = await fetch(`/api/restore?mode=${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const j = await r.json();
      setMsg(r.ok ? `Imported ${j.imported} series (${j.mode}).` : j.error);
      await load();
    } catch (e) {
      setMsg('Import failed: ' + (e as Error).message);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white">Preferences</h1>
        <p className="text-xs text-neutral-400">Customize reading defaults, automatic chapter checks, and library backups</p>
      </div>

      {msg && (
        <div className="rounded-xl border border-violet-500/30 bg-violet-950/30 px-3.5 py-2 text-xs text-violet-200">
          {msg}
        </div>
      )}

      {/* Reader Customization */}
      <section className="space-y-4 rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">Reader Defaults</h2>
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[200px_1fr] sm:items-center">
          <span className="text-neutral-400">Reading layout</span>
          <select
            className="input w-52"
            value={prefs.mode}
            onChange={(e) => updatePref({ mode: e.target.value as ReaderMode })}
          >
            <option value="strip">Vertical Long-Strip</option>
            <option value="single">Single Page</option>
            <option value="double">Double Page</option>
          </select>

          <span className="text-neutral-400">Long-strip width</span>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={480}
              max={1400}
              step={20}
              value={prefs.width}
              onChange={(e) => updatePref({ width: Number(e.target.value) })}
            />
            <span className="w-14 text-xs text-neutral-300">{prefs.width}px</span>
          </div>

          <span className="text-neutral-400">Paged image fit</span>
          <select
            className="input w-52"
            value={prefs.fit}
            onChange={(e) => updatePref({ fit: e.target.value as ReaderFit })}
          >
            <option value="height">Fit to screen height</option>
            <option value="width">Fit to width</option>
            <option value="original">Original resolution</option>
          </select>

          <span className="text-neutral-400">Double-page direction</span>
          <label className="flex items-center gap-2 text-neutral-200">
            <input
              type="checkbox"
              checked={prefs.rtl}
              onChange={(e) => updatePref({ rtl: e.target.checked })}
            />
            Right-to-Left (Manga mode)
          </label>
        </div>
      </section>

      {/* Library & Sync Customization */}
      <section className="space-y-4 rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">Library &amp; Updates</h2>
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[200px_1fr] sm:items-center">
          <span className="text-neutral-400">Auto-check for new chapters</span>
          <select
            className="input w-52"
            value={Number(s.pollMinutes) || 0}
            onChange={(e) => setSetting('pollMinutes', Number(e.target.value))}
          >
            <option value={0}>Manual only</option>
            <option value={15}>Every 15 minutes</option>
            <option value={30}>Every 30 minutes</option>
            <option value={60}>Every hour</option>
            <option value={180}>Every 3 hours</option>
          </select>

          <span className="text-neutral-400">Browse source pills</span>
          <label className="flex items-center gap-2 text-neutral-200">
            <input
              type="checkbox"
              checked={!!s['sources.extraInAllOnly']}
              onChange={(e) => setSetting('sources.extraInAllOnly', e.target.checked)}
            />
            Keep extra sources grouped under &ldquo;All sources&rdquo;
          </label>
        </div>
      </section>

      {/* Backup & Storage */}
      <section className="space-y-4 rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">Backup &amp; Storage</h2>
        <div className="flex flex-wrap items-center gap-2.5">
          <a className="btn btn-primary" href="/api/backup" download>
            ⬇ Export Library (.json)
          </a>
          <select
            className="input"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'merge' | 'replace')}
          >
            <option value="merge">Import: Merge with current library</option>
            <option value="replace">Import: Replace current library</option>
          </select>
          <button className="btn" onClick={() => file.current?.click()}>
            ⬆ Import Backup
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])}
          />
          <button
            className="btn ml-auto"
            onClick={async () => {
              const r = await api.post<{ imagesRemoved: number }>('/cache/clear');
              setMsg(`Cleared cached images (${r.imagesRemoved} files).`);
            }}
          >
            Clear Image Cache
          </button>
        </div>
      </section>
    </div>
  );
}
