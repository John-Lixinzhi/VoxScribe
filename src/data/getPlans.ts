import { mockPlans } from '@/data/mockStore';
import type { PlansData } from '@/types';

export default async function getPlansMock(): Promise<PlansData> {
  return { plans: mockPlans.map((plan) => ({ ...plan })) };
}
