/* 좋됨감지앱 푸시 서버 (Cloudflare Worker + Durable Object)
 *
 * 앱이 /sync 로 { subscription, reminders:[{fireAt,title,body,tag}] } 를 보낸다.
 * Durable Object가 예약을 저장하고 setAlarm으로 정확한 시각에 깨어나
 * Web Push(RFC 8291 aes128gcm + RFC 8292 VAPID)를 직접 만들어 발송한다.
 * 외부 의존성 없음 — `wrangler deploy` 한 방.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(req, env) {
    return env.HUB.get(env.HUB.idFromName("hub")).fetch(req);
  },
  async scheduled(_evt, env) {
    await env.HUB.get(env.HUB.idFromName("hub")).fetch(new Request("https://hub/tick"));
  },
};

export class Hub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (url.pathname === "/tick") {
      await this.deliver();
      return new Response("ok");
    }

    // 즉시 테스트 푸시 1건
    if (url.pathname === "/test" && req.method === "POST") {
      let p;
      try { p = await req.json(); } catch { return json({ error: "bad json" }, 400); }
      const sub = p && p.subscription;
      if (!sub || !sub.endpoint || !sub.keys) return json({ error: "bad subscription" }, 400);
      let status = 0, err = null;
      try {
        status = await sendPush(sub, JSON.stringify({
          title: "좋됨감지앱", body: "테스트 알림이야. 이게 보이면 성공.", tag: "jotdoem-test", url: "./",
        }), this.env);
      } catch (e) { err = String(e && e.message || e); }
      return json({ status, err });
    }

    // 저장 상태 확인
    if (url.pathname === "/debug") {
      const subs = await this.state.storage.list({ prefix: "sub:" });
      const scheds = await this.state.storage.list({ prefix: "sched:" });
      let pending = 0, soonest = null;
      for (const arr of scheds.values()) {
        for (const r of arr) {
          if (!r.sent) { pending++; if (soonest === null || r.fireAt < soonest) soonest = r.fireAt; }
        }
      }
      return json({
        subscriptions: subs.size,
        schedules: scheds.size,
        pendingReminders: pending,
        soonestFireAt: soonest,
        nextAlarm: await this.state.storage.getAlarm(),
        now: Date.now(),
      });
    }

    if (url.pathname === "/sync" && req.method === "POST") {
      let payload;
      try { payload = await req.json(); } catch { return json({ error: "bad json" }, 400); }
      const sub = payload && payload.subscription;
      if (!sub || !sub.endpoint || !sub.keys) return json({ error: "bad subscription" }, 400);

      const hash = await sha256hex(sub.endpoint);
      const now = Date.now();
      const reminders = (Array.isArray(payload.reminders) ? payload.reminders : [])
        .filter(r => r && typeof r.fireAt === "number" && r.fireAt > now - 3600_000)
        .map(r => ({
          fireAt: r.fireAt,
          title: String(r.title || "좋됨감지앱").slice(0, 120),
          body: String(r.body || "").slice(0, 200),
          tag: String(r.tag || "jotdoem").slice(0, 80),
          sent: false,
        }))
        .sort((a, b) => a.fireAt - b.fireAt)
        .slice(0, 80);

      await this.state.storage.put("sub:" + hash, sub);
      await this.state.storage.put("sched:" + hash, reminders);
      await this.reschedule();
      return json({ ok: true, scheduled: reminders.length });
    }

    return new Response("jotdoem push", { headers: CORS });
  }

  async alarm() {
    await this.deliver();
  }

  async reschedule() {
    const now = Date.now();
    let next = null;
    const scheds = await this.state.storage.list({ prefix: "sched:" });
    for (const arr of scheds.values()) {
      for (const r of arr) {
        if (!r.sent && r.fireAt > now && (next === null || r.fireAt < next)) next = r.fireAt;
      }
    }
    if (next !== null) await this.state.storage.setAlarm(next);
  }

  async deliver() {
    const now = Date.now();
    const scheds = await this.state.storage.list({ prefix: "sched:" });

    for (const [key, arr] of scheds) {
      const hash = key.slice("sched:".length);
      const sub = await this.state.storage.get("sub:" + hash);
      let changed = false;
      let dead = false;

      if (sub) {
        for (const r of arr) {
          if (r.sent) continue;
          if (r.fireAt > now) continue;
          if (r.fireAt <= now - 3600_000) { r.sent = true; changed = true; continue; } // 너무 오래된 건 스킵
          let status = 0;
          try {
            status = await sendPush(sub, JSON.stringify({
              title: r.title, body: r.body, tag: r.tag, url: "./",
            }), this.env);
          } catch { status = 0; }
          r.sent = true;
          changed = true;
          if (status === 404 || status === 410) { dead = true; break; }
        }
      }

      if (dead || !sub) {
        await this.state.storage.delete("sub:" + hash);
        await this.state.storage.delete("sched:" + hash);
      } else {
        const keep = arr.filter(r => !r.sent || r.fireAt > now - 7200_000);
        if (changed || keep.length !== arr.length) {
          if (keep.length) await this.state.storage.put("sched:" + hash, keep);
          else await this.state.storage.delete("sched:" + hash);
        }
      }
    }

    await this.reschedule();
  }
}

/* ------------------------------------------------------------------ helpers */

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  s += "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes) {
  let bin = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...arrs) {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
async function sha256hex(str) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

/* VAPID keys cached on the isolate */
let _vapid = null;
async function getVapid(env) {
  if (_vapid) return _vapid;
  if (!env.VAPID_JWK) throw new Error("VAPID_JWK secret 미설정 — `npx wrangler secret put VAPID_JWK` 실행 필요");
  const jwk = JSON.parse(env.VAPID_JWK);
  const signKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: jwk.d, x: jwk.x, y: jwk.y, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const pub = concat(new Uint8Array([4]), b64urlToBytes(jwk.x), b64urlToBytes(jwk.y)); // 65 bytes
  _vapid = { signKey, pubB64url: bytesToB64url(pub), subject: env.VAPID_SUBJECT || "mailto:jotdoem@example.com" };
  return _vapid;
}

async function vapidHeader(endpoint, env) {
  const { signKey, pubB64url, subject } = await getVapid(env);
  const aud = new URL(endpoint).origin;
  const enc = (o) => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ typ: "JWT", alg: "ES256" });
  const body = enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject });
  const signingInput = new TextEncoder().encode(head + "." + body);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signKey, signingInput);
  const jwt = head + "." + body + "." + bytesToB64url(sig);
  return `vapid t=${jwt}, k=${pubB64url}`;
}

/* RFC 8291 aes128gcm payload encryption */
async function encryptPayload(plaintext, p256dhB64, authB64) {
  const uaPublic = b64urlToBytes(p256dhB64); // 65
  const authSecret = b64urlToBytes(authB64); // 16

  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey)); // 65

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256)
  ); // 32

  const te = new TextEncoder();
  const keyInfo = concat(te.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);

  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const record = concat(te.encode(plaintext), new Uint8Array([2])); // 0x02 = last record delimiter
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, cekKey, record)
  );

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  const header = concat(salt, rs, new Uint8Array([asPublic.length]), asPublic);
  return concat(header, ct);
}

async function sendPush(sub, payloadJson, env) {
  const body = await encryptPayload(payloadJson, sub.keys.p256dh, sub.keys.auth);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "TTL": "3600",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "Urgency": "high",
      "Authorization": await vapidHeader(sub.endpoint, env),
    },
    body,
  });
  return res.status;
}
