import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/thread")({
  component: () => redirect({ to: "/" }),
});
