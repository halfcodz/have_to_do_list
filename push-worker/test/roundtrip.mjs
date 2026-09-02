/* RFC 8291 aes128gcm 암복호화 왕복 검증 + VAPID JWT 형식 검증.
 * 실제 푸시 서비스 없이 worker.js 의 암호화 로직이 규격에 맞는지 확인한다.
 * 실행: node test/roundtrip.mjs
 */
import { webcrypto as crypto } from "node:crypto";

// ---- worker.js 에서 쓰는 것과 동일한 헬퍼들 (복제) ----
function b64urlToBytes(s){ s=s.replace(/-/g,"+").replace(/_/g,"/"); s+="=".repeat((4-(s.length%4))%4);
  const bin=atob(s); const o=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)o[i]=bin.charCodeAt(i); return o; }
function bytesToB64url(bytes){ let bin=""; const b=new Uint8Array(bytes);
  for(let i=0;i<b.length;i++)bin+=String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function concat(...arrs){ let len=0; for(const a of arrs)len+=a.length; const out=new Uint8Array(len);
  let o=0; for(const a of arrs){out.set(a,o); o+=a.length;} return out; }
async function hkdf(salt,ikm,info,length){
  const key=await crypto.subtle.importKey("raw",ikm,"HKDF",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"HKDF",hash:"SHA-256",salt,info},key,length*8);
  return new Uint8Array(bits);
}

async function encryptPayload(plaintext, p256dhB64, authB64){
  const uaPublic=b64urlToBytes(p256dhB64);
  const authSecret=b64urlToBytes(authB64);
  const asKeys=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
  const asPublic=new Uint8Array(await crypto.subtle.exportKey("raw",asKeys.publicKey));
  const uaKey=await crypto.subtle.importKey("raw",uaPublic,{name:"ECDH",namedCurve:"P-256"},false,[]);
  const ecdhSecret=new Uint8Array(await crypto.subtle.deriveBits({name:"ECDH",public:uaKey},asKeys.privateKey,256));
  const te=new TextEncoder();
  const keyInfo=concat(te.encode("WebPush: info\0"),uaPublic,asPublic);
  const ikm=await hkdf(authSecret,ecdhSecret,keyInfo,32);
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const cek=await hkdf(salt,ikm,te.encode("Content-Encoding: aes128gcm\0"),16);
  const nonce=await hkdf(salt,ikm,te.encode("Content-Encoding: nonce\0"),12);
  const cekKey=await crypto.subtle.importKey("raw",cek,{name:"AES-GCM"},false,["encrypt"]);
  const record=concat(te.encode(plaintext),new Uint8Array([2]));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:nonce,tagLength:128},cekKey,record));
  const rs=new Uint8Array(4); new DataView(rs.buffer).setUint32(0,4096,false);
  const header=concat(salt,rs,new Uint8Array([asPublic.length]),asPublic);
  return concat(header,ct);
}

// ---- UA(브라우저) 쪽 복호화 구현 (검증용) ----
async function decryptPayload(body, uaPrivKey, uaPublicRaw, authSecret){
  const salt=body.slice(0,16);
  const idlen=body[20];
  const asPublic=body.slice(21,21+idlen);
  const ct=body.slice(21+idlen);
  const asKey=await crypto.subtle.importKey("raw",asPublic,{name:"ECDH",namedCurve:"P-256"},false,[]);
  const ecdhSecret=new Uint8Array(await crypto.subtle.deriveBits({name:"ECDH",public:asKey},uaPrivKey,256));
  const te=new TextEncoder();
  const keyInfo=concat(te.encode("WebPush: info\0"),uaPublicRaw,asPublic);
  const ikm=await hkdf(authSecret,ecdhSecret,keyInfo,32);
  const cek=await hkdf(salt,ikm,te.encode("Content-Encoding: aes128gcm\0"),16);
  const nonce=await hkdf(salt,ikm,te.encode("Content-Encoding: nonce\0"),12);
  const cekKey=await crypto.subtle.importKey("raw",cek,{name:"AES-GCM"},false,["decrypt"]);
  const pt=new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:nonce,tagLength:128},cekKey,ct));
  // strip trailing 0x02 (+ optional zero padding)
  let end=pt.length; while(end>0 && pt[end-1]===0) end--; if(pt[end-1]===2) end--;
  return new TextDecoder().decode(pt.slice(0,end));
}

let pass=0, fail=0;
const ok=(c,m)=>{ c?(pass++,console.log("  ✓ "+m)):(fail++,console.log("  ✗ "+m)); };

// 1) aes128gcm 왕복
{
  const ua=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
  const uaPub=new Uint8Array(await crypto.subtle.exportKey("raw",ua.publicKey));
  const auth=crypto.getRandomValues(new Uint8Array(16));
  const msg=JSON.stringify({title:"「보고서 제출」",body:"마감 10분 전. 했어?",tag:"t-abc",url:"./"});
  const enc=await encryptPayload(msg,bytesToB64url(uaPub),bytesToB64url(auth));
  ok(enc[20]===65,"aes128gcm 헤더의 keyid 길이 = 65");
  ok(enc.length>21+65+16,"암호문 길이가 헤더+태그보다 큼");
  const dec=await decryptPayload(enc,ua.privateKey,uaPub,auth);
  ok(dec===msg,"복호화 결과가 원문과 일치");
}

// 2) VAPID JWT 형식
{
  const kp=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  const jwk=await crypto.subtle.exportKey("jwk",kp.privateKey);
  const signKey=await crypto.subtle.importKey("jwk",{kty:"EC",crv:"P-256",d:jwk.d,x:jwk.x,y:jwk.y,ext:true},
    {name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const enc=(o)=>bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  const head=enc({typ:"JWT",alg:"ES256"});
  const bodyp=enc({aud:"https://fcm.googleapis.com",exp:Math.floor(Date.now()/1000)+43200,sub:"mailto:a@b.c"});
  const si=new TextEncoder().encode(head+"."+bodyp);
  const sig=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},signKey,si);
  ok(new Uint8Array(sig).length===64,"ES256 서명 길이 = 64 (P1363 r||s)");
  const verified=await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},kp.publicKey,sig,si);
  ok(verified,"서명 검증 통과");
  const pub=concat(new Uint8Array([4]),b64urlToBytes(jwk.x),b64urlToBytes(jwk.y));
  ok(pub.length===65 && pub[0]===4,"VAPID 공개키 raw = 0x04||X||Y (65바이트)");
}

console.log(`\n${fail? "FAIL":"OK"}  (${pass} passed, ${fail} failed)`);
process.exit(fail?1:0);
