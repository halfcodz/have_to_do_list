/*  VAPID 키 생성기.  실행:  node genkeys.mjs
 *
 *  출력 1 (VAPID_JWK)      -> `npx wrangler secret put VAPID_JWK` 에 붙여넣기
 *  출력 2 (VAPID_PUBLIC_KEY) -> 앱 index.html 의 VAPID_PUBLIC_KEY 상수에 붙여넣기
 *
 *  Node 18+ 필요.
 */
import { webcrypto as crypto } from "node:crypto";

const kp = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);

const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)); // 65 bytes, 0x04||X||Y

const b64url = (buf) => Buffer.from(buf).toString("base64url");

const secret = JSON.stringify({ kty: "EC", crv: "P-256", d: jwk.d, x: jwk.x, y: jwk.y });

console.log("\n=== VAPID_JWK  (Cloudflare secret) =========================");
console.log("다음 명령에 그대로 붙여넣기:  npx wrangler secret put VAPID_JWK\n");
console.log(secret);
console.log("\n=== VAPID_PUBLIC_KEY  (앱 index.html 에 붙여넣기) ===========\n");
console.log(b64url(rawPub));
console.log("");
