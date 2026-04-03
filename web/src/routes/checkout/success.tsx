import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/checkout/success")({
  component: CheckoutSuccessPage,
});

function CheckoutSuccessPage() {
  const search = Route.useSearch() as { checkout_id?: string };
  redirect({ to: "/", search: { checkout_id: search.checkout_id } });
}
