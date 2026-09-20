import { useEffect, useMemo, useReducer } from "react";
import type {
  AppState,
  Cylinder,
  FillRecord,
  GasBatch,
  HistoryEvent,
  MixMode,
} from "./types";
import { evaluateRetest, isOpen, uid } from "./domain";

const STORAGE_KEY = "dive-fill-closed-loop-v1";

// —— 动作定义 ——
type Action =
  | { type: "addCylinder"; cylinder: Cylinder }
  | { type: "addFill"; fill: FillRecord }
  | { type: "addBatch"; batch: GasBatch }
  | { type: "disableBatch"; batchId: string; at: string }
  | {
      type: "submitRetest";
      fillId: string;
      replacementBatchId?: string; // 已冻结记录必须补录合格气源
      retest: { at: string; pressure: number; o2: number; he: number; operator: string };
      decision: "签收" | "返工";
      reworkNote: string;
    };

function event(type: HistoryEvent["type"], message: string, at = new Date().toISOString()): HistoryEvent {
  return { at, type, message };
}

function reducerImpl(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "addCylinder":
      return { ...state, cylinders: [...state.cylinders, action.cylinder] };

    case "addFill":
      return { ...state, fills: [action.fill, ...state.fills] };

    case "addBatch":
      return { ...state, batches: [action.batch, ...state.batches] };

    case "disableBatch": {
      const batch = state.batches.find((b) => b.id === action.batchId);
      if (!batch || !batch.active) return state;
      const frozenIds = new Set(
        state.fills
          .filter((f) => f.status === "待复测" && f.gasBatchId === action.batchId)
          .map((f) => f.id),
      );
      return {
        ...state,
        batches: state.batches.map((b) => (b.id === action.batchId ? { ...b, active: false } : b)),
        fills: state.fills.map((f) =>
          frozenIds.has(f.id)
            ? {
                ...f,
                status: "已冻结",
                history: [
                  ...f.history,
                  event(
                    "冻结",
                    `气源批次 ${batch.id} 停用，未签收复测冻结；须补录合格气源并重测后方可恢复`,
                    action.at,
                  ),
                ],
              }
            : f,
        ),
      };
    }

    case "submitRetest": {
      const idx = state.fills.findIndex((f) => f.id === action.fillId);
      if (idx < 0) return state;
      const fill = state.fills[idx];
      if (!isOpen(fill)) return state; // 已签收/返工记录只可追加其历史，流程不可再动

      const check = evaluateRetest(fill, action.retest, new Date(action.retest.at));
      let next: FillRecord = {
        ...fill,
        retest: action.retest,
        history: [
          ...fill.history,
          event(
            "复测",
            `复测：压力 ${action.retest.pressure}bar（压降 ${check.pressureDrop}bar）、O₂ ${action.retest.o2}%（偏差 ${check.o2Diff}%）、He ${action.retest.he}%（偏差 ${check.heDiff}%）、静置 ${check.restMinutes} 分钟；复测员 ${action.retest.operator}`,
            action.retest.at,
          ),
        ],
      };

      // 已冻结记录：先补录合格气源（启用中、类型匹配），再恢复
      if (fill.status === "已冻结") {
        const replacement = state.batches.find((b) => b.id === action.replacementBatchId);
        if (!replacement || !replacement.active || replacement.mode !== fill.mode) return state;
        next = {
          ...next,
          gasReplaced: {
            fromBatchId: fill.gasBatchId,
            toBatchId: replacement.id,
            at: action.retest.at,
            operator: action.retest.operator,
          },
          status: "待复测",
          history: [
            ...next.history,
            event(
              "气源补录",
              `补录合格气源 ${replacement.id}（${replacement.mode} O₂${replacement.o2}%/He${replacement.he}%），冻结解除`,
              action.retest.at,
            ),
          ],
        };
      }

      if (action.decision === "签收") {
        if (!check.passed) return state; // 超限不得签收
        next = {
          ...next,
          status: "已签收",
          closure: { kind: "签收", at: action.retest.at, operator: action.retest.operator, failures: [], note: "" },
          history: [
            ...next.history,
            event("签收", `复检合格，操作员 ${action.retest.operator} 签收`, action.retest.at),
          ],
        };
      } else {
        if (check.passed || !action.reworkNote.trim()) return state; // 合格项无需返工；返工必须写明说明
        next = {
          ...next,
          status: "返工",
          closure: {
            kind: "返工",
            at: action.retest.at,
            operator: action.retest.operator,
            failures: check.failures,
            note: action.reworkNote.trim(),
          },
          history: [
            ...next.history,
            event(
              "返工",
              `超限转返工：${check.failures.join("；")}。返工说明：${action.reworkNote.trim()}`,
              action.retest.at,
            ),
          ],
        };
      }

      const fills = state.fills.slice();
      fills[idx] = next;
      return { ...state, fills };
    }

    default:
      return state;
  }
}

// —— 演示种子数据 ——
function seed(): AppState {
  const now = Date.now();
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  const iso = (offset: number) => new Date(now - offset).toISOString();
  const at = (offset: number) => iso(offset);

  const cylinders: Cylinder[] = [
    { id: "TANK-204", volume: "12L 铝瓶", inspectionDue: "2027-03-10", createdAt: at(60 * day) },
    { id: "TANK-219", volume: "11L 钢瓶", inspectionDue: "2026-10-05", createdAt: at(55 * day) },
    { id: "TANK-231", volume: "双瓶组 11L×2", inspectionDue: "2026-09-12", createdAt: at(90 * day) },
    { id: "TANK-258", volume: "15L 钢瓶", inspectionDue: "2028-01-20", createdAt: at(120 * day) },
  ];

  const batches: GasBatch[] = [
    { id: "AIR-2026-09", supplier: "海风气站", mode: "空气", o2: 21, he: 0, active: true, createdAt: at(12 * day) },
    { id: "EAN-2026-08", supplier: "蓝海气体", mode: "高氧", o2: 32, he: 0, active: true, createdAt: at(20 * day) },
    { id: "TMX-2026-07", supplier: "深潜特气", mode: "Trimix", o2: 18, he: 45, active: true, createdAt: at(26 * day) },
    { id: "AIR-2026-06", supplier: "海风气站", mode: "空气", o2: 21, he: 0, active: false, createdAt: at(60 * day) },
  ];

  const fills: FillRecord[] = [
    {
      id: uid("FILL"),
      cylinderId: "TANK-204",
      mode: "空气",
      residualPressure: 55,
      filledPressure: 200,
      targetPressure: 200,
      targetO2: 21,
      targetHe: 0,
      filledAt: at(45 * min),
      gasBatchId: "AIR-2026-09",
      operator: "阿海",
      status: "待复测",
      createdAt: at(45 * min),
      history: [event("创建", "充填完成，进入静置稳压复检（残压 55 → 200bar，气源 AIR-2026-09）", at(45 * min))],
    },
    {
      id: uid("FILL"),
      cylinderId: "TANK-219",
      mode: "高氧",
      residualPressure: 30,
      filledPressure: 200,
      targetPressure: 200,
      targetO2: 32,
      targetHe: 0,
      filledAt: at(12 * min),
      gasBatchId: "EAN-2026-08",
      operator: "阿琳",
      status: "待复测",
      createdAt: at(12 * min),
      history: [event("创建", "充填完成，进入静置稳压复检（EAN32，残压 30 → 200bar）", at(12 * min))],
    },
    {
      id: uid("FILL"),
      cylinderId: "TANK-231",
      mode: "空气",
      residualPressure: 40,
      filledPressure: 200,
      targetPressure: 200,
      targetO2: 21,
      targetHe: 0,
      filledAt: at(2 * hour),
      gasBatchId: "AIR-2026-06",
      operator: "阿海",
      status: "已冻结",
      createdAt: at(2 * hour),
      history: [
        event("创建", "充填完成，进入静置稳压复检（残压 40 → 200bar，气源 AIR-2026-06）", at(2 * hour)),
        event("冻结", "气源批次 AIR-2026-06 停用，未签收复测冻结；须补录合格气源并重测后方可恢复", at(40 * min)),
      ],
    },
    {
      id: uid("FILL"),
      cylinderId: "TANK-258",
      mode: "Trimix",
      residualPressure: 20,
      filledPressure: 210,
      targetPressure: 210,
      targetO2: 18,
      targetHe: 45,
      filledAt: at(1 * day + 2 * hour),
      gasBatchId: "TMX-2026-07",
      operator: "阿琳",
      status: "已签收",
      createdAt: at(1 * day + 2 * hour),
      retest: { at: at(1 * day), pressure: 208, o2: 18.3, he: 45.2, operator: "阿琳" },
      closure: { kind: "签收", at: at(1 * day), operator: "阿琳", failures: [], note: "" },
      history: [
        event("创建", "充填完成，进入静置稳压复检（Trimix 18/45，残压 20 → 210bar）", at(1 * day + 2 * hour)),
        event("复测", "复测：压力 208bar（压降 2bar）、O₂ 18.3%（偏差 0.3%）、He 45.2%（偏差 0.2%）、静置 120 分钟；复测员 阿琳", at(1 * day)),
        event("签收", "复检合格，操作员 阿琳 签收", at(1 * day)),
      ],
    },
    {
      id: uid("FILL"),
      cylinderId: "TANK-204",
      mode: "高氧",
      residualPressure: 25,
      filledPressure: 190,
      targetPressure: 200,
      targetO2: 32,
      targetHe: 0,
      filledAt: at(5 * day + 1 * hour),
      gasBatchId: "EAN-2026-08",
      operator: "阿海",
      status: "返工",
      createdAt: at(5 * day + 1 * hour),
      retest: { at: at(5 * day), pressure: 182, o2: 34.5, he: 0, operator: "阿琳" },
      closure: {
        kind: "返工",
        at: at(5 * day),
        operator: "阿琳",
        failures: [
          "压力下降 8bar，超过 5bar",
          "氧含量偏差 2.5%，超过 ±1%（目标 32%，实测 34.5%）",
        ],
        note: "通知客户暂缓取瓶，重新抽真空配比后再充填，并检查瓶阀密封性。",
      },
      history: [
        event("创建", "充填完成，进入静置稳压复检（EAN32，残压 25 → 190bar）", at(5 * day + 1 * hour)),
        event("复测", "复测：压力 182bar（压降 8bar）、O₂ 34.5%（偏差 2.5%）、He 0%（偏差 0%）、静置 60 分钟；复测员 阿琳", at(5 * day)),
        event(
          "返工",
          "超限转返工：压力下降 8bar，超过 5bar；氧含量偏差 2.5%，超过 ±1%（目标 32%，实测 34.5%）。返工说明：通知客户暂缓取瓶，重新抽真空配比后再充填，并检查瓶阀密封性。",
          at(5 * day),
        ),
      ],
    },
  ];

  return { cylinders, batches, fills };
}

export function reducer(state: AppState, action: Action): AppState {
  return reducerImpl(state, action);
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && Array.isArray(parsed.fills) && Array.isArray(parsed.cylinders) && Array.isArray(parsed.batches)) {
        return parsed;
      }
    }
  } catch {
    // 落盘损坏时回退种子数据
  }
  return seed();
}

export interface SubmitRetestInput {
  replacementBatchId?: string;
  at: string;
  pressure: number;
  o2: number;
  he: number;
  operator: string;
  decision: "签收" | "返工";
  reworkNote: string;
}

export function useStore() {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    // 单一数据源落盘：刷新后列表、统计、单瓶历史全部从同一记录重建
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const actions = useMemo(
    () => ({
      addCylinder(data: Omit<Cylinder, "createdAt">): string | null {
        if (state.cylinders.some((c) => c.id === data.id.trim())) return "气瓶编号已存在";
        dispatch({ type: "addCylinder", cylinder: { ...data, id: data.id.trim(), createdAt: new Date().toISOString() } });
        return null;
      },

      /** 新充填；同一气瓶已有待复测/已冻结记录时拒绝创建，沿用首次记录 */
      addFill(data: Omit<FillRecord, "id" | "status" | "createdAt" | "history">): { ok: boolean; error?: string; existingId?: string } {
        const existing = state.fills.find((f) => f.cylinderId === data.cylinderId && isOpen(f));
        if (existing) {
          return { ok: false, existingId: existing.id, error: `该气瓶已有${existing.status}记录，重复提交沿用首次记录` };
        }
        const nowIso = new Date().toISOString();
        const fill: FillRecord = {
          ...data,
          id: uid("FILL"),
          status: "待复测",
          createdAt: nowIso,
          history: [
            event(
              "创建",
              `${data.mode} 充填完成（残压 ${data.residualPressure} → ${data.filledPressure}bar，目标 ${data.targetPressure}bar，O₂ ${data.targetO2}%/He ${data.targetHe}%），气源 ${data.gasBatchId}，操作员 ${data.operator}，进入静置稳压复检`,
            ),
          ],
        };
        dispatch({ type: "addFill", fill });
        return { ok: true };
      },

      addBatch(data: Omit<GasBatch, "active" | "createdAt">): string | null {
        if (state.batches.some((b) => b.id === data.id.trim())) return "气源批次号已存在";
        dispatch({
          type: "addBatch",
          batch: { ...data, id: data.id.trim(), active: true, createdAt: new Date().toISOString() },
        });
        return null;
      },

      /** 停用批次：立即冻结引用该批次且未签收的复测；终态记录不受影响 */
      disableBatch(batchId: string): number {
        const frozen = state.fills.filter((f) => f.status === "待复测" && f.gasBatchId === batchId).length;
        dispatch({ type: "disableBatch", batchId, at: new Date().toISOString() });
        return frozen;
      },

      submitRetest(fillId: string, input: SubmitRetestInput): string | null {
        const fill = state.fills.find((f) => f.id === fillId);
        if (!fill) return "记录不存在";
        if (!isOpen(fill)) return "该记录已闭环，不可再操作";
        if (!input.at || !input.operator.trim()) return "请填写复测时间与复测员";

        const retest = {
          at: new Date(input.at).toISOString(),
          pressure: input.pressure,
          o2: input.o2,
          he: input.he,
          operator: input.operator.trim(),
        };
        const check = evaluateRetest(fill, retest, new Date(retest.at));

        if (fill.status === "已冻结") {
          const replacement = state.batches.find((b) => b.id === input.replacementBatchId);
          if (!replacement) return "气源已冻结：请先补录合格气源批次并在复测时选择";
          if (!replacement.active) return "所选气源批次已停用，请选择启用中的合格批次";
          if (replacement.mode !== fill.mode) return `补录气源类型须与充填类型一致（${fill.mode}）`;
        }

        if (input.decision === "签收") {
          if (!check.passed) return `复检超限，不得签收：${check.failures.join("；")}。只能转返工`;
        } else {
          if (check.passed) return "复检各项合格，无需返工，可直接签收";
          if (!input.reworkNote.trim()) return "转返工必须写明返工说明";
        }

        dispatch({
          type: "submitRetest",
          fillId,
          replacementBatchId: input.replacementBatchId,
          retest,
          decision: input.decision,
          reworkNote: input.reworkNote,
        });
        return null;
      },
    }),
    [state],
  );

  return { state, actions };
}

export type StoreActions = ReturnType<typeof useStore>["actions"];

export function modeOf(o2: number, he: number): MixMode {
  if (he > 0) return "Trimix";
  if (o2 > 22) return "高氧";
  return "空气";
}
