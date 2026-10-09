// Öffnet /output als eigenes Fenster – wenn möglich direkt auf dem zweiten Bildschirm (Beamer).
// Nutzt die Window Management API von Chrome; der Browser fragt beim ersten Mal nach der Erlaubnis
// „Fenster auf allen Bildschirmen verwalten“.

interface ScreenDetailed {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isPrimary: boolean;
  label?: string;
}

interface ScreenDetails {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
}

type WindowWithScreens = Window & { getScreenDetails?: () => Promise<ScreenDetails> };

export async function openOutputWindow(): Promise<{ ok: boolean; message: string }> {
  let features = 'popup,width=1280,height=720';
  let onBeamer = false;
  const w = window as WindowWithScreens;
  if (w.getScreenDetails) {
    try {
      const d = await w.getScreenDetails();
      const ext = d.screens.find((s) => s !== d.currentScreen) ?? d.screens.find((s) => !s.isPrimary);
      if (ext) {
        features = `popup,left=${ext.availLeft},top=${ext.availTop},width=${ext.availWidth},height=${ext.availHeight}`;
        onBeamer = true;
      }
    } catch {
      // Erlaubnis verweigert → normales Fenster
    }
  }
  const win = window.open('/output', 'pm-output', features);
  if (!win) {
    return { ok: false, message: 'Fenster wurde blockiert – bitte noch einmal klicken (oder Pop-ups für diese Seite erlauben).' };
  }
  win.focus();
  return {
    ok: true,
    message: onBeamer
      ? 'Ausgabe auf dem zweiten Bildschirm geöffnet – dort einmal klicken und F für Vollbild drücken.'
      : 'Ausgabe geöffnet – Fenster auf den Beamer ziehen, hineinklicken und F für Vollbild drücken.',
  };
}
