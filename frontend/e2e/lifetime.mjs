// e2e/lifetime.mjs
// ================
// The servers the WebKit tests and the manual's screenshots start (the backend
// and the static server, playwright.config.ts) stop with the run that started
// them: on Ctrl-C or a kill signal, and also when that run ends without
// stopping them, for example when it is killed outright. Then no server is
// left holding its port for the next run or for `npm run app:dev`.

/** Call `stop` (then exit) on SIGINT, SIGTERM or SIGHUP, or as soon as the
 *  process that started this one is gone (this process is then re-parented,
 *  so its parent pid changes). */
export function stopWithParent(stop) {
  let stopping = false;
  const done = (code = 0) => {
    if (stopping) return;
    stopping = true;
    Promise.resolve(stop()).finally(() => process.exit(code));
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => done(0));
  const parent = process.ppid;
  setInterval(() => { if (process.ppid !== parent) done(0); }, 500).unref();
  return done;
}
