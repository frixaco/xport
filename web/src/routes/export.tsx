import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/export")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
  component: () => null,
});
