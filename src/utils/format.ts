import dayjs from 'dayjs';
import type { TranscriptionStatus } from '@/types';

export const JOB_STATUS_TEXT: Record<TranscriptionStatus, string> = {
  queued: '排队中',
  processing: '转写中',
  completed: '已完成',
  failed: '失败'
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }
  if (minutes > 0) {
    return `${minutes} 分钟`;
  }
  return `${total} 秒`;
}

export function formatDateTime(value: string): string {
  return dayjs(value).format('MM-DD HH:mm');
}

export function formatPrice(priceFen: number): string {
  return (priceFen / 100).toFixed(priceFen % 100 === 0 ? 0 : 1);
}
