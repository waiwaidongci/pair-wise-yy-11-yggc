import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  evaluateRecheck,
  HE_TOL,
  minutesBetween,
  O2_TOL,
  PRESSURE_DROP_MAX,
  REST_MIN_MINUTES,
  TEST_WARN_DAYS
} from "./lib/validation";
import "./styles.css";

/* ============================ 类型定义 ============================ */

type Mode = "空气" | "高氧" | "Trimix";
type FillStatus = "pending" | "signed" | "rework";

interface Cylinder {
  id: string;
  code: string;
  volume: string;
  testDue: string; // ISO 日期
  createdAt: string;
}

interface GasBatch {
  id: string;
  code: string;
  name: string;
  mode: Mode;
  active: boolean;
  note: string;
  createdAt: string;
}

interface FillRecord {
  id: string;
  cylinderId: string;
  // 每次充填必记
  residualPressure: number; // 残压 bar
  fillPressure: number; // 充填后压力 bar
  targetPressure: number; // 目标压力 bar
  mode: Mode;
  targetO2: number; // 目标氧 %
  targetHe: number; // 目标氦 %
  completedAt: string; // 完成时间 ISO
  gasBatchId: string; // 气源批次
  operator: string; // 操作员
  createdAt: string;
  status: FillStatus;
  // 复检（首次追加）
  recheckAt?: string;
  recheckPressure?: number;
  recheckO2?: number;
  recheckHe?: number;
  recheckOperator?: string;
  replacedBatchId?: string; // 冻结后补录的合格气源
  // 返工闭环
  violations?: string[]; // 超限项
  reworkNote?: string;
  reworkedAt?: string;
  // 签收闭环
  signedAt?: string;
}

interface AppState {
  version: 1;
  cylinders: Cylinder[];
  batches: GasBatch[];
  fills: FillRecord[];
}

/* ============================ 常量与规则 ============================ */

const STORAGE_KEY = "hxyfront-62010-state-v1";

const MODES: Mode[] = ["空气", "高氧", "Trimix"];

const PRESETS: { label: string; mode: Mode; o2: number; he: number }[] = [
  { label: "空气 21/0", mode: "空气", o2: 20.9, he: 0 },
  { label: "EAN32", mode: "高氧", o2: 32, he: 0 },
  { label: "EAN36", mode: "高氧", o2: 36, he: 0 },
  { label: "Trimix 18/45", mode: "Trimix", o2: 18, he: 45 },
  { label: "Trimix 21/35", mode: "Trimix", o2: 21, he: 35 }
];

const STATUS_META: Record<FillStatus, { label: string; cls: string }> = {
  pending: { label: "待复测", cls: "badge-warn" },
  signed: { label: "已签收", cls: "badge-ok" },
  rework: { label: "已返工", cls: "badge-danger" }
};

/* ============================ 工具函数 ============================ */

const pad = (n: number) => String(n).padStart(2, "0");

function uid(prefix: string): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rnd}`;
}

function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function fmtDT(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function testStatus(testDue: string, now: number): {
  label: string;
  tone: "ok" | "warn" | "danger";
} {
  const days = (new Date(testDue).getTime() - now) / 86400000;
  if (days < 0) return { label: "检验已过期", tone: "danger" };
  if (days <= TEST_WARN_DAYS)
    return { label: `检验临期 ${Math.ceil(days)} 天`, tone: "warn" };
  return { label: `检验有效 ${Math.floor(days)} 天`, tone: "ok" };
}

/* ============================ 演示数据（首次加载） ============================ */

function seedState(): AppState {
  const now = Date.now();
  const minsAgo = (m: number) => new Date(now - m * 60000).toISOString();
  const daysAway = (d: number) => new Date(now + d * 86400000).toISOString();

  const cylinders: Cylinder[] = [
    { id: "cyl-204", code: "TANK-204", volume: "12L 铝瓶", testDue: daysAway(210), createdAt: minsAgo(60 * 24 * 30) },
    { id: "cyl-219", code: "TANK-219", volume: "11L 钢瓶", testDue: daysAway(65), createdAt: minsAgo(60 * 24 * 20) },
    { id: "cyl-231", code: "TANK-231", volume: "双瓶组 2×12L", testDue: daysAway(12), createdAt: minsAgo(60 * 24 * 12) },
    { id: "cyl-258", code: "TANK-258", volume: "12L 钢瓶", testDue: daysAway(-3), createdAt: minsAgo(60 * 24 * 40) },
    { id: "cyl-301", code: "TANK-301", volume: "11.1L 铝瓶", testDue: daysAway(320), createdAt: minsAgo(60 * 24 * 8) },
    { id: "cyl-305", code: "TANK-305", volume: "12L 钢瓶", testDue: daysAway(18), createdAt: minsAgo(60 * 24 * 15) },
    { id: "cyl-160", code: "TANK-160", volume: "15L 钢瓶", testDue: daysAway(420), createdAt: minsAgo(60 * 24 * 60) }
  ];

  const batches: GasBatch[] = [
    { id: "bat-air01", code: "AIR-2608-01", name: "干燥压缩空气", mode: "空气", active: true, note: "进气压力 230bar", createdAt: minsAgo(60 * 24 * 20) },
    { id: "bat-nx32", code: "EAN32-2609-02", name: "高氧 EAN32", mode: "高氧", active: true, note: "膜分离制气", createdAt: minsAgo(60 * 24 * 12) },
    { id: "bat-nx36", code: "EAN36-2608-07", name: "高氧 EAN36", mode: "高氧", active: false, note: "氧分析抽检不合格，停用", createdAt: minsAgo(60 * 24 * 26) },
    { id: "bat-tmx1845", code: "TMX1845-2609-03", name: "Trimix 18/45", mode: "Trimix", active: true, note: "深潜混合气", createdAt: minsAgo(60 * 24 * 9) },
    { id: "bat-tmx2135", code: "TMX2135-2609-04", name: "Trimix 21/35", mode: "Trimix", active: true, note: "技术潜水", createdAt: minsAgo(60 * 24 * 5) }
  ];

  const mk = (p: Partial<FillRecord> & Pick<FillRecord, "id" | "cylinderId" | "completedAt" | "gasBatchId">): FillRecord => ({
    residualPressure: 50,
    fillPressure: 200,
    targetPressure: 200,
    mode: "空气",
    targetO2: 20.9,
    targetHe: 0,
    operator: "",
    createdAt: p.completedAt,
    status: "pending",
    ...p
  });

  const fills: FillRecord[] = [
    mk({
      id: "fill-001",
      cylinderId: "cyl-204",
      residualPressure: 55,
      fillPressure: 200,
      mode: "空气",
      targetO2: 20.9,
      completedAt: minsAgo(40),
      gasBatchId: "bat-air01",
      operator: "陈昊"
    }),
    mk({
      id: "fill-002",
      cylinderId: "cyl-219",
      residualPressure: 40,
      fillPressure: 210,
      targetPressure: 210,
      mode: "高氧",
      targetO2: 32,
      completedAt: minsAgo(52),
      gasBatchId: "bat-nx32",
      operator: "李婷"
    }),
    mk({
      id: "fill-003",
      cylinderId: "cyl-231",
      residualPressure: 30,
      mode: "Trimix",
      targetO2: 18,
      targetHe: 45,
      completedAt: minsAgo(18),
      gasBatchId: "bat-tmx1845",
      operator: "陈昊"
    }),
    mk({
      id: "fill-004",
      cylinderId: "cyl-258",
      residualPressure: 60,
      fillPressure: 205,
      targetPressure: 205,
      mode: "高氧",
      targetO2: 36,
      completedAt: minsAgo(75),
      gasBatchId: "bat-nx36",
      operator: "王磊"
    }),
    mk({
      id: "fill-005",
      cylinderId: "cyl-301",
      residualPressure: 45,
      mode: "空气",
      targetO2: 20.9,
      completedAt: minsAgo(185),
      gasBatchId: "bat-air01",
      operator: "李婷",
      status: "signed",
      recheckAt: minsAgo(140),
      recheckPressure: 198,
      recheckO2: 20.9,
      recheckHe: 0,
      recheckOperator: "李婷",
      signedAt: minsAgo(138)
    }),
    mk({
      id: "fill-006",
      cylinderId: "cyl-305",
      residualPressure: 50,
      mode: "高氧",
      targetO2: 32,
      completedAt: minsAgo(60 * 26),
      gasBatchId: "bat-nx32",
      operator: "王磊",
      status: "rework",
      recheckAt: minsAgo(60 * 26 + 32),
      recheckPressure: 192,
      recheckO2: 33.6,
      recheckHe: 0,
      recheckOperator: "王磊",
      violations: [
        "压力下降 8.0 bar，超过 5 bar 限值",
        "氧含量实测 33.6% 与目标 32% 偏差 1.6 个百分点（限值 ±1）"
      ],
      reworkNote: "放空后检查发现进气阀微漏且氧分析仪漂移，已更换密封并标定后重新充填。",
      reworkedAt: minsAgo(60 * 26 + 35)
    })
  ];

  return { version: 1, cylinders, batches, fills };
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.fills)) {
        return parsed;
      }
    }
  } catch {
    /* 损坏数据回退到种子 */
  }
  return seedState();
}

/* ============================ 应用 ============================ */

type StatusFilter = "all" | FillStatus | "frozen";
type ModeFilter = "all" | Mode;

interface Toast {
  id: string;
  kind: "ok" | "warn" | "danger";
  text: string;
}

const emptyFillForm = (now: number) => ({
  cylinderId: "",
  residual: "50",
  filled: "200",
  target: "200",
  mode: "空气" as Mode,
  o2: "20.9",
  he: "0",
  completedAt: toLocalInput(new Date(now)),
  batchId: "",
  operator: ""
});

function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  // 全部数据本地持久化：列表、统计、单瓶历史刷新后一致
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = (kind: Toast["kind"], text: string) => {
    const id = uid("toast");
    setToasts((t) => [...t, { id, kind, text }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4200);
  };

  /* ---------- 建档表单 ---------- */
  const [cylForm, setCylForm] = useState({ code: "", volume: "", testDue: "" });

  /* ---------- 充填表单 ---------- */
  const [fillForm, setFillForm] = useState(emptyFillForm(Date.now()));
  const [fillError, setFillError] = useState("");

  /* ---------- 气源补录表单 ---------- */
  const [batchForm, setBatchForm] = useState({
    code: "",
    name: "",
    mode: "空气" as Mode,
    note: ""
  });

  /* ---------- 列表筛选 ---------- */
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [highlightId, setHighlightId] = useState("");

  /* ---------- 弹窗 ---------- */
  const [historyCylId, setHistoryCylId] = useState<string | null>(null);
  const [recheckId, setRecheckId] = useState<string | null>(null);
  const [frozenId, setFrozenId] = useState<string | null>(null);

  /* ---------- 派生数据 ---------- */
  const cylinderMap = useMemo(
    () => new Map(state.cylinders.map((c) => [c.id, c])),
    [state.cylinders]
  );
  const batchMap = useMemo(
    () => new Map(state.batches.map((b) => [b.id, b])),
    [state.batches]
  );

  const isFrozen = (f: FillRecord) =>
    f.status === "pending" && !batchMap.get(f.gasBatchId)?.active;

  const pendingByCylinder = useMemo(() => {
    const m = new Map<string, FillRecord>();
    for (const f of state.fills) {
      if (f.status === "pending") m.set(f.cylinderId, f);
    }
    return m;
  }, [state.fills]);

  const stats = useMemo(() => {
    const pending = state.fills.filter((f) => f.status === "pending");
    const frozen = pending.filter(isFrozen);
    const signed = state.fills.filter((f) => f.status === "signed");
    const rework = state.fills.filter((f) => f.status === "rework");
    const queue = state.cylinders.filter((c) => !pendingByCylinder.has(c.id));
    const testWarn = state.cylinders.filter(
      (c) => testStatus(c.testDue, now).tone !== "ok"
    );
    const avgO2 =
      signed.length > 0
        ? signed.reduce((s, f) => s + (f.recheckO2 ?? f.targetO2), 0) /
          signed.length
        : null;
    return { pending, frozen, signed, rework, queue, testWarn, avgO2 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fills, state.cylinders, batchMap, now]);

  /* ============================ 操作 ============================ */

  // 气瓶建档（只追加）
  function submitCylinder(e: FormEvent) {
    e.preventDefault();
    const code = cylForm.code.trim();
    const volume = cylForm.volume.trim();
    if (!code || !volume || !cylForm.testDue) {
      pushToast("warn", "请完整填写气瓶编号、容积和检验有效期");
      return;
    }
    if (state.cylinders.some((c) => c.code.toUpperCase() === code.toUpperCase())) {
      pushToast("danger", `气瓶 ${code} 已建档，编号不可重复`);
      return;
    }
    setState((s) => ({
      ...s,
      cylinders: [
        ...s.cylinders,
        {
          id: uid("cyl"),
          code: code.toUpperCase(),
          volume,
          testDue: new Date(cylForm.testDue + "T00:00:00").toISOString(),
          createdAt: new Date().toISOString()
        }
      ]
    }));
    setCylForm({ code: "", volume: "", testDue: "" });
    pushToast("ok", `气瓶 ${code.toUpperCase()} 建档成功，已进入待充填队列`);
  }

  // 新增充填：同瓶只能有一条待复测，重复提交沿用首次记录
  function submitFill(e: FormEvent) {
    e.preventDefault();
    setFillError("");
    const f = fillForm;
    if (!f.cylinderId) return setFillError("请选择气瓶");
    const cyl = cylinderMap.get(f.cylinderId);
    if (!cyl) return setFillError("气瓶不存在");

    const existing = pendingByCylinder.get(f.cylinderId);
    if (existing) {
      // 沿用首次记录，不新建、不覆盖
      setHighlightId(existing.id);
      pushToast(
        "warn",
        `${cyl.code} 已有一条待复测记录（${fmtDT(existing.completedAt)} 充填），重复提交沿用首次记录，未新建`
      );
      return;
    }
    const ts = testStatus(cyl.testDue, now);
    if (ts.tone === "danger") {
      pushToast("danger", `${cyl.code} 检验已过期，不得充填，请先送检`);
      return;
    }

    const residual = Number(f.residual);
    const filled = Number(f.filled);
    const target = Number(f.target);
    const o2 = Number(f.o2);
    const he = Number(f.he);
    if (!f.batchId) return setFillError("请选择气源批次");
    if ([residual, filled, target].some((n) => Number.isNaN(n)))
      return setFillError("压力数值无效");
    if (filled <= residual) return setFillError("充填后压力必须高于残压");
    if (Number.isNaN(o2) || Number.isNaN(he) || o2 < 0 || he < 0 || o2 + he > 100)
      return setFillError("目标氧氦比例无效（合计不得超过 100%）");
    if (!f.completedAt) return setFillError("请选择完成时间");
    if (!f.operator.trim()) return setFillError("请填写操作员");
    const batch = batchMap.get(f.batchId);
    if (!batch?.active) return setFillError("气源批次已停用，请改用合格气源");

    const record: FillRecord = {
      id: uid("fill"),
      cylinderId: f.cylinderId,
      residualPressure: residual,
      fillPressure: filled,
      targetPressure: target,
      mode: f.mode,
      targetO2: o2,
      targetHe: he,
      completedAt: new Date(f.completedAt).toISOString(),
      gasBatchId: f.batchId,
      operator: f.operator.trim(),
      createdAt: new Date().toISOString(),
      status: "pending"
    };
    setState((s) => ({ ...s, fills: [...s.fills, record] }));
    setFillForm(emptyFillForm(Date.now()));
    pushToast(
      "ok",
      `${cyl.code} 充填已记录（${filled}bar / O₂ ${o2}% He ${he}%），静置满 ${REST_MIN_MINUTES} 分钟后发起复检`
    );
    if (ts.tone === "warn") pushToast("warn", `${cyl.code} ${ts.label}，请尽快安排送检`);
  }

  // 补录合格气源批次
  function submitBatch(e: FormEvent) {
    e.preventDefault();
    const code = batchForm.code.trim();
    const name = batchForm.name.trim();
    if (!code || !name) {
      pushToast("warn", "请填写气源批次编号和名称");
      return;
    }
    if (state.batches.some((b) => b.code.toUpperCase() === code.toUpperCase())) {
      pushToast("danger", `气源批次 ${code} 已存在`);
      return;
    }
    setState((s) => ({
      ...s,
      batches: [
        ...s.batches,
        {
          id: uid("bat"),
          code: code.toUpperCase(),
          name,
          mode: batchForm.mode,
          active: true,
          note: batchForm.note.trim(),
          createdAt: new Date().toISOString()
        }
      ]
    }));
    setBatchForm({ code: "", name: "", mode: "空气", note: "" });
    pushToast("ok", `合格气源 ${code.toUpperCase()} 已补录，可用于冻结记录重测`);
  }

  // 停用气源：冻结其名下所有未签收复测（停用不可逆，恢复只能补录气源并重测）
  function disableBatch(b: GasBatch) {
    const affected = state.fills.filter(
      (f) => f.status === "pending" && f.gasBatchId === b.id
    );
    const ok = window.confirm(
      `确定停用 ${b.code}（${b.name}）？\n将冻结 ${affected.length} 条未签收复测，补录合格气源并重测通过后才能恢复签收。`
    );
    if (!ok) return;
    setState((s) => ({
      ...s,
      batches: s.batches.map((x) => (x.id === b.id ? { ...x, active: false } : x))
    }));
    pushToast(
      "warn",
      `气源 ${b.code} 已停用，${affected.length} 条待复测记录已冻结，须补录合格气源并重测`
    );
  }

  // 签收（只向已存在记录追加复检字段，不改写原始充填数据）
  function signFill(
    fillId: string,
    data: { pressure: number; o2: number; he: number; operator: string },
    replacedBatchId?: string
  ) {
    const at = new Date().toISOString();
    setState((s) => ({
      ...s,
      fills: s.fills.map((f) =>
        f.id === fillId
          ? {
              ...f,
              status: "signed",
              recheckAt: at,
              recheckPressure: data.pressure,
              recheckO2: data.o2,
              recheckHe: data.he,
              recheckOperator: data.operator,
              replacedBatchId,
              signedAt: at
            }
          : f
      )
    }));
    const cyl = cylinderMap.get(state.fills.find((f) => f.id === fillId)!.cylinderId);
    pushToast("ok", `${cyl?.code ?? ""} 复检合格，已签收发还`);
    setRecheckId(null);
    setFrozenId(null);
  }

  // 返工：必须写明超限项
  function reworkFill(
    fillId: string,
    data: { pressure: number; o2: number; he: number; operator: string },
    violations: string[],
    note: string,
    replacedBatchId?: string
  ) {
    const at = new Date().toISOString();
    setState((s) => ({
      ...s,
      fills: s.fills.map((f) =>
        f.id === fillId
          ? {
              ...f,
              status: "rework",
              recheckAt: at,
              recheckPressure: data.pressure,
              recheckO2: data.o2,
              recheckHe: data.he,
              recheckOperator: data.operator,
              replacedBatchId,
              violations,
              reworkNote: note,
              reworkedAt: at
            }
          : f
      )
    }));
    const cyl = cylinderMap.get(state.fills.find((f) => f.id === fillId)!.cylinderId);
    pushToast("danger", `${cyl?.code ?? ""} 未通过复检，已转返工（${violations.length} 项超限）`);
    setRecheckId(null);
    setFrozenId(null);
  }

  function exportCsv() {
    const rows = [
      [
        "气瓶编号", "容积", "充填方式", "目标O2%", "目标He%", "残压bar", "充填后bar",
        "目标压力bar", "完成时间", "气源批次", "气源状态", "操作员", "状态",
        "复检时间", "复检压力bar", "实测O2%", "实测He%", "复检员",
        "补录气源", "超限项", "返工说明", "签收时间"
      ]
    ];
    for (const f of [...state.fills].sort(
      (a, b) => +new Date(b.completedAt) - +new Date(a.completedAt)
    )) {
      const c = cylinderMap.get(f.cylinderId);
      const b = batchMap.get(f.gasBatchId);
      const rb = f.replacedBatchId ? batchMap.get(f.replacedBatchId) : undefined;
      rows.push([
        c?.code ?? "", c?.volume ?? "", f.mode, f.targetO2, f.targetHe,
        f.residualPressure, f.fillPressure, f.targetPressure, fmtDT(f.completedAt),
        b?.code ?? "", b?.active ? "在用" : "停用", f.operator,
        isFrozen(f) ? "冻结待复测" : STATUS_META[f.status].label,
        f.recheckAt ? fmtDT(f.recheckAt) : "", f.recheckPressure ?? "",
        f.recheckO2 ?? "", f.recheckHe ?? "", f.recheckOperator ?? "",
        rb ? rb.code : "", f.violations?.join(" / ") ?? "",
        f.reworkNote ?? "", f.signedAt ? fmtDT(f.signedAt) : ""
      ].map(String));
    }
    const csv = rows
      .map((r) => r.map((x) => `"${x.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `气瓶充填复检记录-${fmtDate(new Date().toISOString())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ============================ 筛选 ============================ */

  const visibleFills = useMemo(() => {
    const kw = keyword.trim().toUpperCase();
    return state.fills
      .filter((f) => {
        if (statusFilter === "frozen") return isFrozen(f);
        if (statusFilter !== "all" && f.status !== statusFilter) return false;
        if (modeFilter !== "all" && f.mode !== modeFilter) return false;
        if (kw) {
          const c = cylinderMap.get(f.cylinderId);
          const b = batchMap.get(f.gasBatchId);
          const hay = `${c?.code ?? ""} ${c?.volume ?? ""} ${f.operator} ${b?.code ?? ""}`.toUpperCase();
          if (!hay.includes(kw)) return false;
        }
        return true;
      })
      .sort((a, b) => +new Date(b.completedAt) - +new Date(a.completedAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fills, statusFilter, modeFilter, keyword, batchMap, cylinderMap]);

  const recheckFill = recheckId ? state.fills.find((f) => f.id === recheckId) ?? null : null;
  const frozenFill = frozenId ? state.fills.find((f) => f.id === frozenId) ?? null : null;
  const historyCyl = historyCylId ? cylinderMap.get(historyCylId) ?? null : null;

  /* ============================ 渲染 ============================ */

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62010 · 源提示词 5 · Port 62010</p>
        <h1>潜水气瓶充填 · 稳压复检闭环</h1>
        <span>
          每次充填记录压力、目标氧氦比例、完成时间、气源批次与操作员；静置满 {REST_MIN_MINUTES}{" "}
          分钟后复检，压降超 {PRESSURE_DROP_MAX} bar 或氧氦偏差超 ±{O2_TOL}
          个百分点不得签收，只能转返工并写明超限项。气源批次停用即冻结未签收复测，补录合格气源并重测后恢复。已签收记录只可追加。
        </span>
      </section>

      {/* 统计 */}
      <section className="metrics">
        <MetricCard label="待充填队列" value={String(stats.queue.length)} tone="primary" />
        <MetricCard label="待复测" value={String(stats.pending.length)} tone="teal" />
        <MetricCard label="气源冻结" value={String(stats.frozen.length)} tone="amber" />
        <MetricCard label="已签收" value={String(stats.signed.length)} tone="ok" />
        <MetricCard label="返工" value={String(stats.rework.length)} tone="danger" />
        <MetricCard label="检验过期/临期" value={String(stats.testWarn.length)} tone="danger" />
        <div className="metrics-note">
          签收批次实测平均氧含量：
          <b>{stats.avgO2 === null ? "暂无签收" : `${stats.avgO2.toFixed(1)}%`}</b>
        </div>
      </section>

      <section className="workspace">
        {/* 左栏：队列 / 气源 / 规则 */}
        <div className="side">
          <section className="panel">
            <div className="heading">
              <div>
                <p>待充填队列</p>
                <h2>{stats.queue.length} 只气瓶待充填</h2>
              </div>
            </div>
            <div className="queue">
              {stats.queue.length === 0 && <p className="muted">暂无待充填气瓶</p>}
              {stats.queue.map((c) => {
                const ts = testStatus(c.testDue, now);
                return (
                  <div key={c.id} className="queue-item">
                    <div>
                      <strong>{c.code}</strong>
                      <span>{c.volume}</span>
                      <Badge tone={ts.tone}>{ts.label}</Badge>
                    </div>
                    <div className="row-actions">
                      <button
                        className="link"
                        onClick={() => setHistoryCylId(c.id)}
                      >
                        历史
                      </button>
                      <button
                        className="mini primary"
                        onClick={() => {
                          setFillForm((f) => ({ ...f, cylinderId: c.id }));
                          document.getElementById("fill-form")?.scrollIntoView({
                            behavior: "smooth",
                            block: "center"
                          });
                        }}
                      >
                        充填
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="heading">
              <div>
                <p>气源批次管理</p>
                <h2>合格气源</h2>
              </div>
            </div>
            <form className="batch-form" onSubmit={submitBatch}>
              <input
                placeholder="批次编号（如 EAN32-2609-05）"
                value={batchForm.code}
                onChange={(e) => setBatchForm((x) => ({ ...x, code: e.target.value }))}
              />
              <input
                placeholder="气源名称"
                value={batchForm.name}
                onChange={(e) => setBatchForm((x) => ({ ...x, name: e.target.value }))}
              />
              <div className="two">
                <select
                  value={batchForm.mode}
                  onChange={(e) =>
                    setBatchForm((x) => ({ ...x, mode: e.target.value as Mode }))
                  }
                >
                  {MODES.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <button className="primary mini" type="submit">
                  补录气源
                </button>
              </div>
              <input
                placeholder="备注（可选）"
                value={batchForm.note}
                onChange={(e) => setBatchForm((x) => ({ ...x, note: e.target.value }))}
              />
            </form>
            <div className="batch-list">
              {[...state.batches]
                .reverse()
                .map((b) => {
                  const frozenCount = state.fills.filter(
                    (f) => f.status === "pending" && f.gasBatchId === b.id && !b.active
                  ).length;
                  return (
                    <div key={b.id} className={`batch-item ${b.active ? "" : "off"}`}>
                      <div>
                        <strong>
                          {b.code} <Badge tone={b.active ? "ok" : "danger"}>{b.active ? "在用" : "停用"}</Badge>
                        </strong>
                        <span>
                          {b.name} · {b.mode}
                          {b.note ? ` · ${b.note}` : ""}
                        </span>
                        {!b.active && frozenCount > 0 && (
                          <span className="freeze-note">冻结未签收 {frozenCount} 条，待补录重测</span>
                        )}
                      </div>
                      {b.active && (
                        <button className="mini danger-btn" onClick={() => disableBatch(b)}>
                          停用
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>

          <section className="panel rules">
            <p className="panel-title">稳压复检签收规则</p>
            <ul>
              <li>静置时长 ≥ <b>{REST_MIN_MINUTES} 分钟</b></li>
              <li>压力下降 ≤ <b>{PRESSURE_DROP_MAX} bar</b></li>
              <li>
                氧 / 氦含量偏差 ≤ <b>±{O2_TOL} / ±{HE_TOL} 个百分点</b>
              </li>
              <li>气源批次须处于<b>在用</b>状态</li>
            </ul>
            <p className="muted small">
              任一项不满足即不得签收，只能转返工并写明超限项；返工后该瓶重新进入待充填队列。
            </p>
          </section>
        </div>

        {/* 右栏：建档 + 充填 */}
        <div className="main-col">
          <section className="panel">
            <div className="heading">
              <div>
                <p>气瓶建档</p>
                <h2>新气瓶登记</h2>
              </div>
            </div>
            <form className="field-grid three" onSubmit={submitCylinder}>
              <label>
                <span>气瓶编号</span>
                <input
                  placeholder="如 TANK-312"
                  value={cylForm.code}
                  onChange={(e) => setCylForm((x) => ({ ...x, code: e.target.value }))}
                />
              </label>
              <label>
                <span>容积 / 规格</span>
                <input
                  placeholder="如 12L 钢瓶"
                  value={cylForm.volume}
                  onChange={(e) => setCylForm((x) => ({ ...x, volume: e.target.value }))}
                />
              </label>
              <label>
                <span>检验有效期</span>
                <input
                  type="date"
                  value={cylForm.testDue}
                  onChange={(e) => setCylForm((x) => ({ ...x, testDue: e.target.value }))}
                />
              </label>
              <div className="form-action">
                <button className="primary" type="submit">
                  登记建档
                </button>
              </div>
            </form>
          </section>

          <section className="panel" id="fill-form">
            <div className="heading">
              <div>
                <p>新增充填记录</p>
                <h2>充填完成登记</h2>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  setFillForm((f) => ({
                    ...f,
                    completedAt: toLocalInput(new Date(Date.now() - 35 * 60000))
                  }))
                }
              >
                完成时间设为 35 分钟前（便于演示复检）
              </button>
            </div>
            <form onSubmit={submitFill}>
              <div className="field-grid three">
                <label>
                  <span>气瓶编号</span>
                  <select
                    value={fillForm.cylinderId}
                    onChange={(e) =>
                      setFillForm((f) => ({ ...f, cylinderId: e.target.value }))
                    }
                  >
                    <option value="">请选择气瓶</option>
                    {state.cylinders.map((c) => {
                      const pend = pendingByCylinder.get(c.id);
                      const ts = testStatus(c.testDue, now);
                      return (
                        <option key={c.id} value={c.id}>
                          {c.code} · {c.volume}
                          {pend ? ` · 已有待复测(${fmtDT(pend.completedAt)})` : ""}
                          {ts.tone !== "ok" ? ` · ${ts.label}` : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label>
                  <span>残压 (bar)</span>
                  <input
                    type="number"
                    value={fillForm.residual}
                    onChange={(e) => setFillForm((f) => ({ ...f, residual: e.target.value }))}
                  />
                </label>
                <label>
                  <span>充填后压力 (bar)</span>
                  <input
                    type="number"
                    value={fillForm.filled}
                    onChange={(e) => setFillForm((f) => ({ ...f, filled: e.target.value }))}
                  />
                </label>
                <label>
                  <span>目标压力 (bar)</span>
                  <input
                    type="number"
                    value={fillForm.target}
                    onChange={(e) => setFillForm((f) => ({ ...f, target: e.target.value }))}
                  />
                </label>
                <label>
                  <span>完成时间</span>
                  <input
                    type="datetime-local"
                    step={60}
                    value={fillForm.completedAt}
                    onChange={(e) =>
                      setFillForm((f) => ({ ...f, completedAt: e.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>气源批次</span>
                  <select
                    value={fillForm.batchId}
                    onChange={(e) => setFillForm((f) => ({ ...f, batchId: e.target.value }))}
                  >
                    <option value="">请选择气源批次</option>
                    {state.batches.map((b) => (
                      <option key={b.id} value={b.id} disabled={!b.active}>
                        {b.code} · {b.name}
                        {b.active ? "" : "（已停用）"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>操作员</span>
                  <input
                    placeholder="充填操作员姓名"
                    value={fillForm.operator}
                    onChange={(e) => setFillForm((f) => ({ ...f, operator: e.target.value }))}
                  />
                </label>
              </div>

              <div className="mix-block">
                <div className="mix-head">
                  <span>充填方式与目标氧氦比例</span>
                  <div className="chips compact">
                    {MODES.map((m) => (
                      <button
                        type="button"
                        key={m}
                        className={fillForm.mode === m ? "chip-on" : ""}
                        onClick={() => {
                          const preset = PRESETS.find((p) => p.mode === m);
                          setFillForm((f) => ({
                            ...f,
                            mode: m,
                            o2: preset ? String(preset.o2) : f.o2,
                            he: preset ? String(preset.he) : f.he
                          }));
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="presets">
                  {PRESETS.filter((p) => p.mode === fillForm.mode).map((p) => (
                    <button
                      type="button"
                      key={p.label}
                      className="mini ghost"
                      onClick={() =>
                        setFillForm((f) => ({ ...f, o2: String(p.o2), he: String(p.he) }))
                      }
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="field-grid three">
                  <label>
                    <span>目标氧 O₂ (%)</span>
                    <input
                      type="number"
                      step="0.1"
                      value={fillForm.o2}
                      onChange={(e) => setFillForm((f) => ({ ...f, o2: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>目标氦 He (%)</span>
                    <input
                      type="number"
                      step="0.1"
                      value={fillForm.he}
                      onChange={(e) => setFillForm((f) => ({ ...f, he: e.target.value }))}
                    />
                  </label>
                  <MixHint o2={Number(fillForm.o2)} he={Number(fillForm.he)} mode={fillForm.mode} />
                </div>
              </div>

              {fillError && <p className="form-error">{fillError}</p>}
              <div className="form-action right">
                <button className="primary" type="submit">
                  保存充填记录
                </button>
              </div>
            </form>
          </section>
        </div>
      </section>

      {/* 记录列表 */}
      <section className="panel">
        <div className="heading">
          <div>
            <p>充填 / 复检记录</p>
            <h2>工作台摘要</h2>
          </div>
          <button onClick={exportCsv}>导出 CSV</button>
        </div>

        <div className="filters">
          <div className="chips compact">
            {(
              [
                ["all", "全部"],
                ["pending", "待复测"],
                ["frozen", "冻结待补录"],
                ["signed", "已签收"],
                ["rework", "已返工"]
              ] as [StatusFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                className={statusFilter === key ? "chip-on" : ""}
                onClick={() => setStatusFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="chips compact">
            {(["all", ...MODES] as ModeFilter[]).map((m) => (
              <button
                key={m}
                className={modeFilter === m ? "chip-on" : ""}
                onClick={() => setModeFilter(m)}
              >
                {m === "all" ? "全部方式" : m}
              </button>
            ))}
          </div>
          <input
            className="search"
            placeholder="搜索气瓶编号 / 操作员 / 气源批次"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        <div className="records">
          {visibleFills.length === 0 && <p className="muted">没有符合筛选条件的记录</p>}
          {visibleFills.map((f) => (
            <FillCard
              key={f.id}
              fill={f}
              flash={highlightId === f.id}
              now={now}
              cylinder={cylinderMap.get(f.cylinderId)}
              batch={batchMap.get(f.gasBatchId)}
              replacedBatch={f.replacedBatchId ? batchMap.get(f.replacedBatchId) : undefined}
              frozen={isFrozen(f)}
              restMin={minutesBetween(f.completedAt, now)}
              onOpenRecheck={() => setRecheckId(f.id)}
              onOpenFrozen={() => setFrozenId(f.id)}
              onOpenHistory={() => setHistoryCylId(f.cylinderId)}
            />
          ))}
        </div>
        <p className="muted small footer-note">
          已签收记录只可追加、不可改写或删除；全部数据保存在本机浏览器，刷新页面后列表、统计与单瓶历史保持一致。
        </p>
      </section>

      {/* 弹窗 */}
      {recheckFill && (
        <RecheckModal
          fill={recheckFill}
          cylinderCode={cylinderMap.get(recheckFill.cylinderId)?.code ?? ""}
          batch={batchMap.get(recheckFill.gasBatchId)}
          now={now}
          onClose={() => setRecheckId(null)}
          onSign={(d) => signFill(recheckFill.id, d)}
          onRework={(d, violations, note) =>
            reworkFill(recheckFill.id, d, violations, note)
          }
        />
      )}
      {frozenFill && (
        <FrozenRetestModal
          fill={frozenFill}
          oldBatch={batchMap.get(frozenFill.gasBatchId)}
          batches={state.batches.filter(
            (b) => b.active && b.mode === frozenFill.mode
          )}
          allActiveBatches={state.batches.filter((b) => b.active)}
          now={now}
          onClose={() => setFrozenId(null)}
          onSign={(d, replacedId) => signFill(frozenFill.id, d, replacedId)}
          onRework={(d, replacedId, violations, note) =>
            reworkFill(frozenFill.id, d, violations, note, replacedId)
          }
        />
      )}
      {historyCyl && (
        <HistoryModal
          cylinder={historyCyl}
          fills={state.fills
            .filter((f) => f.cylinderId === historyCyl.id)
            .sort((a, b) => +new Date(a.completedAt) - +new Date(b.completedAt))}
          batchMap={batchMap}
          now={now}
          onClose={() => setHistoryCylId(null)}
        />
      )}

      {/* Toast */}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </main>
  );
}

/* ============================ 子组件 ============================ */

function MetricCard({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "primary" | "teal" | "amber" | "ok" | "danger";
}) {
  return (
    <article className={`metric tone-${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}

function Badge({
  tone,
  children
}: {
  tone: "ok" | "warn" | "danger" | "info";
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function MixHint({ o2, he, mode }: { o2: number; he: number; mode: Mode }) {
  const n2 = 100 - o2 - he;
  const invalid = Number.isNaN(o2) || Number.isNaN(he) || o2 < 0 || he < 0 || n2 < 0;
  return (
    <div className={`mix-hint ${invalid ? "bad" : ""}`}>
      <span>
        {mode} 配比：O₂ <b>{Number.isNaN(o2) ? "-" : o2}%</b> / He{" "}
        <b>{Number.isNaN(he) ? "-" : he}%</b> / 余量 N₂{" "}
        <b>{invalid ? "无效" : `${n2.toFixed(1)}%`}</b>
      </span>
      {mode === "空气" && Math.abs(o2 - 20.9) > 0.01 && (
        <span className="hint-warn">空气充填建议 O₂ 约 20.9%、He 0%</span>
      )}
      {invalid && <span className="hint-warn">氧氦合计不得超过 100%</span>}
    </div>
  );
}

function FillCard({
  fill,
  flash,
  now,
  cylinder,
  batch,
  replacedBatch,
  frozen,
  restMin,
  onOpenRecheck,
  onOpenFrozen,
  onOpenHistory
}: {
  fill: FillRecord;
  flash: boolean;
  now: number;
  cylinder?: Cylinder;
  batch?: GasBatch;
  replacedBatch?: GasBatch;
  frozen: boolean;
  restMin: number;
  onOpenRecheck: () => void;
  onOpenFrozen: () => void;
  onOpenHistory: () => void;
}) {
  const ts = cylinder ? testStatus(cylinder.testDue, now) : null;
  return (
    <article className={`record-card ${flash ? "flash" : ""}`}>
      <div className="record-main">
        <div className="record-title">
          <h3>{cylinder?.code ?? "未知气瓶"}</h3>
          {frozen ? (
            <Badge tone="danger">冻结 · 待补录气源</Badge>
          ) : (
            <Badge
              tone={
                fill.status === "signed" ? "ok" : fill.status === "rework" ? "danger" : "warn"
              }
            >
              {STATUS_META[fill.status].label}
            </Badge>
          )}
          {ts && ts.tone !== "ok" && <Badge tone={ts.tone}>{ts.label}</Badge>}
          <Badge tone="info">{fill.mode}</Badge>
        </div>
        <p>
          {cylinder?.volume} · 残压 {fill.residualPressure}bar → 充填后 {fill.fillPressure}bar
          （目标 {fill.targetPressure}bar） · 目标 O₂ {fill.targetO2}% / He {fill.targetHe}%
        </p>
        <p>
          完成于 {fmtDT(fill.completedAt)} · 气源{" "}
          <span className={batch?.active ? "" : "text-danger"}>
            {batch?.code ?? "未知"}
            {batch?.active ? "" : "（已停用）"}
          </span>{" "}
          · 操作员 {fill.operator}
        </p>

        {fill.status === "pending" && (
          <p className={restMin >= REST_MIN_MINUTES ? "text-ok" : "text-amber"}>
            已静置 {restMin.toFixed(1)} 分钟（需 ≥ {REST_MIN_MINUTES} 分钟）
            {restMin >= REST_MIN_MINUTES ? "，可以复检" : "，暂不可签收"}
          </p>
        )}

        {fill.recheckAt && (
          <div className="recheck-box">
            <p>
              复检 {fmtDT(fill.recheckAt)} · {fill.recheckPressure}bar（压降{" "}
              {(fill.fillPressure - (fill.recheckPressure ?? fill.fillPressure)).toFixed(1)}bar）
              · 实测 O₂ {fill.recheckO2}% / He {fill.recheckHe}% · 复检员 {fill.recheckOperator}
              {replacedBatch && (
                <span className="text-ok"> · 已补录气源 {replacedBatch.code}</span>
              )}
            </p>
          </div>
        )}

        {fill.status === "rework" && fill.violations && (
          <div className="violation-box">
            <p className="text-danger">
              <b>返工超限项（{fill.violations.length}）：</b>
            </p>
            <ul>
              {fill.violations.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
            {fill.reworkNote && <p className="muted">返工说明：{fill.reworkNote}</p>}
          </div>
        )}

        {fill.status === "signed" && fill.signedAt && (
          <p className="text-ok">签收时间 {fmtDT(fill.signedAt)}，记录已锁定，仅可追加</p>
        )}
      </div>
      <div className="record-actions">
        <button className="mini" onClick={onOpenHistory}>
          单瓶历史
        </button>
        {fill.status === "pending" && frozen && (
          <button className="mini primary" onClick={onOpenFrozen}>
            补录气源并重测
          </button>
        )}
        {fill.status === "pending" && !frozen && (
          <button className="mini primary" onClick={onOpenRecheck}>
            稳压复检
          </button>
        )}
        {fill.status === "rework" && (
          <span className="muted small">返工后重新排入待充填队列</span>
        )}
      </div>
    </article>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="mini" onClick={onClose}>
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface RecheckInput {
  pressure: number;
  o2: number;
  he: number;
  operator: string;
}

function RecheckModal({
  fill,
  cylinderCode,
  batch,
  now,
  onClose,
  onSign,
  onRework
}: {
  fill: FillRecord;
  cylinderCode: string;
  batch?: GasBatch;
  now: number;
  onClose: () => void;
  onSign: (d: RecheckInput) => void;
  onRework: (d: RecheckInput, violations: string[], note: string) => void;
}) {
  const [pressure, setPressure] = useState(String(fill.fillPressure));
  const [o2, setO2] = useState(String(fill.targetO2));
  const [he, setHe] = useState(String(fill.targetHe));
  const [operator, setOperator] = useState(fill.operator);
  const [note, setNote] = useState("");

  const input: RecheckInput = {
    pressure: Number(pressure),
    o2: Number(o2),
    he: Number(he),
    operator: operator.trim()
  };
  const numericOk =
    !Number.isNaN(input.pressure) && !Number.isNaN(input.o2) && !Number.isNaN(input.he);
  const violations = numericOk
    ? evaluateRecheck(
        fill,
        { at: new Date(now).toISOString(), pressure: input.pressure, o2: input.o2, he: input.he },
        batch
      )
    : ["复检数值无效"];
  const rest = minutesBetween(fill.completedAt, now);
  const formOk = violations.length === 0 && input.operator.length > 0;

  return (
    <Modal title={`稳压复检 · 气瓶 ${cylinderCode}`} onClose={onClose}>
      <RecheckSummary fill={fill} batch={batch} rest={rest} />
      <div className="field-grid three">
        <label>
          <span>复检压力 (bar)</span>
          <input type="number" value={pressure} onChange={(e) => setPressure(e.target.value)} />
        </label>
        <label>
          <span>实测氧 O₂ (%)</span>
          <input type="number" step="0.1" value={o2} onChange={(e) => setO2(e.target.value)} />
        </label>
        <label>
          <span>实测氦 He (%)</span>
          <input type="number" step="0.1" value={he} onChange={(e) => setHe(e.target.value)} />
        </label>
        <label>
          <span>复检员</span>
          <input value={operator} onChange={(e) => setOperator(e.target.value)} />
        </label>
      </div>

      <ViolationPanel violations={violations} />

      {violations.length > 0 && (
        <label className="full-label">
          <span>返工说明（必填，写明超限项与处置）</span>
          <textarea
            rows={2}
            placeholder="如：放空后更换密封圈、重新标定氧分析仪，再次充填"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      )}

      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        {violations.length === 0 ? (
          <button
            className="primary"
            disabled={!formOk}
            onClick={() => onSign(input)}
          >
            复检合格 · 签收发还
          </button>
        ) : (
          <button
            className="danger-btn"
            disabled={!numericOk || !input.operator || !note.trim()}
            onClick={() => onRework(input, violations, note.trim())}
          >
            不得签收 · 转返工（{violations.length} 项超限）
          </button>
        )}
      </div>
    </Modal>
  );
}

function FrozenRetestModal({
  fill,
  oldBatch,
  batches,
  allActiveBatches,
  now,
  onClose,
  onSign,
  onRework
}: {
  fill: FillRecord;
  oldBatch?: GasBatch;
  batches: GasBatch[];
  allActiveBatches: GasBatch[];
  now: number;
  onClose: () => void;
  onSign: (d: RecheckInput, replacedBatchId: string) => void;
  onRework: (
    d: RecheckInput,
    replacedBatchId: string,
    violations: string[],
    note: string
  ) => void;
}) {
  const candidates = batches.length > 0 ? batches : allActiveBatches;
  const [replacedId, setReplacedId] = useState(candidates[0]?.id ?? "");
  const [pressure, setPressure] = useState(String(fill.fillPressure));
  const [o2, setO2] = useState(String(fill.targetO2));
  const [he, setHe] = useState(String(fill.targetHe));
  const [operator, setOperator] = useState(fill.operator);
  const [note, setNote] = useState("");

  const replaced = allActiveBatches.find((b) => b.id === replacedId);
  const input: RecheckInput = {
    pressure: Number(pressure),
    o2: Number(o2),
    he: Number(he),
    operator: operator.trim()
  };
  const numericOk =
    !Number.isNaN(input.pressure) && !Number.isNaN(input.o2) && !Number.isNaN(input.he);
  const violations =
    numericOk && replaced
      ? evaluateRecheck(
          fill,
          { at: new Date(now).toISOString(), pressure: input.pressure, o2: input.o2, he: input.he },
          replaced
        )
      : ["请先补录并选择合格气源"];
  const rest = minutesBetween(fill.completedAt, now);

  return (
    <Modal title="冻结记录 · 补录合格气源并重测" onClose={onClose}>
      <div className="freeze-banner">
        气源批次 <b>{oldBatch?.code}</b>（{oldBatch?.name}）已停用，该未签收复测已冻结。
        补录合格气源并重新检测合格后才能恢复签收。
      </div>
      <RecheckSummary fill={fill} batch={oldBatch} rest={rest} frozen />
      <div className="field-grid three">
        <label>
          <span>补录合格气源批次</span>
          <select value={replacedId} onChange={(e) => setReplacedId(e.target.value)}>
            {candidates.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} · {b.name}（{b.mode}）
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>复检压力 (bar)</span>
          <input type="number" value={pressure} onChange={(e) => setPressure(e.target.value)} />
        </label>
        <label>
          <span>实测氧 O₂ (%)</span>
          <input type="number" step="0.1" value={o2} onChange={(e) => setO2(e.target.value)} />
        </label>
        <label>
          <span>实测氦 He (%)</span>
          <input type="number" step="0.1" value={he} onChange={(e) => setHe(e.target.value)} />
        </label>
        <label>
          <span>复检员</span>
          <input value={operator} onChange={(e) => setOperator(e.target.value)} />
        </label>
      </div>
      {batches.length === 0 && (
        <p className="form-error">
          没有与本次充填方式（{fill.mode}）匹配的在用气源，请先在左侧「补录气源」。
        </p>
      )}

      <ViolationPanel violations={violations} />

      {violations.length > 0 && (
        <label className="full-label">
          <span>返工说明（必填，写明超限项与处置）</span>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      )}

      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        {violations.length === 0 ? (
          <button
            className="primary"
            disabled={!replacedId || !input.operator}
            onClick={() => onSign(input, replacedId)}
          >
            补录气源 · 重测合格 · 签收发还
          </button>
        ) : (
          <button
            className="danger-btn"
            disabled={!replacedId || !numericOk || !input.operator || !note.trim()}
            onClick={() => onRework(input, replacedId, violations, note.trim())}
          >
            重测仍超限 · 转返工（{violations.length} 项）
          </button>
        )}
      </div>
    </Modal>
  );
}

function RecheckSummary({
  fill,
  batch,
  rest,
  frozen
}: {
  fill: FillRecord;
  batch?: GasBatch;
  rest: number;
  frozen?: boolean;
}) {
  return (
    <div className="recheck-summary">
      <span>
        充填后 <b>{fill.fillPressure}bar</b> · 目标 O₂ {fill.targetO2}% / He {fill.targetHe}%
      </span>
      <span>
        完成 {fmtDT(fill.completedAt)} · 已静置 <b>{rest.toFixed(1)}</b> 分钟
      </span>
      <span className={batch?.active && !frozen ? "" : "text-danger"}>
        气源 {batch?.code ?? "未知"} · {batch?.active ? "在用" : "已停用"}
      </span>
    </div>
  );
}

function ViolationPanel({ violations }: { violations: string[] }) {
  if (violations.length === 0) {
    return (
      <div className="violation-panel ok">
        ✓ 静置时长、压力降、氧氦偏差与气源状态全部满足签收条件
      </div>
    );
  }
  return (
    <div className="violation-panel bad">
      <b>不得签收，超限项 {violations.length} 项：</b>
      <ul>
        {violations.map((v, i) => (
          <li key={i}>{v}</li>
        ))}
      </ul>
    </div>
  );
}

function HistoryModal({
  cylinder,
  fills,
  batchMap,
  now,
  onClose
}: {
  cylinder: Cylinder;
  fills: FillRecord[];
  batchMap: Map<string, GasBatch>;
  now: number;
  onClose: () => void;
}) {
  const ts = testStatus(cylinder.testDue, now);
  return (
    <Modal title={`单瓶历史 · ${cylinder.code}`} onClose={onClose} wide>
      <div className="history-head">
        <span>{cylinder.volume}</span>
        <Badge tone={ts.tone}>{ts.label}</Badge>
        <span className="muted">检验有效期至 {fmtDate(cylinder.testDue)}</span>
        <span className="muted">共 {fills.length} 条充填记录（只追加）</span>
      </div>
      <ol className="timeline">
        {fills.map((f) => {
          const b = batchMap.get(f.gasBatchId);
          const rb = f.replacedBatchId ? batchMap.get(f.replacedBatchId) : undefined;
          return (
            <li key={f.id} className="timeline-item">
              <div className="timeline-step">
                <Badge
                  tone={
                    f.status === "signed" ? "ok" : f.status === "rework" ? "danger" : "warn"
                  }
                >
                  {STATUS_META[f.status].label}
                </Badge>
              </div>
              <div className="timeline-body">
                <p>
                  <b>{fmtDT(f.completedAt)}</b> · {f.mode} · {f.fillPressure}bar · 目标 O₂{" "}
                  {f.targetO2}% / He {f.targetHe}% · 气源 {b?.code}（
                  {b?.active ? "在用" : "停用"}） · 操作员 {f.operator}
                </p>
                {f.recheckAt && (
                  <p className="muted">
                    复检 {fmtDT(f.recheckAt)} · {f.recheckPressure}bar · 实测 O₂ {f.recheckO2}% /
                    He {f.recheckHe}% · 复检员 {f.recheckOperator}
                    {rb && <> · 补录气源 {rb.code}</>}
                  </p>
                )}
                {f.violations && (
                  <p className="text-danger">
                    超限项：{f.violations.join("；")}
                    {f.reworkNote ? ` ｜返工说明：${f.reworkNote}` : ""}
                  </p>
                )}
                {f.signedAt && <p className="text-ok">签收于 {fmtDT(f.signedAt)}</p>}
              </div>
            </li>
          );
        })}
        {fills.length === 0 && <p className="muted">该气瓶暂无充填记录</p>}
      </ol>
    </Modal>
  );
}

export default App;
