import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  GH_ALERT_COPY,
  GH_BACKFILL_POINTS,
  GH_DEFAULT_RULES,
  GH_DEVICES,
  GH_HISTORY_POINTS,
  GH_METRICS,
  GH_TICK_MS,
  faDigits,
  nextSensorValue,
  r2,
  runRules,
  type GhDeviceKey,
  type GhMetricKey,
  type GhSnapshot,
} from "@/lib/greenhouse";

export const dynamic = "force-dynamic";

/* ─────────────────────────── helpers ─────────────────────────── */

/** Serialize ticks — concurrent GETs (UI poll + tab focus) must not double-step. */
let ticking: Promise<void> = Promise.resolve();
let tickCounter = 0;

const queueTick = (): Promise<void> => {
  ticking = ticking.then(() => tick());
  return ticking;
};

const latestReadings = async (): Promise<Record<GhMetricKey, number>> => {
  const out = {} as Record<GhMetricKey, number>;
  for (const m of GH_METRICS) {
    const row = await db.ghReading.findFirst({
      where: { metric: m.key },
      orderBy: { recordedAt: "desc" },
    });
    out[m.key] = row?.value ?? m.base;
  }
  return out;
};

/** Seed the singleton state, device rows, default rules and a synthetic past. */
async function ensureGreenhouse(): Promise<void> {
  await db.ghState.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", autopilot: true },
  });

  for (const d of GH_DEVICES) {
    await db.ghDevice.upsert({
      where: { id: d.key },
      update: {},
      create: { id: d.key, isOn: false, source: "manual" },
    });
  }

  const ruleCount = await db.ghRule.count();
  if (ruleCount === 0) {
    await db.ghRule.createMany({
      data: GH_DEFAULT_RULES.map((r) => ({ ...r, enabled: true, builtin: true })),
    });
  }

  const readingCount = await db.ghReading.count();
  if (readingCount === 0) {
    // Backfill a plausible walk so the history chart is never empty on first load.
    const now = Date.now();
    const rows: { metric: string; value: number; recordedAt: Date }[] = [];
    for (const m of GH_METRICS) {
      const walk: number[] = [m.base];
      for (let i = 1; i < GH_BACKFILL_POINTS; i++) walk.push(nextSensorValue(m, walk[i - 1], new Set()));
      rows.push(
        ...walk.map((v, i) => ({
          metric: m.key,
          value: r2(v),
          recordedAt: new Date(now - (GH_BACKFILL_POINTS - i) * GH_TICK_MS),
        }))
      );
    }
    await db.ghReading.createMany({ data: rows });
  }
}

/** One authoritative simulation step: readings + rule engine + band alerts. */
async function tick(): Promise<void> {
  const [prev, deviceRows, state] = await Promise.all([
    latestReadings(),
    db.ghDevice.findMany(),
    db.ghState.findUnique({ where: { id: "singleton" } }),
  ]);

  const onMap = Object.fromEntries(
    GH_DEVICES.map((d) => [d.key, deviceRows.find((r) => r.id === d.key)?.isOn ?? false])
  ) as Record<GhDeviceKey, boolean>;
  const onSet = new Set(GH_DEVICES.filter((d) => onMap[d.key]).map((d) => d.key));

  const nextValues = {} as Record<GhMetricKey, number>;
  for (const m of GH_METRICS) nextValues[m.key] = nextSensorValue(m, prev[m.key], onSet);

  const now = new Date();
  await db.ghReading.createMany({
    data: GH_METRICS.map((m) => ({ metric: m.key, value: r2(nextValues[m.key]), recordedAt: now })),
  });

  const logs: { kind: string; device: string; messageFa: string; messageEn: string; meta: string }[] = [];

  // ── automation rule engine (only when autopilot is engaged) ──
  if (state?.autopilot) {
    const rules = await db.ghRule.findMany({ orderBy: { createdAt: "asc" } });
    const { next, firings } = runRules(rules, nextValues, onMap);
    const changed = GH_DEVICES.filter((d) => next[d.key] !== onMap[d.key]);
    if (changed.length > 0) {
      await db.$transaction(
        changed.map((d) =>
          db.ghDevice.update({ where: { id: d.key }, data: { isOn: next[d.key], source: "rule" } })
        )
      );
      for (const d of changed) {
        const def = GH_DEVICES.find((x) => x.key === d.key)!;
        const firing = firings.find((x) => x.device === d.key);
        const rule = firing?.rule;
        const metric = GH_METRICS.find((m) => m.key === rule?.metric);
        const faCmp = rule?.comparator === "below" ? "پایین‌تر از" : "بالاتر از";
        const enCmp = rule?.comparator === "below" ? "below" : "above";
        logs.push({
          kind: "rule",
          device: d.key,
          messageFa: metric
            ? `${metric.fa} ${faCmp} ${faDigits(rule?.threshold ?? 0)} بود — ${def.fa} ${next[d.key] ? "روشن شد" : "خاموش شد"}`
            : `${def.fa} ${next[d.key] ? "روشن شد" : "خاموش شد"}`,
          messageEn: metric
            ? `${metric.en} ${enCmp} ${rule?.threshold ?? 0} — ${def.en} turned ${next[d.key] ? "on" : "off"}`
            : `${def.en} turned ${next[d.key] ? "on" : "off"}`,
          meta: "{}",
        });
      }
    }
  }

  // ── band alerts — log once when a metric leaves its safe band ──
  for (const m of GH_METRICS) {
    const v = nextValues[m.key];
    const dir = v > m.max + 1 ? "high" : v < m.min - 1 ? "low" : null;
    const wasOut = prev[m.key] > m.max + 1 || prev[m.key] < m.min - 1;
    if (dir && !wasOut) {
      const copy = GH_ALERT_COPY[m.key];
      logs.push({
        kind: "alert",
        device: "",
        messageFa: dir === "high" ? copy.highFa : copy.lowFa,
        messageEn: dir === "high" ? copy.highEn : copy.lowEn,
        meta: JSON.stringify({ metric: m.key, dir }),
      });
    }
  }

  if (logs.length > 0) await db.ghLog.createMany({ data: logs });

  // housekeeping — prune readings older than 15 minutes every 20th tick
  if (++tickCounter % 20 === 0) {
    await db.ghReading.deleteMany({
      where: { recordedAt: { lt: new Date(Date.now() - 15 * 60 * 1000) } },
    });
  }
}

/** Assemble the full client snapshot. */
async function snapshot(): Promise<GhSnapshot> {
  const [state, deviceRows, rules, logs] = await Promise.all([
    db.ghState.findUnique({ where: { id: "singleton" } }),
    db.ghDevice.findMany(),
    db.ghRule.findMany({ orderBy: { createdAt: "asc" } }),
    db.ghLog.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
  ]);

  const history = {} as GhSnapshot["history"];
  const latest = {} as GhSnapshot["latest"];
  let newest = 0;
  for (const m of GH_METRICS) {
    const rows = await db.ghReading.findMany({
      where: { metric: m.key },
      orderBy: { recordedAt: "desc" },
      take: GH_HISTORY_POINTS,
    });
    rows.reverse();
    history[m.key] = rows.map((r) => ({ t: r.recordedAt.toISOString(), v: r.value }));
    latest[m.key] = rows.length > 0 ? rows[rows.length - 1].value : m.base;
    if (rows.length > 0) newest = Math.max(newest, rows[rows.length - 1].recordedAt.getTime());
  }

  const byKey = new Map(deviceRows.map((d) => [d.id, d]));
  return {
    autopilot: state?.autopilot ?? true,
    devices: GH_DEVICES.map((d) => ({
      key: d.key,
      isOn: byKey.get(d.key)?.isOn ?? false,
      source: byKey.get(d.key)?.source ?? "manual",
    })),
    latest,
    history,
    rules: rules.map((r) => ({
      id: r.id,
      metric: r.metric as GhMetricKey,
      comparator: r.comparator as "above" | "below",
      threshold: r.threshold,
      device: r.device as GhDeviceKey,
      turnOn: r.turnOn,
      enabled: r.enabled,
      builtin: r.builtin,
      createdAt: r.createdAt.toISOString(),
    })),
    logs: logs.map((l) => {
      let meta: { metric?: string; dir?: string } = {};
      try {
        meta = JSON.parse(l.meta) as { metric?: string; dir?: string };
      } catch {
        /* tolerate malformed meta */
      }
      return {
        id: l.id,
        kind: l.kind as "rule" | "device" | "autopilot" | "alert",
        device: l.device,
        messageFa: l.messageFa,
        messageEn: l.messageEn,
        meta,
        createdAt: l.createdAt.toISOString(),
      };
    }),
    sampledAt: new Date(newest || Date.now()).toISOString(),
  };
}

/** Advance the sim if the newest reading is stale (lazy tick — max 2 catch-up steps). */
async function maybeTick(): Promise<void> {
  const last = await db.ghReading.findFirst({ orderBy: { recordedAt: "desc" } });
  const age = last ? Date.now() - last.recordedAt.getTime() : Number.POSITIVE_INFINITY;
  if (age < GH_TICK_MS * 0.9) return;
  await queueTick();
  if (age >= GH_TICK_MS * 2) await queueTick(); // catch up after idle
}

/* ─────────────────────────── GET — snapshot ─────────────────────────── */

export async function GET() {
  try {
    await ensureGreenhouse();
    await maybeTick();
    return NextResponse.json({ success: true, state: await snapshot() });
  } catch (err) {
    console.error("[greenhouse] GET failed:", err);
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ─────────────────────────── POST — actions ─────────────────────────── */

const json = (data: unknown, init: { status?: number } = {}) => NextResponse.json(data, init);

export async function POST(req: Request) {
  try {
    await ensureGreenhouse();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = body.action;

    if (action === "tick") {
      await queueTick();
      return json({ success: true, state: await snapshot() });
    }

    if (action === "device") {
      const device = body.device;
      if (typeof device !== "string" || !GH_DEVICES.some((d) => d.key === device)) {
        return json({ success: false, error: "invalid_device" }, { status: 400 });
      }
      if (typeof body.on !== "boolean") {
        return json({ success: false, error: "invalid_body" }, { status: 400 });
      }
      const on = body.on;
      const def = GH_DEVICES.find((d) => d.key === device)!;
      await db.ghDevice.update({ where: { id: device }, data: { isOn: on, source: "manual" } });
      await db.ghLog.create({
        data: {
          kind: "device",
          device,
          messageFa: `${def.fa} به‌صورت دستی ${on ? "روشن" : "خاموش"} شد`,
          messageEn: `${def.en} turned ${on ? "on" : "off"} manually`,
          meta: "{}",
        },
      });
      // Physical override — optional autopilot disengage sent by the client.
      if (body.disengageAutopilot === true) {
        await db.ghState.update({ where: { id: "singleton" }, data: { autopilot: false } });
        await db.ghLog.create({
          data: {
            kind: "autopilot",
            device: "",
            messageFa: "کنترل دستی فعال شد",
            messageEn: "Manual control engaged",
            meta: "{}",
          },
        });
      }
      return json({ success: true, state: await snapshot() });
    }

    if (action === "autopilot") {
      if (typeof body.enabled !== "boolean") {
        return json({ success: false, error: "invalid_body" }, { status: 400 });
      }
      const enabled = body.enabled;
      await db.ghState.update({ where: { id: "singleton" }, data: { autopilot: enabled } });
      await db.ghLog.create({
        data: {
          kind: "autopilot",
          device: "",
          messageFa: enabled ? "خلبان خودکار فعال شد 🤖" : "کنترل دستی فعال شد",
          messageEn: enabled ? "Autopilot engaged 🤖" : "Manual control engaged",
          meta: "{}",
        },
      });
      return json({ success: true, state: await snapshot() });
    }

    return json({ success: false, error: "invalid_action" }, { status: 400 });
  } catch (err) {
    console.error("[greenhouse] POST failed:", err);
    return json({ success: false, error: "server_error" }, { status: 500 });
  }
}
