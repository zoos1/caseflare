/**
 * CaseFlare Authentication Library
 * HMAC-SHA256 signed session cookies using Web Crypto API (Workers-compatible)
 */

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function toBase64Url(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64: string): string {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function getKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Sign a payload into a cookie value.
 * Format: {base64url_payload}.{hex_hmac}
 */
export async function signToken(payload: object, secret: string): Promise<string> {
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = toBase64Url(payloadStr);
  const key = await getKey(secret);
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  const signatureHex = toHex(signature);
  return `${payloadB64}.${signatureHex}`;
}

/**
 * Verify and decode a cookie value. Returns parsed payload or null.
 * Checks HMAC signature and expiry (payload.exp vs Date.now()).
 */
export async function verifyToken(token: string, secret: string): Promise<any | null> {
  try {
    const dotIndex = token.indexOf('.');
    if (dotIndex === -1) return null;

    const payloadB64 = token.substring(0, dotIndex);
    const signatureHex = token.substring(dotIndex + 1);

    const key = await getKey(secret);
    const encoder = new TextEncoder();
    const signatureBytes = fromHex(signatureHex);

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      encoder.encode(payloadB64)
    );

    if (!valid) return null;

    const payloadStr = fromBase64Url(payloadB64);
    const payload = JSON.parse(payloadStr);

    // Check expiry
    if (payload.exp && payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Create a Set-Cookie header string.
 */
export function createSessionCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

/**
 * Clear a cookie by setting it expired.
 */
export function clearCookie(name: string): string {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
