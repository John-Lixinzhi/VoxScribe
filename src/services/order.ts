import { callFunction } from '@/services/cloud';
import type { CreateOrderData, PlansData } from '@/types';

export function getPlans(): Promise<PlansData> {
  return callFunction<PlansData>('getPlans');
}

export function createOrder(planId: string): Promise<CreateOrderData> {
  return callFunction<CreateOrderData>('createOrder', { planId });
}
