import { mockJobs } from '@/data/mockStore';
import type { TranscriptionListData } from '@/types';

export default async function getTranscriptionsMock(): Promise<TranscriptionListData> {
  return { jobs: mockJobs.map((job) => ({ ...job })) };
}
