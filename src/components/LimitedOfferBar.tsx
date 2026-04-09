import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlarmClock } from "lucide-react";
import { cn } from "@/lib/utils";

/** Campos que abrem teclado no celular — esconder faixa fixa evita iOS subir ela em cima do input. */
function opensTextKeyboard(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName !== "INPUT") return false;
  const input = el as HTMLInputElement;
  const skip = new Set(["button", "checkbox", "radio", "submit", "file", "hidden", "color", "range"]);
  return !skip.has(input.type);
}

const STORAGE_KEY = "flame_offer_deadline_ms";

function getOrCreateDeadline(): number {
  const now = Date.now();
  const raw = sessionStorage.getItem(STORAGE_KEY);
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < now) {
    const next = now + 15 * 60 * 1000;
    sessionStorage.setItem(STORAGE_KEY, String(next));
    return next;
  }
  return parsed;
}

function formatMmSs(msLeft: number): string {
  const t = Math.max(0, Math.floor(msLeft / 1000));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Acompanha a visual viewport (pinch-zoom / pan no mobile) para o fixed colar no que o usuário vê. */
function useVisualViewportBand() {
  const [layout, setLayout] = useState(() => ({
    top: 0,
    left: 0,
    width: typeof window !== "undefined" ? window.innerWidth : 0,
  }));

  useLayoutEffect(() => {
    const sync = () => {
      const vp = window.visualViewport;
      if (vp) {
        setLayout({
          top: vp.offsetTop,
          left: vp.offsetLeft,
          width: vp.width,
        });
      } else {
        setLayout({ top: 0, left: 0, width: window.innerWidth });
      }
    };

    sync();
    const vp = window.visualViewport;
    if (vp) {
      vp.addEventListener("resize", sync);
      vp.addEventListener("scroll", sync);
    }
    window.addEventListener("resize", sync);

    return () => {
      if (vp) {
        vp.removeEventListener("resize", sync);
        vp.removeEventListener("scroll", sync);
      }
      window.removeEventListener("resize", sync);
    };
  }, []);

  return layout;
}

/**
 * Navbar de oferta no topo: portal em document.body (fixed real) + VisualViewport (zoom no celular).
 * Prazo em sessionStorage: 15 min ao iniciar / ao renovar.
 */
function initialDisplay(): string {
  if (typeof sessionStorage === "undefined") return "15:00";
  let end = parseInt(sessionStorage.getItem(STORAGE_KEY) || "0", 10);
  const now = Date.now();
  if (!end || end < now) end = getOrCreateDeadline();
  return formatMmSs(end - now);
}

export function LimitedOfferBar() {
  const [display, setDisplay] = useState(initialDisplay);
  const [barVisible, setBarVisible] = useState(true);
  const [mounted, setMounted] = useState(false);
  const vv = useVisualViewportBand();

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const showBarSoon = () => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (!opensTextKeyboard(document.activeElement)) setBarVisible(true);
        }, 50);
      });
    };

    const onFocusIn = (e: FocusEvent) => {
      if (opensTextKeyboard(e.target)) setBarVisible(false);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", showBarSoon);

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", showBarSoon);
    };
  }, []);

  useEffect(() => {
    const tick = () => {
      let end = parseInt(sessionStorage.getItem(STORAGE_KEY) || "0", 10);
      const now = Date.now();
      if (!end || end < now) {
        sessionStorage.removeItem(STORAGE_KEY);
        end = getOrCreateDeadline();
      }
      setDisplay(formatMmSs(end - now));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const bar = (
    <div
      className={cn(
        "pointer-events-none transition-opacity duration-200 ease-out",
        barVisible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      style={{
        position: "fixed",
        top: vv.top,
        left: vv.left,
        width: vv.width,
        zIndex: 40,
      }}
      role="status"
      aria-live="polite"
      aria-hidden={!barVisible}
      aria-label={`Oferta por tempo limitado. Tempo restante: ${display}`}
    >
      <div
        className={cn(
          "pointer-events-auto w-full max-w-full border-b border-border/40 bg-background/95 backdrop-blur-md",
          "pt-[env(safe-area-inset-top,0px)] shadow-[0_8px_28px_rgba(0,0,0,0.35)]",
        )}
      >
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-center gap-x-2 gap-y-1 px-[max(1rem,env(safe-area-inset-left,0px))] py-2.5 pr-[max(1rem,env(safe-area-inset-right,0px))] min-[400px]:gap-x-3 min-[400px]:py-3">
          <AlarmClock
            className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6 md:h-7 md:w-7"
            strokeWidth={2}
            aria-hidden
          />
          <span className="shrink-0 font-mono text-base font-bold tabular-nums leading-none text-primary sm:text-lg md:text-xl">
            {display}
          </span>
          <span className="hidden h-3.5 w-px shrink-0 bg-border min-[380px]:block" aria-hidden />
          <span className="min-w-0 max-w-[min(100%,18rem)] text-center text-[0.6875rem] font-medium leading-snug text-muted-foreground min-[380px]:max-w-none min-[380px]:text-xs md:text-sm">
            Oferta por tempo limitado
          </span>
        </div>
      </div>
    </div>
  );

  if (!mounted || typeof document === "undefined") {
    return null;
  }

  return createPortal(bar, document.body);
}
