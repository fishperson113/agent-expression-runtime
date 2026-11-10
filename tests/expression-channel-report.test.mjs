import { expect, it } from 'vitest';
import { classifyTrial, summarizeTrials, shouldStopTrial } from '../scripts/expression-channel-trial.mjs';
it('does not treat a recorded failed Native turn as a successful trial', () => {
  const rows = ['structured', 'optional'].map(arm => ({ ...classifyTrial(arm, { status: 'failed' }, { dispatch: 'dropped' }), evidenceRecorded: true, reserved: true }));
  expect(rows.every(r => r.status === 'failed' && !r.modelCompleted)).toBe(true);
  expect(summarizeTrials(rows, 2)).toMatchObject({ recorded: 2, successful: 0, failed: 2, collectionComplete: true, complete: false, actualModelTurnsReserved: 2 });
});
it('separates collection, host admission and model completion from utility', () => {
  expect(classifyTrial('structured', { status: 'completed' }, { dispatch: 'dropped' })).toMatchObject({ status: 'failed', failureStage: 'response', modelCompleted: true });
  for (const dispatch of ['retained', 'suppressed', 'accepted', 'pending']) expect(classifyTrial('structured', { status: 'completed' }, { dispatch }).status).toBe('recorded');
  expect(summarizeTrials([{ status: 'recorded', evidenceRecorded: true, reserved: true }], 2)).toMatchObject({ complete: false, collectionComplete: false, humanAcceptance: 'pending' });
});

it('stops known schema rejection from terminal, RPC or error notification before another trial', () => {
  const error = { message: 'HTTP 400', data: { code: 'invalid_json_schema' } };
  for (const row of [{ turn: { error } }, { rpcError: error }, { turn: { errors: [{ error }] } }]) expect(shouldStopTrial(row)).toBe(true);
  expect(shouldStopTrial({ turn: { messages: [{ text: 'invalid_json_schema' }] } })).toBe(false);
  expect(shouldStopTrial({ rpcError: { truncated: true } })).toBe(true);
});
