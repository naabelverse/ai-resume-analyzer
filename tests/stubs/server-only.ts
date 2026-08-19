// `server-only` throws by design when imported outside a React Server
// Components graph, which is exactly what makes it a useful guard in the app
// and useless in a test runner. Vitest aliases the package to this empty
// module so the modules that carry the guard stay testable without weakening
// the guard itself in the build.
export {};
