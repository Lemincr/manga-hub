export type LibStatus = 'reading' | 'plan' | 'hold' | 'completed' | 'dropped';
export const STATUS_LABELS: Record<LibStatus, string> = {
  reading: 'Reading',
  plan: 'Plan to Read',
  hold: 'On Hold',
  completed: 'Completed',
  dropped: 'Dropped',
};

export interface RecentChapterLink {
  id?: number;
  key?: string | null;
  number: number;
  title: string;
  fullTitle?: string;
  publishedAt?: string | null;
  locked?: boolean;
  read?: boolean;
  isNew?: boolean;
}

export interface AltSourceRef {
  sourceId: string;
  sourceName: string;
  seriesKey: string;
  seriesId: number | null;
  latestChapter?: string | null;
}

export interface Series {
  id: number;
  sourceId: string;
  sourceName: string;
  seriesKey: string;
  title: string;
  aliases: string[];
  sourceAliases: string[];
  cover: string | null;
  description: string | null;
  siteStatus: string | null;
  mediaType?: string | null;
  genres?: string[];
  creator?: string | null;
  rating?: number | null;
  inLibrary: boolean;
  libraryStatus: LibStatus;
  lastReadNumber: number;
  resumeChapterId: number | null;
  resumeScroll: number;
  lastReadAt: string | null;
  latestNumber: number | null;
  latestAt: string | null;
  lastCheckedAt: string | null;
  checkError: string | null;
  unread: number;
  newUnreadCount?: number;
  hasNewUnread?: boolean;
  latestNewAt?: string | null;
  totalChapters: number;
  recentChapters?: RecentChapterLink[];
  continueChapterId: number | null;
  originalUrl: string;
}

export interface Chapter {
  id: number;
  number: number;
  title: string;
  publishedAt: string | null;
  locked: boolean;
  read?: boolean;
  isNew?: boolean;
  originalUrl: string;
}

export interface FeedItem {
  sourceId: string;
  sourceName: string;
  seriesKey: string;
  title: string;
  altTitles?: string[];
  cover?: string | null;
  latestChapter?: string | null;
  latestAt?: string | null;
  seriesId: number | null;
  inLibrary: boolean;
  libraryStatus?: LibStatus | null;
  unread?: number | null;
  newUnreadCount?: number;
  hasNewUnread?: boolean;
  latestNewAt?: string | null;
  status?: string | null;
  type?: string | null;
  genres?: string[];
  creator?: string | null;
  chapterCount?: number | null;
  rating?: number | null;
  recentChapters?: RecentChapterLink[];
  altSources?: AltSourceRef[];
}

export interface SourceInfo {
  id: string;
  name: string;
  tier: 'primary' | 'extra';
  hidden: boolean;
  enabled: boolean;
  baseUrl: string;
  extraSettings: { key: string; label: string }[];
  status: { ok: boolean | null; message: string; at: string | null };
}

export interface ReaderData {
  series: { id: number; title: string; sourceId: string };
  chapter: { id: number; number: number; title: string };
  images: string[];
  locked: boolean;
  message?: string;
  prevId: number | null;
  nextId: number | null;
  originalUrl: string;
  resume: { scroll: number; done: boolean } | null;
}
