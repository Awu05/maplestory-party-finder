import { ApiError } from '../src/api/client';
import { friendlyError } from '../src/api/errors';

describe('friendlyError', () => {
  it.each([
    ['UNAUTHENTICATED', 'Your session expired — log in again.'],
    ['BANNED', 'Your account has been banned. Contact the admin.'],
    ['FORBIDDEN', "You don't have permission to do that."],
    ['NOT_OWNER', "You don't own this character."],
    ['GUILD_INACTIVE', "That guild isn't accepting characters right now."],
    ['WORLD_INACTIVE', "That world isn't active right now."],
    ['WRONG_WORLD', "That character isn't on this post's world."],
    ['POST_FULL', 'This party is already full.'],
    ['POST_CLOSED', 'This post is closed.'],
  ])('%s has a friendly message', (code, message) => {
    expect(friendlyError(new ApiError(400, code, 'server text'))).toBe(message);
  });

  it('falls back to the server message for unknown codes', () => {
    expect(friendlyError(new ApiError(400, 'SOMETHING_ELSE', 'server text'))).toBe('server text');
  });
});
