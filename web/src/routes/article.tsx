import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/article")({
  component: () => redirect({ to: "/" }),
});
