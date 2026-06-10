import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/article")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
  component: () => null,
});
