// 潜水气瓶「充填 — 静置稳压 — 复检 — 签收/返工」闭环数据模型

export type MixMode = "空气" | "高氧" | "Trimix";

/** 待复测：充填完成等待稳压复检；已冻结：气源批次停用；已签收/返工：终态，只可追加不可修改 */
export type FillStatus = "待复测" | "已冻结" | "已签收" | "返工";

export interface Cylinder {
  id: string; // 气瓶编号
  volume: string; // 容积描述，如 12L 铝瓶
  inspectionDue: string; // 检验有效期 YYYY-MM-DD
  createdAt: string;
}

export interface GasBatch {
  id: string; // 气源批次号
  supplier: string; // 气源厂商
  mode: MixMode; // 标定混合气类型
  o2: number; // 标定氧含量 %
  he: number; // 标定氦含量 %
  active: boolean; // 是否启用；停用后不可再启用，只能补录新批次
  createdAt: string;
}

export interface RetestResult {
  at: string; // 复测时间 ISO
  pressure: number; // 复测压力 bar
  o2: number; // 实测氧 %
  he: number; // 实测氦 %
  operator: string; // 复测员
}

export interface GasReplacement {
  fromBatchId: string;
  toBatchId: string;
  at: string;
  operator: string;
}

export interface FillClosure {
  kind: "签收" | "返工";
  at: string;
  operator: string;
  failures: string[]; // 返工时记录的超限项（签收为空）
  note: string; // 返工说明
}

export interface HistoryEvent {
  at: string;
  type: "创建" | "冻结" | "气源补录" | "复测" | "签收" | "返工";
  message: string;
}

export interface FillRecord {
  id: string;
  cylinderId: string;
  mode: MixMode;
  residualPressure: number; // 残压 bar
  filledPressure: number; // 充填后压力 bar
  targetPressure: number; // 目标压力 bar
  targetO2: number; // 目标氧比例 %
  targetHe: number; // 目标氦比例 %
  filledAt: string; // 充填完成时间 ISO
  gasBatchId: string; // 气源批次
  operator: string; // 充填操作员
  status: FillStatus;
  createdAt: string;
  // —— 以下均为流程中「追加」的内容，终态记录不再接受任何变更 ——
  retest?: RetestResult;
  gasReplaced?: GasReplacement;
  closure?: FillClosure;
  history: HistoryEvent[];
}

export interface AppState {
  cylinders: Cylinder[];
  batches: GasBatch[];
  fills: FillRecord[];
}
