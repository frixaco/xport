import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/auth-error")({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/",
      search: { auth_error: (search as { auth_error?: string }).auth_error },
    });
  },
  component: () => null,
});
