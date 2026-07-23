// Vitest alias target for "server-only" (see vitest.config.ts). Next.js's own
// bundler substitutes a no-op for this package when compiling server code;
// outside that bundler (i.e. under Vitest) the real package throws
// unconditionally on import, so tests need the same substitution.
export {};
