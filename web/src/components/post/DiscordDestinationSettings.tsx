import { useState } from 'react';
import type { FormEvent } from 'react';
import type { PostDetailDTO } from '@pf/shared';
import { useDiscordDestinations, useUpdatePost } from '../../api/postHooks';
import { friendlyError } from '../../api/errors';
import { DiscordDestinationFields } from './DiscordDestinationFields';

export function DiscordDestinationSettings({ post }: { post: PostDetailDTO }) {
  const destinations = useDiscordDestinations();
  const update = useUpdatePost(post.id);
  const [value, setValue] = useState({ notificationGuildId: post.notificationGuild?.id ?? '', partyForumGuildId: post.partyForumGuild?.id ?? '' });
  const [saved, setSaved] = useState(false);
  const changed = value.notificationGuildId !== (post.notificationGuild?.id ?? '') || value.partyForumGuildId !== (post.partyForumGuild?.id ?? '');
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!changed || update.isPending) return;
    try {
      await update.mutateAsync({
        ...(value.notificationGuildId !== (post.notificationGuild?.id ?? '') ? { notificationGuildId: value.notificationGuildId || null } : {}),
        ...(value.partyForumGuildId !== (post.partyForumGuild?.id ?? '') ? { partyForumGuildId: value.partyForumGuildId || null } : {}),
      });
      setSaved(true);
    } catch { /* The mutation error is shown below. */ }
  }
  return <form className="post-discord-settings" onSubmit={(e) => void save(e)}>
    <DiscordDestinationFields
      choices={(destinations.data ?? []).filter((guild) => guild.worldIds.includes(post.world.id))}
      loading={destinations.isPending} failed={destinations.isError} worldId={post.world.id}
      {...value} post={post} lfp={post.type === 'lfp'} disabled={update.isPending}
      onChange={(field, id) => { setSaved(false); update.reset(); setValue((current) => ({ ...current, [field]: id })); }}
    />
    <button type="submit" className="btn btn--secondary" disabled={!changed || update.isPending}>{update.isPending ? 'Saving…' : 'Save Discord destinations'}</button>
    <small>Saving does not send a notification. The Notify Discord cooldown still applies.</small>
    {saved && <p role="status">Discord destinations saved.</p>}
    {update.isError && <p role="alert">{friendlyError(update.error)}</p>}
  </form>;
}
