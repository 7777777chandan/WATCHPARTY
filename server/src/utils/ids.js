import { customAlphabet, nanoid } from 'nanoid';

// No 0/O or 1/I so codes can be read aloud and typed from a phone.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const generateRoomCode = customAlphabet(ROOM_CODE_ALPHABET, 6);
export const newId = (size = 10) => nanoid(size);
