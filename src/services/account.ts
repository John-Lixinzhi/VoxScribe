import { callFunction } from '@/services/cloud';
import type { LoginData } from '@/types';

export function getAccount(): Promise<LoginData> {
  return callFunction<LoginData>('login');
}
