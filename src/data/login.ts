import { mockAccount, mockOrders } from '@/data/mockStore';
import type { LoginData } from '@/types';

export default async function loginMock(): Promise<LoginData> {
  return {
    openid: 'mock-openid',
    account: { ...mockAccount },
    recentOrders: mockOrders.map((order) => ({ ...order }))
  };
}
