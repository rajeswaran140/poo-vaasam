import { findSharedOutputKeys, type JobOutputs } from '@/lib/master-key-collisions';

const job = (over: Partial<JobOutputs>): JobOutputs => ({
  jobId: 'j',
  title: null,
  s3Key: 'audio/mastering/1_a_song.wav',
  masterKey: null,
  matchedMasterKey: null,
  savedAt: null,
  updatedAt: null,
  ...over,
});

describe('findSharedOutputKeys', () => {
  it('reports two jobs that name the same master, newest first', () => {
    const shared = findSharedOutputKeys([
      job({ jobId: 'old', masterKey: 'k-master-14LUFS.wav', updatedAt: '2026-09-01T00:00:00Z' }),
      job({ jobId: 'new', masterKey: 'k-master-14LUFS.wav', updatedAt: '2026-09-02T00:00:00Z' }),
      job({ jobId: 'alone', masterKey: 'other-master-14LUFS.wav' }),
    ]);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ key: 'k-master-14LUFS.wav', field: 'masterKey' });
    expect(shared[0].jobs.map((j) => j.jobId)).toEqual(['new', 'old']);
  });

  it('checks matched masters too, and ignores jobs with no output', () => {
    const shared = findSharedOutputKeys([
      job({ jobId: 'a', matchedMasterKey: 'k-matched-r.wav' }),
      job({ jobId: 'b', matchedMasterKey: 'k-matched-r.wav' }),
      job({ jobId: 'c' }),
      job({ jobId: 'd' }),
    ]);
    expect(shared.map((s) => [s.field, s.jobs.length])).toEqual([['matchedMasterKey', 2]]);
  });

  it('reports nothing when every job has its own file', () => {
    expect(findSharedOutputKeys([
      job({ jobId: 'a', masterKey: 'a_j1-master-14LUFS.wav' }),
      job({ jobId: 'b', masterKey: 'a_j2-master-14LUFS.wav' }),
    ])).toEqual([]);
  });
});
