import type { FillStatus, HistoryEvent } from "../types";

export function StatusBadge({ status }: { status: FillStatus }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDate(s: string): string {
  if (!s) return "—";
  return s;
}

export function Timeline({ events }: { events: HistoryEvent[] }) {
  return (
    <ol className="timeline">
      {events.map((e, i) => (
        <li key={i} className={`tl-${e.type}`}>
          <div className="tl-dot" />
          <div>
            <time>{fmtDateTime(e.at)}</time>
            <span className="tl-type">{e.type}</span>
            <p>{e.message}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function EmptyHint({ text }: { text: string }) {
  return <p className="empty-hint">{text}</p>;
}
