import { defineTask } from "nitro/task";
import { deliverCreditReports } from "../src/lib/billing-delivery.ts";

export default defineTask({
  meta: { name: "billing-delivery", description: "Deliver pending Polar credit reports" },
  async run() {
    return { result: { delivered: await deliverCreditReports() } };
  },
});
