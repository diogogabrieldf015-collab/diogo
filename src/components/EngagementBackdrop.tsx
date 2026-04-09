import type { LucideIcon } from "lucide-react";
import { Bookmark, Heart, MessageCircle, Send, Share2, Sparkles, Star, UserPlus } from "lucide-react";

type Placement = {
  left: string;
  top: string;
  Icon: LucideIcon;
  size: number;
  duration: number;
  delay: number;
  animClass:
    | "animate-engagement-drift-a"
    | "animate-engagement-drift-b"
    | "animate-engagement-drift-c"
    | "animate-engagement-drift-d";
};

/** Posições fixas (evita diferença SSR/cliente). Ícones da cor primária discretos. */
const PLACEMENTS: Placement[] = [
  { left: "6%", top: "14%", Icon: Heart, size: 28, duration: 19, delay: 0, animClass: "animate-engagement-drift-a" },
  { left: "18%", top: "72%", Icon: MessageCircle, size: 24, duration: 23, delay: 1.2, animClass: "animate-engagement-drift-b" },
  { left: "82%", top: "11%", Icon: UserPlus, size: 26, duration: 17, delay: 0.6, animClass: "animate-engagement-drift-d" },
  { left: "91%", top: "48%", Icon: Heart, size: 22, duration: 21, delay: 2.4, animClass: "animate-engagement-drift-c" },
  { left: "12%", top: "38%", Icon: Share2, size: 20, duration: 25, delay: 0.3, animClass: "animate-engagement-drift-d" },
  { left: "44%", top: "8%", Icon: Bookmark, size: 22, duration: 18, delay: 3.1, animClass: "animate-engagement-drift-b" },
  { left: "72%", top: "22%", Icon: Send, size: 21, duration: 22, delay: 1.1, animClass: "animate-engagement-drift-a" },
  { left: "28%", top: "88%", Icon: Star, size: 18, duration: 20, delay: 1.8, animClass: "animate-engagement-drift-d" },
  { left: "55%", top: "62%", Icon: Heart, size: 32, duration: 16, delay: 0.15, animClass: "animate-engagement-drift-c" },
  { left: "3%", top: "55%", Icon: Sparkles, size: 20, duration: 24, delay: 3.6, animClass: "animate-engagement-drift-b" },
  { left: "68%", top: "78%", Icon: MessageCircle, size: 24, duration: 18, delay: 0.7, animClass: "animate-engagement-drift-a" },
  { left: "38%", top: "28%", Icon: UserPlus, size: 19, duration: 26, delay: 2.7, animClass: "animate-engagement-drift-d" },
  { left: "88%", top: "82%", Icon: Bookmark, size: 23, duration: 19, delay: 0.5, animClass: "animate-engagement-drift-c" },
  { left: "50%", top: "42%", Icon: Heart, size: 16, duration: 23, delay: 3.3, animClass: "animate-engagement-drift-b" },
  { left: "22%", top: "52%", Icon: Share2, size: 18, duration: 21, delay: 1.6, animClass: "animate-engagement-drift-a" },
  { left: "95%", top: "28%", Icon: Star, size: 17, duration: 22, delay: 0.9, animClass: "animate-engagement-drift-d" },
  { left: "58%", top: "18%", Icon: Send, size: 19, duration: 20, delay: 2.9, animClass: "animate-engagement-drift-c" },
  { left: "76%", top: "56%", Icon: Sparkles, size: 21, duration: 17, delay: 0.25, animClass: "animate-engagement-drift-b" },
];

export function EngagementBackdrop() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden overscroll-none [contain:paint]"
      aria-hidden
    >
      {PLACEMENTS.map((p, i) => (
        <p.Icon
          key={i}
          className={`absolute text-primary will-change-transform ${p.animClass}`}
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            opacity: 0.17,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
          strokeWidth={1.35}
        />
      ))}
    </div>
  );
}
