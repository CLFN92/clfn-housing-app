// Minimal ES256 (ECDSA P-256) JWS sign/verify + keygen via Web Crypto, shared by
// the support-login trust chain:
//   gen-support-key (platform)  -> generateEs256()  makes a per-nation keypair
//   enter-nation    (platform)  -> signEs256()      signs a 2-min entry token
//   support-login   (nation)    -> verifyEs256()    verifies with the public key
//
// The private key lives ONLY in the control-plane DB; each nation holds ONLY its
// public key. A stolen public key cannot forge a token. Source ASCII-only.

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): Uint8Array {
  let t = s.replace(/-/g, '+').replace(/_/g, '/')
  while (t.length % 4) t += '='
  const bin = atob(t)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
const ENC = new TextEncoder()
const DEC = new TextDecoder()
const EC_PARAMS = { name: 'ECDSA', namedCurve: 'P-256' } as EcKeyImportParams
const SIG_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as EcdsaParams

// Generate a fresh keypair. Returns JWKs; the public JWK has no private field.
export async function generateEs256(): Promise<{ privateJwk: any; publicJwk: any }> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
  const publicJwk = await crypto.subtle.exportKey('jwk', kp.publicKey)
  delete (publicJwk as any).d      // ensure no private scalar rides along
  ;(publicJwk as any).key_ops = ['verify']
  return { privateJwk, publicJwk }
}

// Sign a JSON payload as a compact JWS (ES256). Caller sets iat/exp/etc.
export async function signEs256(payload: Record<string, unknown>, privateJwk: any): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', privateJwk, EC_PARAMS, false, ['sign'])
  const header = { alg: 'ES256', typ: 'JWT' }
  const signingInput = b64urlEncode(ENC.encode(JSON.stringify(header))) + '.' + b64urlEncode(ENC.encode(JSON.stringify(payload)))
  const sig = new Uint8Array(await crypto.subtle.sign(SIG_PARAMS, key, ENC.encode(signingInput)))
  return signingInput + '.' + b64urlEncode(sig)
}

// Verify a compact JWS and return its payload, or null (bad signature / expired /
// malformed). Enforces exp and nbf when present.
export async function verifyEs256(token: string, publicJwk: any): Promise<Record<string, any> | null> {
  try {
    const parts = String(token || '').split('.')
    if (parts.length !== 3) return null
    const key = await crypto.subtle.importKey('jwk', publicJwk, EC_PARAMS, false, ['verify'])
    const signingInput = parts[0] + '.' + parts[1]
    const ok = await crypto.subtle.verify(SIG_PARAMS, key, b64urlDecode(parts[2]), ENC.encode(signingInput))
    if (!ok) return null
    const payload = JSON.parse(DEC.decode(b64urlDecode(parts[1])))
    const now = Math.floor(Date.now() / 1000)
    if (typeof payload.exp === 'number' && now > payload.exp) return null
    if (typeof payload.nbf === 'number' && now < payload.nbf) return null
    return payload
  } catch (_e) { return null }
}
