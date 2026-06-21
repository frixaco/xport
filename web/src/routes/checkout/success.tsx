import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/checkout/success")({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/",
      search: { checkout_id: (search as { checkout_id?: string }).checkout_id },
    });
  },
  component: () => null,
});
