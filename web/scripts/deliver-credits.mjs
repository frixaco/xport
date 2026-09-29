import { deliverCreditReports } from "../src/lib/billing-delivery.ts";
import { db } from "../src/lib/db.ts";

try {
  console.log(JSON.stringify({ delivered: await deliverCreditReports() }));
} finally {
  await db.$client.end();
}
