// Single Source of Truth: aktueller Zustand + Projektdateien auf der Platte.

import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { newId } from '../shared/ids.js';
import { applyOp, createProject, defaultShow, defaultView, parseProject, touchesProject, undoable, type Op } from '../shared/state.js';
import type { AppState, Project, ProjectMeta, SessionMeta } from '../shared/types.js';
import { config } from './config.js';
import { readJson, writeJsonAtomic } from './fsutil.js';

interface ProjectFile {
  id: string;
  updatedAt: string;
  project: Project;
}

interface CurrentFile {
  currentProjectId: string | null;
  dirty: boolean;
  project: Project;
}

const CURRENT_FILE = () => join(config.dataDir, 'current.json');
const projectFile = (id: string) => join(config.projectsDir, `${id}.json`);

export class StoreError extends Error {}

const HISTORY_LIMIT = 200;

export class Store {
  state: AppState = { project: createProject('Neues Projekt', newId()), view: defaultView(), show: defaultShow() };
  private meta = { currentProjectId: null as string | null, dirty: false, projects: [] as ProjectMeta[] };
  private autosaveTimer: NodeJS.Timeout | null = null;
  // Rückgängig/Wiederherstellen: Projekt-Schnappschüsse (unveränderliche Objekte, daher billig)
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private lastGesture: string | null = null;

  get session(): SessionMeta {
    return { ...this.meta, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 };
  }

  /** Lädt den zuletzt aktiven Stand (auch ungespeichert), damit ein Neustart nichts verliert. */
  async init(): Promise<void> {
    try {
      const raw = (await readJson(CURRENT_FILE())) as Partial<CurrentFile>;
      const project = parseProject(raw.project);
      if (project) {
        this.state = { project, view: defaultView(), show: defaultShow() };
        this.meta.currentProjectId = typeof raw.currentProjectId === 'string' ? raw.currentProjectId : null;
        this.meta.dirty = raw.dirty === true;
      }
    } catch {
      // Erster Start oder kaputte Datei → Standardprojekt
    }
    this.meta.projects = await this.listProjects();
  }

  /** Wendet eine Operation an. Gibt false zurück, wenn sie nichts geändert hat. */
  apply(op: Op, gesture?: string): boolean {
    const prev = this.state;
    const next = applyOp(prev, op);
    if (next === prev) return false;
    this.state = next;
    if (touchesProject(op)) {
      // Neue Geste → neuer Rückgängig-Schritt; Folge-Ops derselben Geste werden zusammengefasst
      if (undoable(op) && (!gesture || gesture !== this.lastGesture)) {
        this.undoStack.push(prev.project);
        if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
        this.redoStack = [];
      }
      this.lastGesture = gesture ?? null;
      this.meta.dirty = true;
      this.scheduleAutosave();
    }
    return true;
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.state.project);
    this.restore(prev);
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.state.project);
    this.restore(next);
    return true;
  }

  private restore(project: Project): void {
    this.state = { ...this.state, project };
    this.lastGesture = null;
    this.meta.dirty = true;
    this.scheduleAutosave();
  }

  private clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastGesture = null;
  }

  // --- Projekte -------------------------------------------------------------

  async save(): Promise<void> {
    const id = this.meta.currentProjectId ?? newId();
    await this.writeProject(id, this.state.project);
    this.meta.currentProjectId = id;
    this.meta.dirty = false;
    await this.refreshList();
  }

  async saveAs(name: string): Promise<void> {
    const id = newId();
    this.state = { ...this.state, project: { ...this.state.project, name: cleanName(name) } };
    await this.writeProject(id, this.state.project);
    this.meta.currentProjectId = id;
    this.meta.dirty = false;
    await this.refreshList();
  }

  async load(id: string): Promise<void> {
    const file = await this.readProjectFile(id);
    // Ansichtseinstellungen (Bearbeiten, Snap, Raster) beibehalten, Auswahl zurücksetzen
    const { editMode, snap, grid } = this.state.view;
    this.state = { project: file.project, view: { ...defaultView(), editMode, snap, grid }, show: defaultShow() };
    this.meta.currentProjectId = id;
    this.meta.dirty = false;
    await this.afterProjectChange();
  }

  async newProject(name: string): Promise<void> {
    this.state = { project: createProject(cleanName(name), newId()), view: defaultView(), show: defaultShow() };
    this.meta.currentProjectId = null;
    this.meta.dirty = true;
    await this.afterProjectChange();
  }

  async rename(id: string, name: string): Promise<void> {
    const file = await this.readProjectFile(id);
    file.project.name = cleanName(name);
    await this.writeProject(id, file.project);
    if (this.meta.currentProjectId === id) {
      this.state = { ...this.state, project: { ...this.state.project, name: file.project.name } };
    }
    await this.refreshList();
  }

  async delete(id: string): Promise<void> {
    await this.readProjectFile(id); // existiert?
    await unlink(projectFile(id));
    if (this.meta.currentProjectId === id) {
      this.meta.currentProjectId = null;
      this.meta.dirty = true;
    }
    await this.refreshList();
  }

  /** Nach Laden/Neu: Verlauf gehört zum alten Projekt → verwerfen */
  private async afterProjectChange(): Promise<void> {
    this.clearHistory();
    await this.refreshList();
  }

  private async refreshList(): Promise<void> {
    this.meta.projects = await this.listProjects();
    await this.writeCurrent();
  }

  private async writeProject(id: string, project: Project): Promise<void> {
    const file: ProjectFile = { id, updatedAt: new Date().toISOString(), project };
    await writeJsonAtomic(projectFile(id), file);
  }

  private async readProjectFile(id: string): Promise<ProjectFile> {
    if (!/^[a-z0-9]{1,64}$/.test(id)) throw new StoreError('Ungültige Projekt-ID');
    let raw: Partial<ProjectFile>;
    try {
      raw = (await readJson(projectFile(id))) as Partial<ProjectFile>;
    } catch {
      throw new StoreError('Projekt nicht gefunden');
    }
    const project = parseProject(raw.project);
    if (!project) throw new StoreError('Projektdatei ist beschädigt');
    return { id, updatedAt: String(raw.updatedAt ?? ''), project };
  }

  private async listProjects(): Promise<ProjectMeta[]> {
    let names: string[];
    try {
      names = await readdir(config.projectsDir);
    } catch {
      return [];
    }
    const metas: ProjectMeta[] = [];
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      try {
        const f = await this.readProjectFile(n.slice(0, -5));
        metas.push({ id: f.id, name: f.project.name, updatedAt: f.updatedAt });
      } catch {
        // kaputte Dateien überspringen
      }
    }
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  // --- Autosave -------------------------------------------------------------

  private scheduleAutosave(): void {
    if (this.autosaveTimer) return;
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      this.writeCurrent().catch((err) => console.error('Autosave fehlgeschlagen:', err));
    }, 1000);
  }

  async writeCurrent(): Promise<void> {
    const data: CurrentFile = {
      currentProjectId: this.meta.currentProjectId,
      dirty: this.meta.dirty,
      project: this.state.project,
    };
    await writeJsonAtomic(CURRENT_FILE(), data);
  }

  async flush(): Promise<void> {
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    await this.writeCurrent();
  }
}

function cleanName(name: string): string {
  const n = name.trim().slice(0, 100);
  if (!n) throw new StoreError('Bitte einen Namen angeben');
  return n;
}
