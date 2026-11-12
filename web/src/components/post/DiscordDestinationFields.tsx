import type { DiscordDestinationDTO, PostDetailDTO } from '@pf/shared';

/** While destinations load, the select keeps its value but does not claim it is None. */
const loadingOption = (value: string) => <option value={value}>Loading Discord destinations…</option>;

export function DiscordDestinationFields({ choices, loading, failed, worldId, notificationGuildId, partyForumGuildId, post, lfp, disabled, onChange }: {
  choices: DiscordDestinationDTO[]; loading: boolean; failed: boolean; worldId?: number;
  notificationGuildId: string; partyForumGuildId: string; post?: PostDetailDTO; lfp: boolean; disabled?: boolean;
  onChange: (field: 'notificationGuildId' | 'partyForumGuildId', id: string) => void;
}) {
  const notifications = choices.filter((guild) => guild.notifications);
  const forums = choices.filter((guild) => guild.partyForum);
  return <section className="post-discord" aria-label="Discord destinations">
    <h3>Discord</h3>
    <label>
      Notification guild
      <select value={notificationGuildId} disabled={disabled || loading || !worldId} onChange={(e) => onChange('notificationGuildId', e.target.value)}>
        {loading ? loadingOption(notificationGuildId) : <>
          <option value="">None — no Discord notifications</option>
          {notificationGuildId && !notifications.some((guild) => guild.id === notificationGuildId) && <option value={notificationGuildId}>Unavailable — {post?.notificationGuild?.name ?? 'choose another guild'}</option>}
          {notifications.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
        </>}
      </select>
    </label>
    <small>Post announcements, party notifications and weekly reminders go to this guild’s boss notification channel.</small>
    {!lfp && <>
      <label>
        Party chat guild
        <select value={partyForumGuildId} disabled={disabled || loading || !worldId || !!post?.partyChatRequested} onChange={(e) => onChange('partyForumGuildId', e.target.value)}>
          {loading ? loadingOption(partyForumGuildId) : <>
            <option value="">None — do not create a party chat</option>
            {partyForumGuildId && !forums.some((guild) => guild.id === partyForumGuildId) && <option value={partyForumGuildId}>Unavailable — {post?.partyForumGuild?.name ?? 'choose another guild'}</option>}
            {forums.map((guild) => <option key={guild.id} value={guild.id}>{guild.name} — party forum</option>)}
          </>}
        </select>
      </label>
      <small>{post?.partyChatRequested ? 'A party chat has already been requested and cannot be moved.' : 'Finalizing the time creates one thread in this guild’s configured party forum. You do not need to belong to the guild.'}</small>
    </>}
    {failed && <p role="alert">Couldn’t load Discord destinations. Try refreshing before selecting a guild.</p>}
    {!loading && !failed && worldId && choices.length === 0 && <small>No Discord destinations are configured for this world.</small>}
  </section>;
}
