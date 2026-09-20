import { useMemo, useState } from "react";
import "./styles.css";
import { useStore } from "./store";
import { inspectionState, isOpen } from "./domain";
import { QueueTab } from "./components/QueueTab";
import { LedgerTab } from "./components/LedgerTab";
import { CylindersTab } from "./components/CylindersTab";
import { GasTab } from "./components/GasTab";
import { RetestModal } from "./components/RetestModal";

type Tab = "queue" | "ledger" | "cylinders" | "gas";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "queue", label: "充填与复检" },
  { key: "ledger", label: "记录台账" },
  { key: "cylinders", label: "单瓶历史" },
  { key: "gas", label: "气源批次" },
];

function App() {
  const { state, actions } = useStore();
  const [tab, setTab] = useState<Tab>("queue");
  const [retestId, setRetestId] = useState<string | null>(null);

  // 列表、统计、单瓶历史全部由同一份 fills 记录派生，刷新落盘后口径一致
  const metrics = useMemo(() => {
    const pending = state.fills.filter((f) => f.status === "待复测").length;
    const frozen = state.fills.filter((f) => f.status === "已冻结").length;
    const closed = state.fills.filter((f) => f.status === "已签收" || f.status === "返工").length;
    const signed = state.fills.filter((f) => f.status === "已签收").length;
    const rework = state.fills.filter((f) => f.status === "返工").length;
    const expired = state.cylinders.filter((c) => {
      const i = inspectionState(c.inspectionDue);
      return i.state === "过期" || i.state === "临近";
    }).length;
    const rate = closed === 0 ? "—" : `${Math.round((signed / closed) * 100)}%`;
    return { pending, frozen, expired, signed, rework, rate };
  }, [state.fills, state.cylinders]);

  const retestFill = retestId ? state.fills.find((f) => f.id === retestId && isOpen(f)) ?? null : null;

  function openRetest(id: string) {
    setRetestId(id);
  }

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62010 · 潜水气瓶充填 — 静置稳压复检闭环</p>
        <h1>潜水气瓶充填记录</h1>
        <span>
          每次充填记录压力、目标氧氦比例、完成时间、气源批次与操作员；同一气瓶仅保留一条待复测，重复提交沿用首次记录。
          静置不足半小时、压降超 5bar 或氧氦偏差超限不得签收，只能转返工并写明超限项；气源停用冻结未签收复测，补录合格气源并重测后恢复。
          已签收记录只可追加。
        </span>
      </section>

      <section className="metrics">
        <article><small>待复测</small><strong>{metrics.pending}</strong></article>
        <article><small>气源冻结</small><strong className={metrics.frozen ? "num-warn" : ""}>{metrics.frozen}</strong></article>
        <article><small>检验到期提醒</small><strong className={metrics.expired ? "num-warn" : ""}>{metrics.expired}</strong></article>
        <article><small>已签收 / 返工</small><strong>{metrics.signed}<em> / {metrics.rework}</em></strong></article>
        <article><small>签收合格率</small><strong>{metrics.rate}</strong></article>
      </section>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "tab-on" : ""} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === "queue" && metrics.pending + metrics.frozen > 0 && (
              <span className="tab-badge">{metrics.pending + metrics.frozen}</span>
            )}
          </button>
        ))}
      </nav>

      {tab === "queue" && <QueueTab state={state} actions={actions} focusFillId={retestId} onOpenRetest={openRetest} />}
      {tab === "ledger" && <LedgerTab state={state} />}
      {tab === "cylinders" && <CylindersTab state={state} />}
      {tab === "gas" && <GasTab state={state} actions={actions} />}

      {retestFill && (
        <RetestModal
          fill={retestFill}
          state={state}
          actions={actions}
          onClose={() => setRetestId(null)}
        />
      )}
    </main>
  );
}

export default App;
