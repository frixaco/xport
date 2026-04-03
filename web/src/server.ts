import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { FastResponse } from "srvx";

globalThis.Response = FastResponse as typeof Response;

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request);
  },
});
