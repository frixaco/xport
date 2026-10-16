import { defineRailway, github, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "xport-web";
export default defineRailway(() => {
  const xportWeb = service("xport-web", {
    source: github("frixaco/xport", { branch: "main", checkSuites: false }),
    build: { builder: "RAILPACK", buildCommand: "pnpm build" },
    start: "pnpm start",
    healthcheck: "/",
    replicas: { "europe-west4-drams3a": 1 },
    domains: ["xport.frixaco.com"],
  });

  return project("main", {
    variables: { managed: false },
    resources: [xportWeb],
  });
});
