import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { paidOrder } from "./polar-fixture.ts";

const customers = new Map(),
  checkouts = new Map(),
  calls = new Map();
const now = new Date().toISOString();
const origin = "http://localhost:3210";
const author = { id: "example", userName: "example", name: "Example" };
const customer = (body) => ({
  id: randomUUID(),
  created_at: now,
  modified_at: null,
  metadata: {},
  external_id: null,
  email_verified: true,
  type: "individual",
  name: "Test customer",
  billing_address: null,
  tax_id: null,
  organization_id: randomUUID(),
  deleted_at: null,
  avatar_url: "",
  ...body,
});
function checkout(body) {
  const id = randomUUID();
  const result = {
    id,
    created_at: now,
    modified_at: null,
    payment_processor: "stripe",
    status: "open",
    client_secret: "test",
    url: `http://localhost:3211/checkout/${id}`,
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    success_url: body.success_url,
    amount: 100,
    discount_amount: 0,
    net_amount: 100,
    total_amount: 100,
    currency: "usd",
    organization_id: randomUUID(),
    allow_discount_codes: true,
    require_billing_address: false,
    is_discount_applicable: false,
    is_free_product_price: false,
    is_payment_required: true,
    is_payment_setup_required: false,
    is_payment_form_required: true,
    is_business_customer: false,
    payment_processor_metadata: {},
    metadata: {},
    customer_metadata: {},
    products: [],
    billing_address_fields: Object.fromEntries(
      ["country", "state", "city", "postal_code", "line1", "line2"].map((k) => [k, "optional"]),
    ),
    external_customer_id: body.external_customer_id,
    product_id: body.products[0],
  };
  for (const k of [
    "return_url",
    "embed_origin",
    "tax_amount",
    "tax_behavior",
    "allow_trial",
    "active_trial_interval",
    "active_trial_interval_count",
    "trial_end",
    "product_price_id",
    "discount_id",
    "customer_id",
    "customer_name",
    "customer_email",
    "customer_ip_address",
    "customer_billing_name",
    "customer_billing_address",
    "customer_tax_id",
    "trial_interval",
    "trial_interval_count",
    "product",
    "product_price",
    "prices",
    "discount",
    "subscription_id",
    "attached_custom_fields",
  ])
    result[k] = null;
  checkouts.set(id, result);
  return result;
}
createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:3211");
  const path = url.pathname;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    body = Object.fromEntries(new URLSearchParams(raw));
  }
  const json = (data, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  const redirect = (location) => {
    res.writeHead(302, { Location: location });
    res.end();
  };
  try {
    calls.set(req.url, (calls.get(req.url) || 0) + 1);
    if (path === "/oauth2.googleapis.com/token") {
      const jwt =
        [
          { alg: "RS256", typ: "JWT" },
          {
            sub: body.code,
            name: "OAuth Test",
            email: `${body.code}@example.test`,
            email_verified: true,
            iss: "https://accounts.google.com",
            aud: "test-only",
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
          },
        ]
          .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
          .join(".") + ".mock-signature";
      return json({
        access_token: body.code,
        token_type: "bearer",
        expires_in: 3600,
        id_token: jwt,
      });
    }
    if (path === "/github.com/login/oauth/access_token")
      return json({
        access_token: body.code || "offline",
        token_type: "bearer",
        scope: "read:user user:email",
      });
    if (path.startsWith("/api.github.com/user")) {
      const id = (req.headers.authorization || "").split(" ").at(-1);
      return json(
        path.endsWith("/emails")
          ? [{ email: `${id}@example.test`, primary: true, verified: true }]
          : { id, login: id, name: "OAuth Test", email: `${id}@example.test`, avatar_url: null },
      );
    }
    if (path.startsWith("/sandbox-api.polar.sh/v1/customers")) {
      if (req.method === "GET")
        return json({
          items: [...customers.values()].filter((c) => c.email === url.searchParams.get("email")),
          pagination: { total_count: customers.size, max_page: 1 },
        });
      if (req.method === "POST") {
        const c = customer(body);
        customers.set(c.id, c);
        return json(c, 201);
      }
      const c = customers.get(path.split("/").at(-1));
      Object.assign(c, body);
      return json(c);
    }
    if (path === "/sandbox-api.polar.sh/v1/events/ingest")
      return json({ inserted: body.events?.length || 1 }, 200);
    if (path.startsWith("/sandbox-api.polar.sh/v1/checkouts")) {
      if (req.method === "POST") return json(checkout(body), 201);
      const c = checkouts.get(path.split("/").at(-1));
      return json(c || { detail: "Not found" }, c ? 200 : 404);
    }
    if (path.startsWith("/checkout/")) {
      const c = checkouts.get(path.split("/")[2]);
      if (url.searchParams.has("pay")) {
        const event = paidOrder(c.external_customer_id, c.product_id, c.id);
        const response = await fetch(`${origin}/api/auth/polar/webhooks`, {
          method: "POST",
          ...event,
        });
        if (!response.ok) throw new Error(`Webhook rejected: ${await response.text()}`);
        c.status = "succeeded";
        return redirect(c.success_url.replace("{CHECKOUT_ID}", c.id));
      }
      if (url.searchParams.has("fail")) {
        c.status = "failed";
        return redirect(c.success_url.replace("{CHECKOUT_ID}", c.id));
      }
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<h1>Test checkout</h1><a href="?pay">Pay</a><a href="?fail">Decline</a><a href="http://localhost:3210/">Cancel</a>',
      );
      return;
    }
    if (path === "/twitter/article") {
      if (url.searchParams.get("tweet_id") === "999")
        return json({ message: "Article unavailable" }, 502);
      return json({
        status: "success",
        article: {
          title: "Test article",
          author,
          createdAt: now,
          contents: [
            {
              type: "unstyled",
              text: 'Paid content **bold** <img src=x onerror="window.articleXss=true">',
            },
          ],
        },
      });
    }
    if (path === "/twitter/user/info")
      return json({
        status: "success",
        data: {
          ...author,
          id: url.searchParams.get("userName"),
          userName: url.searchParams.get("userName"),
        },
      });
    if (path === "/twitter/tweet/thread_context" || path === "/twitter/user/tweet_timeline") {
      const source = url.searchParams.get("tweetId") || url.searchParams.get("userId");
      const page = Number(url.searchParams.get("cursor") || 0);
      if (source === "999") return json({ message: "Upstream unavailable" }, 502);
      if (source === "777" && calls.get(req.url) === 1)
        return json({ message: "Rate limited" }, 429);
      if (source === "slow") await delay(2500);
      const count = source === "empty" ? 0 : 40;
      const tweets = Array.from({ length: count }, (_, i) => ({
        id: String(1000 + page * 40 + i),
        url: `https://x.com/example/status/${1000 + page * 40 + i}`,
        text: `Post ${page * 40 + i + 1}`,
        createdAt: now,
        author: { ...author, userName: source === "mixed" ? "mixed" : "example" },
        ...(source === "mixed" && i % 2
          ? { isReply: true, inReplyToId: "99", inReplyToUsername: "parent" }
          : {}),
      }));
      const next = source === "slow" ? page < 9 : source === "paged" ? page < 2 : false;
      return json({
        status: "success",
        tweets,
        data: { tweets },
        has_next_page: next,
        next_cursor: next ? String(page + 1) : "",
      });
    }
    return json({ message: `Unhandled mock request ${req.method} ${path}` }, 500);
  } catch (e) {
    console.error(e);
    json({ message: e.message }, 500);
  }
}).listen(3211, "127.0.0.1");
