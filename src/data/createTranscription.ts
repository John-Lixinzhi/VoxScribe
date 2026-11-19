import { mockAccount, mockJobs, mockPollCounts } from '@/data/mockStore';
import type { CreateTranscriptionData, TranscriptionJob } from '@/types';

export default async function createTranscriptionMock(
  data: Record<string, unknown>
): Promise<CreateTranscriptionData> {
  if (mockAccount.remainingSeconds < 60) {
    throw new Error('可用时长不足，请先充值');
  }
  const timestamp = new Date().toISOString();
  const id = `job_${Date.now()}`;
  const job: TranscriptionJob = {
    _id: id,
    fileName: String(data.fileName || '未命名音视频'),
    fileSize: Number(data.fileSize || 0),
    status: 'queued',
    progress: 0,
    language: String(data.language || 'auto'),
    model: String(data.model || 'small'),
    withSrt: data.withSrt !== false,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  mockJobs.unshift(job);
  mockPollCounts[id] = 0;
  console.info('[Mock] 已创建转写任务', { id, fileName: job.fileName });
  return { job };
}
