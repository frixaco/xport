import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/export")({
  component: () => redirect({ to: "/" }),
});
