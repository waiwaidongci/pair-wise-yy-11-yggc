import type { FillRecord, GasBatch, MixMode } from "./types";

// —— 稳压复检硬性阈值 ——
export const MIN_SETTLE_MINUTES = 30; // 静置不足半小时不得签收
export const MAX_PRESSURE_DROP = 5; // 压力下降超 5bar 不得签收
export const O2_TOLERANCE = 1; // 氧含量偏差 > 1 个百分点
export const HE_TOLERANCE = 1; // 氦含量偏差 > 1 个百分点

export interface MixPreset {
  mode: MixMode;
  label: string;
  targetO2: number;
  targetHe: number;
  hint: string;
}

export const MIX_PRESETS: MixPreset[] = [
  { mode: "空气", label: "空气 21/0", targetO2: 21, targetHe: 0, hint: "常规压缩空气，氧约 20.9%，无氦" },
  { mode: "高氧", label: "EAN32", targetO2: 32, targetHe: 0, hint: "高氧空气，最大深度约 34m" },
  { mode: "高氧", label: "EAN36", targetO2: 36, targetHe: 0, hint: "高氧空气，最大深度约 29m" },
  { mode: "Trimix", label: "Trimix 18/45", targetO2: 18, targetHe: 45, hint: "大深度三混气，氦 45%" },
  { mode: "Trimix", label: "Trimix 21/35", targetO2: 21, targetHe: 35, hint: "技术潜水三混气，氦 35%" },
];

export interface RetestCheck {
  restMinutes: number;
  pressureDrop: number;
  o2Diff: number;
  heDiff: number;
  failures: string[]; // 超限项描述
  passed: boolean;
}

/**
 * 复检判定（共享纯函数，保证列表/统计/弹窗判定口径一致）：
 * 静置不足半小时、压降超 5bar、氧偏差超 1%、氦偏差超 1%（Trimix 才考核氦）即不通过。
 */
export function evaluateRetest(
  fill: Pick<FillRecord, "mode" | "filledPressure" | "targetO2" | "targetHe" | "filledAt">,
  retest: { at: string; pressure: number; o2: number; he: number },
  now: Date = new Date(),
): RetestCheck {
  const restMs = new Date(retest.at).getTime() - new Date(fill.filledAt).getTime();
  const restMinutes = Math.round((restMs / 60000) * 10) / 10;
  const pressureDrop = Math.round((fill.filledPressure - retest.pressure) * 10) / 10;
  const o2Diff = Math.round(Math.abs(retest.o2 - fill.targetO2) * 100) / 100;
  const heDiff = Math.round(Math.abs(retest.he - fill.targetHe) * 100) / 100;

  const failures: string[] = [];
  if (restMinutes < MIN_SETTLE_MINUTES) {
    failures.push(`静置不足${MIN_SETTLE_MINUTES}分钟（当前 ${formatMinutes(restMinutes)}）`);
  }
  if (pressureDrop > MAX_PRESSURE_DROP) {
    failures.push(`压力下降 ${pressureDrop}bar，超过 ${MAX_PRESSURE_DROP}bar`);
  }
  if (o2Diff > O2_TOLERANCE) {
    failures.push(`氧含量偏差 ${o2Diff}%，超过 ±${O2_TOLERANCE}%（目标 ${fill.targetO2}%，实测 ${retest.o2}%）`);
  }
  if (fill.mode === "Trimix" && heDiff > HE_TOLERANCE) {
    failures.push(`氦含量偏差 ${heDiff}%，超过 ±${HE_TOLERANCE}%（目标 ${fill.targetHe}%，实测 ${retest.he}%）`);
  }

  return { restMinutes, pressureDrop, o2Diff, heDiff, failures, passed: failures.length === 0 };
}

export function formatMinutes(min: number): string {
  if (!Number.isFinite(min)) return "—";
  if (min < 60) return `${Math.round(min)} 分钟`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

/** 检验有效期状态：过期 / 30 天内到期 / 正常 */
export function inspectionState(due: string, now: Date = new Date()): {
  state: "过期" | "临近" | "正常";
  days: number;
} {
  const d = new Date(due + "T23:59:59");
  const days = Math.ceil((d.getTime() - now.getTime()) / 86400000);
  if (days < 0) return { state: "过期", days };
  if (days <= 30) return { state: "临近", days };
  return { state: "正常", days };
}

export function isOpen(fill: FillRecord): boolean {
  return fill.status === "待复测" || fill.status === "已冻结";
}

export function batchLabel(b: GasBatch | undefined): string {
  if (!b) return "未知批次";
  return `${b.id} · ${b.mode} O₂${b.o2}%/He${b.he}%`;
}

export function toLocalInput(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}
