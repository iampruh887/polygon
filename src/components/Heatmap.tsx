import { useMemo } from 'react';
import type { Artifact } from '../types';

// Artifact activity heatmaps — logging intensity per local day, in reds.
// Levels: 0 none, then 1 / 2-3 / 4-6 / 7+ artifacts.

export function countsByDay(artifacts: Artifact[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of artifacts) {
    const d = new Date(a.created_at + 'Z'); // sqlite datetime('now') is UTC
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}

function level(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

function dayKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface MonthProps {
  counts: Map<string, number>;
  year: number;
  month: number; // 0-based
  onClick?: () => void;
}

export function MonthHeatmap({ counts, year, month, onClick }: MonthProps) {
  const today = new Date();
  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // Monday-first offset so weekends sit together at the row's end.
    const lead = (first.getDay() + 6) % 7;
    const out: { key: string; day: number; count: number }[] = [];
    for (let i = 0; i < lead; i++) out.push({ key: `blank-${i}`, day: 0, count: -1 });
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ key: dayKey(year, month, d), day: d, count: counts.get(dayKey(year, month, d)) ?? 0 });
    }
    return out;
  }, [counts, year, month]);

  return (
    <button className="hm-month" onClick={onClick} title="Click for the full history">
      <div className="hm-month-label">
        {MONTHS[month]} {year}
      </div>
      <div className="hm-grid-month">
        {cells.map((c) =>
          c.count < 0 ? (
            <span key={c.key} className="hm-cell blank" />
          ) : (
            <span
              key={c.key}
              className={`hm-cell hm-l${level(c.count)} ${
                c.day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
                  ? 'today'
                  : ''
              }`}
              title={`${c.key} — ${c.count} artifact${c.count === 1 ? '' : 's'}`}
            />
          ),
        )}
      </div>
    </button>
  );
}

interface YearProps {
  counts: Map<string, number>;
  year: number;
}

export function YearHeatmap({ counts, year }: YearProps) {
  const { weeks, total } = useMemo(() => {
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    // Pad back to Monday so every column is a full week.
    const cursor = new Date(start);
    cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
    const weeks: { key: string; count: number; inYear: boolean }[][] = [];
    let total = 0;
    while (cursor <= end) {
      const week: { key: string; count: number; inYear: boolean }[] = [];
      for (let i = 0; i < 7; i++) {
        const key = dayKey(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
        const inYear = cursor.getFullYear() === year;
        const count = counts.get(key) ?? 0;
        if (inYear) total += count;
        week.push({ key, count, inYear });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }
    return { weeks, total };
  }, [counts, year]);

  return (
    <div className="hm-year">
      <div className="hm-year-head">
        <span className="hm-year-label">{year}</span>
        <span className="hm-year-total">
          {total} artifact{total === 1 ? '' : 's'}
        </span>
      </div>
      <div className="hm-year-grid">
        {weeks.map((week, wi) => (
          <div className="hm-week" key={wi}>
            {week.map((c) => (
              <span
                key={c.key}
                className={`hm-cell small ${c.inYear ? `hm-l${level(c.count)}` : 'blank'}`}
                title={c.inYear ? `${c.key} — ${c.count} artifact${c.count === 1 ? '' : 's'}` : undefined}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
