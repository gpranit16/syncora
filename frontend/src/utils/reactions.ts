// Default quick picks shown in the picker. Users can also send ANY custom emoji.
export const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '🚀', '👀', '🎉'];
export const MAX_REACTION_LENGTH = 32;

// Light client-side gate so the picker input only submits emoji-like text.
// The backend re-validates authoritatively.
export const isValidReactionEmoji = (emoji: string): boolean => {
  const trimmed = emoji.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_REACTION_LENGTH) return false;
  return [...trimmed].some((ch) => ch.codePointAt(0) > 0x7f);
};

export interface ReactionSummary {
  emoji: string;
  count: number;
}

export interface ReactionState {
  message_id: number;
  direct_message_id?: number;
  emoji: string;
  added: boolean;
  reactions: ReactionSummary[];
  my_reactions: string[];
}

export interface ReactionTarget {
  reactions?: ReactionSummary[];
  my_reactions?: string[];
}

export interface ReactionDelta {
  emoji: string;
  user_id: number;
}

/**
 * Pure helper: applies a reaction add/remove delta to a message's reaction
 * state. Used for optimistic updates and realtime socket events so counts
 * stay consistent without a refetch. When `ownUserId` is provided and matches
 * the event's user, the current user's own reaction list is kept in sync too.
 */
export const applyReactionDelta = <T extends ReactionTarget>(
  message: T,
  delta: ReactionDelta,
  added: boolean,
  ownUserId?: number
): T => {
  const reactions = [...(message.reactions ?? [])];
  const index = reactions.findIndex((r) => r.emoji === delta.emoji);

  if (added) {
    if (index >= 0) {
      reactions[index] = { ...reactions[index], count: reactions[index].count + 1 };
    } else {
      reactions.push({ emoji: delta.emoji, count: 1 });
    }
  } else if (index >= 0) {
    const count = reactions[index].count - 1;
    if (count <= 0) {
      reactions.splice(index, 1);
    } else {
      reactions[index] = { ...reactions[index], count };
    }
  }

  const isOwn = ownUserId !== undefined && Number(delta.user_id) === Number(ownUserId);
  let myReactions = message.my_reactions ?? [];
  if (isOwn) {
    const mine = new Set(myReactions);
    if (added) {
      mine.add(delta.emoji);
    } else {
      mine.delete(delta.emoji);
    }
    myReactions = Array.from(mine);
  }

  return { ...message, reactions, my_reactions: myReactions };
};
