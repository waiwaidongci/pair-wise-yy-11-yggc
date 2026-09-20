import { useMemo, useState } from "react";
import type { AppState } from "../types";
import { inspectionState } from "../domain";
import { StatusBadge, Timeline, fmtDateTime, EmptyHint } from "./shared";

interface Props {
  state: AppState;
}

export function CylindersTab({ state }: Props) {
  const [selectedId, setSelectedId] = useState(state.cylinders[0]?.id ?? "");
  const selected = state.cylinders.find((c) => c.id === selectedId);

  const history = useMemo(
    () =>
      state.fills
        .filter((f) => f.cylinderId === selectedId)
        .sort((a, b) => +new Date(b.filledAt) - +new Date(a.filledAt)),
    [state.fills, selectedId],
  );

  const stats = useMemo(() => {
    const signed = history.filter((f) => f.status === "已签收").length;
    const rework = history.filter((f) => f.status === "返工").length;
    return { total: history.length, signed, rework };
  }, [history]);

  return (
    <div className="cyl-layout">
      <section className="panel cyl-list-panel">
        <div className="heading">
          <div>
            <p>气瓶档案</p>
            <h2>单瓶选择 · {state.cylinders.length} 只</h2>
          </div>
        </div>
        <div className="cyl-list">
          {state.cylinders.map((c) => {
            const info = inspectionState(c.inspectionDue);
            const open = state.fills.some((f) => f.cylinderId === c.id && (f.status === "待复测" || f.status === "已冻结"));
            return (
              <button
                key={c.id}
                className={`cyl-item ${selectedId === c.id ? "selected" : ""}`}
                onClick={() => setSelectedId(c.id)}
              >
                <b>{c.id}</b>
                <small>{c.volume}</small>
                <span className={`cyl-due due-${info.state}`}>
                  {info.state === "过期" ? `检验过期 ${-info.days} 天` : info.state === "临近" ? `检验剩 ${info.days} 天` : `检验至 ${c.inspectionDue}`}
                </span>
                {open && <span className="open-dot" title="存在未闭环充填" />}
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel">
        {!selected ? (
          <EmptyHint text="暂无气瓶档案。" />
        ) : (
          <>
            <div className="heading">
              <div>
                <p>单瓶历史（与台账、统计同源，刷新后一致）</p>
                <h2>{selected.id} · {selected.volume}</h2>
              </div>
              <div className="mini-stats">
                <span>充填 {stats.total} 次</span>
                <span className="ok-text">签收 {stats.signed}</span>
                <span className="danger-text">返工 {stats.rework}</span>
              </div>
            </div>
            <p className="due-line">检验有效期：{fmtDateSafe(selected.inspectionDue)}（建档 {fmtDateTime(selected.createdAt)}）</p>

            {history.length === 0 ? (
              <EmptyHint text="该气瓶暂无充填记录。" />
            ) : (
              <div className="cyl-history">
                {history.map((f) => (
                  <article key={f.id} className="hist-card">
                    <header>
                      <div>
                        <h3>{f.mode} · {f.filledPressure}bar <StatusBadge status={f.status} /></h3>
                        <p>充填完成 {fmtDateTime(f.filledAt)} · 记录号 {f.id}</p>
                      </div>
                      <div className="hist-side">
                        <span>气源 {f.gasBatchId}</span>
                        <span>操作员 {f.operator}</span>
                      </div>
                    </header>
                    {f.retest && (
                      <p className="hist-retest">
                        复检（{fmtDateTime(f.retest.at)}）：{f.retest.pressure}bar、O₂{f.retest.o2}%、He{f.retest.he}%、复测员 {f.retest.operator}
                        {f.gasReplaced && <> · 已补录气源 {f.gasReplaced.toBatchId}</>}
                      </p>
                    )}
                    {f.closure?.kind === "返工" && (
                      <p className="danger-text">返工超限：{f.closure.failures.join("；")}｜说明：{f.closure.note}</p>
                    )}
                    <Timeline events={f.history} />
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function fmtDateSafe(s: string): string {
  return s || "—";
}
