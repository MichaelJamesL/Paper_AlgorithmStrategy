import { createCallerFactory, createTRPCRouter } from "../init";
import { pathfindingRouter } from "./pathfinding";

/** Root tRPC router. Mount feature routers here. */
export const appRouter = createTRPCRouter({
  pathfinding: pathfindingRouter,
});

/** Exported type signature of the API — consumed by the tRPC client. */
export type AppRouter = typeof appRouter;

/** Server-side caller: invoke procedures directly without an HTTP round-trip. */
export const createCaller = createCallerFactory(appRouter);
