import Taro from '@tarojs/taro';
import { callFunction } from '@/services/cloud';
import type {
  CreateTranscriptionData,
  TranscriptionData,
  TranscriptionListData
} from '@/types';

export interface CreateTranscriptionInput {
  fileID: string;
  fileName: string;
  fileSize: number;
  language: string;
  model: string;
  withSrt: boolean;
}

export async function uploadMedia(filePath: string, fileName: string): Promise<string> {
  if (process.env.TARO_ENV === 'weapp') {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const cloudPath = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
    console.info('[Upload] 开始上传音视频', { fileName, cloudPath });
    const result = await Taro.cloud.uploadFile({ cloudPath, filePath });
    console.info('[Upload] 上传完成', { fileID: result.fileID });
    return result.fileID;
  }
  return `mock://${Date.now()}-${fileName}`;
}

export function createTranscription(
  input: CreateTranscriptionInput
): Promise<CreateTranscriptionData> {
  return callFunction<CreateTranscriptionData>('createTranscription', { ...input });
}

export function getTranscription(id: string): Promise<TranscriptionData> {
  return callFunction<TranscriptionData>('getTranscription', { id });
}

export function getTranscriptions(): Promise<TranscriptionListData> {
  return callFunction<TranscriptionListData>('getTranscriptions');
}
