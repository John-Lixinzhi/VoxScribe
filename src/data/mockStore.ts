import type { Account, Order, Plan, TranscriptionJob, TranscriptionResult } from '@/types';

export const mockResult: TranscriptionResult = {
  text: '欢迎使用 VoxScribe。音视频已上传到云端，系统会自动识别语音并整理为带时间轴的字幕。转写完成后，你可以复制纯文本，也可以复制 SRT 字幕用于剪辑。',
  srt: '1\n00:00:00,000 --> 00:00:04,200\n欢迎使用 VoxScribe。\n\n2\n00:00:04,200 --> 00:00:10,800\n音视频已上传到云端，系统会自动识别语音并整理为带时间轴的字幕。\n\n3\n00:00:10,800 --> 00:00:17,500\n转写完成后，你可以复制纯文本，也可以复制 SRT 字幕用于剪辑。\n',
  json: JSON.stringify({
    language: 'zh',
    duration: 17.5,
    segments: [
      { start: 0, end: 4.2, text: '欢迎使用 VoxScribe。' },
      { start: 4.2, end: 10.8, text: '音视频已上传到云端，系统会自动识别语音并整理为带时间轴的字幕。' },
      { start: 10.8, end: 17.5, text: '转写完成后，你可以复制纯文本，也可以复制 SRT 字幕用于剪辑。' }
    ]
  }, null, 2),
  duration: 17.5,
  language: 'zh'
};

const now = Date.now();

export const mockAccount: Account = {
  nickname: '微信用户',
  remainingSeconds: 600,
  usedSeconds: 3720,
  freeQuotaSeconds: 600
};

export const mockPlans: Plan[] = [
  { id: 'minutes_60', name: '轻量包', seconds: 3600, priceFen: 990, description: '60 分钟，适合会议片段与短视频' },
  { id: 'minutes_240', name: '进阶包', seconds: 14400, priceFen: 2490, description: '240 分钟，适合课程与访谈', tag: '最受欢迎' },
  { id: 'minutes_600', name: '创作包', seconds: 600 * 60, priceFen: 4990, description: '600 分钟，适合持续内容生产', tag: '单价更低' }
];

export const mockJobs: TranscriptionJob[] = [
  {
    _id: 'job_demo_completed',
    fileName: '产品讨论会.m4a',
    fileSize: 8_420_000,
    status: 'completed',
    progress: 100,
    language: 'auto',
    model: 'small',
    withSrt: true,
    createdAt: new Date(now - 3600_000).toISOString(),
    updatedAt: new Date(now - 3500_000).toISOString(),
    result: mockResult
  },
  {
    _id: 'job_demo_processing',
    fileName: '课程录制第三章.mp4',
    fileSize: 86_000_000,
    status: 'processing',
    progress: 62,
    language: 'zh',
    model: 'small',
    withSrt: true,
    createdAt: new Date(now - 480_000).toISOString(),
    updatedAt: new Date(now - 5_000).toISOString()
  },
  {
    _id: 'job_demo_queued',
    fileName: '客户访谈.wav',
    fileSize: 22_600_000,
    status: 'queued',
    progress: 0,
    language: 'auto',
    model: 'medium',
    withSrt: true,
    createdAt: new Date(now - 120_000).toISOString(),
    updatedAt: new Date(now - 120_000).toISOString()
  },
  {
    _id: 'job_demo_failed',
    fileName: '损坏的录音.aac',
    fileSize: 1_200_000,
    status: 'failed',
    progress: 0,
    language: 'auto',
    model: 'small',
    withSrt: false,
    createdAt: new Date(now - 7200_000).toISOString(),
    updatedAt: new Date(now - 7100_000).toISOString(),
    error: '无法读取音轨，请检查文件后重试'
  }
];

export const mockOrders: Order[] = [];
export const mockPollCounts: Record<string, number> = {};
