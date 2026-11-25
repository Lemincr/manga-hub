import { useEffect, useState } from 'react';
import { api } from '../api';
import type { SourceInfo } from '../types';

export function useSources() {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  useEffect(() => {
    api.get<SourceInfo[]>('/sources').then((s) => setSources(s.filter((x) => x.enabled)));
  }, []);
  return sources;
}

/**
 * Filter bar for Discovery / Search.
 * - `selected === null` means **"All sources"** (queries every enabled source, including extra sources).
 * - Individual pills only show sources where `!s.hidden` (primary sources by default, or all enabled
 *   sources if `sources.extraInAllOnly` is turned off in Settings).
 */
export function SourceChips({
  sources,
  selected,
  onChange,
  allowAll = true,
}: {
  sources: SourceInfo[];
  selected: string[] | null;
  onChange: (ids: string[] | null) => void;
  allowAll?: boolean;
}) {
  const visible = sources.filter((s) => !s.hidden);
  const extraCount = sources.length - visible.length;
  const isAll = selected === null;

  const toggle = (id: string) => {
    if (selected === null) {
      onChange([id]);
      return;
    }
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(next.length ? next : [id]);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {allowAll && (
        <button
          type="button"
          className={`chip ${isAll ? 'chip-on' : ''}`}
          title={extraCount > 0 ? `Includes ${visible.length} primary + ${extraCount} extra sources` : 'All enabled sources'}
          onClick={() => onChange(null)}
        >
          All sources{extraCount > 0 ? ` (+${extraCount})` : ''}
        </button>
      )}
      {visible.map((s) => (
        <button
          type="button"
          key={s.id}
          className={`chip ${!isAll && selected.includes(s.id) ? 'chip-on' : ''}`}
          onClick={() => toggle(s.id)}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}
