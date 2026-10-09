// Single Source of Truth: aktueller Zustand + Projektdateien auf der Platte.

import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { newId } from '../shared/ids.js';
import { applyOp, createProject, defaultView, parseProject, touchesProject, type Op } from '../shared/state.js';
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

export class Store {
  state: AppState = { project: createProject('Neues Projekt', newId()), view: defaultView() };
  session: SessionMeta = { currentProjectId: null, dirty: false, projects: [] };
  private autosaveTimer: NodeJS.Timeout | null = null;

  /** Lädt den zuletzt aktiven Stand (auch ungespeichert), damit ein Neustart nichts verliert. */
  async init(): Promise<void> {
    try {
      const raw = (await readJson(CURRENT_FILE())) as Partial<CurrentFile>;
      const project = parseProject(raw.project);
      if (project) {
        this.state = { project, view: defaultView() };
        this.session.currentProjectId = typeof raw.currentProjectId === 'string' ? raw.currentProjectId : null;
        this.session.dirty = raw.dirty === true;
      }
    } catch {
      // Erster Start oder kaputte Datei → Standardprojekt
    }
    this.session.projects = await this.listProjects();
  }

  apply(op: Op): void {
    const next = applyOp(this.state, op);
    if (next === this.state) return;
    this.state = next;
    if (touchesProject(op)) {
      this.session.dirty = true;
      this.scheduleAutosave();
    }
  }

  // --- Projekte -------------------------------------------------------------

  async save(): Promise<void> {
    const id = this.session.currentProjectId ?? newId();
    await this.writeProject(id, this.state.project);
    this.session.currentProjectId = id;
    this.session.dirty = false;
    await this.afterProjectChange();
  }

  async saveAs(name: string): Promise<void> {
    const id = newId();
    this.state = { ...this.state, project: { ...this.state.project, name: cleanName(name) } };
    await this.writeProject(id, this.state.project);
    this.session.currentProjectId = id;
    this.session.dirty = false;
    await this.afterProjectChange();
  }

  async load(id: string): Promise<void> {
    const file = await this.readProjectFile(id);
    this.state = { project: file.project, view: { ...defaultView(), showOutlines: this.state.view.showOutlines } };
    this.session.currentProjectId = id;
    this.session.dirty = false;
    await this.afterProjectChange();
  }

  async newProject(name: string): Promise<void> {
    this.state = { project: createProject(cleanName(name), newId()), view: defaultView() };
    this.session.currentProjectId = null;
    this.session.dirty = true;
    await this.afterProjectChange();
  }

  async rename(id: string, name: string): Promise<void> {
    const file = await this.readProjectFile(id);
    file.project.name = cleanName(name);
    await this.writeProject(id, file.project);
    if (this.session.currentProjectId === id) {
      this.state = { ...this.state, project: { ...this.state.project, name: file.project.name } };
    }
    await this.afterProjectChange();
  }

  async delete(id: string): Promise<void> {
    await this.readProjectFile(id); // existiert?
    await unlink(projectFile(id));
    if (this.session.currentProjectId === id) {
      this.session.currentProjectId = null;
      this.session.dirty = true;
    }
    await this.afterProjectChange();
  }

  private async afterProjectChange(): Promise<void> {
    this.session.projects = await this.listProjects();
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
      currentProjectId: this.session.currentProjectId,
      dirty: this.session.dirty,
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
