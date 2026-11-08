import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SCHEDULE,
  parseClock,
  validateSchedule,
  scheduleOnDuty,
  advanceDuty,
} from "../src/host/duty/schedule.mjs";

/**
 * 上下班纯状态机（票 09: 时间可测 — 到点判定是注入时钟的纯函数）。
 * 所有时刻都用本地时间构造（new Date(y, m, d, …)），与时区无关。
 */

/** @param {number} y @param {number} mo @param {number} d @param {number} h @param {number} mi @param {number} [s] */
const at = (y, mo, d, h, mi, s = 0) => new Date(y, mo, d, h, mi, s).getTime();

const SCHEDULE = { workStart: "09:00", workEnd: "18:00", graceSeconds: 90 };

/**
 * 相位/override 的构造器：让字面量保持联合类型（checkJs 下不会被推宽）。
 *
 * @param {"on" | "grace" | "off"} phase
 * @param {number} phaseSince
 * @param {number | null} [graceUntil]
 * @returns {import("../src/host/duty/schedule.mjs").DutyPhase}
 */
const phaseAt = (phase, phaseSince, graceUntil = null) => ({ phase, phaseSince, graceUntil });

/**
 * @param {"on" | "off"} mode
 * @param {number} at
 * @returns {import("../src/host/duty/schedule.mjs").DutyOverride}
 */
const ovr = (mode, at) => ({ mode, at });

test("parseClock 接受 HH:MM 与 HH:MM:SS，其余一律拒绝", () => {
  assert.equal(parseClock("09:00"), 9 * 3600);
  assert.equal(parseClock("18:00:30"), 18 * 3600 + 30);
  assert.equal(parseClock("00:00"), 0);
  assert.equal(parseClock("23:59:59"), 23 * 3600 + 59 * 60 + 59);
  for (const bad of ["9:00", "24:00", "09:60", "09:00:60", "0900", "", "09:00:00:00", "ab:cd", 900, null]) {
    assert.equal(parseClock(/** @type {any} */ (bad)), null, `${String(bad)} 必须被拒`);
  }
});

test("validateSchedule：下班必须晚于上班，宽限是非负整数秒", () => {
  assert.equal(validateSchedule(SCHEDULE).ok, true);
  assert.equal(validateSchedule({ workStart: "09:00", workEnd: "08:00", graceSeconds: 90 }).ok, false, "v1 不跨夜");
  assert.equal(validateSchedule({ workStart: "09:00", workEnd: "09:00", graceSeconds: 90 }).ok, false);
  assert.equal(validateSchedule({ workStart: "09:00", workEnd: "18:00:30", graceSeconds: 4 }).ok, true, "秒级时间表可配（e2e 把下班配成几秒后）");
  assert.equal(validateSchedule({ workStart: "09:00", workEnd: "18:00", graceSeconds: -1 }).ok, false);
  assert.equal(validateSchedule({ workStart: "09:00", workEnd: "18:00", graceSeconds: 1.5 }).ok, false);
  assert.equal(validateSchedule({ workStart: "09:00", workEnd: "18:00", graceSeconds: 0 }).ok, true, "0 秒宽限 = 到点即落盘");
});

test("没有配置的公司走默认时间表：90 秒宽限是硬约束里的默认值", () => {
  assert.deepEqual(
    { workStart: DEFAULT_SCHEDULE.workStart, workEnd: DEFAULT_SCHEDULE.workEnd, graceSeconds: DEFAULT_SCHEDULE.graceSeconds },
    { workStart: "09:00", workEnd: "18:00", graceSeconds: 90 },
  );
});

test("scheduleOnDuty：上班含边界、下班不含（[workStart, workEnd)）", () => {
  assert.equal(scheduleOnDuty(SCHEDULE, at(2026, 10, 5, 8, 59, 59)), false);
  assert.equal(scheduleOnDuty(SCHEDULE, at(2026, 10, 5, 9, 0, 0)), true);
  assert.equal(scheduleOnDuty(SCHEDULE, at(2026, 10, 5, 17, 59, 59)), true);
  assert.equal(scheduleOnDuty(SCHEDULE, at(2026, 10, 5, 18, 0, 0)), false);
});

test("到下班点：进入 90 秒宽限（可配），宽限内不产生 pause", () => {
  const on = phaseAt("on", at(2026, 10, 5, 9, 0));
  const r1 = advanceDuty({ phase: on, schedule: SCHEDULE, override: null, now: at(2026, 10, 5, 17, 59, 59) });
  assert.deepEqual({ phase: r1.phase.phase, effects: r1.effects }, { phase: "on", effects: [] }, "还没到点不动 anything");

  const r2 = advanceDuty({ phase: on, schedule: SCHEDULE, override: null, now: at(2026, 10, 5, 18, 0, 5) });
  assert.deepEqual(r2.effects, ["begin_grace"], "到点先进宽限，不直接掐");
  assert.equal(r2.phase.phase, "grace");
  assert.equal(
    r2.phase.graceUntil,
    at(2026, 10, 5, 18, 0, 0) + 90_000,
    "宽限从下班界点起算 90s，不是从发现时刻起算",
  );

  const r3 = advanceDuty({ phase: r2.phase, schedule: SCHEDULE, override: null, now: at(2026, 10, 5, 18, 1, 29) });
  assert.deepEqual({ phase: r3.phase.phase, effects: r3.effects }, { phase: "grace", effects: [] }, "宽限内不产生 pause");

  const r4 = advanceDuty({ phase: r2.phase, schedule: SCHEDULE, override: null, now: at(2026, 10, 5, 18, 1, 30) });
  assert.deepEqual({ phase: r4.phase.phase, effects: r4.effects }, { phase: "off", effects: ["pause_runs"] }, "宽限到期 → 落盘暂停");
});

test("宽限可配：秒级下班 + 短宽限，到点即 pause（e2e 用它控制时长）", () => {
  const fast = { workStart: "09:00", workEnd: "14:00:10", graceSeconds: 2 };
  const on = phaseAt("on", at(2026, 10, 5, 9, 0));
  const entered = advanceDuty({ phase: on, schedule: fast, override: null, now: at(2026, 10, 5, 14, 0, 11) });
  assert.deepEqual(entered.effects, ["begin_grace"]);
  assert.equal(entered.phase.graceUntil, at(2026, 10, 5, 14, 0, 10) + 2_000);
  const done = advanceDuty({ phase: entered.phase, schedule: fast, override: null, now: at(2026, 10, 5, 14, 0, 13) });
  assert.deepEqual({ phase: done.phase.phase, effects: done.effects }, { phase: "off", effects: ["pause_runs"] });
});

test("发现下班点时宽限已过期：诚实直接 pause，不补做假宽限", () => {
  const on = phaseAt("on", at(2026, 10, 5, 9, 0));
  const r = advanceDuty({ phase: on, schedule: SCHEDULE, override: null, now: at(2026, 10, 5, 19, 30) });
  assert.deepEqual({ phase: r.phase.phase, effects: r.effects }, { phase: "off", effects: ["pause_runs"] });
});

test("到上班点：off → on 产生 clock_in（激活有未完成任务的员工）", () => {
  const off = phaseAt("off", at(2026, 10, 4, 18, 1, 30));
  const before = advanceDuty({ phase: off, schedule: SCHEDULE, override: null, now: at(2026, 10, 5, 8, 59, 59) });
  assert.deepEqual({ phase: before.phase.phase, effects: before.effects }, { phase: "off", effects: [] });

  const r = advanceDuty({ phase: off, schedule: SCHEDULE, override: null, now: at(2026, 10, 5, 9, 0, 0) });
  assert.deepEqual({ phase: r.phase.phase, effects: r.effects }, { phase: "on", effects: ["clock_in"] });
});

test("override 与时间表是两条独立状态：off 立即下班（无宽限），时间表原样参与判定", () => {
  const on = phaseAt("on", at(2026, 10, 5, 9, 0));
  const r = advanceDuty({ phase: on, schedule: SCHEDULE, override: ovr("off", at(2026, 10, 5, 11, 0)), now: at(2026, 10, 5, 11, 0, 1) });
  // 手动下班 = 立即生效：没有宽限，直接落盘暂停（验收 2「立即」）。
  // runtime 在写入 override 时就走这条收敛；tick 兜底重放对空公司是无操作。
  assert.equal(r.phase.phase, "off", "override off：当前态是下班，不是宽限");
  assert.deepEqual(r.effects, ["pause_runs"]);
});

test("override 到期 = 越过下一个排班界点自动失效：手动下班不会把明天的上班也吃掉", () => {
  // 11:00 手动下班（当时排班是上班中）；次日 09:00 排班进入上班 → override 失效
  const override = ovr("off", at(2026, 10, 5, 11, 0));
  const r = advanceDuty({ phase: phaseAt("off", at(2026, 10, 5, 11, 0)), schedule: SCHEDULE, override, now: at(2026, 10, 6, 9, 0) });
  assert.equal(r.clearOverride, true, "越过界点，override 记录被清");
  assert.deepEqual({ phase: r.phase.phase, effects: r.effects }, { phase: "on", effects: ["clock_in"] }, "override 失效后按时间表上班");
});

test("手动上班（override on）期间到点下班：override 在界点失效，正常走宽限", () => {
  // 08:00 手动上班（排班还没到点）；18:00 排班下班 → override(at=08:00 排班 off) 与现在(排班 off)不同相位 → 失效，进宽限
  const override = ovr("on", at(2026, 10, 5, 8, 0));
  const r = advanceDuty({ phase: phaseAt("on", at(2026, 10, 5, 8, 0)), schedule: SCHEDULE, override, now: at(2026, 10, 5, 18, 0, 1) });
  assert.equal(r.clearOverride, true);
  assert.equal(r.phase.phase, "grace");
  assert.deepEqual(r.effects, ["begin_grace"]);
});

test("override 未越界时保持有效：手动下班后，同一工作时段内不会被时间表翻回上班", () => {
  const override = ovr("off", at(2026, 10, 5, 11, 0));
  const r = advanceDuty({ phase: phaseAt("off", at(2026, 10, 5, 11, 0)), schedule: SCHEDULE, override, now: at(2026, 10, 5, 15, 0) });
  assert.equal(r.clearOverride, false, "还没越过排班界点（18:00），override 仍然作数");
  assert.deepEqual({ phase: r.phase.phase, effects: r.effects }, { phase: "off", effects: [] });
});

test("宽限中手动下班：立即 off + pause，不被 graceSeconds 吞掉", () => {
  const grace = phaseAt("grace", at(2026, 10, 5, 18, 0), at(2026, 10, 5, 18, 1, 30));
  const r = advanceDuty({
    phase: grace,
    schedule: SCHEDULE,
    override: ovr("off", at(2026, 10, 5, 18, 0, 20)),
    now: at(2026, 10, 5, 18, 0, 30),
  });
  assert.deepEqual({ phase: r.phase.phase, effects: r.effects }, { phase: "off", effects: ["pause_runs"] });
});

test("跨天重启：昨天的 on 在今天上班时段重新 clock_in，不会用昨天相位假装上班", () => {
  const yesterdayOn = phaseAt("on", at(2026, 10, 4, 10, 0));
  const r = advanceDuty({ phase: yesterdayOn, schedule: SCHEDULE, override: null, now: at(2026, 10, 5, 10, 0) });
  assert.deepEqual({ phase: r.phase.phase, effects: r.effects }, { phase: "on", effects: ["clock_in"] });

  const early = advanceDuty({ phase: yesterdayOn, schedule: SCHEDULE, override: null, now: at(2026, 10, 5, 8, 0) });
  assert.deepEqual(
    { phase: early.phase.phase, effects: early.effects },
    { phase: "off", effects: ["pause_runs"] },
    "早上 8 点不能把昨天的 on 演成今天的宽限",
  );

  const yesterdayGrace = phaseAt("grace", at(2026, 10, 4, 18, 0), at(2026, 10, 4, 18, 1, 30));
  const lateMorning = advanceDuty({ phase: yesterdayGrace, schedule: SCHEDULE, override: null, now: at(2026, 10, 5, 10, 0) });
  assert.deepEqual(
    { phase: lateMorning.phase.phase, effects: lateMorning.effects },
    { phase: "on", effects: ["clock_in"] },
    "昨天的宽限不是今天的宽限",
  );
});

test("首次观测（phase 未知）只落位、不放 effects：重启不伪造一次上班", () => {
  const morning = advanceDuty({ phase: null, schedule: SCHEDULE, override: null, now: at(2026, 10, 5, 10, 0) });
  assert.deepEqual({ phase: morning.phase.phase, effects: morning.effects }, { phase: "on", effects: [] });
  const evening = advanceDuty({ phase: null, schedule: SCHEDULE, override: null, now: at(2026, 10, 5, 21, 0) });
  assert.deepEqual({ phase: evening.phase.phase, effects: evening.effects }, { phase: "off", effects: [] });
});

test("宽限中被手动上班：runtime 直接把相位拨回 on，tick 不再补 pause", () => {
  const grace = phaseAt("grace", at(2026, 10, 5, 18, 0, 5), at(2026, 10, 5, 18, 1, 30));
  const r = advanceDuty({ phase: grace, schedule: SCHEDULE, override: ovr("on", at(2026, 10, 5, 18, 0, 30)), now: at(2026, 10, 5, 18, 1, 29) });
  assert.deepEqual({ phase: r.phase.phase, effects: r.effects }, { phase: "on", effects: [] });
});
