import db from "../db.server";

// Health endpoint for Macron POS.
//
// Pingable from a heartbeat / uptime monitor every few minutes. Reports:
//   - app process is up
//   - DB is reachable and the Session/PendingMacronPosIntent tables work
//   - At least one shop has an installed offline session (otherwise webhooks
//     can't authenticate, and intents will all fail with shop_not_installed)
//   - Recent intent activity timestamps so a long silent gap is visible
//
// HTTP status:
//   200 — healthy (db_ok, sessions_count >= 1)
//   503 — unhealthy (any check failed). Use this for alerting.
//
// Auth: optional. If MACRON_POS_HEALTH_TOKEN is set, the same token must
//   appear in `x-macron-pos-token` or `?token=`. If unset, the endpoint
//   responds without auth — fine for a public uptime check that only
//   reads aggregate counts (no PII).

const DEBUG_MARKER = "[MSH-HEALTH]";

function logInfo(stage, details = "") {
  if (details) console.log(`${DEBUG_MARKER} ${stage} | ${details}`);
  else console.log(`${DEBUG_MARKER} ${stage}`);
}
function logError(stage, details = "") {
  if (details) console.error(`${DEBUG_MARKER}[ERROR] ${stage} | ${details}`);
  else console.error(`${DEBUG_MARKER}[ERROR] ${stage}`);
}

function normalizeString(value) {
  return String(value == null ? "" : value).trim();
}

async function buildHealthSnapshot() {
  const startedAt = Date.now();
  const checks = {
    db_ok: false,
    sessions_count: 0,
    intents_total: 0,
    intents_last_15m: 0,
    intents_last_1h: 0,
    intents_last_24h: 0,
    most_recent_intent_at: null,
    most_recent_consumed_intent_at: null,
    expired_unconsumed_last_24h: 0,
  };
  const errors = [];

  try {
    const sessionsCount = await db.session.count();
    checks.sessions_count = Number(sessionsCount || 0);
    checks.db_ok = true;
  } catch (err) {
    errors.push({ check: "session_count", message: err && err.message ? err.message : String(err) });
    return { healthy: false, checks, errors, durationMs: Date.now() - startedAt };
  }

  try {
    const now = new Date();
    const t15 = new Date(now.getTime() - 15 * 60 * 1000);
    const t60 = new Date(now.getTime() - 60 * 60 * 1000);
    const t24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [total, c15, c60, c24h, latest, latestConsumed, expiredUnconsumed] = await Promise.all([
      db.pendingMacronPosIntent.count(),
      db.pendingMacronPosIntent.count({ where: { createdAt: { gte: t15 } } }),
      db.pendingMacronPosIntent.count({ where: { createdAt: { gte: t60 } } }),
      db.pendingMacronPosIntent.count({ where: { createdAt: { gte: t24h } } }),
      db.pendingMacronPosIntent.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db.pendingMacronPosIntent.findFirst({
        where: { consumedAt: { not: null } },
        orderBy: { consumedAt: "desc" },
        select: { consumedAt: true },
      }),
      db.pendingMacronPosIntent.count({
        where: { consumedAt: null, expiresAt: { lt: now }, createdAt: { gte: t24h } },
      }),
    ]);

    checks.intents_total = Number(total || 0);
    checks.intents_last_15m = Number(c15 || 0);
    checks.intents_last_1h = Number(c60 || 0);
    checks.intents_last_24h = Number(c24h || 0);
    checks.most_recent_intent_at = latest?.createdAt ? latest.createdAt.toISOString() : null;
    checks.most_recent_consumed_intent_at = latestConsumed?.consumedAt
      ? latestConsumed.consumedAt.toISOString()
      : null;
    checks.expired_unconsumed_last_24h = Number(expiredUnconsumed || 0);
  } catch (err) {
    errors.push({ check: "intent_metrics", message: err && err.message ? err.message : String(err) });
  }

  // A healthy system has at least one installed session. Without it, intents
  // and webhooks can't operate at all.
  const healthy = checks.db_ok && checks.sessions_count >= 1 && errors.length === 0;
  return { healthy, checks, errors, durationMs: Date.now() - startedAt };
}

function isAuthorized(request) {
  const expected = normalizeString(process.env.MACRON_POS_HEALTH_TOKEN);
  if (!expected) return true; // unauthenticated health checks allowed when no token is set
  const url = new URL(request.url);
  const provided =
    normalizeString(request.headers.get("x-macron-pos-token")) ||
    normalizeString(url.searchParams.get("token"));
  return Boolean(provided && provided === expected);
}

async function handle(request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let snapshot;
  try {
    snapshot = await buildHealthSnapshot();
  } catch (err) {
    logError("SNAPSHOT EXCEPTION", err && err.message ? err.message : String(err));
    return Response.json(
      { ok: false, healthy: false, error: "snapshot_exception" },
      { status: 503 },
    );
  }

  const status = snapshot.healthy ? 200 : 503;
  if (snapshot.healthy) {
    logInfo(
      "HEALTHY",
      `sessions=${snapshot.checks.sessions_count} intents_15m=${snapshot.checks.intents_last_15m} intents_1h=${snapshot.checks.intents_last_1h} duration_ms=${snapshot.durationMs}`,
    );
  } else {
    logError(
      "UNHEALTHY",
      `sessions=${snapshot.checks.sessions_count} db_ok=${snapshot.checks.db_ok} errors=${JSON.stringify(snapshot.errors)}`,
    );
  }

  return Response.json(
    {
      ok: snapshot.healthy,
      healthy: snapshot.healthy,
      checkedAt: new Date().toISOString(),
      durationMs: snapshot.durationMs,
      checks: snapshot.checks,
      errors: snapshot.errors,
    },
    { status },
  );
}

export const loader = async ({ request }) => handle(request);
export const action = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  return handle(request);
};
