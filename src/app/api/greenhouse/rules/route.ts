import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  GH_MAX_RULES,
  GH_MET,
  isGhDevice,
  isGhMetric,
  type GhComparator,
  type GhDeviceKey,
  type GhMetricKey,
} from "@/lib/greenhouse";

export const dynamic = "force-dynamic";

/* ─────────────────────────── helpers ─────────────────────────── */

const json = (data: unknown, init: { status?: number } = {}) => NextResponse.json(data, init);

/** Threshold must sit inside the metric's absolute validation bounds. */
const thresholdInRange = (metric: GhMetricKey, threshold: number): boolean => {
  const m = GH_MET[metric];
  return Number.isFinite(threshold) && threshold >= m.absMin && threshold <= m.absMax;
};

const ruleDto = (r: {
  id: string;
  metric: string;
  comparator: string;
  threshold: number;
  device: string;
  turnOn: boolean;
  enabled: boolean;
  builtin: boolean;
  createdAt: Date;
}) => ({
  id: r.id,
  metric: r.metric as GhMetricKey,
  comparator: r.comparator as GhComparator,
  threshold: r.threshold,
  device: r.device as GhDeviceKey,
  turnOn: r.turnOn,
  enabled: r.enabled,
  builtin: r.builtin,
  createdAt: r.createdAt.toISOString(),
});

/* ─────────────────────────── GET — list rules ─────────────────────────── */

export async function GET() {
  try {
    const rules = await db.ghRule.findMany({ orderBy: { createdAt: "asc" } });
    return json({ success: true, rules: rules.map(ruleDto) });
  } catch (err) {
    console.error("[greenhouse:rules] failed:", err);
    return json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ─────────────────────────── POST — create a rule ─────────────────────────── */

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const errors: Record<string, string> = {};

    if (!isGhMetric(body.metric)) errors.metric = "invalid";
    if (body.comparator !== "above" && body.comparator !== "below") errors.comparator = "invalid";
    if (typeof body.threshold !== "number" || !Number.isFinite(body.threshold)) {
      errors.threshold = "invalid";
    } else if (!isGhMetric(body.metric) || !thresholdInRange(body.metric, body.threshold)) {
      errors.threshold = "range";
    }
    if (!isGhDevice(body.device)) errors.device = "invalid";

    if (Object.keys(errors).length > 0) {
      return json({ success: false, error: "validation", errors }, { status: 400 });
    }

    const metric = body.metric as GhMetricKey;
    const comparator = body.comparator as GhComparator;
    const device = body.device as GhDeviceKey;
    const threshold = body.threshold as number; // validated above (typeof number + range)
    const turnOn = body.turnOn === undefined ? true : body.turnOn === true;

    // the cap applies to user-created rules only — seeded hysteresis pairs are builtin
    const count = await db.ghRule.count({ where: { builtin: false } });
    if (count >= GH_MAX_RULES) {
      return json({ success: false, error: "limit_reached", limit: GH_MAX_RULES }, { status: 409 });
    }

    const duplicate = await db.ghRule.findFirst({
      where: { metric, comparator, threshold, device, turnOn },
    });
    if (duplicate) {
      return json({ success: false, error: "duplicate" }, { status: 409 });
    }

    const rule = await db.ghRule.create({
      data: { metric, comparator, threshold, device, turnOn, enabled: true },
    });
    return json({ success: true, rule: ruleDto(rule) }, { status: 201 });
  } catch (err) {
    console.error("[greenhouse:rules] failed:", err);
    return json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ─────────────────────────── PATCH — threshold / enabled ─────────────────── */

export async function PATCH(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    if (!id) return json({ success: false, error: "missing_id" }, { status: 400 });

    const existing = await db.ghRule.findUnique({ where: { id } });
    if (!existing) return json({ success: false, error: "not_found" }, { status: 404 });

    const data: { threshold?: number; enabled?: boolean } = {};

    const t = body.threshold;
    if (t !== undefined) {
      if (typeof t !== "number" || !Number.isFinite(t)) {
        return json(
          { success: false, error: "validation", errors: { threshold: "invalid" } },
          { status: 400 }
        );
      }
      if (!thresholdInRange(existing.metric as GhMetricKey, t)) {
        return json(
          { success: false, error: "validation", errors: { threshold: "range" } },
          { status: 400 }
        );
      }
      data.threshold = t;
    }
    const e = body.enabled;
    if (e !== undefined) {
      if (typeof e !== "boolean") {
        return json(
          { success: false, error: "validation", errors: { enabled: "invalid" } },
          { status: 400 }
        );
      }
      data.enabled = e;
    }

    if (Object.keys(data).length === 0) {
      return json({ success: false, error: "nothing_to_update" }, { status: 400 });
    }

    const rule = await db.ghRule.update({ where: { id }, data });
    return json({ success: true, rule: ruleDto(rule) });
  } catch (err) {
    console.error("[greenhouse:rules] failed:", err);
    return json({ success: false, error: "server_error" }, { status: 500 });
  }
}

/* ─────────────────────────── DELETE — remove a rule ─────────────────────── */

export async function DELETE(req: Request) {
  try {
    let id = "";
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      id = String(body.id ?? "").trim().slice(0, 40);
    }
    if (!id) {
      id = String(new URL(req.url).searchParams.get("id") ?? "").trim().slice(0, 40);
    }
    if (!id) return json({ success: false, error: "missing_id" }, { status: 400 });

    const existing = await db.ghRule.findUnique({ where: { id } });
    if (!existing) return json({ success: false, error: "not_found" }, { status: 404 });

    await db.ghRule.delete({ where: { id } });
    return json({ success: true, id });
  } catch (err) {
    console.error("[greenhouse:rules] failed:", err);
    return json({ success: false, error: "server_error" }, { status: 500 });
  }
}
