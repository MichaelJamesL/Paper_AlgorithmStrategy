import { initTRPC } from "@trpc/server";
import superjson from "superjson";

/**
 * Per-request tRPC context. Empty for now — extend with auth/session/db handles
 * as the app grows. Receives the fetch-adapter options at call time.
 */
export const createTRPCContext = async () => {
  return {};
};

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;

/**
 * superjson lets procedures return rich values (Map, Date, undefined, BigInt)
 * and have them survive the wire intact. The client transformer must match.
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const baseProcedure = t.procedure;
