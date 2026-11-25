import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, isRecentChapterDate, proxied, timeAgo } from '../api';
import { STATUS_LABELS, type Chapter, type LibStatus, type Series } from '../types';

export default function SeriesPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [s, setS] = useState<Series | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [aliases, setAliases] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    const r = await api.get<{ series: Series; chapters: Chapter[] }>(`/series/${id}`);
    setS(r.series);
    setChapters(r.chapters);
    setAliases(r.series.aliases.join(', '));
  }, [id]);
  useEffect(() => {
    void load().catch((e) => setMsg(e.message));
  }, [load]);

  if (!s) return <p className="text-neutral-400">{msg || 'Loading…'}</p>;

  const refresh = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await api.post<{ newChapters: number }>(`/series/${s.id}/refresh`);
      setMsg(r.newChapters ? `${r.newChapters} new chapter(s) found` : 'Up to date');
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  };
  const patch = async (b: object) => {
    await api.patch(`/series/${s.id}`, b);
    await load();
  };
  const addToLibrary = async () => {
    await api.post('/library', { seriesId: s.id, status: 'plan' });
    await load();
  };
  const remove = async () => {
    if (!confirm('Remove from library and delete read progress?')) return;
    await api.del(`/series/${s.id}`);
    nav('/');
  };
  const markReadUpTo = async (c: Chapter) => {
    await api.put(`/series/${s.id}/progress`, { chapterId: c.id, scroll: 0, done: true, force: true });
    await load();
  };

  const shown = chapters.filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="space-y-6">
      {/* Hero Banner Card */}
      <div className="flex flex-col gap-6 rounded-2xl border border-neutral-800/80 bg-neutral-900/60 p-5 shadow-lg md:flex-row">
        <div className="w-48 shrink-0">
          <div className="aspect-[2/3] overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-xl">
            {s.cover && <img src={proxied(s.cover, s.sourceId)} alt="" className="h-full w-full object-cover" />}
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-violet-600/20 px-2 py-0.5 text-xs font-semibold text-violet-300 ring-1 ring-violet-500/30">
              {s.sourceName}
            </span>
            {s.inLibrary && (
              <span className="inline-flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-800/90 px-2 py-0.5 text-xs font-medium text-neutral-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {STATUS_LABELS[s.libraryStatus]}
              </span>
            )}
            {s.siteStatus && (
              <span className="rounded-md bg-neutral-800 px-2 py-0.5 text-xs font-medium capitalize text-neutral-300">
                {s.siteStatus}
              </span>
            )}
            {s.unread > 0 ? (
              <span
                className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                  s.hasNewUnread
                    ? 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                    : 'border border-violet-500/40 bg-violet-950/40 text-violet-200'
                }`}
              >
                {s.unread} unread{s.newUnreadCount ? ` (${s.newUnreadCount} new <1w)` : ''}
              </span>
            ) : (
              <span className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-xs text-neutral-400">
                Caught up (0 unread)
              </span>
            )}
            <span className="text-xs text-neutral-400">
              · {s.totalChapters} total chapters
              {s.lastCheckedAt && <> · checked {timeAgo(s.lastCheckedAt)}</>}
            </span>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-white">{s.title}</h1>

          {s.checkError && (
            <div className="rounded-xl border border-amber-700/50 bg-amber-950/30 px-3.5 py-2 text-xs text-amber-200">
              Last check failed: {s.checkError}
            </div>
          )}

          {s.description && (
            <p className="line-clamp-4 max-w-3xl text-sm leading-relaxed text-neutral-300">{s.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {s.continueChapterId && (
              <Link
                className={s.unread > 0 ? 'btn btn-primary' : 'btn text-neutral-400'}
                to={`/read/${s.id}/${s.continueChapterId}`}
              >
                {s.unread === 0 ? 'Caught up · Re-read latest' : s.lastReadNumber >= 0 ? '▶ Continue Reading' : '▶ Start Reading'}
              </Link>
            )}
            {s.inLibrary ? (
              <select
                className="input"
                value={s.libraryStatus}
                onChange={(e) => patch({ libraryStatus: e.target.value as LibStatus })}
              >
                {(Object.keys(STATUS_LABELS) as LibStatus[]).map((k) => (
                  <option key={k} value={k}>
                    {STATUS_LABELS[k]}
                  </option>
                ))}
              </select>
            ) : (
              <button className="btn" onClick={addToLibrary}>
                + Add to library
              </button>
            )}
            <button className="btn" disabled={busy} onClick={refresh}>
              {busy ? 'Checking…' : '↻ Check for new chapters'}
            </button>
            <a className="btn" href={s.originalUrl} target="_blank" rel="noreferrer">
              ↗ Open on site
            </a>
            {s.inLibrary && (
              <button
                className="btn"
                onClick={async () => {
                  await api.del(`/series/${s.id}/progress`);
                  await load();
                }}
              >
                Reset progress
              </button>
            )}
            <button className="btn btn-danger" onClick={remove}>
              Delete
            </button>
          </div>
          {msg && <div className="text-xs font-medium text-violet-300">{msg}</div>}

          <div className="flex max-w-3xl items-center gap-2 pt-1">
            <label className="text-xs font-medium text-neutral-400">Aliases</label>
            <input
              className="input flex-1 text-xs"
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="Comma separated alternate titles"
            />
            <button className="btn text-xs" onClick={() => patch({ aliases: aliases.split(',') })}>
              Save
            </button>
          </div>
          {s.sourceAliases.length > 0 && (
            <div className="max-w-3xl text-xs text-neutral-500">
              Site aliases: {s.sourceAliases.slice(0, 8).join(' · ')}
            </div>
          )}
        </div>
      </div>

      {/* Chapters Section */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-white">Chapters ({shown.length})</h2>
          <input
            className="input w-60"
            placeholder="Filter chapters…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="divide-y divide-neutral-800/80 overflow-hidden rounded-xl border border-neutral-800/90 bg-neutral-900/50">
          {shown.map((c) => {
            const read = c.read ?? c.number <= s.lastReadNumber;
            const isNewCh = !read && (c.isNew ?? isRecentChapterDate(c.publishedAt));
            return (
              <div
                key={c.id}
                className={`flex items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-neutral-800/60 ${
                  read ? 'text-neutral-500' : 'text-neutral-100'
                }`}
              >
                <Link to={`/read/${s.id}/${c.id}`} className="flex flex-1 items-center gap-2 truncate font-medium hover:text-violet-300">
                  <span className="truncate">{c.title}</span>
                  {isNewCh && (
                    <span className="shrink-0 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-neutral-950">
                      NEW
                    </span>
                  )}
                  {c.locked && <span className="shrink-0 text-xs text-amber-400">🔒 early access</span>}
                  {c.id === s.resumeChapterId && (
                    <span className="shrink-0 rounded-md bg-violet-600/30 px-1.5 py-0.5 text-[11px] font-semibold text-violet-200">
                      resume
                    </span>
                  )}
                </Link>
                <span className="text-xs text-neutral-500">{timeAgo(c.publishedAt)}</span>
                <button
                  className="rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-white"
                  title="Mark everything up to here as read"
                  onClick={() => markReadUpTo(c)}
                >
                  mark read to here
                </button>
                <a
                  className="rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-white"
                  href={c.originalUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Open chapter on original site"
                >
                  ↗
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
