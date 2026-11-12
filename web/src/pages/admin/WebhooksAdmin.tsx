import { Fragment, useState } from 'react';
import type { WebhookHealthDTO } from '@pf/shared';
import { useClearFailedDeliveries, useDeleteDelivery, useWebhookHealth } from '../../api/hooks';
import { friendlyError } from '../../api/errors';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { relativeTime } from '../../components/post/time';

function pill(h: WebhookHealthDTO): { cls: string; text: string } {
  if (!h.hasWebhook) return { cls: 'pill--gray', text: 'No webhook' };
  if (h.failedLast24h > 0) return { cls: 'pill--red', text: 'Failing' };
  return { cls: '', text: 'Healthy' };
}

export function WebhooksAdmin() {
  const health = useWebhookHealth();
  const [open, setOpen] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const remove = useDeleteDelivery();
  const clear = useClearFailedDeliveries();

  return (
    <div>
      <h2>Webhooks</h2>
      {health.isError && <p role="alert" className="admin__error">{friendlyError(health.error)}</p>}
      <button type="button" className="btn btn--secondary" disabled={health.isFetching} onClick={() => void health.refetch()}>Refresh</button>
      <button type="button" className="btn btn--danger" onClick={() => { clear.reset(); setClearing(true); }}>Clear failed</button>
      {remove.isError && <p role="alert" className="admin__error">{friendlyError(remove.error)}</p>}
      <table className="admin__table">
        <thead>
          <tr><th>Guild</th><th>Status</th><th>Webhook</th><th>Active</th><th>Last sent</th><th>Pending</th><th>Failed 24h</th><th /></tr>
        </thead>
        <tbody>
          {health.data?.map((h) => {
            const p = pill(h);
            const expanded = open === h.guildId;
            return (
              <Fragment key={h.guildId}>
                <tr>
                  <td data-label="Guild">{h.guildName}</td>
                  <td data-label="Status"><span data-testid={`pill-${h.guildId}`} className={`pill ${p.cls}`}>{p.text}</span></td>
                  <td data-label="Webhook">{h.hasWebhook ? '✓' : '—'}</td>
                  <td data-label="Active">{h.active ? 'Yes' : 'No'}</td>
                  <td data-label="Last sent">{h.lastSentAt ? relativeTime(h.lastSentAt) : '—'}</td>
                  <td data-label="Pending"><span aria-label="Pending">{h.pending}</span></td>
                  <td data-label="Failed 24h"><span aria-label="Failed 24h">{h.failedLast24h}</span></td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Hide' : 'Show'} failures ${h.guildName}`}
                      onClick={() => setOpen(expanded ? null : h.guildId)}
                    >
                      {expanded ? 'Hide' : 'Failures'}
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr>
                    <td colSpan={8}>
                      {h.recentFailures.length === 0 ? (
                        <p>No recent failures.</p>
                      ) : (
                        <ul>
                          {h.recentFailures.map((f) => (
                            <li key={f.id}>
                              <span>{f.eventType}</span> · {f.attempts} attempts · <span>{f.lastError ?? 'unknown error'}</span> ·{' '}
                              <span>{relativeTime(f.createdAt)}</span>{' '}
                              <button type="button" className="btn btn--secondary" aria-label={`Remove failed delivery ${f.eventType}`} disabled={remove.isPending} onClick={() => remove.mutate(f.id)}>Remove</button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {clearing && (
        <ConfirmDialog
          title="Clear all failed deliveries?"
          confirmLabel="Clear failed"
          busy={clear.isPending}
          error={clear.isError ? friendlyError(clear.error) : undefined}
          onConfirm={() => clear.mutate(undefined, { onSuccess: () => setClearing(false) })}
          onCancel={() => setClearing(false)}
        >
          <p>This removes every failed delivery record for all guilds. It does not resend anything.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
