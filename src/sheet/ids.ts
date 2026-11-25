const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Random lowercase base36 string. 256 % 36 != 0, so reject bytes >= 252 to stay unbiased. */
export function randomId(len: number): string {
  let out = ''
  const buf = new Uint8Array(len * 2)
  while (out.length < len) {
    crypto.getRandomValues(buf)
    for (const b of buf) {
      if (b < 252) out += ALPHABET[b % 36]
      if (out.length === len) break
    }
  }
  return out
}

/** Block id: "b_" + 10 base36 chars (matches ^b_[a-z0-9]{6,32}$). */
export const newBlockId = () => `b_${randomId(10)}`
/** Section id: "s_" + 8 base36 chars (matches ^s_[a-z0-9_]{3,32}$). */
export const newSectionId = () => `s_${randomId(8)}`
