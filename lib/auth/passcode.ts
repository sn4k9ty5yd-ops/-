import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384;
const KEYLEN = 32;

const scryptAsync = (pw: string, salt: Buffer, n: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(pw, salt, KEYLEN, { N: n }, (err, key) => (err ? reject(err) : resolve(key))),
  );

/** パスコードの形式: 6けたの数字。同じ数字だけ(111111)・連番(123456, 654321)は不可 */
export function validatePasscode(pc: string): string | null {
  if (!/^\d{6}$/.test(pc)) return "パスコードは6けたの数字にしてください";
  if (/^(\d)\1{5}$/.test(pc)) return "同じ数字だけのパスコードは使えません";
  if ("0123456789".includes(pc) || "9876543210".includes(pc)) return "連続した数字のパスコードは使えません";
  return null;
}

/** オフィスが発行する用の、推測されにくい6けた */
export function generatePasscode(): string {
  for (;;) {
    const pc = String(randomInt(0, 1_000_000)).padStart(6, "0");
    if (!validatePasscode(pc)) return pc;
  }
}

export async function hashPasscode(pc: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pc, salt, N);
  return `scrypt$${N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPasscode(pc: string, stored: string): Promise<boolean> {
  const [alg, n, salt, key] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scryptAsync(pc, Buffer.from(salt, "base64"), Number(n));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
