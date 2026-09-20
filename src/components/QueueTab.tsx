import { useMemo, useState } from "react";
import type { AppState, MixMode } from "../types";
import { MIX_PRESETS, inspectionState, isOpen, toLocalInput } from "../domain";
import type { StoreActions } from "../store";
import { StatusBadge, EmptyHint } from "./shared";

interface Props {
  state: AppState;
  actions: StoreActions;
  focusFillId?: string | null;
  onOpenRetest: (fillId: string) => void;
}

export function QueueTab({ state, actions, focusFillId, onOpenRetest }: Props) {
  const [cylinderId, setCylinderId] = useState(state.cylinders[0]?.id ?? "");
  const [mode, setMode] = useState<MixMode>("空气");
  const [residual, setResidual] = useState("40");
  const [targetPressure, setTargetPressure] = useState("200");
  const [filledPressure, setFilledPressure] = useState("200");
  const [targetO2, setTargetO2] = useState("21");
  const [targetHe, setTargetHe] = useState("0");
  const [filledAt, setFilledAt] = useState(toLocalInput());
  const [gasBatchId, setGasBatchId] = useState("");
  const [operator, setOperator] = useState("");
  const [newCylId, setNewCylId] = useState("");
  const [newCylVolume, setNewCylVolume] = useState("");
  const [newCylDue, setNewCylDue] = useState("");
  const [showNewCyl, setShowNewCyl] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [dupId, setDupId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeBatches = state.batches.filter((b) => b.active);
  const modeBatches = activeBatches.filter((b) => b.mode === mode);
  const effectiveBatch = gasBatchId && modeBatches.some((b) => b.id === gasBatchId) ? gasBatchId : modeBatches[0]?.id ?? "";

  const queue = state.fills.filter((f) => isOpen(f));

  const expiredCylinders = useMemo(
    () =>
      state.cylinders
        .map((c) => ({ c, info: inspectionState(c.inspectionDue) }))
        .filter((x) => x.info.state !== "正常"),
    [state.cylinders],
  );

  function applyPreset(o2: number, he: number, m: MixMode) {
    setMode(m);
    setTargetO2(String(o2));
    setTargetHe(String(he));
  }

  function registerCylinder() {
    setFormError(null);
    if (!newCylId.trim() || !newCylVolume.trim() || !newCylDue) {
      setFormError("登记气瓶需填写编号、容积与检验有效期");
      return;
    }
    const err = actions.addCylinder({ id: newCylId, volume: newCylVolume, inspectionDue: newCylDue });
    if (err) {
      setFormError(err);
      return;
    }
    setCylinderId(newCylId.trim());
    setNewCylId("");
    setNewCylVolume("");
    setNewCylDue("");
    setShowNewCyl(false);
  }

  function submitFill() {
    setFormError(null);
    setNotice(null);
    setDupId(null);
    if (!cylinderId) {
      setFormError("请选择或登记气瓶");
      return;
    }
    if (!effectiveBatch) {
      setFormError(`没有启用中的${mode}气源批次，请先到「气源批次」补录`);
      return;
    }
    if (!filledAt || !operator.trim()) {
      setFormError("请填写充填完成时间与操作员");
      return;
    }
    const nums = {
      residualPressure: Number(residual),
      targetPressure: Number(targetPressure),
      filledPressure: Number(filledPressure),
      targetO2: Number(targetO2),
      targetHe: Number(targetHe),
    };
    if (Object.values(nums).some((n) => !Number.isFinite(n) || n < 0)) {
      setFormError("压力与比例需为有效数值");
      return;
    }

    const res = actions.addFill({
      cylinderId,
      mode,
      residualPressure: nums.residualPressure,
      targetPressure: nums.targetPressure,
      filledPressure: nums.filledPressure,
      targetO2: nums.targetO2,
      targetHe: nums.targetHe,
      filledAt: new Date(filledAt).toISOString(),
      gasBatchId: effectiveBatch,
      operator: operator.trim(),
    });
    if (!res.ok) {
      setFormError(res.error ?? "提交失败");
      setDupId(res.existingId ?? null);
      return;
    }
    setNotice("充填已记录，进入静置稳压复检队列");
    setDupId(null);
    setOperator("");
  }

  return (
    <div className="queue-layout">
      {expiredCylinders.length > 0 && (
        <section className="panel alert-panel">
          <h2>⚠ 气瓶检验有效期提醒</h2>
          <div className="alert-list">
            {expiredCylinders.map(({ c, info }) => (
              <span key={c.id} className={`alert-tag alert-${info.state}`}>
                {c.id}（{c.volume}）{info.state === "过期" ? `已过期 ${-info.days} 天` : `剩余 ${info.days} 天`}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="heading">
          <div>
            <p>充填记录</p>
            <h2>新充填登记</h2>
          </div>
          <button onClick={() => setShowNewCyl((v) => !v)}>{showNewCyl ? "收起登记" : "+ 登记新气瓶"}</button>
        </div>

        {showNewCyl && (
          <div className="new-cyl-box">
            <div className="field-grid">
              <label><span>气瓶编号</span><input value={newCylId} onChange={(e) => setNewCylId(e.target.value)} placeholder="如 TANK-260" /></label>
              <label><span>容积</span><input value={newCylVolume} onChange={(e) => setNewCylVolume(e.target.value)} placeholder="如 12L 铝瓶" /></label>
              <label><span>检验有效期</span><input type="date" value={newCylDue} onChange={(e) => setNewCylDue(e.target.value)} /></label>
            </div>
            <button className="secondary" onClick={registerCylinder}>保存气瓶档案</button>
          </div>
        )}

        <div className="field-grid">
          <label>
            <span>气瓶编号</span>
            <select value={cylinderId} onChange={(e) => setCylinderId(e.target.value)}>
              {state.cylinders.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} · {c.volume}
                  {(() => {
                    const info = inspectionState(c.inspectionDue);
                    return info.state === "正常" ? "" : info.state === "过期" ? "（检验已过期）" : `（检验剩${info.days}天）`;
                  })()}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>充填方式</span>
            <select value={mode} onChange={(e) => { setMode(e.target.value as MixMode); setGasBatchId(""); }}>
              <option value="空气">空气</option>
              <option value="高氧">高氧 EAN</option>
              <option value="Trimix">Trimix 三混气</option>
            </select>
          </label>
        </div>

        <div className="preset-row">
          <span>混合气比例提示：</span>
          {MIX_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="preset-chip"
              title={p.hint}
              onClick={() => applyPreset(p.targetO2, p.targetHe, p.mode)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="field-grid">
          <label><span>残压 bar</span><input type="number" value={residual} onChange={(e) => setResidual(e.target.value)} /></label>
          <label><span>目标压力 bar</span><input type="number" value={targetPressure} onChange={(e) => setTargetPressure(e.target.value)} /></label>
          <label><span>充填后压力 bar</span><input type="number" value={filledPressure} onChange={(e) => setFilledPressure(e.target.value)} /></label>
          <label><span>目标氧比例 %</span><input type="number" step="0.1" value={targetO2} onChange={(e) => setTargetO2(e.target.value)} /></label>
          <label>
            <span>目标氦比例 %{mode !== "Trimix" && "（非 Trimix 不考核）"}</span>
            <input type="number" step="0.1" value={targetHe} onChange={(e) => setTargetHe(e.target.value)} disabled={mode !== "Trimix"} />
          </label>
          <label>
            <span>气源批次{effectiveBatch ? "" : "（无启用批次）"}</span>
            <select value={effectiveBatch} onChange={(e) => setGasBatchId(e.target.value)}>
              {modeBatches.length === 0 && <option value="">无可用{mode}气源</option>}
              {modeBatches.map((b) => (
                <option key={b.id} value={b.id}>{b.id} · O₂{b.o2}%/He{b.he}% · {b.supplier}</option>
              ))}
            </select>
          </label>
          <label><span>充填完成时间</span><input type="datetime-local" value={filledAt} onChange={(e) => setFilledAt(e.target.value)} /></label>
          <label><span>操作员</span><input value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="充填操作员" /></label>
        </div>

        {formError && (
          <p className="form-error dup-error">
            <span>{formError}</span>
            {dupId && <button className="primary" onClick={() => onOpenRetest(dupId)}>打开首次记录复检</button>}
          </p>
        )}
        {notice && <p className="form-ok">{notice}</p>}
        <div className="form-actions">
          <button className="primary" onClick={submitFill}>保存充填记录 · 进入复检</button>
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>待复测 / 已冻结（{queue.length}）</p>
            <h2>充填后稳压复检队列</h2>
          </div>
        </div>
        {queue.length === 0 ? (
          <EmptyHint text="当前没有待复测气瓶，所有充填均已闭环。" />
        ) : (
          <div className="queue-list">
            {queue.map((f) => {
              const cyl = state.cylinders.find((c) => c.id === f.cylinderId);
              const batch = state.batches.find((b) => b.id === f.gasBatchId);
              const info = cyl ? inspectionState(cyl.inspectionDue) : null;
              return (
                <article key={f.id} className={`queue-card ${focusFillId === f.id ? "focused" : ""} status-${f.status}`}>
                  <div className="queue-main">
                    <h3>
                      {f.cylinderId} <small>{cyl?.volume}</small> <StatusBadge status={f.status} />
                      {info && info.state !== "正常" && (
                        <span className={`alert-tag alert-${info.state}`}>
                          {info.state === "过期" ? `检验过期 ${-info.days} 天` : `检验剩 ${info.days} 天`}
                        </span>
                      )}
                    </h3>
                    <p>
                      {f.mode} · 充填后 {f.filledPressure}bar（残压 {f.residualPressure} → 目标 {f.targetPressure}）
                      · 目标 O₂{f.targetO2}%/He{f.targetHe}%
                    </p>
                    <p>
                      气源 {f.gasBatchId}（{batch?.active ? "启用中" : "已停用"}）· 完成 {new Date(f.filledAt).toLocaleString("zh-CN", { hour12: false })}
                      · 操作员 {f.operator}
                    </p>
                    {f.status === "已冻结" && (
                      <p className="frozen-note">气源批次已停用，复测冻结；请补录合格气源并重测后恢复签收。</p>
                    )}
                  </div>
                  <button className="primary" onClick={() => onOpenRetest(f.id)}>
                    {f.status === "已冻结" ? "补录气源并重测" : "静置后复检"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
