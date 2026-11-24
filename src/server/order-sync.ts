/**
 * PlantVerse — server-side order progression sync.
 *
 * The DB-touching half of the progression engine (pure math lives in
 * src/lib/order-progression.ts). Read paths call this so the recorded
 * status always reflects elapsed fulfilment time:
 *
 *   - syncOrderProgression() — bulk sweep for the feed-style reads
 *     (/api/orders, /api/notifications): one findMany over the small
 *     active set + at most one grouped updateMany per target status.
 *     Free when everything is current (zero writes).
 *   - advanceOrderRow() — targeted single-row advance for the
 *     high-frequency tracking probe, reusing the row the route already
 *     fetched (no extra findUnique).
 *
 * Concurrent callers are safe: updates are idempotent status writes and
 * SQLite serialises them.
 */

import { db } from "@/lib/db";
import { advancedStatus } from "@/lib/order-progression";

/** bulk-advance every non-terminal order; returns the number of rows moved */
export async function syncOrderProgression(now: Date = new Date()): Promise<number> {
  const active = await db.order.findMany({
    where: { status: { in: ["paid", "preparing", "shipped"] } },
    select: { id: true, status: true, createdAt: true },
  });

  const byTarget = new Map<string, string[]>();
  for (const o of active) {
    const next = advancedStatus(o.status, o.createdAt, now);
    if (next) byTarget.set(next, [...(byTarget.get(next) ?? []), o.id]);
  }
  if (byTarget.size === 0) return 0;

  let moved = 0;
  for (const [status, ids] of byTarget) {
    const res = await db.order.updateMany({ where: { id: { in: ids } }, data: { status } });
    moved += res.count;
  }
  return moved;
}

/** targeted advance for one already-fetched row; returns the authoritative status */
export async function advanceOrderRow(row: {
  code: string;
  status: string;
  createdAt: Date;
}): Promise<string> {
  const next = advancedStatus(row.status, row.createdAt, new Date());
  if (!next) return row.status;
  await db.order.update({ where: { code: row.code }, data: { status: next } });
  return next;
}
