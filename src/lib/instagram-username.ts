/** Normaliza handle para busca (remove @ em qualquer posição, espaços, chars invisíveis). */
export function normalizeInstagramUsername(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/@+/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}
