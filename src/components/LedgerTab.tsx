import { useMemo, useState } from "react";
import type { AppState, FillStatus, MixMode } from "../types";
import { batchLabel, isOpen } from "../domain";
import { StatusBadge, Timeline, fmtDateTime, EmptyHint } from "./shared";

interface Props {
  state: AppState;
}

const STATUS_FILTERS: Array<FillStatus | "全部"> = ["全部", "待复测", "已冻结", "已签收", "返工"];
const MODE_FILTERS: Array<MixMode | "全部"> = ["全部", "空气", "高氧", "Trimix"];

export function LedgerTab({ state }: Props) {
  const [statusFilter, setStatusFilter] = useState<FillStatus | "全部">("全部");
  const [modeFilter, setModeFilter] = useState<MixMode | "全部">("全部");
  const [expanded, setExpanded] = useState<string | null>(null);

  const list = useMemo(
    () =>
      state.fills.filter(
        (f) =>
          (statusFilter === "全部" || f.status === statusFilter) &&
          (modeFilter === "全部" || f.mode === modeFilter),
      ),
    [state.fills, statusFilter, modeFilter],
  );

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>充填记录台账（只可追加，不可删改）</p>
          <h2>全部充填与复检记录 · {list.length} 条</h2>
        </div>
      </div>

      <div className="filter-row">
        <div className="chip-group">
          {STATUS_FILTERS.map((s) => (
            <button key={s} className={statusFilter === s ? "chip-on" : ""} onClick={() => setStatusFilter(s)}>{s}</button>
          ))}
        </div>
        <div className="chip-group">
          {MODE_FILTERS.map((m) => (
            <button key={m} className={modeFilter === m ? "chip-on" : ""} onClick={() => setModeFilter(m)}>{m}</button>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyHint text="没有符合筛选条件的记录。" />
      ) : (
        <div className="ledger">
          {list.map((f) => {
            const cyl = state.cylinders.find((c) => c.id === f.cylinderId);
            const batch = state.batches.find((b) => b.id === f.gasBatchId);
            const replaced = f.gasReplaced ? state.batches.find((b) => b.id === f.gasReplaced!.toBatchId) : undefined;
            const open = isOpen(f);
            return (
              <article key={f.id} className={`ledger-card status-${f.status} ${expanded === f.id ? "expanded" : ""}`}>
                <button className="ledger-row" onClick={() => setExpanded(expanded === f.id ? null : f.id)}>
                  <span className="ledger-id">{f.id}</span>
                  <span className="ledger-cyl"><b>{f.cylinderId}</b><small>{cyl?.volume}</small></span>
                  <span className="ledger-mode">{f.mode}<small>O₂{f.targetO2}%/He{f.targetHe}%</small></span>
                  <span className="ledger-pressure">{f.filledPressure}bar<small>目标 {f.targetPressure}</small></span>
                  <span className="ledger-batch">
                    {f.gasBatchId}
                    {f.gasReplaced && <small>→ 补录 {f.gasReplaced.toBatchId}</small>}
                    {batch && !batch.active && open && <small className="warn-text">已停用</small>}
                  </span>
                  <span className="ledger-time">{fmtDateTime(f.filledAt)}</span>
                  <span className="ledger-operator">{f.operator}</span>
                  <StatusBadge status={f.status} />
                  <span className="expand-mark">{expanded === f.id ? "▴" : "▾"}</span>
                </button>

                {expanded === f.id && (
                  <div className="ledger-detail">
                    <div className="detail-grid">
                      <div><span>残压</span><b>{f.residualPressure} bar</b></div>
                      <div><span>充填后压力</span><b>{f.filledPressure} bar</b></div>
                      <div><span>目标压力</span><b>{f.targetPressure} bar</b></div>
                      <div><span>目标 O₂ / He</span><b>{f.targetO2}% / {f.targetHe}%</b></div>
                      <div><span>原始气源</span><b>{batchLabel(batch)}</b></div>
                      {f.gasReplaced && (
                        <div className="detail-highlight">
                          <span>补录合格气源</span>
                          <b>{batchLabel(replaced)}（{fmtDateTime(f.gasReplaced.at)}，{f.gasReplaced.operator}）</b>
                        </div>
                      )}
                    </div>

                    {f.retest && (
                      <div className={`retest-summary ${f.closure?.kind === "返工" ? "rs-fail" : "rs-ok"}`}>
                        <h4>复检读数（{fmtDateTime(f.retest.at)}，复测员 {f.retest.operator}）</h4>
                        <p>
                          复测压力 {f.retest.pressure}bar（压降 {f.filledPressure - f.retest.pressure}bar）
                          · O₂ {f.retest.o2}% · He {f.retest.he}%
                        </p>
                        {f.closure?.kind === "返工" && (
                          <div className="rework-box">
                            <b>返工超限项：</b>
                            <ul>{f.closure.failures.map((x) => <li key={x}>{x}</li>)}</ul>
                            <p><b>返工说明：</b>{f.closure.note}</p>
                          </div>
                        )}
                        {f.closure?.kind === "签收" && <p className="ok-text">✔ 复检合格，{fmtDateTime(f.closure.at)} 由 {f.closure.operator} 签收。</p>}
                      </div>
                    )}

                    <Timeline events={f.history} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
