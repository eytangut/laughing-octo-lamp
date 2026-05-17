import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseModelTierList,
  isFallbackWorthyError,
  scheduleFlashcard,
  safeParsePuzzles,
} from '../core.js';

test('parseModelTierList supports lines/commas and removes duplicates', () => {
  const models = parseModelTierList('gemini-pro, gemini-flash\ngemini-pro');
  assert.deepEqual(models, ['gemini-pro', 'gemini-flash']);
});

test('isFallbackWorthyError catches quota/rate errors', () => {
  assert.equal(isFallbackWorthyError(429, 'quota exceeded'), true);
  assert.equal(isFallbackWorthyError(400, 'bad request'), false);
});

test('scheduleFlashcard increases interval by quality', () => {
  const card = { intervalDays: 2 };
  assert.equal(scheduleFlashcard(card, 'good').intervalDays, 4);
  assert.equal(scheduleFlashcard(card, 'again').intervalDays, 1);
});

test('safeParsePuzzles validates array payload', () => {
  const valid = safeParsePuzzles(JSON.stringify([{ id: '1', question: 'Q', explanation: 'E' }]));
  assert.equal(valid.length, 1);
  assert.throws(() => safeParsePuzzles('{}'));
});
