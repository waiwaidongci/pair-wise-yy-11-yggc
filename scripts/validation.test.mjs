import { evaluateRecheck, minutesBetween } from "../src/lib/validation";
import assert from "node:assert/strict";

const base = {
  completedAt: new Date(Date.now() - 40 * 60000).toISOString(),
  fillPressure: 200,
  targetO2: 32,
  targetHe: 0
};
const activeBatch = { code: "EAN32-OK", active: true };
const deadBatch = { code: "EAN36-BAD", active: false };

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

// 1. 全部达标：静置 40min、压降 2bar、偏差 0、气源在用 -> 可签收
check("全部达标返回空超限项", () => {
  const v = evaluateRecheck(
    base,
    { at: new Date().toISOString(), pressure: 198, o2: 32, he: 0 },
    activeBatch
  );
  assert.deepEqual(v, []);
});

// 2. 静置不足 30 分钟不得签收
check("静置 25 分钟判定超限", () => {
  const fill = { ...base, completedAt: new Date(Date.now() - 25 * 60000).toISOString() };
  const v = evaluateRecheck(
    fill,
    { at: new Date().toISOString(), pressure: 200, o2: 32, he: 0 },
    activeBatch
  );
  assert.equal(v.length, 1);
  assert.match(v[0], /静置.*不足 30 分钟/);
});

// 3. 临界：恰好 30 分钟允许；压降恰好 5bar 允许（阈值用严格大于）
check("临界值 30 分钟 / 压降 5bar 不超限", () => {
  const at = new Date(new Date(base.completedAt).getTime() + 30 * 60000).toISOString();
  const v = evaluateRecheck(base, { at, pressure: 195, o2: 32, he: 0 }, activeBatch);
  assert.deepEqual(v, []);
  assert.equal(minutesBetween(base.completedAt, new Date(at).getTime()), 30);
});

// 4. 压力下降 6bar 超限
check("压降 6bar 判定超限", () => {
  const v = evaluateRecheck(
    base,
    { at: new Date().toISOString(), pressure: 194, o2: 32, he: 0 },
    activeBatch
  );
  assert.ok(v.some((x) => /压力下降 6\.0 bar.*超过 5/.test(x)));
});

// 5. 氧偏差 1.1 超限；氦偏差 1.1 超限；偏差恰好 1.0 允许
check("氧氦偏差边界正确", () => {
  const ok = evaluateRecheck(
    base,
    { at: new Date().toISOString(), pressure: 200, o2: 33, he: 1 },
    activeBatch
  );
  assert.deepEqual(ok, []);
  const bad = evaluateRecheck(
    { ...base, targetHe: 45 },
    { at: new Date().toISOString(), pressure: 200, o2: 30.9, he: 43.9 },
    activeBatch
  );
  assert.equal(bad.length, 2);
  assert.ok(bad.some((x) => x.includes("氧含量")));
  assert.ok(bad.some((x) => x.includes("氦含量")));
});

// 6. 气源停用：即使其它全达标也冻结
check("气源停用冻结，不能签收", () => {
  const v = evaluateRecheck(
    base,
    { at: new Date().toISOString(), pressure: 200, o2: 32, he: 0 },
    deadBatch
  );
  assert.equal(v.length, 1);
  assert.match(v[0], /EAN36-BAD 已停用.*补录合格气源并重测/);
});

// 7. 气源缺失（批次被删除等）同样冻结
check("气源未知同样冻结", () => {
  const v = evaluateRecheck(
    base,
    { at: new Date().toISOString(), pressure: 200, o2: 32, he: 0 },
    undefined
  );
  assert.match(v[0], /气源批次 未知 已停用/);
});

// 8. 多项同时超限全部列出，供返工单写明
check("多项超限完整列出", () => {
  const fill = { ...base, completedAt: new Date(Date.now() - 10 * 60000).toISOString() };
  const v = evaluateRecheck(
    fill,
    { at: new Date().toISOString(), pressure: 190, o2: 40, he: 10 },
    deadBatch
  );
  assert.equal(v.length, 5);
});

console.log(`\n全部 ${passed} 组规则测试通过`);
