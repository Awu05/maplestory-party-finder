import { useState } from 'react';
import type { FormEvent } from 'react';
import type { PostDetailDTO } from '@pf/shared';
import { useDiscordDestinations, useUpdatePost } from '../../api/postHooks';
import { friendlyError } from '../../api/errors';
import { DiscordDestinationFields } from './DiscordDestinationFields';

export function DiscordDestinationSettings({ post }: { post: PostDetailDTO }) {
  const destinations = useDiscordDestinations();
  const update = useUpdatePost(post.id);
  const stored = { notificationGuildId: post.notificationGuild?.id ?? '', partyForumGuildId: post.partyForumGuild?.id ?? '' };
  const [value, setValue] = useState(stored);
  const [synced, setSynced] = useState(stored);
  const [saved, setSaved] = useState(false);
  // When the saved destinations change (the refetch after saving, or a background refresh), a field
  // takes the new stored value only if the poster hasn't changed it yet: an unsaved choice is kept.
  if (synced.notificationGuildId !== stored.notificationGuildId || synced.partyForumGuildId !== stored.partyForumGuildId) {
    setValue({
      notificationGuildId: value.notificationGuildId === synced.notificationGuildId ? stored.notificationGuildId : value.notificationGuildId,
      partyForumGuildId: value.partyForumGuildId === synced.partyForumGuildId ? stored.partyForumGuildId : value.partyForumGuildId,
    });
    setSynced(stored);
  }
  const changed = value.notificationGuildId !== stored.notificationGuildId || value.partyForumGuildId !== stored.partyForumGuildId;
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
