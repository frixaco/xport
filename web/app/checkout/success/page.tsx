import { redirect } from "next/navigation";

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout_id?: string }>;
}) {
  const { checkout_id } = await searchParams;

  if (!checkout_id) {
    redirect("/");
  }

  redirect(`/?checkout_id=${checkout_id}`);
}
