// Hard ceiling for the entire live run; retries also count toward the budget.
const original = globalThis.fetch;
let calls = 0;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin === new URL(process.env.X_API_URL).origin && ++calls > 50) {
    throw new Error("Live test X API request budget exceeded (50)");
  }
  return original(input, init);
};
