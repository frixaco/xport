// ==UserScript==
// @name         X Media Downloader (original quality)
// @namespace    frixaco.x-media-downloader
// @version      1.0.7
// @description  Per-item download buttons for photos, videos and GIFs on X (ex-Twitter): timelines, threads, quotes, retweets, carousels, sensitive media, media tab and photo viewer. Original quality.
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.x.com/*
// @run-at       document-start
// @sandbox      JavaScript
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      pbs.twimg.com
// @connect      video.twimg.com
// @connect      cdn.syndication.twimg.com
// @updateURL    https://raw.githubusercontent.com/frixaco/xport/main/userscripts/x-media-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/frixaco/xport/main/userscripts/x-media-downloader.user.js
// ==/UserScript==

(function () {
  "use strict";

  const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const TAG = "[xmd]";

  // ---------------------------------------------------------------------------
  // Media index: media key -> { tweet, index }
  // tweet = { id, user, date, media: [ {key, type, url, ext} ], quotedIds: Set }
  // Keys are the IDs X uses in thumbnail URLs, so any DOM item can be resolved
  // without knowing which tweet (main, quote, retweet) it belongs to.
  // ---------------------------------------------------------------------------
  const tweets = new Map();
  const byKey = new Map();

  function mediaKeyFromUrl(u) {
    if (!u) return null;
    let m = u.match(
      /\/(?:ext_tw_video_thumb|amplify_video_thumb|amplify_video|ext_tw_video|dm_video_thumb)\/(\d+)\//,
    );
    if (m) return m[1];
    m = u.match(/\/(?:media|tweet_video_thumb|tweet_video)\/([A-Za-z0-9_-]+)/);
    if (m) return m[1];
    return null;
  }

  function bestMedia(m) {
    const type = m.type; // photo | video | animated_gif
    if (type === "photo") {
      const base = m.media_url_https || m.media_url;
      const mm = base.match(/^(.*\/media\/[A-Za-z0-9_-]+)\.(\w+)/);
      if (!mm) return { type, url: base, ext: "jpg" };
      const ext = mm[2] === "jpeg" ? "jpg" : mm[2];
      return { type, url: `${mm[1]}?format=${ext}&name=orig`, ext };
    }
    const variants = (m.video_info && m.video_info.variants) || [];
    const mp4 = variants
      .filter((v) => v.content_type === "video/mp4" && v.url)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    if (mp4.length) return { type, url: mp4[0].url.split("?")[0], ext: "mp4" };
    const hls = variants.find((v) => /mpegurl/i.test(v.content_type || ""));
    return { type, url: hls ? hls.url : null, ext: "mp4", hlsOnly: true };
  }

  function fmtDate(created) {
    const d = created ? new Date(created) : null;
    if (!d || isNaN(d)) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  }

  // info = { user, name, created, text }
  function addTweet(id, info, mediaList, quotedId) {
    if (!id) return null;
    const { user, name, created, text } = info;
    let t = tweets.get(id);
    if (!t) {
      t = {
        id,
        user: user || "unknown",
        name: name || "",
        text: text || "",
        created: created || "",
        date: fmtDate(created),
        media: [],
        quotedIds: new Set(),
      };
      tweets.set(id, t);
    }
    if (user && t.user === "unknown") t.user = user;
    if (name && !t.name) t.name = name;
    if (text && !t.text) t.text = text;
    if (created && !t.created) t.created = created;
    if (!t.date && created) t.date = fmtDate(created);
    if (quotedId) t.quotedIds.add(quotedId);
    for (const m of mediaList || []) {
      const key = mediaKeyFromUrl(m.media_url_https || m.media_url) || m.id_str || m.media_key;
      if (!key || t.media.some((x) => x.key === key)) continue;
      t.media.push({ key, ...bestMedia(m) });
    }
    t.media.forEach((m, i) => byKey.set(m.key, { tweet: t, index: i }));
    return t;
  }

  function userOf(result) {
    const u = result && result.core && result.core.user_results && result.core.user_results.result;
    if (!u) return {};
    return {
      user: (u.core && u.core.screen_name) || (u.legacy && u.legacy.screen_name) || null,
      name: (u.core && u.core.name) || (u.legacy && u.legacy.name) || null,
    };
  }

  function tweetText(o) {
    const L = o.legacy || o;
    const note =
      o.note_tweet &&
      o.note_tweet.note_tweet_results &&
      o.note_tweet.note_tweet_results.result &&
      o.note_tweet.note_tweet_results.result.text;
    // Drop the trailing t.co link X appends for attached media; API text is HTML-escaped.
    return String(note || L.full_text || L.text || "")
      .replace(/\s*https:\/\/t\.co\/\w+\s*$/, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .trim();
  }

  function cardMedia(card) {
    // Promoted/"unified" cards carry their media as a JSON string.
    const out = [];
    const bv = card && (card.legacy ? card.legacy.binding_values : card.binding_values);
    if (!bv) return out;
    const list = Array.isArray(bv)
      ? bv
      : Object.entries(bv).map(([key, value]) => ({ key, value }));
    for (const { key, value } of list) {
      if (key !== "unified_card" || !value || !value.string_value) continue;
      try {
        const uc = JSON.parse(value.string_value);
        for (const m of Object.values(uc.media_entities || {})) out.push(m);
      } catch {}
    }
    return out;
  }

  function walk(o, depth = 0) {
    if (!o || typeof o !== "object" || depth > 60) return;
    if (Array.isArray(o)) {
      for (const x of o) walk(x, depth + 1);
      return;
    }
    // GraphQL tweet
    if (o.rest_id && o.legacy && typeof o.legacy === "object" && "full_text" in o.legacy) {
      const L = o.legacy;
      const media = (
        (L.extended_entities && L.extended_entities.media) ||
        (L.entities && L.entities.media) ||
        []
      ).concat(cardMedia(o.card));
      const q = o.quoted_status_result && o.quoted_status_result.result;
      const qid = q && (q.rest_id || (q.tweet && q.tweet.rest_id));
      addTweet(
        o.rest_id,
        { ...userOf(o), created: L.created_at, text: tweetText(o) },
        media,
        qid || L.quoted_status_id_str,
      );
    }
    // Syndication / v1.1 tweet
    else if (
      o.id_str &&
      o.user &&
      o.user.screen_name &&
      (o.mediaDetails || o.extended_entities || o.entities)
    ) {
      const media =
        o.mediaDetails ||
        (o.extended_entities && o.extended_entities.media) ||
        (o.entities && o.entities.media) ||
        [];
      addTweet(
        o.id_str,
        { user: o.user.screen_name, name: o.user.name, created: o.created_at, text: tweetText(o) },
        media,
        o.quoted_tweet && o.quoted_tweet.id_str,
      );
    }
    for (const k in o) {
      const v = o[k];
      if (v && typeof v === "object") walk(v, depth + 1);
    }
  }

  function ingest(url, data) {
    try {
      walk(data);
      schedule();
    } catch (e) {
      console.warn(TAG, "parse failed", url, e);
    }
  }

  const isApi = (u) =>
    /\/(graphql|i\/api|2\/timeline|1\.1)\//.test(u || "") || /api\.(x|twitter)\.com/.test(u || "");

  // ---------------------------------------------------------------------------
  // Network hooks (page context)
  // ---------------------------------------------------------------------------
  try {
    const XHR = W.XMLHttpRequest.prototype;
    const open = XHR.open;
    XHR.open = function (method, url) {
      this.__xmdUrl = String(url);
      return open.apply(this, arguments);
    };
    const send = XHR.send;
    XHR.send = function () {
      if (isApi(this.__xmdUrl)) {
        this.addEventListener("load", function () {
          try {
            let data;
            if (this.responseType === "json") data = this.response;
            else if (this.responseType === "" || this.responseType === "text") {
              const t = this.responseText;
              if (t && (t[0] === "{" || t[0] === "[")) data = JSON.parse(t);
            }
            if (data) ingest(this.__xmdUrl, data);
          } catch {}
        });
      }
      return send.apply(this, arguments);
    };
    const origFetch = W.fetch;
    W.fetch = function (input) {
      const p = origFetch.apply(this, arguments);
      const url = typeof input === "string" ? input : input && input.url;
      if (isApi(url)) {
        p.then(
          (res) => {
            const ct = res.headers.get("content-type") || "";
            if (ct.includes("json"))
              res
                .clone()
                .json()
                .then(
                  (d) => ingest(url, d),
                  () => {},
                );
          },
          () => {},
        );
      }
      return p;
    };
  } catch (e) {
    console.error(TAG, "hook failed", e);
  }

  // ---------------------------------------------------------------------------
  // Syndication fallback for tweets we never saw in API traffic
  // ---------------------------------------------------------------------------
  const synPending = new Map();
  function fetchSyndication(id) {
    if (synPending.has(id)) return synPending.get(id);
    const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
    const p = new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${token}`,
        responseType: "json",
        onload: (r) => {
          try {
            const d =
              typeof r.response === "object" && r.response
                ? r.response
                : JSON.parse(r.responseText);
            walk(d);
          } catch {}
          resolve();
        },
        onerror: () => resolve(),
        ontimeout: () => resolve(),
      });
    });
    synPending.set(id, p);
    return p;
  }

  // ---------------------------------------------------------------------------
  // Downloading
  // ---------------------------------------------------------------------------
  const safe = (s) => String(s).replace(/[^A-Za-z0-9_]/g, "_");
  function fileName(entry) {
    const { tweet, index } = entry;
    const m = tweet.media[index];
    const n = String(index + 1).padStart(2, "0");
    const parts = [
      safe(tweet.user),
      tweet.date,
      tweet.id,
      `${n}of${String(tweet.media.length).padStart(2, "0")}`,
    ].filter(Boolean);
    const kind = m.type === "animated_gif" ? "gif" : m.type;
    return `${parts.join("-")}-${kind}.${m.ext}`;
  }

  // ---------------------------------------------------------------------------
  // Embedded metadata (author, link, text) so Photos/Finder show where media came from.
  // Photos: XMP in JPEG/PNG. Videos: QuickTime mdta keys in moov/meta.
  // ---------------------------------------------------------------------------
  function mediaInfo(tweet) {
    const url = `https://x.com/${tweet.user}/status/${tweet.id}`;
    const author = tweet.name ? `${tweet.name} (@${tweet.user})` : `@${tweet.user}`;
    const d = tweet.created ? new Date(tweet.created) : null;
    const date = d && !isNaN(d) ? d.toISOString().replace(/\.\d{3}Z$/, "Z") : "";
    const description = [tweet.text, `${author}\n${url}`].filter(Boolean).join("\n\n");
    return { url, author, date, title: `${author} on X`, description };
  }

  const utf8 = (s) => new TextEncoder().encode(s);
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));
  const concat = (parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  const xml = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );

  function xmpPacket(info) {
    const alt = (v) => `<rdf:Alt><rdf:li xml:lang="x-default">${xml(v)}</rdf:li></rdf:Alt>`;
    return (
      '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"' +
      ' xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">' +
      `<dc:title>${alt(info.title)}</dc:title>` +
      `<dc:description>${alt(info.description)}</dc:description>` +
      `<dc:creator><rdf:Seq><rdf:li>${xml(info.author)}</rdf:li></rdf:Seq></dc:creator>` +
      `<dc:source>${xml(info.url)}</dc:source>` +
      `<photoshop:Credit>${xml(info.author)}</photoshop:Credit>` +
      `<photoshop:Source>${xml(info.url)}</photoshop:Source>` +
      (info.date ? `<photoshop:DateCreated>${info.date}</photoshop:DateCreated>` : "") +
      "</rdf:Description></rdf:RDF></x:xmpmeta>" +
      '<?xpacket end="w"?>'
    );
  }

  function tagJpeg(b, info) {
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    const payload = concat([utf8("http://ns.adobe.com/xap/1.0/\0"), utf8(xmpPacket(info))]);
    if (payload.length + 2 > 0xffff) return null;
    // Insert after SOI and a leading JFIF APP0, where readers expect APP1.
    let at = 2;
    if (b[2] === 0xff && b[3] === 0xe0) at = 4 + ((b[4] << 8) | b[5]);
    const len = payload.length + 2;
    const seg = concat([new Uint8Array([0xff, 0xe1, len >> 8, len & 255]), payload]);
    return concat([b.subarray(0, at), seg, b.subarray(at)]);
  }

  let crcTable;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (const x of bytes) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function tagPng(b, info) {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!sig.every((x, i) => b[i] === x)) return null;
    // iTXt: keyword \0 compression(0) method(0) lang \0 translated \0 text
    const body = concat([
      new Uint8Array(ascii("iTXt")),
      utf8("XML:com.adobe.xmp\0\0\0\0\0"),
      utf8(xmpPacket(info)),
    ]);
    const chunk = concat([
      new Uint8Array(u32(body.length - 4)),
      body,
      new Uint8Array(u32(crc32(body))),
    ]);
    const at = 8 + 12 + ((b[8] << 24) | (b[9] << 16) | (b[10] << 8) | b[11]); // after IHDR
    return concat([b.subarray(0, at), chunk, b.subarray(at)]);
  }

  const box = (type, ...parts) => {
    const body = concat(parts);
    return concat([new Uint8Array([...u32(body.length + 8), ...ascii(type)]), body]);
  };

  function quickTimeMeta(info) {
    const items = [
      ["com.apple.quicktime.title", info.title],
      ["com.apple.quicktime.description", info.description],
      ["com.apple.quicktime.author", info.author],
      ["com.apple.quicktime.artist", info.author],
      ["com.apple.quicktime.comment", info.url],
      ["com.apple.quicktime.creationdate", info.date],
    ].filter(([, v]) => v);
    const zero = (n) => new Uint8Array(n);
    const hdlr = box("hdlr", zero(8), new Uint8Array(ascii("mdta")), zero(13));
    const keys = box(
      "keys",
      zero(4),
      new Uint8Array(u32(items.length)),
      ...items.map(([k]) => box("mdta", utf8(k))),
    );
    const ilst = concat([
      new Uint8Array([...u32(0), ...ascii("ilst")]),
      ...items.map(([, v], i) => {
        const data = box("data", new Uint8Array(u32(1)), zero(4), utf8(v)); // type 1 = UTF-8
        return concat([new Uint8Array([...u32(data.length + 8), ...u32(i + 1)]), data]);
      }),
    ]);
    new DataView(ilst.buffer).setUint32(0, ilst.length);
    return box("meta", hdlr, keys, ilst);
  }

  function tagMp4(b, info) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const children = (start, end) => {
      const out = [];
      for (let o = start; o + 8 <= end; ) {
        const size = dv.getUint32(o);
        if (size < 8 || o + size > end) return null; // 64-bit or broken sizes: leave file alone
        out.push({ type: String.fromCharCode(...b.subarray(o + 4, o + 8)), start: o, size });
        o += size;
      }
      return out;
    };
    const top = children(0, b.length);
    const moov = top && top.find((x) => x.type === "moov");
    if (!moov) return null;
    const inMoov = children(moov.start + 8, moov.start + moov.size);
    if (!inMoov || inMoov.some((x) => x.type === "meta")) return null;
    const meta = quickTimeMeta(info);
    const out = concat([
      b.subarray(0, moov.start + moov.size),
      meta,
      b.subarray(moov.start + moov.size),
    ]);
    const odv = new DataView(out.buffer);
    odv.setUint32(moov.start, moov.size + meta.length);
    // Media data after moov moves by meta.length; shift chunk offsets that point past moov.
    const moovEnd = moov.start + moov.size;
    const walkStbl = (list, path) => {
      for (const x of list) {
        if (path.length) {
          if (x.type === path[0])
            walkStbl(children(x.start + 8, x.start + x.size) || [], path.slice(1));
          continue;
        }
        if (x.type !== "stco" && x.type !== "co64") continue;
        const n = dv.getUint32(x.start + 12);
        for (let i = 0; i < n; i++) {
          if (x.type === "stco") {
            const p = x.start + 16 + i * 4;
            const v = dv.getUint32(p);
            if (v >= moovEnd) odv.setUint32(p, v + meta.length);
          } else {
            const p = x.start + 16 + i * 8;
            const v = dv.getBigUint64(p);
            if (v >= BigInt(moovEnd)) odv.setBigUint64(p, v + BigInt(meta.length));
          }
        }
      }
    };
    walkStbl(inMoov, ["trak", "mdia", "minf", "stbl"]);
    return out;
  }

  function tagMedia(bytes, ext, info) {
    try {
      const b = new Uint8Array(bytes);
      const out =
        ext === "mp4"
          ? tagMp4(b, info)
          : ext === "jpg"
            ? tagJpeg(b, info)
            : ext === "png"
              ? tagPng(b, info)
              : null;
      return out || b;
    } catch (e) {
      console.warn(TAG, "metadata embed failed", e);
      return new Uint8Array(bytes);
    }
  }

  const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4" };

  function download(entry) {
    const m = entry.tweet.media[entry.index];
    const name = fileName(entry);
    return new Promise((resolve, reject) => {
      if (!m.url) return reject(new Error("no url"));
      if (m.hlsOnly) return reject(new Error("HLS-only video, no MP4 variant"));
      const viaAnchor = (blob) => {
        const a = document.createElement("a");
        const href = URL.createObjectURL(blob);
        a.href = href;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 60000);
        resolve(name);
      };
      // Untagged direct download (the 1.0.4 path); used when the tagged fetch fails.
      const plain = (why) => {
        console.warn(TAG, "tagged download failed, saving without metadata:", why);
        try {
          GM_download({
            url: m.url,
            name,
            saveAs: false,
            onload: () => resolve(name),
            onerror: (e) =>
              reject(
                new Error(`${why}; GM_download: ${(e && (e.error || e.details)) || "failed"}`),
              ),
          });
        } catch (e) {
          reject(new Error(`${why}; GM_download: ${e.message}`));
        }
      };
      try {
        GM_xmlhttpRequest({
          method: "GET",
          url: m.url,
          responseType: "arraybuffer",
          onload: (r) => {
            if (r.status !== 200) return plain("HTTP " + r.status);
            if (!r.response || !r.response.byteLength) return plain("empty response");
            try {
              saveTagged(r.response);
            } catch (e) {
              plain("tagging: " + e.message);
            }
          },
          onerror: (e) => plain("network error " + ((e && e.error) || "")),
          ontimeout: () => plain("timeout"),
        });
      } catch (e) {
        plain("GM_xmlhttpRequest: " + e.message);
      }
      function saveTagged(buf) {
        const bytes = tagMedia(buf, m.ext, mediaInfo(entry.tweet));
        const blob = new Blob([bytes], { type: MIME[m.ext] || "application/octet-stream" });
        try {
          GM_download({
            url: blob,
            name,
            saveAs: false,
            onload: () => resolve(name),
            onerror: (e) => {
              console.warn(TAG, "GM_download failed, using anchor fallback", e);
              viaAnchor(blob);
            },
          });
        } catch {
          viaAnchor(blob);
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  const css = `
  .xmd-btn{position:absolute;top:6px;right:6px;z-index:20;width:30px;height:30px;border-radius:999px;border:1px solid rgba(255,255,255,.35);
    background:rgba(15,20,25,.75);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;
    opacity:.85;transition:opacity .15s,background .15s;font:600 11px/1 system-ui,sans-serif;backdrop-filter:blur(4px);
    user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
  .xmd-btn:hover{opacity:1;background:rgba(29,155,240,.95)}
  .xmd-btn svg{width:16px;height:16px;fill:currentColor;pointer-events:none}
  .xmd-btn[data-state=busy]{background:rgba(29,155,240,.95)} .xmd-btn[data-state=ok]{background:rgba(0,186,124,.95)}
  .xmd-btn[data-state=err]{background:rgba(244,33,46,.95)}
  .xmd-bar{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0;align-items:center;font:500 12px system-ui,sans-serif;color:rgb(113,118,123)}
  .xmd-bar .xmd-btn{position:static;width:auto;padding:0 10px;gap:4px}
  `;
  const ICON =
    '<svg viewBox="0 0 24 24"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5z"/></svg>';
  const CHECK =
    '<svg viewBox="0 0 24 24"><path d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.4-1.4z"/></svg>';

  function makeButton(resolveEntry, label) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "xmd-btn";
    b.innerHTML = ICON + (label ? `<span>${label}</span>` : "");
    b.title = "Download original";
    const stop = (e) => {
      // Cancelling touchstart prevents Safari from generating the download click.
      if (e.type === "click") e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    ["pointerdown", "mousedown", "mouseup", "touchstart"].forEach((ev) =>
      b.addEventListener(ev, stop, true),
    );
    b.addEventListener(
      "click",
      async (e) => {
        stop(e);
        if (b.dataset.state === "busy") return;
        // Tap a red button to see why it failed (no hover tooltips on touch screens).
        if (b.dataset.state === "err") {
          alert(
            `X Media Downloader v${typeof GM_info !== "undefined" ? GM_info.script.version : "?"}\n${b.title}`,
          );
          delete b.dataset.state;
          return;
        }
        b.dataset.state = "busy";
        try {
          const entry = await resolveEntry();
          // Indexed tweet count tells whether the API capture works at all on this device.
          if (!entry) throw new Error(`media not found (indexed posts: ${tweets.size})`);
          b.title = fileName(entry);
          await download(entry);
          b.dataset.state = "ok";
          b.innerHTML = CHECK + (label ? `<span>${label}</span>` : "");
        } catch (err) {
          console.warn(TAG, err);
          b.dataset.state = "err";
          b.title = "Failed: " + (err && err.message);
        }
      },
      true,
    );
    return b;
  }

  function statusIdFromHref(h) {
    const m = h && h.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  // Keys of media rendered inside an element (img src, video poster/src).
  function keysIn(el) {
    const keys = [];
    el.querySelectorAll("img, video, source").forEach((n) => {
      for (const attr of ["src", "poster"]) {
        const k = mediaKeyFromUrl(n.getAttribute(attr));
        if (k && !keys.includes(k)) keys.push(k);
      }
    });
    return keys;
  }

  function mainTweetId(article) {
    for (const t of article.querySelectorAll("time")) {
      const a = t.closest("a[href*='/status/']");
      if (a && !a.closest("div[role=link]")) return statusIdFromHref(a.getAttribute("href"));
    }
    const m = location.pathname.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  // Figure out which tweet an on-screen media element belongs to, for when its
  // key isn't indexed yet: photo link, else main/quoted tweet of the article.
  function tweetIdFor(el) {
    const a = el.closest("a[href*='/status/']") || el.querySelector("a[href*='/status/']");
    if (a) return statusIdFromHref(a.getAttribute("href"));
    const article = el.closest("article");
    if (!article) return statusIdFromHref(location.pathname);
    const main = mainTweetId(article);
    if (el.closest("div[role=link]") && main) {
      const t = tweets.get(main);
      if (t && t.quotedIds.size) return [...t.quotedIds][0];
    }
    return main;
  }

  function positionalEntry(el, tweetId) {
    const t = tweets.get(tweetId);
    if (!t || !t.media.length) return null;
    const scope = el.closest("div[role=link]") || el.closest("article") || document;
    const inQuote = !!el.closest("div[role=link]");
    const items = [...scope.querySelectorAll(TILE)].filter(
      (x) => !x.parentElement.closest(TILE) && !!x.closest("div[role=link]") === inQuote,
    );
    const i = items.indexOf(el.closest(TILE) || el);
    return i >= 0 && i < t.media.length ? { tweet: t, index: i } : null;
  }

  async function resolveFor(el) {
    const keys = keysIn(el);
    for (const k of keys) if (byKey.has(k)) return byKey.get(k);
    const id = tweetIdFor(el);
    if (id) {
      const article = el.closest("article");
      const main = article && mainTweetId(article);
      await fetchSyndication(id);
      if (main && main !== id) await fetchSyndication(main);
      for (const k of keysIn(el)) if (byKey.has(k)) return byKey.get(k);
      const pos = positionalEntry(el, id);
      if (pos) return pos;
    }
    return photoFromDom(el);
  }

  // Last resort for photos when no API data was captured (e.g. iOS, or posts the
  // syndication API tombstones): the <img> holds the media ID and the link holds
  // the author and post ID, which is all an original-quality URL needs.
  function photoFromDom(el) {
    const img = [...el.querySelectorAll("img")].find((i) =>
      /\/\/pbs\.twimg\.com\/media\//.test(i.src),
    );
    if (!img) return null;
    const u = new URL(img.src);
    const key = mediaKeyFromUrl(u.pathname);
    if (!key) return null;
    const fmt = u.searchParams.get("format") || (u.pathname.match(/\.(\w+)$/) || [])[1] || "jpg";
    const ext = fmt === "jpeg" ? "jpg" : fmt;
    const link = el.closest("a[href*='/status/']") || el.querySelector("a[href*='/status/']");
    const href = link ? link.getAttribute("href") : location.pathname;
    const m = href.match(/^\/([^/]+)\/status\/(\d+)(?:\/photo\/(\d+))?/);
    if (!m) return null;
    const scope = el.closest("div[role=link]") || el.closest("article");
    const count = scope
      ? Math.max(1, scope.querySelectorAll("[data-testid=tweetPhoto]").length)
      : 1;
    const index = Math.min(m[3] ? Number(m[3]) - 1 : 0, count - 1);
    const media = Array.from({ length: count }, () => ({ type: "photo", ext }));
    media[index] = {
      key,
      type: "photo",
      ext,
      url: `https://pbs.twimg.com/media/${key}?format=${ext}&name=orig`,
    };
    return {
      tweet: {
        id: m[2],
        user: m[1],
        name: "",
        text: "",
        created: "",
        date: "",
        media,
        quotedIds: new Set(),
      },
      index,
    };
  }

  // Media tiles: photos/videos/GIFs, and click-to-play video previews.
  const TILE = "[data-testid=tweetPhoto], [data-testid=previewInterstitial]";
  const done = new WeakSet();
  function attach(container) {
    if (done.has(container)) return;
    if (container.querySelector(":scope > .xmd-btn")) return;
    done.add(container);
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    container.appendChild(makeButton(() => resolveFor(container)));
  }

  // Sensitive media that X hasn't rendered (behind "Show"), or any media of a
  // known tweet that has no on-screen button, gets a labelled button row.
  function attachHiddenBar(article) {
    const main = mainTweetId(article);
    if (!main) return;
    const ids = [main];
    const mt = tweets.get(main);
    if (mt) ids.push(...mt.quotedIds);
    // Anything with a button anywhere on the page (e.g. the photo viewer
    // carousel next to its tweet) counts as shown.
    const shown = new Set();
    document.querySelectorAll(".xmd-btn").forEach((b) => {
      const c = b.parentElement;
      if (c && !c.classList.contains("xmd-bar")) keysIn(c).forEach((k) => shown.add(k));
    });
    const missing = [];
    for (const id of ids) {
      const t = tweets.get(id);
      if (!t) continue;
      t.media.forEach((m, i) => {
        if (!shown.has(m.key)) missing.push({ tweet: t, index: i });
      });
    }
    let bar = article.querySelector(".xmd-bar");
    const sig = missing.map((e) => e.tweet.media[e.index].key).join(",");
    if (!missing.length) {
      if (bar) bar.remove();
      return;
    }
    if (bar && bar.dataset.sig === sig) return;
    // Hidden media still loading in? Only show the bar once the article has
    // settled with no visible element for these keys.
    const group = [...article.querySelectorAll("[role=group]")].pop();
    if (!group) return;
    if (bar) bar.remove();
    bar = document.createElement("div");
    bar.className = "xmd-bar";
    bar.dataset.sig = sig;
    bar.append("Hidden media:");
    for (const e of missing) {
      const who = e.tweet.id === main ? "" : "quote ";
      bar.appendChild(makeButton(async () => e, `${who}${e.index + 1}/${e.tweet.media.length}`));
    }
    group.parentElement.insertBefore(bar, group);
  }

  function scan() {
    if (!document.body) return;
    // Feed / thread / quotes / retweets: each photo, video, GIF tile.
    document.querySelectorAll(TILE).forEach((el) => {
      if (el.parentElement && el.parentElement.closest(TILE)) return;
      attach(el);
    });
    // Profile media grid & any other photo/video links without a tweetPhoto wrapper.
    document
      .querySelectorAll(
        "a[href*='/status/'][href*='/photo/'], a[href*='/status/'][href*='/video/']",
      )
      .forEach((a) => {
        if (a.querySelector(TILE) || a.closest(TILE)) return;
        if (!keysIn(a).length) return;
        attach(a);
      });
    // Full-screen photo viewer / carousel.
    document
      .querySelectorAll("[aria-modal=true] img[src*='/media/'], [aria-modal=true] video")
      .forEach((m) => {
        if (m.closest(TILE) || m.closest("a[href*='/photo/']")) return;
        const box = m.parentElement;
        if (box && box.getBoundingClientRect().width > 100) attach(box);
      });
    document.querySelectorAll("article[data-testid=tweet]").forEach(attachHiddenBar);
  }

  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      try {
        scan();
      } catch (e) {
        console.warn(TAG, e);
      }
    }, 150);
  }

  function boot() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    schedule();
  }
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
