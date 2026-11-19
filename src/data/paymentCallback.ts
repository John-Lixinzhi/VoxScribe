export default async function paymentCallbackMock(): Promise<{ received: boolean; demo: boolean }> {
  return { received: true, demo: true };
}
