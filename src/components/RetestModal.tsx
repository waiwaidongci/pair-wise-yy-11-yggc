import { useMemo, useState } from "react";
import type { AppState, FillRecord } from "../types";
import {
  MAX_PRESSURE_DROP,
  MIN_SETTLE_MINUTES,
  O2_TOLERANCE,
  HE_TOLERANCE,
  batchLabel,
  evaluateRetest,
  formatMinutes,
  toLocalInput,
} from "../domain";
import type { StoreActions } from "../store";
import { StatusBadge, fmtDateTime } from "./shared";

interface Props {
  fill: FillRecord;
  state: AppState;
  actions: StoreActions;
  onClose: () => void;
}

export function RetestModal({ fill, state, actions, onClose }: Props) {
  const frozen = fill.status === "已冻结";
  const replacementCandidates = useMemo(
    () => state.batches.filter((b) => b.active && b.mode === fill.mode),
    [state.batches, fill.mode],
  );

  const [replacementBatchId, setReplacementBatchId] = useState(replacementCandidates[0]?.id ?? "");
  const [at, setAt] = useState(toLocalInput());
  const [pressure, setPressure] = useState<string>(String(fill.filledPressure));
  const [o2, setO2] = useState<string>(String(fill.targetO2));
  const [he, setHe] = useState<string>(String(fill.targetHe));
  const [operator, setOperator] = useState(fill.operator);
  const [reworkNote, setReworkNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const oldBatch = state.batches.find((b) => b.id === fill.gasBatchId);

  const draft = {
    at: new Date(at).toISOString(),
    pressure: Number(pressure),
    o2: Number(o2),
    he: Number(he),
  };
  const validInputs = at !== "" && pressure !== "" && o2 !== "" && he !== "" && operator.trim() !== ""
    && Number.isFinite(draft.pressure) && Number.isFinite(draft.o2) && Number.isFinite(draft.he);
  const check = useMemo(
    () => (validInputs ? evaluateRetest(fill, draft, new Date(draft.at)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fill, at, pressure, o2, he, validInputs],
  );

  const replacementOk = !frozen || (replacementBatchId !== "" && replacementCandidates.some((b) => b.id === replacementBatchId));

  function submit(decision: "签收" | "返工") {
    const err = actions.submitRetest(fill.id, {
      replacementBatchId: frozen ? replacementBatchId : undefined,
      at,
      pressure: Number(pressure),
      o2: Number(o2),
      he: Number(he),
      operator,
      decision,
      reworkNote,
    });
    if (err) {
      setError(err);
      return;
    }
    onClose();
  }

  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <p>静置稳压复检</p>
            <h2>
              {fill.cylinderId} · {fill.mode} <StatusBadge status={fill.status} />
            </h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">✕</button>
        </header>

        <div className="modal-body">
          <section className="retest-meta">
            <div><span>充填完成</span><b>{fmtDateTime(fill.filledAt)}</b></div>
            <div><span>充填压力</span><b>{fill.filledPressure} bar</b></div>
            <div><span>目标比例</span><b>O₂ {fill.targetO2}% / He {fill.targetHe}%</b></div>
            <div><span>气源批次</span><b>{batchLabel(oldBatch)}</b></div>
            <div><span>充填员</span><b>{fill.operator}</b></div>
          </section>

          {frozen && (
            <section className={`freeze-box ${replacementOk ? "" : "box-error"}`}>
              <h3>① 气源冻结 — 先补录合格气源</h3>
              <p>
                原批次 <b>{fill.gasBatchId}</b> 已停用，该未签收复测已冻结。
                须补录启用中的 <b>{fill.mode}</b> 合格气源并完成本次重测后才恢复。
              </p>
              {replacementCandidates.length === 0 ? (
                <p className="form-error">暂无启用中的{fill.mode}合格气源，请先到「气源批次」页签补录。</p>
              ) : (
                <label className="full">
                  <span>补录气源批次</span>
                  <select value={replacementBatchId} onChange={(e) => setReplacementBatchId(e.target.value)}>
                    {replacementCandidates.map((b) => (
                      <option key={b.id} value={b.id}>{batchLabel(b)} · {b.supplier}</option>
                    ))}
                  </select>
                </label>
              )}
            </section>
          )}

          <section>
            <h3>{frozen ? "② " : ""}复检读数（静置后实测）</h3>
            <div className="field-grid">
              <label>
                <span>复测时间</span>
                <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
              </label>
              <label>
                <span>复测员</span>
                <input value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="复测操作员" />
              </label>
              <label>
                <span>复测压力 bar（充填后 {fill.filledPressure}bar）</span>
                <input type="number" value={pressure} onChange={(e) => setPressure(e.target.value)} />
              </label>
              <label>
                <span>实测氧含量 %（目标 {fill.targetO2}%）</span>
                <input type="number" step="0.1" value={o2} onChange={(e) => setO2(e.target.value)} />
              </label>
              <label>
                <span>实测氦含量 %（目标 {fill.targetHe}%）</span>
                <input
                  type="number"
                  step="0.1"
                  value={he}
                  onChange={(e) => setHe(e.target.value)}
                  disabled={fill.mode !== "Trimix"}
                />
              </label>
            </div>
            <p className="rule-hint">
              判定阈值：静置 ≥ {MIN_SETTLE_MINUTES} 分钟、压力下降 ≤ {MAX_PRESSURE_DROP}bar、
              氧偏差 ≤ ±{O2_TOLERANCE}%{fill.mode === "Trimix" ? `、氦偏差 ≤ ±${HE_TOLERANCE}%` : ""}（非 Trimix 不考核氦）。
            </p>
          </section>

          {check && (
            <section className={`check-box ${check.passed ? "box-ok" : "box-error"}`}>
              <div className="check-grid">
                <div className={check.restMinutes < MIN_SETTLE_MINUTES ? "fail" : "ok"}>
                  <span>静置时长</span>
                  <b>{formatMinutes(check.restMinutes)}</b>
                </div>
                <div className={check.pressureDrop > MAX_PRESSURE_DROP ? "fail" : "ok"}>
                  <span>压力下降</span>
                  <b>{check.pressureDrop} bar</b>
                </div>
                <div className={check.o2Diff > O2_TOLERANCE ? "fail" : "ok"}>
                  <span>氧偏差</span>
                  <b>{check.o2Diff}%</b>
                </div>
                <div className={fill.mode === "Trimix" && check.heDiff > HE_TOLERANCE ? "fail" : "ok"}>
                  <span>氦偏差</span>
                  <b>{check.heDiff}%</b>
                </div>
              </div>
              {check.passed ? (
                <p className="check-msg">✔ 复检合格，可以签收。</p>
              ) : (
                <div className="check-msg">
                  <p className="box-title">✕ 超限项（不得签收，只能转返工）：</p>
                  <ul>
                    {check.failures.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                </div>
              )}
            </section>
          )}

          {check && !check.passed && (
            <label className="full">
              <span>返工说明（必填，写明超限项处理）</span>
              <textarea
                rows={3}
                value={reworkNote}
                onChange={(e) => setReworkNote(e.target.value)}
                placeholder={`如：${check.failures[0] ?? "超限项"} —— 重新抽真空/查漏/配比后再充填`}
              />
            </label>
          )}

          {error && <p className="form-error">{error}</p>}
        </div>

        <footer className="modal-foot">
          <button onClick={onClose}>取消</button>
          <button
            className="danger"
            disabled={!validInputs || !replacementOk || !check || check.passed || reworkNote.trim() === ""}
            onClick={() => submit("返工")}
          >
            转返工（写明超限项）
          </button>
          <button
            className="primary"
            disabled={!validInputs || !replacementOk || !check || !check.passed}
            onClick={() => submit("签收")}
          >
            复检合格 · 签收
          </button>
        </footer>
      </div>
    </div>
  );
}
