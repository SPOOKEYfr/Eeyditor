import { useEffect } from "react";
import { editorStore } from "../state/editorStore";
import { openProject, saveProject } from "../lib/projectFile";
import { clearAutosave } from "../lib/autosave";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return;
      const store = editorStore;
      const state = store.getState();
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const frame = 1 / state.project.frameRate;

      if (key === "?" || (event.shiftKey && key === "/")) {
        event.preventDefault();
        store.setShortcuts(!state.showShortcuts);
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        store.togglePlay();
        return;
      }

      if (mod && key === "z" && !event.shiftKey) {
        event.preventDefault();
        store.undo();
        return;
      }
      if ((mod && key === "z" && event.shiftKey) || (mod && key === "y")) {
        event.preventDefault();
        store.redo();
        return;
      }
      if (mod && key === "b") {
        event.preventDefault();
        store.splitAtPlayhead();
        return;
      }
      if (mod && key === "c") {
        event.preventDefault();
        store.copySelectedClip();
        return;
      }
      if (mod && key === "x") {
        event.preventDefault();
        store.cutSelectedClip();
        return;
      }
      if (mod && key === "v") {
        event.preventDefault();
        store.pasteClipboard();
        return;
      }
      if (mod && key === "s") {
        event.preventDefault();
        void saveProject(state.project).then((message) => editorStore.setStatus(message))
          .catch(() => editorStore.setStatus("Save failed"));
        return;
      }
      if (mod && key === "o") {
        event.preventDefault();
        void openProject().then((project) => {
          if (!project) return;
          clearAutosave();
          editorStore.loadProject(project);
        });
        return;
      }
      if (mod && key === "d") {
        event.preventDefault();
        store.duplicateSelectedClip();
        return;
      }
      if (mod) return;

      switch (key) {
        case "v":
          store.setTool("select");
          break;
        case "c":
          store.setTool("blade");
          break;
        case "s":
          store.toggleSnap();
          break;
        case "k":
          store.setPlaying(false);
          break;
        case "l":
          store.setPlaying(true);
          break;
        case "j":
          store.setPlaying(false);
          store.setPlayhead(state.playhead - frame);
          break;
        case "delete":
        case "backspace":
          event.preventDefault();
          store.rippleDeleteSelected();
          break;
        case "m":
          store.addMarker(state.playhead);
          break;
        case "arrowleft":
          store.setPlayhead(state.playhead - (event.shiftKey ? 1 : frame));
          break;
        case "arrowright":
          store.setPlayhead(state.playhead + (event.shiftKey ? 1 : frame));
          break;
        case "=":
        case "+":
          store.zoomBy(1.2);
          break;
        case "-":
          store.zoomBy(1 / 1.2);
          break;
        case "home":
          store.setPlayhead(0);
          break;
        case "end":
          store.setPlayhead(state.project.duration);
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
