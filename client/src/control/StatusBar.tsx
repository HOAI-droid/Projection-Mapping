import { useSnapshot } from './store';

export function StatusBar() {
  const snap = useSnapshot();
  const output = snap.presence.outputs[0];
  const server = snap.status === 'online';
  const name = snap.state?.project.name ?? '…';

  let outLabel = 'Keine Ausgabe';
  let outClass = 'bad';
  if (server && output) {
    outLabel = `Ausgabe · ${output.fps} fps`;
    outClass = output.fps >= 50 ? 'ok' : output.fps >= 25 ? 'warn' : 'bad';
    if (snap.presence.outputs.length > 1) outLabel += ` (+${snap.presence.outputs.length - 1})`;
  }

  return (
    <header className="statusbar">
      <div className="project-name" title={name}>
        {name}
        {snap.session?.dirty && <span className="dirty" title="Ungespeicherte Änderungen"> •</span>}
      </div>
      <div className="pills">
        <span className={`pill ${server ? 'ok' : 'bad'}`} title={snap.rtt !== null ? `${snap.rtt} ms` : undefined}>
          {server ? 'Server' : snap.status === 'connecting' ? 'Verbinde …' : 'Offline'}
        </span>
        <span className={`pill ${outClass}`}>{outLabel}</span>
      </div>
      {server && output && !output.started && (
        <div className="hint">Auf der Ausgabe einmal „Tippen zum Starten“ antippen.</div>
      )}
    </header>
  );
}
