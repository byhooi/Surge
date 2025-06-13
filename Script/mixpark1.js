[Script]
# 自动签到脚本 - woxshare.com
# 创建时间: 2025-06-13
# 作者: Cline (AI助手)

# MD5 算法实现 (用于请求头 mkey)
const md5 = (input) => {
  function r(n, e) {
    var r = (65535 & n) + (65535 & e);
    return (n >> 16) + (e >> 16) + (r >> 16) << 16 | 65535 & r
  }

  function t(n, e, t, o, u, f) {
    return r((c = r(r(e, n), r(o, f))) << (i = u) | c >>> 32 - i, t);
    var c, i
  }

  function o(n, e, r, o, u, f, c) {
    return t(e & r | ~e & o, n, e, u, f, c)
  }

  function u(n, e, r, o, u, f, c) {
    return t(e & o | r & ~o, n, e, u, f, c)
  }

  function f(n, e, r, o, u, f, c) {
    return t(e ^ r ^ o, n, e, u, f, c)
  }

  function c(n, e, r, o, u, f, c) {
    return t(r ^ (e | ~o), n, e, u, f, c)
  }

  function i(n, e) {
    var t, i, a, d, h;
    n[e >> 5] |= 128 << e % 32, n[14 + (e + 64 >>> 9 << 4)] = e;
    var l = 1732584193,
      v = -271733879,
      g = -1732584194,
      m = 271733878;
    for (t = 0; t < n.length; t += 16) i = l, a = v, d = g, h = m, l = o(l, v, g, m, n[t], 7, -680876936), m = o(m, l, v, g, n[t + 1], 12, -389564586), g = o(g, m, l, v, n[t + 2], 17, 606105819), v = o(v, g, m, l, n[t + 3], 22, -1044525330), l = o(l, v, g, m, n[t + 4], 7, -176418897), m = o(m, l, v, g, n[t + 5], 12, 1200080426), g = o(g, m, l, v, n[t + 6], 17, -1473231341), v = o(v, g, m, l, n[t + 7], 22, -45705983), l = o(l, v, g, m, n[t + 8], 7, 1770035416), m = o(m, l, v, g, n[t + 9], 12, -1958414417), g = o(g, m, l, v, n[t + 10], 17, -42063), v = o(v, g, m, l, n[t + 11], 22, -1990404162), l = o(l, v, g, m, n[t + 12], 7, 1804603682), m = o(m, l, v, g, n[t + 13], 12, -40341101), g = o(g, m, l, v, n[t + 14], 17, -1502002290), l = u(l, v = o(v, g, m, l, n[t + 15], 22, 1236535329), g, m, n[t + 1], 5, -165796510), m = u(m, l, v, g, n[t + 6], 9, -1069501632), g = u(g, m, l, v, n[t + 11], 14, 643717713), v = u(v, g, m, l, n[t], 20, -373897302), l = u(l, v, g, m, n[t + 5], 5, -701558691), m = u(m, l, v, g, n[t + 10], 9, 38016083), g = u(g, m, l, v, n[t + 15], 14, -660478335), v = u(v, g, m, l, n[t + 4], 20, -405537848), l = u(l, v, g, m, n[t + 9], 5, 568446438), m = u(m, l, v, g, n[t + 14], 9, -1019803690), g = u(g, m, l, v, n[t + 3], 14, -187363961), v = u(v, g, m, l, n[t + 8], 20, 1163531501), l = u(l, v, g, m, n[t + 13], 5, -1444681467), m = u(m, l, v, g, n[t + 2], 9, -51403784), g = u(g, m, l, v, n[t + 7], 14, 1735328473), l = f(l, v = u(v, g, m, l, n[t + 12], 20, -1926607734), g, m, n[t + 5], 4, -378558), m = f(m, l, v, g, n[t + 8], 11, -2022574463), g = f(g, m, l, v, n[t + 11], 16, 1839030562), v = f(v, g, m, l, n[t + 14], 23, -35309556), l = f(l, v, g, m, n[t + 1], 4, -1530992060), m = f(m, l, v, g, n[t + 4], 11, 1272893353), g = f(g, m, l, v, n[t + 7], 16, -155497632), v = f(v, g, m, l, n[t + 10], 23, -1094730640), l = f(l, v, g, m, n[t + 13], 4, 681279174), m = f(m, l, v, g, n[t], 11, -358537222), g = f(g, m, l, v, n[t + 3], 16, -722521979), v = f(v, g, m, l, n[t + 6], 23, 76029189), l = f(l, v, g, m, n[t + 9], 4, -640364487), m = f(m, l, v, g, n[t + 12], 11, -421815835), g = f(g, m, l, v, n[t + 15], 16, 530742520), l = c(l, v = f(v, g, m, l, n[t + 2], 23, -995338651), g, m, n[t], 6, -198630844), m = c(m, l, v, g, n[t + 7], 10, 1126891415), g = c(g, m, l, v, n[t + 14], 15, -1416354905), v = c(v, g, m, l, n[t + 5], 21, -57434055), l = c(l, v, g, m, n[t + 12], 6, 1700485571), m = c(m, l, v, g, n[t + 3], 10, -1894986606), g = c(g, m, l, v, n[t + 10], 15, -1051523), v = c(v, g, m, l, n[t + 1], 21, -2054922799), l = c(l, v, g, m, n[t + 8], 6, 1873313359), m = c(m, l, v, g, n[t + 15], 10, -30611744), g = c(g, m, l, v, n[t + 6], 15, -1560198380), v = c(v, g, m, l, n[t + 13], 21, 1309151649), l = c(l, v, g, m, n[t + 4], 6, -145523070), m = c(m, l, v, g, n[t + 11], 10, -1120210379), g = c(g, m, l, v, n[t + 2], 15, 718787259), v = c(v, g, m, l, n[t + 9], 21, -343485551), l = r(l, i), v = r(v, a), g = r(g, d), m = r(m, h);
    return [l, v, g, m]
  }

  function a(n) {
    var e, r = "",
      t = 32 * n.length;
    for (e = 0; e < t; e += 8) r += String.fromCharCode(n[e >> 5] >>> e % 32 & 255);
    return r
  }

  function d(n) {
    var e, r = [];
    for (r[(n.length >> 2) - 1] = void 0, e = 0; e < r.length; e += 1) r[e] = 0;
    var t = 8 * n.length;
    for (e = 0; e < t; e += 8) r[e >> 5] |= (255 & n.charCodeAt(e / 8)) << e % 32;
    return r
  }

  function h(n) {
    var e, r, t = "";
    for (r = 0; r < n.length; r += 1) e = n.charCodeAt(r), t += "0123456789abcdef".charAt(e >>> 4 & 15) + "0123456789abcdef".charAt(15 & e);
    return t
  }

  function l(n) {
    return unescape(encodeURIComponent(n))
  }

  function v(n) {
    return function(n) {
      return a(i(d(n), 8 * n.length))
    }(l(n))
  }

  function g(n, e) {
    return function(n, e) {
      var r, t, o = d(n),
        u = [],
        f = [];
      for (u[15] = f[15] = void 0, o.length > 16 && (o = i(o, 8 * n.length)), r = 0; r < 16; r += 1) u[r] = 909522486 ^ o[r], f[r] = 1549556828 ^ o[r];
      return t = i(u.concat(d(e)), 512 + 8 * e.length), a(i(f.concat(t), 640))
    }(l(n), l(e))
  }

  function m(n, e, r) {
    return e ? r ? g(e, n) : h(g(e, n)) : r ? v(n) : h(v(n))
  }
  
  return m(input);
};

# SHA-1 算法实现 (用于请求体 mkey)
const sha1 = (input) => {
  function r(n, e) {
    var r = (65535 & n) + (65535 & e);
    return (n >> 16) + (e >> 16) + (r >> 16) << 16 | 65535 & r
  }

  function s(n, e) {
    return n << e | n >>> 32 - e
  }

  const n = new Uint8Array(function(e) {
    var t, a, n, o = [];
    for (t = 0; t < e.length; t++)(a = e.charCodeAt(t)) < 128 ? o.push(a) : a < 2048 ? o.push(192 + (a >> 6 & 31), 128 + (63 & a)) : ((n = 55296 ^ a) >> 10 == 0 ? (a = (n << 10) + (56320 ^ e.charCodeAt(++t)) + 65536, o.push(240 + (a >> 18 & 7), 128 + (a >> 12 & 63))) : o.push(224 + (a >> 12 & 15)), o.push(128 + (a >> 6 & 63), 128 + (63 & a)));
    return o
  }(input));
  
  const o = 16 + (n.length + 8 >>> 6 << 4);
  const e = new Uint8Array(o << 2);
  e.set(new Uint8Array(n.buffer));
  const a = new Uint32Array(e.buffer);
  const d = new DataView(a.buffer);
  
  for (let g = 0; g < o; g++) a[g] = d.getUint32(g << 2);
  
  a[n.length >> 2] |= 128 << 24 - 8 * (3 & n.length);
  a[o - 1] = n.length << 3;
  
  const r = [];
  const i = [
    () => l[1] & l[2] | ~l[1] & l[3],
    () => l[1] ^ l[2] ^ l[3],
    () => l[1] & l[2] | l[1] & l[3] | l[2] & l[3],
    () => l[1] ^ l[2] ^ l[3]
  ];
  
  const c = [1518500249, 1859775393, -1894007588, -899497514];
  let l = [1732584193, -271733879, null, null, -1009589776];
  
  l[2] = ~l[0];
  l[3] = ~l[1];
  
  for (let g = 0; g < a.length; g += 16) {
    const u = l.slice(0);
    for (let t = 0; t < 80; t++) {
      r[t] = t < 16 ? a[g + t] : s(r[t - 3] ^ r[t - 8] ^ r[t - 14] ^ r[t - 16], 1);
      const a = s(l[0], 5) + i[t / 20 | 0]() + l[4] + r[t] + c[t / 20 | 0] | 0;
      l[1] = s(l[1], 30);
      l.pop();
      l.unshift(a);
    }
    for (let t = 0; t < 5; t++) l[t] = l[t] + u[t] | 0
  }
  
  const h = new DataView(new Uint32Array(l).buffer);
  for (let g = 0; g < 5; g++) l[g] = h.getUint32(g << 2);
  
  return Array.prototype.map.call(new Uint8Array(new Uint32Array(l).buffer), 
    (e) => (e < 16 ? "0" : "") + e.toString(16)).join("");
};

# 生成请求头 mkey
const genHeaderMkey = (ts) => {
  const oid = "1";
  const version = "4.11.23";
  const gid = "70";
  const bid = "ejga";
  const token = "WeixinMiniToken:719:8be9074877a7861b1952c42703909fdd80b893d5";
  const suffix = "wox2019";
  
  const body = JSON.stringify({
    token: token,
    version: version,
    bid: bid,
    mkeyUrl: "/clientApi/signInRecordAdd"
  });
  
  const raw = `${oid}:${version}:${gid}:${bid}:${token}:${body}:${ts}:${suffix}`;
  return md5(raw);
};

# 生成请求体 mkey
const genBodyMkey = () => {
  const params = {
    token: "WeixinMiniToken:719:8be9074877a7861b1952c42703909fdd80b893d5",
    version: "4.11.23",
    bid: "ejga",
    mkeyUrl: "/clientApi/signInRecordAdd"
  };
  
  // 按键名排序并拼接
  const keys = Object.keys(params).sort();
  const paramStr = keys.map(k => `${k}=${params[k]}`).join("&") + "wox2019";
  
  return sha1(paramStr);
};

# 主签到函数
const woxSign = async () => {
  const ts = Math.floor(Date.now() / 1000);
  const url = "https://wox2019.woxshare.com/clientApi/signInRecordAdd";
  
  try {
    const response = await $http.post({
      url: url,
      headers: {
        "openid": "ol4uQ5A8FEN8DFT3augaZ74KydhM",
        "Connection": "keep-alive",
        "Content-Type": "application/json",
        "ts": ts,
        "mkey": genHeaderMkey(ts),
        "version": "4.11.23",
        "bid": "ejga",
        "oid": "1",
        "gid": "70",
        "token": "WeixinMiniToken:719:8be9074877a786
