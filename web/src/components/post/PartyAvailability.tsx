import { useEffect, useMemo, useState } from 'react';
import { freeSlotCoverageForViewer } from '@pf/shared';
import type { PartyMemberDTO, PostSummaryDTO } from '@pf/shared';
import { useMemberAvailability } from '../../api/postHooks';
import { friendlyError } from '../../api/errors';
import { browserTimeZone } from '../../lib/timeZone';
import { FreeTimeGrid } from './FreeTimeGrid';
import type { AvailabilityLayer } from './FreeTimeGrid';
import './PartyAvailability.css';

const COLORS = ['#9d8cff', '#38bdf8', '#fbbf24', '#f472b6', '#34d399', '#fb923c'];
const referenceWeek = (now: Date) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay());

interface Props {
  post: PostSummaryDTO;
  members: PartyMemberDTO[];
  allowEdit?: boolean;
  labelledBy?: string;
}

export function PartyAvailability({ post, members, allowEdit = false, labelledBy }: Props) {
  const viewerZone = browserTimeZone();
  const save = useMemberAvailability(post.id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<number[]>([]);
  const [week, setWeek] = useState(() => referenceWeek(new Date()));
  useEffect(() => {
    const timer = window.setInterval(() => setWeek(referenceWeek(new Date())), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const canEdit = allowEdit && !post.deleted && (post.status !== 'closed' || !!post.recruitmentClosed);
  const editing = canEdit ? members.find((m) => m.id === editingId && m.isMine) : undefined;
  const zone = editing ? (editing.role === 'poster' ? post.freeTimesZone : editing.freeTimesZone) ?? viewerZone : viewerZone;
  const baseParticipants = useMemo<AvailabilityLayer[]>(() => {
    const now = new Date(week);
    return members.map((m, index) => {
      const times = m.role === 'poster' ? post.freeTimes : m.freeTimes;
      const fromZone = m.role === 'poster' ? post.freeTimesZone : m.freeTimesZone;
      const coverage = fromZone ? freeSlotCoverageForViewer(times, fromZone, zone, now) : new Map<number, number>();
      const name = m.character?.ign ?? m.snapshot.ign;
      const displayName = m.character?.owner.displayName;
      return { id: m.id, label: displayName ? `${name} (${displayName})` : name, color: COLORS[index % COLORS.length], slots: [...coverage.keys()], coverage };
    });
  }, [members, post.freeTimes, post.freeTimesZone, zone, week]);
  const participants = baseParticipants.map((person) => person.id === editing?.id
    ? { ...person, slots: draft, coverage: new Map(draft.map((slot) => [slot, 3])) }
    : person);
  const union = [...new Set(participants.flatMap((p) => p.slots))].sort((a, b) => a - b);
  const showGrid = union.length > 0 || !!editing;
  const hasSavedTimes = members.some((m) => (m.role === 'poster' ? post.freeTimes : m.freeTimes).length > 0);

  function edit(member: PartyMemberDTO) {
    save.reset();
    setDraft(member.role === 'poster' ? post.freeTimes : member.freeTimes);
    setEditingId(member.id);
  }

  return (
    <div className="party-availability">
      <ul className="party-availability__legend" aria-label="Availability legend">
        {participants.map((person) => {
          const member = members.find((m) => m.id === person.id)!;
          return (
            <li key={person.id}>
              <span className="party-availability__swatch" style={{ background: person.color }} aria-hidden="true" />
              <span>{person.label}</span>
              {person.slots.length === 0 && <small>{(member.role === 'poster' ? post.freeTimes : member.freeTimes).length ? 'No available times this week' : 'No times selected'}</small>}
              {canEdit && member.isMine && !editing && (
                <button type="button" className="btn btn--secondary btn--compact" aria-label={`Edit availability for ${person.label}`} onClick={() => edit(member)}>Edit my times</button>
              )}
            </li>
          );
        })}
      </ul>
      {editing && <p className="party-availability__editing">Editing {participants.find((p) => p.id === editing.id)?.label}. Click or drag across the times you are free.</p>}
      {showGrid ? (
        <>
          <FreeTimeGrid value={editing ? draft : union} participants={participants} onChange={editing ? setDraft : undefined}
            readOnly={!editing || save.isPending} label="Free times" labelledBy={labelledBy} />
          <p className="when-section__caption">Shown in {zone === viewerZone ? 'your time zone' : 'your saved time zone'} ({zone})</p>
          {participants.length > 1 && <p className="party-availability__hint">Stripes show overlap and the number shows how many people are free. A white outline means everyone is free for the full half hour. A split cell shows partial availability. Point to a cell to see who is free.</p>}
        </>
      ) : <p>{hasSavedTimes ? 'No availability in this reference week.' : 'Flexible'}</p>}
      {save.isError && <p role="alert">{friendlyError(save.error)}</p>}
      {editing && (
        <div className="actions">
          <button type="button" className="btn btn--primary" disabled={save.isPending} onClick={() => save.mutate({
            memberId: editing.id, freeTimes: draft, freeTimesZone: draft.length ? zone : null,
          }, { onSuccess: () => setEditingId(null) })}>{save.isPending ? 'Saving…' : 'Save availability'}</button>
          <button type="button" className="btn btn--secondary" disabled={save.isPending} onClick={() => { setEditingId(null); save.reset(); }}>Cancel</button>
        </div>
      )}
    </div>
  );
}
