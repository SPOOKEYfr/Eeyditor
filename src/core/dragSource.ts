/** Source id currently dragged from the media bin (set on dragstart). */
let current: string | null = null;

export function setDragSource(sourceId: string | null): void {
  current = sourceId;
}

export function dragSource(): string | null {
  return current;
}
