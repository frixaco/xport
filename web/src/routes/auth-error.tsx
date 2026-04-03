import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/auth-error")({
  component: AuthErrorPage,
});

function AuthErrorPage() {
  const search = Route.useSearch() as { auth_error?: string };
  redirect({ to: "/", search: { auth_error: search.auth_error } });
}
