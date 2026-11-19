import { mockOrders, mockPlans } from '@/data/mockStore';
import type { CreateOrderData, Order } from '@/types';

export default async function createOrderMock(
  data: Record<string, unknown>
): Promise<CreateOrderData> {
  const plan = mockPlans.find((item) => item.id === data.planId);
  if (!plan) throw new Error('所选套餐不存在');
  const timestamp = new Date().toISOString();
  const order: Order = {
    _id: `order_${Date.now()}`,
    outTradeNo: `DEMO${Date.now()}`,
    planId: plan.id,
    planName: plan.name,
    seconds: plan.seconds,
    amountFen: plan.priceFen,
    status: 'pending',
    createdAt: timestamp
  };
  mockOrders.unshift(order);
  return { order, payment: null };
}
