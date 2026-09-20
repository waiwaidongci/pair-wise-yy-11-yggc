import { useState } from "react";
import type { AppState, MixMode } from "../types";
import type { StoreActions } from "../store";
import { EmptyHint, fmtDateTime } from "./shared";

interface Props {
  state: AppState;
  actions: StoreActions;
}

export function GasTab({ state, actions }: Props) {
  const [id, setId] = useState("");
  const [supplier, setSupplier] = useState("");
  const [mode, setMode] = useState<MixMode>("空气");
  const [o2, setO2] = useState("21");
  const [he, setHe] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function addBatch() {
    setError(null);
    setOk(null);
    if (!id.trim() || !supplier.trim()) {
      setError("请填写批次号与气源厂商");
      return;
    }
    const nums = { o2: Number(o2), he: Number(he) };
    if (!Number.isFinite(nums.o2) || !Number.isFinite(nums.he) || nums.o2 < 0 || nums.he < 0 || nums.o2 + nums.he > 100) {
      setError("氧/氦比例需为有效数值且合计不超过 100%");
      return;
    }
    const err = actions.addBatch({ id, supplier, mode, o2: nums.o2, he: nums.he });
    if (err) {
      setError(err);
      return;
    }
    setOk(`合格气源批次 ${id.trim()} 已补录，可用于解除对应冻结复测`);
    setId("");
    setSupplier("");
  }

  function doDisable(batchId: string) {
    const frozen = actions.disableBatch(batchId);
    setConfirmId(null);
    setOk(`批次 ${batchId} 已停用${frozen > 0 ? `，${frozen} 条未签收复测已冻结` : "，无未闭环记录受影响"}`);
  }

  return (
    <div className="gas-layout">
      <section className="panel">
        <div className="heading">
          <div>
            <p>气源批次管理</p>
            <h2>补录合格气源</h2>
          </div>
        </div>
        <div className="field-grid">
          <label><span>批次号</span><input value={id} onChange={(e) => setId(e.target.value)} placeholder="如 AIR-2026-10" /></label>
          <label><span>气源厂商</span><input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="如 海风气站" /></label>
          <label>
            <span>标定类型</span>
            <select value={mode} onChange={(e) => {
              const m = e.target.value as MixMode;
              setMode(m);
              if (m === "空气") { setO2("21"); setHe("0"); }
              if (m === "高氧") { setO2("32"); setHe("0"); }
              if (m === "Trimix") { setO2("18"); setHe("45"); }
            }}>
              <option value="空气">空气</option>
              <option value="高氧">高氧</option>
              <option value="Trimix">Trimix</option>
            </select>
          </label>
          <label><span>标定氧含量 %</span><input type="number" step="0.1" value={o2} onChange={(e) => setO2(e.target.value)} /></label>
          <label><span>标定氦含量 %</span><input type="number" step="0.1" value={he} onChange={(e) => setHe(e.target.value)} disabled={mode !== "Trimix"} /></label>
        </div>
        {error && <p className="form-error">{error}</p>}
        {ok && <p className="form-ok">{ok}</p>}
        <div className="form-actions"><button className="primary" onClick={addBatch}>补录批次</button></div>
        <p className="rule-hint">停用不可逆：停用后该批次不可再启用，只能补录新的合格批次。停用会冻结所有引用该批次且未签收的复测，须在复测中补录合格气源并重测后才恢复。</p>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>批次清单</p>
            <h2>气源批次 · {state.batches.length} 个</h2>
          </div>
        </div>
        {state.batches.length === 0 ? (
          <EmptyHint text="暂无气源批次。" />
        ) : (
          <div className="batch-list">
            {state.batches.map((b) => {
              const openCount = state.fills.filter((f) => f.gasBatchId === b.id && (f.status === "待复测" || f.status === "已冻结")).length;
              const signedCount = state.fills.filter((f) => f.gasBatchId === b.id && f.status === "已签收").length;
              return (
                <article key={b.id} className={`batch-card ${b.active ? "" : "batch-off"}`}>
                  <div className="batch-main">
                    <h3>
                      {b.id}
                      <span className={b.active ? "batch-state on" : "batch-state off"}>{b.active ? "启用中" : "已停用"}</span>
                    </h3>
                    <p>{b.supplier} · {b.mode} · 标定 O₂{b.o2}% / He{b.he}%</p>
                    <p className="batch-meta">
                      建档 {fmtDateTime(b.createdAt)} · 未闭环 {openCount} 条 · 已签收 {signedCount} 条
                    </p>
                    {!b.active && openCount > 0 && <p className="frozen-note">存在 {openCount} 条冻结复测，等待补录合格气源并重测。</p>}
                  </div>
                  <div className="batch-actions">
                    {b.active ? (
                      confirmId === b.id ? (
                        <>
                          <span className="confirm-text">停用将冻结 {openCount} 条未签收复测</span>
                          <button className="danger" onClick={() => doDisable(b.id)}>确认停用</button>
                          <button onClick={() => setConfirmId(null)}>取消</button>
                        </>
                      ) : (
                        <button className="danger" onClick={() => setConfirmId(b.id)}>停用批次</button>
                      )
                    ) : (
                      <span className="off-text">已停用（不可恢复）</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
