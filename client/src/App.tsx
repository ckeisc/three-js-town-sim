import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { Scene } from "./game/Scene";
import {
emptyGrid, gridToString, idx, starterGrid, stringToGrid, townStats,
type Grid, type Tile, type Tool, type TrainStatus,
} from "./game/types";

const TOOL_TILE: Partial<Record<Tool, Tile>> = {
  road: "R", house: "H", shop: "S", office: "O",
  park: "P", track: "T", station: "D", erase: ".",
};

const TOOLS: Array<{ id: Tool; label: string; color: string }> = [
  { id: "look", label: "Look", color: "#8ea2b5" },
  { id: "road", label: "Road", color: "#3c4043" },
  { id: "house", label: "House", color: "#d01012" },
  { id: "shop", label: "Shop", color: "#fe8a18" },
  { id: "office", label: "Office", color: "#0055bf" },
  { id: "park", label: "Park", color: "#237841" },
  { id: "track", label: "Track", color: "#8d9296" },
  { id: "station", label: "Station", color: "#0055bf" },
  { id: "erase", label: "Bulldoze", color: "#c4281c" },
];

const STATUS_TEXT: Record<TrainStatus, string> = {
  running: "Train is on the move",
  station: "Train is stopped at the station",
  stopped: "Train is stopped",
  "no-track": "No usable track — lay a loop!",
};

type SaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

export function App() {
  const queryClient = useQueryClient();
  const townQuery = useQuery({ queryKey: ["town"], queryFn: () => api.getTown({}) });

  const [grid, setGrid] = useState<Grid | null>(null);
  const [tool, setTool] = useState<Tool>("look");
  const [trainRunning, setTrainRunning] = useState(true);
  const [trainSpeed, setTrainSpeed] = useState(1);
  const [carCount, setCarCount] = useState(3);
  const [followTrain, setFollowTrain] = useState(false);
  const [whistleNonce, setWhistleNonce] = useState(0);
  const [resetCamNonce, setResetCamNonce] = useState(0);
  const [trainStatus, setTrainStatus] = useState<TrainStatus>("no-track");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [confirmClear, setConfirmClear] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const initedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // surface runtime errors instead of a black canvas
  useEffect(() => {
    const onErr = (e: ErrorEvent) => setErrorText(e.message || "Something went wrong");
    const onRej = (e: PromiseRejectionEvent) =>
      setErrorText(e.reason instanceof Error ? e.reason.message : "Something went wrong");
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  // initial load: saved town if there is one, otherwise the starter town
  useEffect(() => {
    if (initedRef.current || !townQuery.data) return;
    initedRef.current = true;
    const saved = townQuery.data.grid ? stringToGrid(townQuery.data.grid) : null;
    setGrid(saved ?? starterGrid());
    setSaveState(saved ? "saved" : "idle");
  }, [townQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (g: Grid) => api.saveTown({ grid: gridToString(g) }),
    onSuccess: () => {
      setSaveState("saved");
      void queryClient.invalidateQueries({ queryKey: ["town"] });
    },
    onError: () => setSaveState("error"),
  });
  const saveMutRef = useRef(saveMutation);
  saveMutRef.current = saveMutation;

  const clearMutation = useMutation({
    mutationFn: () => api.clearTown({}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["town"] }),
  });

  const scheduleSave = (g: Grid) => {
    setSaveState("unsaved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setSaveState("saving");
      saveMutRef.current.mutate(g);
    }, 1200);
  };

  const onPaint = (x: number, z: number) => {
    const tile = TOOL_TILE[tool];
    if (!tile) return;
    setGrid((prev) => {
      if (!prev) return prev;
      const i = idx(x, z);
      if (prev[i] === tile) return prev;
      const next = [...prev];
      next[i] = tile;
      scheduleSave(next);
      return next;
    });
  };

  const saveNow = () => {
    if (!grid) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveState("saving");
    saveMutation.mutate(grid);
  };

  const loadStarter = () => {
    const g = starterGrid();
    setGrid(g);
    scheduleSave(g);
    setConfirmClear(false);
  };

  const clearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    const g = emptyGrid();
    setGrid(g);
    scheduleSave(g);
    setConfirmClear(false);
  };

  const forgetSave = () => {
    clearMutation.mutate();
    setSaveState("idle");
  };

  const stats = useMemo(() => (grid ? townStats(grid) : null), [grid]);

  const hint =
    tool === "track"
      ? "Drag across tiles to lay track. Close a loop and the train will run it."
      : tool === "station"
        ? "Place a station on a straight stretch of track — the train will stop there."
        : tool === "road"
          ? "Drag to pave roads. Minifigs stroll along them."
          : tool === "erase"
            ? "Tap or drag to bulldoze tiles back to grass."
            : tool === "look"
              ? "Drag to orbit, pinch or scroll to zoom. Pick a brick below to build."
              : "Tap or drag on the baseplate to build.";

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#9fd3f0] text-[var(--text)] select-none">
      {grid && (
        <Scene
          grid={grid}
          tool={tool}
          onPaint={onPaint}
          trainRunning={trainRunning}
          trainSpeed={trainSpeed}
          carCount={carCount}
          followTrain={followTrain}
          whistleNonce={whistleNonce}
          resetCamNonce={resetCamNonce}
          onTrainStatus={setTrainStatus}
        />
      )}

      {!grid && (
        <div className="absolute inset-0 grid place-items-center bg-[#79b5d9]">
          <p className="font-display text-xl font-bold text-white drop-shadow">
            {townQuery.isError ? "Could not load your town — check your connection." : "Setting out the bricks…"}
          </p>
        </div>
      )}

      {errorText && (
        <div className="absolute inset-x-3 top-14 z-30 rounded-lg bg-red-700/95 px-3 py-2 text-sm shadow-lg">
          <span className="font-semibold">Oops: </span>
          {errorText}
          <button
            type="button"
            aria-label="Dismiss error"
            className="ml-2 underline"
            onClick={() => setErrorText(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* top bar: town plate + actions, stats chips on their own row below */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-col gap-1.5 pt-safe">
        <div className="flex items-start justify-between gap-2">
          <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-[#171a21]/85 px-3 py-2 shadow-lg backdrop-blur-sm">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[#d01012] font-display text-sm font-extrabold text-white shadow-inner">
              L
            </span>
            <div className="leading-tight">
              <p className="font-display text-base font-bold">Brickton</p>
              <p className="whitespace-nowrap text-[11px] text-[var(--dim)]">
                {saveState === "saved" && "Town saved"}
                {saveState === "saving" && "Saving…"}
                {saveState === "unsaved" && "Unsaved changes"}
                {saveState === "error" && "Save failed — tap Save"}
                {saveState === "idle" && "Starter town"}
              </p>
            </div>
          </div>
          <div className="pointer-events-auto flex flex-col items-end gap-1.5">
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={saveNow}
                disabled={!grid || saveState === "saving"}
                className="rounded-lg bg-[#237841] px-3 py-2 font-display text-sm font-bold whitespace-nowrap text-white shadow-lg transition active:scale-95 disabled:opacity-50"
              >
                Save town
              </button>
              <button
                type="button"
                aria-label="Reset camera"
                onClick={() => setResetCamNonce((n) => n + 1)}
                className="rounded-lg bg-[#171a21]/85 px-3 py-2 font-display text-sm font-bold whitespace-nowrap shadow-lg backdrop-blur-sm transition active:scale-95"
              >
                ⌂ View
              </button>
            </div>
            <div className="flex gap-1 text-[10.5px] font-semibold">
              <button
                type="button"
                onClick={loadStarter}
                className="rounded-full bg-[#171a21]/75 px-2 py-1 whitespace-nowrap backdrop-blur-sm transition active:scale-95"
              >
                Starter town
              </button>
              <button
                type="button"
                onClick={clearAll}
                className={`rounded-full px-2 py-1 whitespace-nowrap backdrop-blur-sm transition active:scale-95 ${
                  confirmClear ? "bg-[#c4281c] text-white" : "bg-[#171a21]/75"
                }`}
              >
                {confirmClear ? "Tap again to clear" : "Clear all"}
              </button>
              <button
                type="button"
                onClick={forgetSave}
                className="rounded-full bg-[#171a21]/75 px-2 py-1 whitespace-nowrap backdrop-blur-sm transition active:scale-95"
              >
                Forget save
              </button>
            </div>
          </div>
        </div>
        {stats && (
          <div className="pointer-events-auto flex gap-1.5 overflow-x-auto text-[11px] font-semibold">
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#171a21]/80 px-2.5 py-1 whitespace-nowrap backdrop-blur-sm">
              <span aria-hidden className="h-2 w-2 rounded-[2px] bg-[#d01012]" />
              {stats.buildings} buildings
            </span>
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#171a21]/80 px-2.5 py-1 whitespace-nowrap backdrop-blur-sm">
              <span aria-hidden className="h-2 w-2 rounded-[2px] bg-[#8d9296]" />
              {stats.trackPieces} track
            </span>
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#171a21]/80 px-2.5 py-1 whitespace-nowrap backdrop-blur-sm">
              <span aria-hidden className="h-2 w-2 rounded-[2px] bg-[#0055bf]" />
              {stats.stations} stations
            </span>
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#171a21]/80 px-2.5 py-1 whitespace-nowrap backdrop-blur-sm">
              <span aria-hidden className="h-2 w-2 rounded-[2px] bg-[#f2cd37]" />
              {stats.residents} residents
            </span>
          </div>
        )}
      </div>

      {/* bottom: hint + train panel + palette */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-1.5 px-3 pb-3 pb-safe">
        <p className="mx-auto max-w-md rounded-full bg-[#171a21]/75 px-3 py-1 text-center text-[11px] font-medium text-[#e8e6df] backdrop-blur-sm">
          {hint}
        </p>

        {/* train panel */}
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-[#171a21]/88 px-3 py-2 shadow-xl backdrop-blur-sm">
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <span
              aria-hidden
              className={`h-2.5 w-2.5 rounded-full ${
                trainStatus === "running"
                  ? "bg-[#37b24d]"
                  : trainStatus === "station"
                    ? "bg-[#f2cd37]"
                    : trainStatus === "stopped"
                      ? "bg-[#fe8a18]"
                      : "bg-[#c4281c]"
              }`}
            />
            {STATUS_TEXT[trainStatus]}
          </span>
          <span className="mx-0.5 hidden h-6 w-px bg-white/15 sm:block" />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label={trainRunning ? "Stop train" : "Start train"}
              aria-pressed={trainRunning}
              onClick={() => setTrainRunning((r) => !r)}
              className={`grid h-9 w-9 place-items-center rounded-lg font-display text-base font-extrabold text-white shadow transition active:scale-95 ${
                trainRunning ? "bg-[#c4281c]" : "bg-[#237841]"
              }`}
            >
              {trainRunning ? "■" : "▶"}
            </button>
            <button
              type="button"
              aria-label="Whistle"
              onClick={() => setWhistleNonce((n) => n + 1)}
              className="grid h-9 w-9 place-items-center rounded-lg bg-[#0055bf] shadow transition active:scale-95"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M3 10v4h3l5 4V6l-5 4H3z" fill="#fff" />
                <path d="M15 9c1.2 1 1.2 5 0 6M17.5 6.5c2.4 2.4 2.4 8.6 0 11" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Follow train"
              aria-pressed={followTrain}
              onClick={() => setFollowTrain((f) => !f)}
              className={`h-9 rounded-lg px-2.5 font-display text-sm font-bold shadow transition active:scale-95 ${
                followTrain ? "bg-[#f2cd37] text-[#171a21]" : "bg-white/12 text-white"
              }`}
            >
              Follow
            </button>
          </div>
          <label className="flex items-center gap-2 text-[12px] font-semibold">
            Speed
            <input
              type="range"
              aria-label="Train speed"
              min={0.4}
              max={2.6}
              step={0.2}
              value={trainSpeed}
              onChange={(e) => setTrainSpeed(Number(e.target.value))}
              className="w-24 accent-[#f2cd37]"
            />
          </label>
          <span className="flex items-center gap-1.5 text-[12px] font-semibold">
            <button
              type="button"
              aria-label="Remove wagon"
              onClick={() => setCarCount((c) => Math.max(1, c - 1))}
              className="grid h-8 w-8 place-items-center rounded-lg bg-white/12 font-display text-base font-bold transition active:scale-95"
            >
              −
            </button>
            {carCount} {carCount === 1 ? "car" : "cars"}
            <button
              type="button"
              aria-label="Add wagon"
              onClick={() => setCarCount((c) => Math.min(6, c + 1))}
              className="grid h-8 w-8 place-items-center rounded-lg bg-white/12 font-display text-base font-bold transition active:scale-95"
            >
              +
            </button>
          </span>
        </div>

        {/* build palette */}
        <div
          role="toolbar"
          aria-label="Building tools"
          className="mx-auto flex w-full max-w-2xl gap-1.5 overflow-x-auto rounded-xl bg-[#171a21]/88 p-1.5 shadow-xl backdrop-blur-sm"
        >
          {TOOLS.map((t) => {
            const active = tool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-label={`${t.label} tool`}
                aria-pressed={active}
                onClick={() => setTool(t.id)}
                className={`flex min-w-[62px] flex-1 flex-col items-center gap-1 rounded-lg px-1.5 py-1.5 transition active:scale-95 ${
                  active ? "bg-[#f2cd37] text-[#171a21]" : "bg-white/8 text-white"
                }`}
              >
                <span
                  aria-hidden
                  className="relative block h-4 w-8 rounded-[3px] shadow-inner"
                  style={{ backgroundColor: t.color }}
                >
                  <span className="absolute left-[5px] top-[3px] h-[5px] w-[5px] rounded-full bg-white/35" />
                  <span className="absolute right-[5px] top-[3px] h-[5px] w-[5px] rounded-full bg-white/35" />
                </span>
                <span className="font-display text-[12px] font-bold leading-none">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
