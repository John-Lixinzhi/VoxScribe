import { mockAccount, mockJobs, mockResult } from '@/data/mockStore';
import type { TranscriptionData } from '@/types';

export default async function getTranscriptionMock(
  data: Record<string, unknown>
): Promise<TranscriptionData> {
  const id = String(data.id || '');
  const job = mockJobs.find((item) => item._id === id);
  if (!job) throw new Error('转写任务不存在');

  if (job.status === 'queued') {
    job.status = 'processing';
    job.progress = 12;
  } else if (job.status === 'processing') {
    job.progress = Math.min(100, job.progress + 24);
    if (job.progress >= 100) {
      job.status = 'completed';
      job.result = { ...mockResult };
      const billedSeconds = Math.max(1, Math.ceil(mockResult.duration));
      mockAccount.remainingSeconds = Math.max(0, mockAccount.remainingSeconds - billedSeconds);
      mockAccount.usedSeconds += billedSeconds;
    }
  }
  job.updatedAt = new Date().toISOString();

  return {
    job: {
      ...job,
      result: job.result ? { ...job.result } : undefined
    }
  };
}
