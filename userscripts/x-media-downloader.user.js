// ==UserScript==
// @name         X Media Downloader (original quality)
// @namespace    frixaco.x-media-downloader
// @version      1.0.2
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

  function addTweet(id, user, created, mediaList, quotedId) {
    if (!id) return null;
    let t = tweets.get(id);
    if (!t) {
      t = { id, user: user || "unknown", date: fmtDate(created), media: [], quotedIds: new Set() };
      tweets.set(id, t);
    }
    if (user && t.user === "unknown") t.user = user;
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
    if (!u) return null;
    return (u.core && u.core.screen_name) || (u.legacy && u.legacy.screen_name) || null;
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
      addTweet(o.rest_id, userOf(o), L.created_at, media, qid || L.quoted_status_id_str);
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
        o.user.screen_name,
        o.created_at,
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

  function download(entry) {
    const m = entry.tweet.media[entry.index];
    const name = fileName(entry);
    return new Promise((resolve, reject) => {
      if (!m.url) return reject(new Error("no url"));
      if (m.hlsOnly) return reject(new Error("HLS-only video, no MP4 variant"));
      const viaBlob = () =>
        GM_xmlhttpRequest({
          method: "GET",
          url: m.url,
          responseType: "blob",
          onload: (r) => {
            if (r.status !== 200) return reject(new Error("HTTP " + r.status));
            const a = document.createElement("a");
            const href = URL.createObjectURL(r.response);
            a.href = href;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(href), 60000);
            resolve(name);
          },
          onerror: () => reject(new Error("network error")),
        });
      try {
        GM_download({
          url: m.url,
          name,
          saveAs: false,
          onload: () => resolve(name),
          onerror: (e) => {
            console.warn(TAG, "GM_download failed, using blob fallback", e);
            viaBlob();
          },
        });
      } catch {
        viaBlob();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  const css = `
  .xmd-btn{position:absolute;top:6px;right:6px;z-index:20;width:30px;height:30px;border-radius:999px;border:1px solid rgba(255,255,255,.35);
    background:rgba(15,20,25,.75);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;
    opacity:.85;transition:opacity .15s,background .15s;font:600 11px/1 system-ui,sans-serif;backdrop-filter:blur(4px)}
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
      e.preventDefault();
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
        b.dataset.state = "busy";
        try {
          const entry = await resolveEntry();
          if (!entry) throw new Error("media not found");
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
      return positionalEntry(el, id);
    }
    return null;
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
