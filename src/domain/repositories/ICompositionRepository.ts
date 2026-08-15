/**
 * Composition repository port — persistence for the Composition Notebook.
 */

import type {
  Composition,
  CompositionSummary,
  CreateCompositionInput,
  UpdateCompositionInput,
  AddCompositionVersionInput,
} from '@/types/composition';

export interface ICompositionRepository {
  create(input: CreateCompositionInput): Promise<Composition>;
  /** Full record including every version snapshot. */
  findById(id: string): Promise<Composition | null>;
  /** List view — metadata only, newest first. */
  list(): Promise<CompositionSummary[]>;
  /** Update the working state. Never touches stored versions. */
  update(id: string, updates: UpdateCompositionInput): Promise<Composition>;
  /** Snapshot the current (or supplied) spec as a new immutable version. */
  addVersion(id: string, input: AddCompositionVersionInput): Promise<Composition>;
  delete(id: string): Promise<void>;
}
