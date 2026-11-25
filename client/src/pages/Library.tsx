import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, isRecentChapterDate, proxied, timeAgo } from '../api';
import { STATUS_LABELS, type LibStatus, type Series, type SourceInfo } from '../types';

export default function Library() {
  const [items, setItems] = useState<Series[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<LibStatus | ''>('');
  const [sort, setSort] = useState('latest');
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ sort });
    if (status) p.set('status', status);
    if (q) p.set('q', q);
    if (source) p.set('source', source);
    const r = await api.get<{ items: Series[]; counts: Record<string, number> }>('/library?' + p);
    setItems(r.items);
    setCounts(r.counts);
  }, [status, sort, q, source]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api.get<SourceInfo[]>('/sources').then(setSources);
  }, []);

  const check = async () => {
    setChecking(true);
    setMsg('');
    try {
      const r = await api.post<{
        lastResult: { checked: number; newChapters: number; errors: number; durationMs?: number };
      }>('/library/check');
      const x = r.lastResult;
      const secs = x.durationMs ? ` in ${(x.durationMs / 1000).toFixed(1)}s` : '';
      setMsg(
        `Checked ${x.checked} series${secs} · ${x.newChapters} new chapter(s)${
          x.errors ? ` · ${x.errors} failed (see series pages)` : ''
        }`,
      );
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
    setChecking(false);
  };

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const shown = unreadOnly ? items.filter((i) => i.unread > 0) : items;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Library</h1>
          <p className="text-xs text-neutral-400">
            Series with fresh unread chapters (&lt; 1 week old) are prioritized first
          </p>
        </div>

        <input
          className="input ml-auto w-60"
          placeholder="Search titles & aliases…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="latest">Sort: New &amp; Latest updates</option>
          <option value="unread">Sort: Unread count</option>
          <option value="read">Sort: Recently read</option>
          <option value="added">Sort: Date added</option>
          <option value="title">Sort: Title (A–Z)</option>
        </select>
        <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {sources
            .filter((s) => !s.hidden)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        <button
          type="button"
          onClick={() => setUnreadOnly(!unreadOnly)}
          className={`pill ${unreadOnly ? 'pill-active' : ''}`}
        >
          <span className={`h-2 w-2 rounded-full ${unreadOnly ? 'bg-violet-400' : 'bg-neutral-600'}`} />
          Unread only
        </button>
        <button className="btn btn-primary" onClick={check} disabled={checking}>
          {checking ? 'Checking…' : '↻ Check for new chapters'}
        </button>
      </div>

      {msg && (
        <div className="rounded-xl border border-violet-500/30 bg-violet-950/30 px-3.5 py-2 text-xs text-violet-200">
          {msg}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button className={`chip ${status === '' ? 'chip-on' : ''}`} onClick={() => setStatus('')}>
          All ({total})
        </button>
        {(Object.keys(STATUS_LABELS) as LibStatus[]).map((s) => (
          <button key={s} className={`chip ${status === s ? 'chip-on' : ''}`} onClick={() => setStatus(s)}>
            {STATUS_LABELS[s]} ({counts[s] ?? 0})
          </button>
        ))}
      </div>

      {!shown.length && (
        <div className="rounded-2xl border border-neutral-800/70 bg-neutral-900/40 py-16 text-center">
          <p className="text-sm text-neutral-400">
            Nothing here yet. Discover and bookmark series from{' '}
            <Link className="font-semibold text-violet-400 underline hover:text-violet-300" to="/browse">
              Browse
            </Link>
            .
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {shown.map((s) => {
          const recent = (s.recentChapters ?? []).slice(0, 2);
          const hasNew = !!s.hasNewUnread;
          return (
            <div
              key={s.id}
              className={`group flex flex-col overflow-hidden rounded-xl border bg-neutral-900/75 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-xl ${
                hasNew
                  ? 'border-emerald-500/45 shadow-emerald-950/20 hover:border-emerald-400/70 hover:shadow-emerald-950/30'
                  : 'border-neutral-800/90 hover:border-violet-500/50 hover:shadow-violet-950/30'
              }`}
            >
              <Link to={`/series/${s.id}`} className="relative aspect-[2/3] overflow-hidden bg-neutral-950">
                {s.cover ? (
                  <img
                    src={proxied(s.cover, s.sourceId)}
                    loading="lazy"
                    alt=""
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = '/icon.svg';
                    }}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-xs text-neutral-500">No Cover</div>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                <span className="absolute left-2 top-2 rounded-md bg-neutral-950/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-200 ring-1 ring-white/10 backdrop-blur-sm">
                  {s.sourceName}
                </span>

                {/* Top-right badges: NEW (<1wk unread) + total unread count */}
                <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
                  {hasNew && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-neutral-950 shadow-md shadow-emerald-950/70">
                      <span className="h-1.5 w-1.5 rounded-full bg-neutral-950 animate-pulse" />
                      NEW {s.newUnreadCount && s.newUnreadCount > 1 ? `(${s.newUnreadCount})` : ''}
                    </span>
                  )}
                  {s.unread > 0 && (
                    <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-bold text-white shadow-md shadow-violet-950/60">
                      {s.unread} unread
                    </span>
                  )}
                </div>

                {s.checkError && (
                  <span
                    title={s.checkError}
                    className="absolute bottom-2 left-2 rounded-md bg-amber-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                  >
                    ⚠ Check failed
                  </span>
                )}
                <div className="absolute inset-x-2 bottom-2 flex items-center justify-between text-[11px] font-medium text-neutral-200">
                  {s.latestNumber != null ? (
                    <span className="rounded bg-black/60 px-1.5 py-0.5 backdrop-blur-xs">Ch. {s.latestNumber}</span>
                  ) : (
                    <span />
                  )}
                  {s.siteStatus && (
                    <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] capitalize text-neutral-300 backdrop-blur-xs">
                      {s.siteStatus}
                    </span>
                  )}
                </div>
              </Link>
              <div className="flex flex-1 flex-col gap-1.5 p-3">
                <Link
                  to={`/series/${s.id}`}
                  title={s.title}
                  className="line-clamp-2 text-sm font-semibold leading-snug text-neutral-100 transition-colors group-hover:text-violet-300"
                >
                  {s.title}
                </Link>

                {/* Reading status paired directly with Unread chapter counter */}
                <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
                  <span className="inline-flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-950/80 px-2 py-0.5 text-[11px] font-medium text-neutral-300">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        s.libraryStatus === 'reading'
                          ? 'bg-emerald-400'
                          : s.libraryStatus === 'completed'
                            ? 'bg-sky-400'
                            : 'bg-neutral-500'
                      }`}
                    />
                    {STATUS_LABELS[s.libraryStatus]}
                  </span>
                  {s.unread > 0 ? (
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                        hasNew
                          ? 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                          : 'border border-violet-500/35 bg-violet-950/40 text-violet-200'
                      }`}
                    >
                      {s.unread} unread
                    </span>
                  ) : (
                    <span className="rounded-md border border-neutral-800/70 bg-neutral-900/50 px-2 py-0.5 text-[10px] font-medium text-neutral-500">
                      Caught up
                    </span>
                  )}
                </div>

                <div className="text-[11px] text-neutral-400">
                  {s.lastReadNumber >= 0 ? `Read to Ch. ${s.lastReadNumber}` : 'Not started'}
                  {s.latestAt && <span className="text-neutral-500"> · {timeAgo(s.latestAt)}</span>}
                </div>

                {/* Last two chapters quick links with read vs unread visual distinction + NEW badge */}
                {recent.length > 0 && (
                  <div className="flex flex-col gap-1 pt-0.5">
                    {recent.map((ch) => {
                      const isNewCh = !ch.read && (ch.isNew ?? isRecentChapterDate(ch.publishedAt));
                      return (
                        <Link
                          key={ch.id ?? ch.number}
                          to={`/read/${s.id}/${ch.id}`}
                          onClick={(e) => e.stopPropagation()}
                          title={ch.fullTitle ?? ch.title}
                          className={`flex items-center justify-between rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                            ch.read
                              ? 'border-neutral-800/80 bg-neutral-900/50 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300'
                              : isNewCh
                                ? 'border-emerald-500/45 bg-emerald-950/25 text-emerald-100 shadow-xs hover:border-emerald-400 hover:bg-emerald-900/35'
                                : 'border-violet-500/40 bg-violet-600/20 text-violet-200 shadow-xs hover:border-violet-400 hover:bg-violet-600/30'
                          }`}
                        >
                          <span className="flex items-center gap-1.5 truncate">
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                ch.read ? 'bg-neutral-600' : isNewCh ? 'bg-emerald-400' : 'bg-violet-400'
                              }`}
                            />
                            <span className="truncate">{ch.title}</span>
                            {isNewCh && (
                              <span className="rounded bg-emerald-500 px-1 py-0.2 text-[9px] font-extrabold uppercase tracking-wider text-neutral-950">
                                NEW
                              </span>
                            )}
                          </span>
                          <span className="ml-1 shrink-0 text-[10px]">
                            {ch.read ? '✓ Read' : ch.publishedAt ? timeAgo(ch.publishedAt) : 'Unread'}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}

                {s.continueChapterId && s.unread > 0 && (
                  <Link
                    to={`/read/${s.id}/${s.continueChapterId}`}
                    className="btn btn-primary mt-auto justify-center py-1 text-xs"
                  >
                    {s.lastReadNumber >= 0 ? '▶ Continue' : '▶ Start reading'}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
