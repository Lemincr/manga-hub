import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { ReaderData } from '../types';

type Mode = 'strip' | 'single' | 'double';
type Fit = 'width' | 'height' | 'original';
interface Prefs { mode: Mode; width: number; fit: Fit; rtl: boolean }

const loadPrefs = (): Prefs => {
  try {
    return { mode: 'strip', width: 800, fit: 'height', rtl: false, ...JSON.parse(localStorage.getItem('reader-prefs') ?? '{}') };
  } catch {
    return { mode: 'strip', width: 800, fit: 'height', rtl: false };
  }
};

export default function Reader() {
  const { seriesId, chapterId } = useParams();
  const nav = useNavigate();
  const [d, setD] = useState<ReaderData | null>(null);
  const [err, setErr] = useState('');
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const [page, setPage] = useState(0);
  const [barVisible, setBarVisible] = useState(true);
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(0);
  const imgs = useRef<(HTMLImageElement | null)[]>([]);
  const pending = useRef<number | null>(null); // strip scroll position still to restore
  const saveTimer = useRef<number>(0);
  const lastY = useRef(0);

  const setPrefs = (p: Partial<Prefs>) =>
    setPrefsState((cur) => {
      const n = { ...cur, ...p };
      localStorage.setItem('reader-prefs', JSON.stringify(n));
      return n;
    });

  const n = d?.images.length ?? 0;
  const step = prefs.mode === 'double' ? 2 : 1;

  // ---- progress saving ------------------------------------------------------
  const save = useCallback(
    (scroll: number, done: boolean, immediate = false) => {
      if (!d) return;
      window.clearTimeout(saveTimer.current);
      const send = () => void api.put(`/series/${d.series.id}/progress`, { chapterId: d.chapter.id, scroll, done }).catch(() => {});
      if (immediate) send();
      else saveTimer.current = window.setTimeout(send, 600);
    },
    [d],
  );

  // ---- load chapter -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setD(null);
    setErr('');
    setFailed(0);
    setPage(0);
    imgs.current = [];
    window.scrollTo(0, 0);
    api
      .get<ReaderData>(`/reader/${seriesId}/${chapterId}`)
      .then((r) => {
        if (cancelled) return;
        const resume = r.resume && !r.resume.done ? r.resume.scroll : 0;
        pending.current = resume > 0 ? resume : null;
        if (resume > 0) setPage(Math.floor(resume));
        setD(r);
        // Reaching a chapter counts as progress (unless we are just resuming it).
        if (!r.resume) void api.put(`/series/${r.series.id}/progress`, { chapterId: r.chapter.id, scroll: 0, done: false }).catch(() => {});
      })
      .catch((e) => !cancelled && setErr(e.message));
    return () => { cancelled = true; };
  }, [seriesId, chapterId]);

  useEffect(() => { if (d) document.title = `${d.series.title} – ${d.chapter.title}`; return () => { document.title = 'Manga Hub'; }; }, [d]);

  // ---- strip mode: restore + track scroll -----------------------------------
  const tryRestore = useCallback(() => {
    const pos = pending.current;
    if (pos == null || prefs.mode !== 'strip') return;
    const idx = Math.floor(pos);
    for (let i = 0; i <= idx; i++) if (!imgs.current[i]?.complete || !imgs.current[i]?.naturalHeight) return;
    const el = imgs.current[idx];
    if (el) window.scrollTo(0, el.offsetTop + (pos - idx) * el.offsetHeight);
    pending.current = null;
  }, [prefs.mode]);

  useEffect(() => {
    if (!d || prefs.mode !== 'strip') return;
    const onScroll = () => {
      const y = window.scrollY;
      setBarVisible(y < lastY.current || y < 80);
      lastY.current = y;
      if (pending.current != null) return;
      let pos = 0;
      for (let i = 0; i < imgs.current.length; i++) {
        const el = imgs.current[i];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom > 1) { pos = i + Math.min(1, Math.max(0, -r.top / (r.height || 1))); break; }
      }
      const done = window.innerHeight + y >= document.documentElement.scrollHeight - 80;
      save(pos, done);
      if (done && d.nextId) void api.get(`/reader/${d.series.id}/${d.nextId}`).catch(() => {}); // warm next chapter
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [d, prefs.mode, save]);

  // ---- paged mode: save + preload -------------------------------------------
  useEffect(() => {
    if (!d || prefs.mode === 'strip') return;
    save(page, page + step >= n);
    for (let i = page + step; i < Math.min(n, page + step + 3); i++) new Image().src = d.images[i];
  }, [page, prefs.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- navigation -------------------------------------------------------------
  const goChapter = useCallback((id: number | null) => id && nav(`/read/${seriesId}/${id}`), [nav, seriesId]);
  const forward = useCallback(() => {
    if (!d) return;
    if (prefs.mode === 'strip') return goChapter(d.nextId);
    if (page + step < n) setPage(page + step);
    else goChapter(d.nextId);
  }, [d, prefs.mode, page, step, n, goChapter]);
  const back = useCallback(() => {
    if (!d) return;
    if (prefs.mode === 'strip') return goChapter(d.prevId);
    if (page > 0) setPage(Math.max(0, page - step));
    else goChapter(d.prevId);
  }, [d, prefs.mode, page, step, goChapter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
      const rtlSwap = prefs.mode === 'double' && prefs.rtl;
      if (e.key === 'ArrowRight') (rtlSwap ? back : forward)();
      else if (e.key === 'ArrowLeft') (rtlSwap ? forward : back)();
      else if (e.key.toLowerCase() === 'f') document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen();
      else if (e.key.toLowerCase() === 'm') setPrefs({ mode: prefs.mode === 'strip' ? 'single' : prefs.mode === 'single' ? 'double' : 'strip' });
      else if (e.key === 'Escape') nav(`/series/${seriesId}`);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [forward, back, prefs.mode, prefs.rtl, nav, seriesId]);

  // ---- render -----------------------------------------------------------------
  const src = (i: number) => (retry ? `${d!.images[i]}&r=${retry}` : d!.images[i]);
  const imgStyle: React.CSSProperties =
    prefs.fit === 'height' && prefs.mode !== 'strip'
      ? { maxHeight: '100vh', maxWidth: '100%', objectFit: 'contain' }
      : prefs.fit === 'original' && prefs.mode !== 'strip'
        ? {}
        : { width: prefs.mode === 'double' ? undefined : prefs.width, maxWidth: prefs.mode === 'double' ? '50%' : '100%' };

  const toolbar = (
    <div className={`fixed inset-x-0 top-0 z-30 border-b border-neutral-800 bg-neutral-950/95 px-3 py-2 backdrop-blur transition-transform ${barVisible ? '' : '-translate-y-full'}`}
      onMouseEnter={() => setBarVisible(true)}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 text-sm">
        <Link to={`/series/${seriesId}`} className="btn">← Series</Link>
        <button className="btn" disabled={!d?.prevId} onClick={() => goChapter(d!.prevId)}>◀ Prev</button>
        <span className="max-w-xs truncate font-medium">{d ? `${d.series.title} — ${d.chapter.title}` : 'Loading…'}</span>
        <button className="btn" disabled={!d?.nextId} onClick={() => goChapter(d!.nextId)}>Next ▶</button>
        <span className="mx-1 text-neutral-700">|</span>
        <select className="input" value={prefs.mode} onChange={(e) => { setPrefs({ mode: e.target.value as Mode }); pending.current = null; }}>
          <option value="strip">Long strip</option>
          <option value="single">Single page</option>
          <option value="double">Double page</option>
        </select>
        {prefs.mode === 'strip' && (
          <label className="flex items-center gap-2 text-neutral-400">Width
            <input type="range" min={300} max={1600} step={20} value={prefs.width} onChange={(e) => setPrefs({ width: Number(e.target.value) })} />
            <span className="w-12 text-xs">{prefs.width}px</span>
          </label>
        )}
        {prefs.mode !== 'strip' && (
          <select className="input" value={prefs.fit} onChange={(e) => setPrefs({ fit: e.target.value as Fit })}>
            <option value="height">Fit height</option>
            <option value="width">Fit width</option>
            <option value="original">Original size</option>
          </select>
        )}
        {prefs.mode === 'double' && (
          <label className="flex items-center gap-1 text-neutral-400"><input type="checkbox" checked={prefs.rtl} onChange={(e) => setPrefs({ rtl: e.target.checked })} /> RTL</label>
        )}
        {prefs.mode !== 'strip' && d && <span className="text-neutral-400">{Math.min(page + 1, n)}{step > 1 && page + 2 <= n ? `–${page + 2}` : ''} / {n}</span>}
        <div className="ml-auto flex gap-2">
          {failed > 0 && <button className="btn" onClick={() => { setFailed(0); setRetry((r) => r + 1); }}>Retry images ({failed})</button>}
          <button className="btn" title="F" onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen())}>⛶</button>
          {d && <a className="btn" href={d.originalUrl} target="_blank" rel="noreferrer">↗ Original</a>}
        </div>
      </div>
    </div>
  );

  if (err || d?.locked)
    return (
      <div className="min-h-screen bg-black pt-24 text-center">
        {toolbar}
        <p className="mx-auto max-w-lg rounded-md border border-amber-700/50 bg-amber-900/20 p-4 text-amber-200">{err || d?.message}</p>
        <div className="mt-4 flex justify-center gap-2">
          {d && <a className="btn btn-primary" href={d.originalUrl} target="_blank" rel="noreferrer">Open on original site ↗</a>}
          {d?.nextId && <button className="btn" onClick={() => goChapter(d.nextId)}>Next ▶</button>}
        </div>
      </div>
    );

  if (!d) return <div className="min-h-screen bg-black pt-24 text-center text-neutral-400">{toolbar}Loading chapter…</div>;

  const bottomNav = (
    <div className="mx-auto flex max-w-xl justify-center gap-3 py-10">
      <button className="btn" disabled={!d.prevId} onClick={() => goChapter(d.prevId)}>◀ Previous chapter</button>
      {d.nextId ? <button className="btn btn-primary" onClick={() => goChapter(d.nextId)}>Next chapter ▶</button> : <span className="self-center text-sm text-neutral-500">Latest chapter — check for new ones from the series page.</span>}
    </div>
  );

  const pageImg = (i: number) =>
    i < n ? <img key={i} src={src(i)} alt={`Page ${i + 1}`} style={imgStyle} draggable={false} onError={() => setFailed((f) => f + 1)} /> : null;

  return (
    <div className="min-h-screen bg-black">
      {toolbar}
      {prefs.mode === 'strip' ? (
        <div className="flex flex-col items-center pt-0">
          {d.images.map((_, i) => (
            <img
              key={`${d.chapter.id}-${i}-${retry}`}
              ref={(el) => { imgs.current[i] = el; }}
              src={src(i)}
              alt={`Page ${i + 1}`}
              style={{ ...imgStyle, minHeight: 500 }}
              className="block bg-neutral-950"
              onLoad={(e) => { (e.currentTarget as HTMLImageElement).style.minHeight = '0'; tryRestore(); }}
              onError={() => setFailed((f) => f + 1)}
            />
          ))}
          {bottomNav}
        </div>
      ) : (
        <div className="flex min-h-screen items-center justify-center" onClick={(e) => { const x = e.clientX / window.innerWidth; if (x < 0.35) (prefs.mode === 'double' && prefs.rtl ? forward : back)(); else if (x > 0.65) (prefs.mode === 'double' && prefs.rtl ? back : forward)(); }}>
          <div className={`flex items-center justify-center ${prefs.rtl && prefs.mode === 'double' ? 'flex-row-reverse' : ''}`} style={prefs.fit === 'width' ? { width: prefs.mode === 'double' ? '100%' : prefs.width } : undefined}>
            {pageImg(page)}
            {prefs.mode === 'double' && pageImg(page + 1)}
          </div>
        </div>
      )}
    </div>
  );
}
