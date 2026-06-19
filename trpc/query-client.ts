import { QueryClient, defaultShouldDehydrateQuery } from "@tanstack/react-query";
import superjson from "superjson";

/**
 * One QueryClient factory shared by server (per-request) and browser (singleton).
 * superjson de/hydration keeps Map/Date/undefined intact across the RSC boundary,
 * matching the transformer used on the tRPC link.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The graph build is expensive; don't auto-refetch or hammer retries.
        staleTime: 5 * 60 * 1000,
        retry: false,
        refetchOnWindowFocus: false,
      },
      dehydrate: {
        serializeData: superjson.serialize,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
      hydrate: {
        deserializeData: superjson.deserialize,
      },
    },
  });
}
