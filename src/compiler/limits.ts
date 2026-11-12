export const SOURCE_LIMIT = 32 * 1024;
export const OUTPUT_LIMIT = 2 * 1024 * 1024;

export function byteLimit(text: string, maximum: number, label: string): void {
  // Avoid allocating a second huge string/buffer when it is already too long.
  if (text.length > maximum || new TextEncoder().encode(text).byteLength > maximum) {
    throw new Error(`Browser compiler: ${label} exceeds the ${maximum}-byte limit`);
  }
}
