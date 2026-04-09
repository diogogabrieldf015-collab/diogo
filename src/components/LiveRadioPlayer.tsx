import { useCallback, useEffect, useRef, useState } from "react";
import { Coffee, Pause, Radio, SlidersHorizontal, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Stream MP3 público SomaFM (ambient). Podes trocar por `VITE_LIVE_RADIO_STREAM_URL` — ver termos em somafm.com. */
const DEFAULT_STREAM_MP3 = "https://ice5.somafm.com/groovesalad-128-mp3";

/** Volume inicial ao dar Play (4% — bem baixo para não assustar). */
const PLAY_START_VOLUME = 0.04;

type LiveRadioPlayerProps = {
  /** `sidebar` = ao lado do “Bem-vindo” na barra lateral. `floating` = canto da tela (legado). */
  variant?: "floating" | "sidebar";
  /** Chamado quando o estado de reprodução muda (ex.: animar avatar na sidebar). */
  onPlayingChange?: (playing: boolean) => void;
};

/**
 * Rádio no admin. Stream padrão se não houver env. Autoplay com som bloqueado: tocar em Play.
 */
export function LiveRadioPlayer({ variant = "floating", onPlayingChange }: LiveRadioPlayerProps) {
  const envUrl = String(import.meta.env.VITE_LIVE_RADIO_STREAM_URL ?? "").trim();
  const streamUrl = envUrl || DEFAULT_STREAM_MP3;
  const envTitle = String(import.meta.env.VITE_LIVE_RADIO_TITLE ?? "").trim();
  const title = envTitle || (envUrl ? "Jazz & Coffee · ao vivo" : "Groove Salad · SomaFM");

  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(PLAY_START_VOLUME);
  const [error, setError] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const syncAudioProps = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = Math.min(1, Math.max(0, volume));
    a.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    syncAudioProps();
  }, [syncAudioProps]);

  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  const togglePlay = async () => {
    const a = audioRef.current;
    if (!a) return;
    setError(false);
    try {
      if (playing) {
        a.pause();
        setPlaying(false);
      } else {
        setVolume(PLAY_START_VOLUME);
        a.volume = PLAY_START_VOLUME;
        await a.play();
        setPlaying(true);
      }
    } catch {
      setError(true);
      setPlaying(false);
    }
  };

  const audioEl = (
    <audio
      ref={audioRef}
      src={streamUrl}
      preload="none"
      playsInline
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onError={() => {
        setError(true);
        setPlaying(false);
      }}
    />
  );

  if (variant === "sidebar") {
    return (
      <>
        {audioEl}
        <div
          className="relative z-[210] flex shrink-0 flex-col items-end gap-0.5"
          role="region"
          aria-label="Rádio ao vivo"
        >
          {error && (
            <span className="max-w-[4.5rem] text-right text-[8px] leading-tight text-destructive">Erro no stream</span>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void togglePlay()}
              title={title}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg border border-primary/45 bg-primary/15 text-primary shadow-sm",
                "ring-1 ring-primary/20 hover:bg-primary/25",
              )}
              aria-pressed={playing}
              aria-label={playing ? "Pausar rádio" : "Tocar rádio"}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title="Volume e som"
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/60 text-foreground",
                    "hover:bg-muted",
                  )}
                  aria-label="Volume"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                sideOffset={8}
                className="z-[300] w-56 border-border bg-card p-3 shadow-xl"
              >
                <p className="truncate text-xs font-semibold text-foreground">{title}</p>
                <p className="mb-3 text-[10px] text-muted-foreground">Ao vivo · ajuste o volume</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMuted((m) => !m)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 hover:bg-muted"
                    aria-label={muted ? "Ativar som" : "Silenciar"}
                  >
                    {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={(e) => {
                      setVolume(Number(e.target.value));
                      if (muted && Number(e.target.value) > 0) setMuted(false);
                    }}
                    className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
                    aria-label="Volume"
                  />
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {audioEl}
      <div
        className={cn(
          "fixed z-[200] flex max-w-[min(100vw-1.5rem,20rem)] flex-col gap-1 rounded-xl border border-primary/35 bg-background/95 p-2 shadow-lg shadow-black/40 backdrop-blur-md",
          "end-3 max-md:bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))]",
          "md:bottom-6 md:end-6",
        )}
        role="region"
        aria-label="Rádio ao vivo"
      >
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15 text-primary hover:bg-primary/25"
            aria-expanded={false}
            title={title}
          >
            <Radio className="h-5 w-5" aria-hidden />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2 pe-1">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Coffee className="h-4 w-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold leading-tight text-foreground">{title}</p>
                <p className="text-[10px] text-muted-foreground">Ao vivo · toque para ouvir</p>
              </div>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="shrink-0 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Minimizar player"
              >
                −
              </button>
            </div>
            {error && (
              <p className="rounded-md bg-destructive/15 px-2 py-1 text-[10px] text-destructive">
                Não foi possível carregar o stream. Confira o URL e CORS do servidor.
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void togglePlay()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg gradient-instagram text-primary-foreground shadow-sm hover:opacity-95"
                aria-pressed={playing}
                aria-label={playing ? "Pausar" : "Tocar"}
              >
                {playing ? <Pause className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-foreground hover:bg-muted"
                aria-label={muted ? "Ativar som" : "Silenciar"}
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => {
                  setVolume(Number(e.target.value));
                  if (muted && Number(e.target.value) > 0) setMuted(false);
                }}
                className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
                aria-label="Volume"
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}
