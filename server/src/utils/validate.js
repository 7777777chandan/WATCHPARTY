/**
 * Payload validators. Each returns { ok: true, value } or { ok: false, error }.
 * Handlers never touch raw payload fields without going through one of these.
 */
import { config } from '../config.js';

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;

export const ok = (value) => ({ ok: true, value });
export const fail = (error) => ({ ok: false, error });

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function stripControl(s) {
  return s.replace(CONTROL_CHARS, '');
}

/** Trimmed single-line text with length bounds. */
export function validateText(v, { min = 1, max, field = 'text', multiline = false }) {
  if (typeof v !== 'string') return fail(`${field} must be a string`);
  if (v.length > max * 4) return fail(`${field} is too long`);
  let s = stripControl(v);
  if (!multiline) s = s.replace(/[\r\n\t]+/g, ' ');
  s = s.trim();
  if (s.length < min) return fail(min === 1 ? `${field} cannot be empty` : `${field} is too short`);
  if (s.length > max) return fail(`${field} must be at most ${max} characters`);
  return ok(s);
}

export const validateName = (v) => validateText(v, { min: 1, max: 24, field: 'Name' });

export function validateCode(v) {
  if (typeof v !== 'string') return fail('Room code must be a string');
  const code = v.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return fail('Room code must be 6 letters or digits');
  return ok(code);
}

export function validateUserId(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(v)) return fail('Invalid userId');
  return ok(v);
}

export function validateId(v, field = 'id') {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) return fail(`Invalid ${field}`);
  return ok(v);
}

export function validatePosition(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail('position must be a finite number');
  if (v < 0) return fail('position must be >= 0');
  if (v > config.MAX_POSITION_SEC) return fail('position is too large');
  return ok(v);
}

export function validateInt(v, { min, max, field }) {
  if (typeof v !== 'number' || !Number.isInteger(v)) return fail(`${field} must be an integer`);
  if (v < min || v > max) return fail(`${field} must be between ${min} and ${max}`);
  return ok(v);
}

export function validateVideoId(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(v)) return fail('Invalid YouTube video id');
  return ok(v);
}

export function validateBoolean(v, field) {
  if (typeof v !== 'boolean') return fail(`${field} must be true or false`);
  return ok(v);
}
