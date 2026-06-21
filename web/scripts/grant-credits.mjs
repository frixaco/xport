import { Polar } from "@polar-sh/sdk";

const USAGE_EVENT_NAME = "usage";

function usage() {
  console.error(
    'Usage: pnpm run credits:grant -- <customer-email-or-external-id> <credits> "<reason>" [--key <idempotency-key>]',
  );
}

function parseArgs(argv) {
  const args = [...argv];
  if (args[0] === "--") {
    args.shift();
  }

  const keyIndex = args.indexOf("--key");
  const key = keyIndex >= 0 ? args[keyIndex + 1] : null;

  if (keyIndex >= 0) {
    args.splice(keyIndex, 2);
  }

  const [identifier, amountInput, ...reasonParts] = args;
  const amount = Number(amountInput);
  const reason = reasonParts.join(" ").trim();

  if (!identifier || !Number.isInteger(amount) || amount <= 0 || !reason) {
    usage();
    process.exit(1);
  }

  return { identifier, amount, reason, key };
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

async function resolveExternalCustomerId(polar, identifier) {
  if (!identifier.includes("@")) {
    return identifier;
  }

  const pages = await polar.customers.list({ email: identifier, limit: 10 });
  const matches = [];

  for await (const page of pages) {
    matches.push(...page.result.items);
    if (matches.length > 0) break;
  }

  if (matches.length === 0) {
    throw new Error(`No Polar customer found for email ${identifier}.`);
  }

  const exactMatches = matches.filter((customer) => customer.email === identifier);
  const customer = exactMatches[0] ?? matches[0];

  if (!customer.externalId) {
    throw new Error(`Polar customer ${customer.id} has no externalId.`);
  }

  return customer.externalId;
}

const { identifier, amount, reason, key } = parseArgs(process.argv.slice(2));

if (!process.env.POLAR_ACCESS_TOKEN) {
  console.error("POLAR_ACCESS_TOKEN is required.");
  process.exit(1);
}

const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
});

const externalCustomerId = await resolveExternalCustomerId(polar, identifier);
const externalId =
  key ?? `manual-credit:${externalCustomerId}:${amount}:${slug(reason)}:${dateStamp()}`;

const result = await polar.events.ingest({
  events: [
    {
      name: USAGE_EVENT_NAME,
      externalCustomerId,
      externalId,
      metadata: {
        credits: -amount,
        reason,
      },
    },
  ],
});

console.log(
  JSON.stringify(
    {
      externalCustomerId,
      creditsGranted: amount,
      externalId,
      inserted: result.inserted,
      duplicates: result.duplicates,
    },
    null,
    2,
  ),
);
