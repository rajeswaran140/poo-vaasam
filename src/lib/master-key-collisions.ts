/**
 * Which saved jobs point at the SAME output file — the damage the pre-2026-10-20
 * key naming could do.
 *
 * Output keys used to be built from (source, target) alone, so a second job on
 * the same upload and target wrote over the first job's master (and its MP3,
 * video and short, all named from it). Both job records still name that key;
 * only the job whose write landed last describes the bytes actually stored.
 * jobKeyToken in mastering-storage stops new collisions. This finds the old ones.
 *
 * Pure: the caller scans the table and stats S3. Read-only by construction.
 */

export interface JobOutputs {
  jobId: string;
  title: string | null;
  s3Key: string;
  masterKey: string | null;
  matchedMasterKey: string | null;
  savedAt: string | null;
  updatedAt: string | null;
}

export interface SharedKey {
  key: string;
  field: 'masterKey' | 'matchedMasterKey';
  /** Newest first by updatedAt — the first is the likeliest owner of the stored bytes. */
  jobs: JobOutputs[];
}

const FIELDS = ['masterKey', 'matchedMasterKey'] as const;

export function findSharedOutputKeys(jobs: JobOutputs[]): SharedKey[] {
  const groups = new Map<string, SharedKey>();
  for (const job of jobs) {
    for (const field of FIELDS) {
      const key = job[field];
      if (!key) continue;
      const g = groups.get(key) ?? { key, field, jobs: [] };
      g.jobs.push(job);
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .filter((g) => g.jobs.length > 1)
    .map((g) => ({ ...g, jobs: [...g.jobs].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
