"use client";

import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { Fragment, useState } from "react";

import { useTRPC } from "@/trpc/client";
import type { AppRouter } from "@/trpc/routers/_app";

type FindPathOutput = inferRouterOutputs<AppRouter>["pathfinding"]["findPath"];
type PathNode = FindPathOutput["path"][number];
type PathStep = FindPathOutput["steps"][number];

const PRESETS: { label: string; start: string; end: string }[] = [
  { label: "Einstein → Plato", start: "Albert Einstein", end: "Plato" },
  { label: "Newton → Aristotle", start: "Isaac Newton", end: "Aristotle" },
  { label: "Napoleon → Caesar", start: "Napoleon", end: "Julius Caesar" },
  { label: "Darwin → Galileo", start: "Charles Darwin", end: "Galileo Galilei" },
];

export default function Home() {
  const trpc = useTRPC();
  const [start, setStart] = useState("Albert Einstein");
  const [end, setEnd] = useState("Plato");
  const [submitted, setSubmitted] = useState<{ start: string; end: string } | null>(null);

  const query = useQuery(
    trpc.pathfinding.findPath.queryOptions(
      { start: submitted?.start ?? "", end: submitted?.end ?? "" },
      { enabled: submitted !== null },
    ),
  );

  const canSubmit = start.trim().length > 0 && end.trim().length > 0 && !query.isFetching;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!start.trim() || !end.trim()) return;
    setSubmitted({ start: start.trim(), end: end.trim() });
  }

  function runPreset(p: { start: string; end: string }) {
    setStart(p.start);
    setEnd(p.end);
    setSubmitted({ start: p.start, end: p.end });
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Utility bar */}
      <div className="border-b border-hairline bg-surface-1">
        <div className="mx-auto flex h-8 max-w-[1312px] items-center justify-between px-4 text-[12px] leading-none tracking-[0.32px] text-ink-muted sm:px-6">
          <span>Algorithm Strategy · Paper</span>
          <span className="hidden sm:block">Wikidata Query Service</span>
        </div>
      </div>

      {/* Top nav */}
      <header className="sticky top-0 z-10 border-b border-hairline bg-canvas">
        <div className="mx-auto flex h-12 max-w-[1312px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-baseline gap-2">
            <span className="text-[16px] font-semibold tracking-[0.16px] text-ink">PATHFINDER</span>
            <span className="text-[14px] text-ink-subtle">/ six degrees</span>
          </div>
          <nav className="flex items-center gap-6 text-[14px] text-ink-muted">
            <a
              href="https://query.wikidata.org"
              target="_blank"
              rel="noreferrer"
              className="text-ibm-blue transition-colors hover:text-ibm-blue-60"
            >
              Wikidata ↗
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-[1312px] px-4 py-16 sm:px-6 sm:py-24">
          <p className="mb-4 text-[14px] tracking-[0.16px] text-ibm-blue">
            Spatiotemporal A* · Wikidata graph
          </p>
          <h1 className="max-w-3xl text-[42px] font-light leading-[1.17] tracking-[-0.4px] text-ink sm:text-[60px]">
            The shortest connection between two figures.
          </h1>
          <p className="mt-6 max-w-2xl text-[18px] leading-[1.5] text-ink-muted">
            Pick two notable figures. We pull a subgraph of the most popular figures from Wikidata
            each one carrying where and when they lived. Then, run A* over their interpersonal links
            to connect the pair with spatiotemporal weights.
          </p>
        </div>
      </section>

      {/* Search */}
      <section id="search" className="border-b border-hairline">
        <div className="mx-auto max-w-[1312px] px-4 py-12 sm:px-6">
          <form onSubmit={handleSubmit} className="grid gap-6 sm:grid-cols-[1fr_1fr_auto]">
            <Field
              label="Start person"
              hint="e.g. Albert Einstein"
              value={start}
              onChange={setStart}
            />
            <Field
              label="End person"
              hint="e.g. Plato"
              value={end}
              onChange={setEnd}
            />
            <div className="flex items-end">
              <button
                type="submit"
                disabled={!canSubmit}
                className="h-12 w-full bg-ibm-blue px-5 text-[14px] tracking-[0.16px] text-white transition-colors hover:bg-ibm-blue-hover disabled:cursor-not-allowed disabled:bg-ink-subtle sm:w-auto"
              >
                {query.isFetching ? "Searching…" : "Find path"}
              </button>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[14px]">
            <span className="text-ink-subtle">Try:</span>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => runPreset(p)}
                disabled={query.isFetching}
                className="border border-hairline bg-canvas px-3 py-1.5 text-ink-muted transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {p.label}
              </button>
            ))}
          </div>

          <p className="mt-4 max-w-2xl text-[12px] leading-[1.33] tracking-[0.32px] text-ink-subtle">
            Type a person&apos;s name or its Wikidata ID (starting with &quot;Q&quot;). We match it to Wikidata (the most popular match wins, so
            spelling matters). The first search can take up to a minute while the subgraph is built.
          </p>
        </div>
      </section>

      {/* Results */}
      <main className="mx-auto w-full max-w-[1312px] flex-1 px-4 py-12 sm:px-6">
        {submitted === null && <HowItWorks />}
        {submitted !== null && query.isFetching && (
          <LoadingPanel start={submitted.start} end={submitted.end} />
        )}
        {!query.isFetching && query.isError && (
          <ErrorPanel message={query.error.message} />
        )}
        {!query.isFetching &&
          query.data &&
          (query.data.found ? (
            <PathResult data={query.data} />
          ) : (
            <NoPathPanel data={query.data} />
          ))}
      </main>

      {/* Footer */}
      <footer className="bg-inverse-canvas">
        <div className="mx-auto max-w-[1312px] px-4 py-16 sm:px-6">
          <div className="flex flex-col justify-between gap-8 sm:flex-row">
            <div>
              <p className="text-[20px] font-light text-inverse-ink">PATHFINDER</p>
              <p className="mt-2 max-w-sm text-[14px] leading-[1.5] text-inverse-ink-muted">
                Spatiotemporal A* pathfinding between popular people, sourced from the Wikidata Query
                Service.
              </p>
            </div>
            <div className="text-[14px] text-inverse-ink-muted">
              <p className="text-inverse-ink">Algorithm Strategy · Paper</p>
              <p className="mt-2">Data: Wikidata (CC0)</p>
              <a
                href="https://query.wikidata.org"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block underline transition-colors hover:text-inverse-ink"
              >
                query.wikidata.org
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form field (Carbon input: surface fill + bottom rule, blue underline on focus)
// ---------------------------------------------------------------------------

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[12px] tracking-[0.32px] text-ink-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint}
        className="w-full border-b border-hairline-strong bg-surface-1 px-4 py-3 text-[16px] text-ink outline-none transition-[border] placeholder:text-ink-subtle focus:border-b-2 focus:border-ibm-blue"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Result states
// ---------------------------------------------------------------------------

function LoadingPanel({ start, end }: { start: string; end: string }) {
  return (
    <div className="border-l-2 border-ibm-blue bg-surface-1 p-6">
      <p className="text-[16px] text-ink">Building the Wikidata subgraph and searching…</p>
      <p className="mt-2 text-[14px] leading-[1.5] text-ink-muted">
        Connecting <span className="font-mono text-ink">{start}</span> →{" "}
        <span className="font-mono text-ink">{end}</span>. The first fetch can take up to a minute
        while we pull the most popular figures and all their interpersonal links.
      </p>
      <div className="pf-progress relative mt-6 h-1 w-full overflow-hidden bg-surface-2">
        <span />
      </div>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="border-l-2 border-error bg-surface-1 p-6">
      <p className="text-[14px] font-semibold tracking-[0.16px] text-ink">Something went wrong</p>
      <p className="mt-2 break-words text-[14px] leading-[1.5] text-ink-muted">{message}</p>
    </div>
  );
}

function NoPathPanel({ data }: { data: FindPathOutput }) {
  return (
    <div className="space-y-8">
      <div className="border-l-2 border-warning bg-surface-1 p-6">
        <p className="text-[16px] text-ink">No path found.</p>
        <p className="mt-2 max-w-2xl text-[14px] leading-[1.5] text-ink-muted">
          <span className="text-ink">{data.start.name}</span> and{" "}
          <span className="text-ink">{data.end.name}</span> aren&apos;t connected within the fetched
          subgraph. Try different endpoints, or widen the graph (more occupations / a higher
          per-occupation count) so a connecting person can appear.
        </p>
      </div>
      <StatsRow stats={data.stats} hops={null} />
    </div>
  );
}

function PathResult({ data }: { data: FindPathOutput }) {
  return (
    <div className="space-y-10">
      <div>
        <p className="mb-2 text-[14px] tracking-[0.16px] text-ibm-blue">Path found</p>
        <h2 className="text-[32px] font-light leading-[1.25] text-ink">
          {data.start.name} <span className="text-ink-subtle">→</span> {data.end.name}
        </h2>
        <p className="mt-2 text-[16px] text-ink-muted">
          Connected in {data.hops} {data.hops === 1 ? "step" : "steps"}.
        </p>
      </div>

      <StatsRow stats={data.stats} hops={data.hops} />

      <div className="flex flex-col">
        {data.path.map((node, i) => (
          <Fragment key={node.id}>
            <div className="flex gap-4">
              <div className="flex w-8 flex-none justify-center">
                <div className="flex h-8 w-8 items-center justify-center bg-ink text-[14px] text-white">
                  {i + 1}
                </div>
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <PersonCard node={node} />
              </div>
            </div>
            {i < data.path.length - 1 && <Connector step={data.steps[i]} />}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function Connector({ step }: { step: PathStep }) {
  return (
    <div className="flex gap-4">
      <div className="flex w-8 flex-none justify-center">
        <div className="h-10 w-px bg-hairline-strong" />
      </div>
      <div
        className="flex items-center text-[12px] tracking-[0.32px] text-ibm-blue"
        title={step.property ?? undefined}
      >
        {step.relation}
        {step.reversed && <span className="ml-1 text-ink-subtle">(reverse)</span>}
      </div>
    </div>
  );
}

function PersonCard({ node }: { node: PathNode }) {
  return (
    <div className="border border-hairline bg-canvas p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[24px] font-normal leading-[1.33] text-ink">{node.name}</h3>
        <span className="flex-none font-mono text-[12px] text-ink-subtle">{node.id}</span>
      </div>
      {node.description && (
        <p className="mt-1 text-[14px] leading-[1.29] text-ink-muted">{node.description}</p>
      )}
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Meta label="When" value={formatYears(node.birthYear, node.deathYear)} />
        <Meta label="Where" value={formatPlace(node)} />
        <Meta label="Popularity" value={`${node.sitelinks.toLocaleString()} sitelinks`} />
      </dl>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div>
      <dt className="text-[12px] tracking-[0.32px] text-ink-subtle">{label}</dt>
      <dd className="mt-1 text-[14px] text-ink">{value ?? "—"}</dd>
    </div>
  );
}

function StatsRow({ stats, hops }: { stats: FindPathOutput["stats"]; hops: number | null }) {
  const items = [
    { label: "Hops", value: hops === null ? "—" : String(hops) },
    { label: "Graph nodes", value: stats.nodes.toLocaleString() },
    { label: "Graph edges", value: stats.edges.toLocaleString() },
    { label: "Build time", value: `${(stats.buildMs / 1000).toFixed(1)}s` },
    { label: "Search time", value: `${stats.searchMs} ms` },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px border border-hairline bg-hairline sm:grid-cols-5">
      {items.map((i) => (
        <div key={i.label} className="bg-canvas p-4">
          <dt className="text-[12px] tracking-[0.32px] text-ink-muted">{i.label}</dt>
          <dd className="mt-1 text-[24px] font-light text-ink">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Idle state
// ---------------------------------------------------------------------------

function HowItWorks() {
  const cards = [
    {
      t: "Spatiotemporal nodes",
      b: "Each person is a point in space and time, such as birthplace latitude/longitude and birth/death years, pulled from Wikidata.",
    },
    {
      t: "Interpersonal edges",
      b: "People link through real relationships: influenced-by, teacher/student, doctoral lineage, family, spouse, partner.",
    },
    {
      t: "A* search",
      b: "A heuristic search walks the graph from start to end, guided by spatial and temporal distance, and returns the chain it finds.",
    },
  ];
  return (
    <div id="how">
      <p className="mb-2 text-[14px] tracking-[0.16px] text-ibm-blue">How it works</p>
      <h2 className="text-[32px] font-light leading-[1.25] text-ink">Three pieces</h2>
      <div className="mt-8 grid gap-px border border-hairline bg-hairline sm:grid-cols-3">
        {cards.map((c, i) => (
          <div key={c.t} className="bg-canvas p-6">
            <span className="font-mono text-[12px] text-ink-subtle">0{i + 1}</span>
            <h3 className="mt-3 text-[20px] leading-[1.4] text-ink">{c.t}</h3>
            <p className="mt-2 text-[14px] leading-[1.5] text-ink-muted">{c.b}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatYears(birthYear?: number, deathYear?: number): string {
  const fmt = (y?: number) => (y === undefined ? "?" : y < 0 ? `${-y} BCE` : `${y}`);
  if (birthYear === undefined && deathYear === undefined) return "Unknown";
  return `${fmt(birthYear)} – ${deathYear === undefined ? "present" : fmt(deathYear)}`;
}

function formatPlace(node: PathNode): string | undefined {
  if (node.lat !== undefined && node.lon !== undefined) {
    const lat = `${Math.abs(node.lat).toFixed(1)}°${node.lat >= 0 ? "N" : "S"}`;
    const lon = `${Math.abs(node.lon).toFixed(1)}°${node.lon >= 0 ? "E" : "W"}`;
    return node.country ? `${node.country} · ${lat} ${lon}` : `${lat} ${lon}`;
  }
  return node.country ?? undefined;
}
