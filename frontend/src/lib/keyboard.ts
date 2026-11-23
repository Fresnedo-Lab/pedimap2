// lib/keyboard.ts
// ===============
// Keyboard shortcuts must never act while the user types.

/** True when a key event's target takes text or a choice: an input, a text
 *  area, a select, or anything editable (or inside such an element). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return target.isContentEditable || target.closest("[contenteditable=''], [contenteditable='true']") !== null;
}
