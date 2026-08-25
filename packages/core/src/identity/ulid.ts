import { randomBytes } from 'node:crypto';

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = 0;
const lastRandom: number[] = new Array(16).fill(0);

export function generateUlid(seedTime: number = Date.now()): string {
  let time = seedTime;
  if (time <= lastTime) {
    time = lastTime;
    // Increment last random for strict monotonicity within same millisecond
    for (let i = 15; i >= 0; i--) {
      if (lastRandom[i] < 31) {
        lastRandom[i]++;
        break;
      }
      lastRandom[i] = 0;
    }
  } else {
    lastTime = time;
    const buf = randomBytes(16);
    for (let i = 0; i < 16; i++) {
      lastRandom[i] = buf[i] % 32;
    }
  }

  // 10 chars for 48-bit timestamp
  let timeStr = '';
  for (let i = 9; i >= 0; i--) {
    timeStr = ENCODING[time % 32] + timeStr;
    time = Math.floor(time / 32);
  }

  // 16 chars for 80-bit randomness
  let randStr = '';
  for (let i = 0; i < 16; i++) {
    randStr += ENCODING[lastRandom[i]];
  }

  return timeStr + randStr;
}
