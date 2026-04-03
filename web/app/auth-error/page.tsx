import { redirect } from "next/navigation";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  if (error === "access_denied") {
    redirect("/?auth_error=cancelled");
  }

  redirect("/?auth_error=failed");
}
