import { useEffect } from "react";
import { editorStore } from "../state/editorStore";
import { saveAutosave } from "../lib/autosave";

export function useAutosave(): void {
  useEffect(() => {
    let timer: number | null = null;
    const unsubscribe = editorStore.subscribe(() => {
      const state = editorStore.getState();
      if (state.past.length === 0) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => saveAutosave(editorStore.getState().project), 1500);
    });
    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);
}
