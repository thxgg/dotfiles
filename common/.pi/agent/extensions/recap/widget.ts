import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const WIDGET_KEY = "session-recap";
const PREFIX = "  recap: ";
const CONTINUATION = "         ";

export function showWidget(ctx: ExtensionContext, text: string): void {
  ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => {
    let cachedWidth: number | undefined;
    let cachedLines: string[] | undefined;
    return {
      render(width: number): string[] {
        if (cachedWidth === width && cachedLines) return cachedLines;
        if (width <= 0) return [];
        if (width <= PREFIX.length) {
          cachedLines = [truncateToWidth(theme.fg("text", theme.bold(PREFIX.trim())), width, "")];
        } else {
          const wrapped = wrapTextWithAnsi(text, Math.max(1, width - CONTINUATION.length));
          cachedLines = [...wrapped.map((line, index) => truncateToWidth(
            index === 0
              ? `  ${theme.fg("text", theme.bold("recap: "))}${theme.fg("dim", line)}`
              : theme.fg("dim", `${CONTINUATION}${line}`),
            width,
            "",
          )), ""];
        }
        cachedWidth = width;
        return cachedLines;
      },
      invalidate(): void {
        cachedWidth = undefined;
        cachedLines = undefined;
      },
    };
  }, { placement: "aboveEditor" });
}

export function clearWidget(ctx: ExtensionContext): void {
  if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined, { placement: "aboveEditor" });
}
