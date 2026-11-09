export type PostClosedReason = 'manual' | 'full' | 'lfp_matched' | 'character_deleted' | 'deleted' | 'banned';

export type DomainEvent =
  | { type: 'post.created'; postId: string }
  | { type: 'post.updated'; postId: string }
  | { type: 'post.closed'; postId: string; reason: PostClosedReason }
  | { type: 'post.reopened'; postId: string }
  | { type: 'request.created'; requestId: string }
  | { type: 'request.accepted'; requestId: string }
  /** actorUserId: the user whose action caused the decline (never notified about it); null if no acting user. */
  | { type: 'request.declined'; requestId: string; auto: boolean; actorUserId: string | null }
  | { type: 'request.cancelled'; requestId: string }
  | { type: 'member.left'; postId: string; memberId: string; userId: string; ign: string; removedBy: 'self' | 'poster' };

export interface DomainEvents {
  emit(event: DomainEvent): void;
}

export class NoopEvents implements DomainEvents {
  emit(): void {}
}
