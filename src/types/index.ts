export type TranscriptionStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface TranscriptionResult {
  text: string;
  srt: string;
  json: string;
  duration: number;
  language: string;
}

export interface TranscriptionJob {
  _id: string;
  fileName: string;
  fileSize: number;
  status: TranscriptionStatus;
  progress: number;
  language: string;
  model: string;
  withSrt: boolean;
  createdAt: string;
  updatedAt: string;
  error?: string;
  result?: TranscriptionResult;
}

export interface Account {
  nickname: string;
  remainingSeconds: number;
  usedSeconds: number;
  freeQuotaSeconds: number;
}

export interface LoginData {
  openid: string;
  account: Account;
  recentOrders: Order[];
}

export interface Plan {
  id: string;
  name: string;
  seconds: number;
  priceFen: number;
  description: string;
  tag?: string;
}

export type OrderStatus = 'pending' | 'paid' | 'failed';

export interface Order {
  _id: string;
  outTradeNo: string;
  planId: string;
  planName: string;
  seconds: number;
  amountFen: number;
  status: OrderStatus;
  createdAt: string;
}

export interface PaymentParams {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'MD5' | 'HMAC-SHA256' | 'RSA';
  paySign: string;
}

export interface CreateTranscriptionData {
  job: TranscriptionJob;
}

export interface TranscriptionData {
  job: TranscriptionJob;
}

export interface TranscriptionListData {
  jobs: TranscriptionJob[];
}

export interface PlansData {
  plans: Plan[];
}

export interface CreateOrderData {
  order: Order;
  payment: PaymentParams | null;
}
