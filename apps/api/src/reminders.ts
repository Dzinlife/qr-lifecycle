import {
  createApnsProviderFromEnv,
  type ApnsMessage,
  type ApnsResult,
} from "./apns";

export interface ReminderPushProvider {
  send(message: ApnsMessage): Promise<ApnsResult>;
}

interface DueReminderRow {
  tenant_id: string;
  channel_id: string;
  channel_name: string;
  expires_at: string;
  active_qr_version_id: string | null;
  device_id: string;
  apns_token: string;
  reminder_key: string;
}

export interface ReminderRunResult {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
}

export async function sendDueReminders(
  env: Env,
  provider: ReminderPushProvider | null = createApnsProviderFromEnv(env),
  now = new Date(),
): Promise<ReminderRunResult> {
  if (!provider) {
    console.log(
      JSON.stringify({ message: "reminder scan skipped", reason: "apns_not_configured" }),
    );
    return { scanned: 0, sent: 0, failed: 0, skipped: 1 };
  }

  const rows = await env.DB.prepare(
    `SELECT
       c.tenant_id,
       c.id AS channel_id,
       c.name AS channel_name,
       c.expires_at,
       c.active_qr_version_id,
       d.id AS device_id,
       d.apns_token,
       (c.expires_at || ':' || c.remind_before_minutes || ':' ||
        COALESCE(c.active_qr_version_id, 'none')) AS reminder_key
     FROM channels c
     JOIN devices d
       ON d.tenant_id = c.tenant_id
      AND d.notifications_enabled = 1
      AND d.apns_environment = ?
     LEFT JOIN reminder_deliveries rd
       ON rd.tenant_id = c.tenant_id
      AND rd.channel_id = c.id
      AND rd.device_id = d.id
      AND rd.reminder_key = (
        c.expires_at || ':' || c.remind_before_minutes || ':' ||
        COALESCE(c.active_qr_version_id, 'none')
      )
     WHERE c.disabled_at IS NULL
       AND c.expires_at IS NOT NULL
       AND datetime(c.expires_at, '-' || c.remind_before_minutes || ' minutes')
           <= datetime(?)
       AND rd.id IS NULL
     ORDER BY c.expires_at ASC
     LIMIT 100`,
  )
    .bind(env.APNS_ENVIRONMENT, now.toISOString())
    .all<DueReminderRow>();

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows.results) {
    const deliveryId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO reminder_deliveries (
         id, tenant_id, channel_id, device_id, reminder_key, status, created_at
       ) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(
        deliveryId,
        row.tenant_id,
        row.channel_id,
        row.device_id,
        row.reminder_key,
        createdAt,
      )
      .run();
    if (inserted.meta.changes !== 1) {
      skipped += 1;
      continue;
    }

    try {
      const result = await provider.send({
        deviceToken: row.apns_token,
        collapseId: row.channel_id,
        expiration: Math.floor(now.getTime() / 1_000) + 24 * 60 * 60,
        payload: {
          aps: {
            alert: {
              title: `${row.channel_name} 二维码即将过期`,
              body: "保存新的群二维码后打开 App，系统会自动识别并更新。",
            },
            sound: "default",
          },
          channelId: row.channel_id,
          route: "/discover",
        },
      });
      const status = result.ok ? "sent" : "failed";
      await env.DB.prepare(
        `UPDATE reminder_deliveries
         SET status = ?, apns_id = ?, status_code = ?, response_reason = ?, sent_at = ?
         WHERE id = ? AND tenant_id = ? AND channel_id = ? AND device_id = ?`,
      )
        .bind(
          status,
          result.apnsId,
          result.status,
          result.reason,
          new Date().toISOString(),
          deliveryId,
          row.tenant_id,
          row.channel_id,
          row.device_id,
        )
        .run();
      if (result.ok) sent += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message : "Unknown APNs error";
      await env.DB.prepare(
        `UPDATE reminder_deliveries
         SET status = 'failed', response_reason = ?, sent_at = ?
         WHERE id = ? AND tenant_id = ? AND channel_id = ? AND device_id = ?`,
      )
        .bind(
          reason.slice(0, 500),
          new Date().toISOString(),
          deliveryId,
          row.tenant_id,
          row.channel_id,
          row.device_id,
        )
        .run();
    }
  }

  return { scanned: rows.results.length, sent, failed, skipped };
}
