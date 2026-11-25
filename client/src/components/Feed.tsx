import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, isRecentChapterDate, proxied, timeAgo } from '../api';
import { STATUS_LABELS, type AltSourceRef, type FeedItem, type RecentChapterLink } from '../types';

export function SourceStatusBar({
  statuses,
  names,
}: {
  statuses: Record<string, { ok: boolean; message?: string }>;
  names: Record<string, string>;
}) {
  const bad = Object.entries(statuses).filter(([, s]) => !s.ok);
  if (!bad.length) return null;
  return (
    <div className="mb-4 space-y-1.5">
      {bad.map(([id, s]) => (
        <div
          key={id}
          className="flex items-center gap-2 rounded-xl border border-amber-700/40 bg-amber-950/30 px-3.5 py-2 text-xs text-amber-200/90 shadow-sm"
        >
          <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-400" />
          <div className="min-w-0 flex-1">
            <strong className="font-semibold text-amber-100">{names[id] ?? id}:</strong> {s.message}
          </div>
        </div>
      ))}
    </div>
  );
}

const TYPE_COLORS: Record<string, string> = {
  Manhwa: 'bg-violet-500/85 text-white',
  Manga: 'bg-sky-500/85 text-white',
  Manhua: 'bg-amber-500/85 text-neutral-950',
  'Novel/Other': 'bg-emerald-500/85 text-neutral-950',
};

const STATUS_DOT: Record<string, string> = {
  Ongoing: 'bg-emerald-400',
  Completed: 'bg-sky-400',
  Hiatus: 'bg-amber-400',
  Cancelled: 'bg-rose-400',
};

export function FeedCard({ item, onChange }: { item: FeedItem; onChange: (patch: Partial<FeedItem>) => void }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [imgErr, setImgErr] = useState(false);

  const open = async () => {
    setBusy(true);
    try {
      const id = item.seriesId ?? (await api.open(item)).id;
      nav(`/series/${id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const openAltSource = async (e: React.MouseEvent, alt: AltSourceRef) => {
    e.stopPropagation();
    setBusy(true);
    try {
      const id =
        alt.seriesId ??
        (
          await api.open({
            sourceId: alt.sourceId,
            seriesKey: alt.seriesKey,
            title: item.title,
            cover: item.cover,
            latestAt: item.latestAt,
            status: item.status,
            type: item.type,
            genres: item.genres,
            creator: item.creator,
            rating: item.rating,
          })
        ).id;
      nav(`/series/${id}`);
    } catch (er) {
      setErr((er as Error).message);
      setBusy(false);
    }
  };

  const jumpChapter = async (e: React.MouseEvent, ch: RecentChapterLink) => {
    e.stopPropagation();
    setBusy(true);
    setErr('');
    try {
      if (item.seriesId && ch.id) {
        nav(`/read/${item.seriesId}/${ch.id}`);
        return;
      }
      const r = await api.openChapter(item, ch);
      nav(`/read/${r.seriesId}/${r.chapterId}`);
    } catch (er) {
      setErr((er as Error).message);
      setBusy(false);
    }
  };

  const bookmark = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    setErr('');
    try {
      const r = await api.bookmark(item);
      onChange({ inLibrary: true, seriesId: r.series.id, libraryStatus: 'plan' });
      if (r.warning) setErr(r.warning);
    } catch (er) {
      setErr((er as Error).message);
    }
    setBusy(false);
  };

  const recent = (item.recentChapters ?? []).slice(0, 2);
  const hasNew = item.hasNewUnread ?? recent.some((ch) => !ch.read && (ch.isNew ?? isRecentChapterDate(ch.publishedAt)));

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-neutral-900/75 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-xl ${
        item.inLibrary && hasNew
          ? 'border-emerald-500/45 shadow-emerald-950/20 hover:border-emerald-400/70'
          : 'border-neutral-800/90 hover:border-violet-500/50 hover:shadow-violet-950/30'
      }`}
    >
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="relative aspect-[2/3] w-full overflow-hidden bg-neutral-950 text-left"
      >
        {item.cover && !imgErr ? (
          <img
            src={proxied(item.cover, item.sourceId)}
            loading="lazy"
            alt=""
            onError={() => setImgErr(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-neutral-900 via-violet-950/30 to-neutral-950 p-3 text-center">
            <img src="/icon.svg" alt="" className="h-9 w-9 opacity-45" />
            <span className="line-clamp-3 text-xs font-medium text-neutral-400">{item.title}</span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

        {/* Top-left Source Pill */}
        <span className="absolute left-2 top-2 rounded-md bg-neutral-950/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-200 ring-1 ring-white/10 backdrop-blur-sm">
          {item.sourceName}
        </span>

        {/* Top-right Type / NEW / Rating Pill */}
        <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
          {hasNew && (
            <span className="rounded-md bg-emerald-500 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-neutral-950 shadow">
              NEW
            </span>
          )}
          {item.type && (
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow ${
                TYPE_COLORS[item.type] ?? 'bg-neutral-800 text-neutral-200'
              }`}
            >
              {item.type}
            </span>
          )}
          {item.rating != null && item.rating > 0 && (
            <span className="rounded-md bg-neutral-950/85 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-400/20 backdrop-blur-sm">
              ★ {item.rating.toFixed(1)}
            </span>
          )}
        </div>

        {/* Bottom overlay inside cover: Status & Latest chapter */}
        <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-1.5 text-[11px] font-medium text-neutral-200">
          {item.latestChapter ? (
            <span className="truncate rounded bg-black/60 px-1.5 py-0.5 backdrop-blur-xs">{item.latestChapter}</span>
          ) : (
            <span />
          )}
          {item.status && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-neutral-300 backdrop-blur-xs">
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[item.status] ?? 'bg-emerald-400'}`} />
              {item.status}
            </span>
          )}
        </div>

        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-black/70 text-xs font-medium text-violet-200 backdrop-blur-xs">
            Loading…
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <button
          type="button"
          onClick={open}
          title={item.title}
          className="line-clamp-2 text-left text-sm font-semibold leading-snug text-neutral-100 transition-colors group-hover:text-violet-300"
        >
          {item.title}
        </button>

        {/* Paired Reading Status & Unread Chapter Counter when bookmarked */}
        {item.inLibrary && (
          <div className="flex flex-wrap items-center justify-between gap-1 pt-0.5">
            <span className="inline-flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-950/80 px-1.5 py-0.5 text-[10px] font-medium text-neutral-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {item.libraryStatus ? STATUS_LABELS[item.libraryStatus] : 'In Library'}
            </span>
            {item.unread != null && item.unread > 0 ? (
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                  hasNew
                    ? 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                    : 'border border-violet-500/35 bg-violet-950/40 text-violet-200'
                }`}
              >
                {item.unread} unread
              </span>
            ) : (
              <span className="rounded-md border border-neutral-800/70 bg-neutral-900/50 px-1.5 py-0.5 text-[10px] text-neutral-500">
                Caught up
              </span>
            )}
          </div>
        )}

        {/* Alternative deduplicated sources badges */}
        {item.altSources && item.altSources.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-[10px] text-neutral-400">
            <span>Also on:</span>
            {item.altSources.slice(0, 2).map((alt) => (
              <button
                key={alt.sourceId}
                type="button"
                onClick={(e) => openAltSource(e, alt)}
                title={`Open from ${alt.sourceName}${alt.latestChapter ? ` (${alt.latestChapter})` : ''}`}
                className="rounded border border-neutral-700/80 bg-neutral-800/80 px-1.5 py-0.2 text-[10px] font-medium text-neutral-300 transition hover:border-violet-500/60 hover:text-violet-200"
              >
                {alt.sourceName}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-neutral-400">
          {item.latestAt && <span>{timeAgo(item.latestAt)}</span>}
          {item.creator && (
            <span className="truncate text-neutral-500" title={item.creator}>
              {item.latestAt ? '· ' : ''}
              {item.creator}
            </span>
          )}
        </div>

        {/* Last two chapters clickable quick links with NEW (< 1 week) badge */}
        {recent.length > 0 && (
          <div className="flex flex-col gap-1 pt-0.5">
            {recent.map((ch) => {
              const isNewCh = !ch.read && (ch.isNew ?? isRecentChapterDate(ch.publishedAt));
              return (
                <button
                  key={`${ch.number}-${ch.key ?? ''}`}
                  type="button"
                  disabled={busy}
                  onClick={(e) => jumpChapter(e, ch)}
                  className={`flex items-center justify-between rounded-md border px-2 py-1 text-left text-[11px] font-medium transition ${
                    ch.read
                      ? 'border-neutral-800/70 bg-neutral-900/50 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300'
                      : isNewCh
                        ? 'border-emerald-500/40 bg-emerald-950/25 text-emerald-100 hover:border-emerald-400 hover:bg-emerald-900/35'
                        : 'border-violet-500/25 bg-violet-950/25 text-violet-200 hover:border-violet-500/60 hover:bg-violet-900/40'
                  }`}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="truncate">{ch.title}</span>
                    {isNewCh && (
                      <span className="rounded bg-emerald-500 px-1 py-0.2 text-[9px] font-extrabold uppercase tracking-wider text-neutral-950">
                        NEW
                      </span>
                    )}
                  </span>
                  <span className="ml-1 shrink-0 text-[10px] opacity-75">
                    {ch.read ? '✓ Read' : ch.publishedAt ? timeAgo(ch.publishedAt) : 'Read →'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {item.genres && item.genres.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {item.genres.slice(0, 2).map((g) => (
              <span
                key={g}
                className="rounded bg-neutral-800/90 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400"
              >
                {g}
              </span>
            ))}
            {item.genres.length > 2 && (
              <span className="rounded bg-neutral-800/60 px-1 py-0.5 text-[10px] text-neutral-500">
                +{item.genres.length - 2}
              </span>
            )}
          </div>
        )}

        {err && <div className="text-[11px] text-amber-400">{err}</div>}

        <div className="mt-auto pt-1.5">
          {item.inLibrary ? (
            <button
              type="button"
              className="btn w-full justify-center border-emerald-500/30 bg-emerald-950/30 py-1 text-xs text-emerald-300 hover:border-emerald-500/50 hover:bg-emerald-900/40"
              onClick={open}
            >
              ✓ Bookmarked
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary w-full justify-center py-1 text-xs"
              disabled={busy}
              onClick={bookmark}
            >
              + Bookmark
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
