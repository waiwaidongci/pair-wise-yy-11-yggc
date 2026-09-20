export const REST_MIN_MINUTES = 30; // 最少静置时长
export const PRESSURE_DROP_MAX = 5; // 允许最大压降 bar
export const O2_TOL = 1.0; // 氧含量偏差 ±1 个百分点
export const HE_TOL = 1.0; // 氦含量偏差 ±1 个百分点
export const TEST_WARN_DAYS = 30; // 检验临期提醒

export type Mode = "空气" | "高氧" | "Trimix";
export type FillStatus = "pending" | "signed" | "rework";

export interface GasBatchLike {
  code: string;
  active: boolean;
}

export interface FillLike {
  completedAt: string;
  fillPressure: number;
  targetO2: number;
  targetHe: number;
}

export interface RecheckReading {
  at: string;
  pressure: number;
  o2: number;
  he: number;
}

export function minutesBetween(aIso: string, bMs: number): number {
  return (bMs - new Date(aIso).getTime()) / 60000;
}

/**
 * 复检验算：返回所有超限项；为空数组表示满足签收条件。
 * - 静置不足 30 分钟
 * - 压力下降超过 5 bar
 * - 氧 / 氦偏差超 ±1 个百分点
 * - 气源批次已停用（冻结，须补录合格气源并重测）
 */
export function evaluateRecheck(
  fill: FillLike,
  reading: RecheckReading,
  batch: GasBatchLike | undefined
): string[] {
  const v: string[] = [];
  const rest = minutesBetween(fill.completedAt, new Date(reading.at).getTime());
  if (rest < REST_MIN_MINUTES) {
    v.push(`静置仅 ${rest.toFixed(1)} 分钟，不足 ${REST_MIN_MINUTES} 分钟`);
  }
  const drop = fill.fillPressure - reading.pressure;
  if (drop > PRESSURE_DROP_MAX) {
    v.push(`压力下降 ${drop.toFixed(1)} bar，超过 ${PRESSURE_DROP_MAX} bar 限值`);
  }
  const dO2 = Math.abs(reading.o2 - fill.targetO2);
  if (dO2 > O2_TOL) {
    v.push(
      `氧含量实测 ${reading.o2}% 与目标 ${fill.targetO2}% 偏差 ${dO2.toFixed(
        1
      )} 个百分点（限值 ±${O2_TOL}）`
    );
  }
  const dHe = Math.abs(reading.he - fill.targetHe);
  if (dHe > HE_TOL) {
    v.push(
      `氦含量实测 ${reading.he}% 与目标 ${fill.targetHe}% 偏差 ${dHe.toFixed(
        1
      )} 个百分点（限值 ±${HE_TOL}）`
    );
  }
  if (!batch || !batch.active) {
    v.push(
      `气源批次 ${batch ? batch.code : "未知"} 已停用，必须补录合格气源并重测`
    );
  }
  return v;
}
