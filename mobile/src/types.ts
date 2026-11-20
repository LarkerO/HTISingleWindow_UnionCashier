export type Environment = 'live' | 'sandbox';
export type User = { id: string; name?: string; minecraft_name?: string; uuid?: string; avatar_url?: string };
export type Status = { installed: boolean; user: User | null; plugin_online: boolean; oauth_error?: string; csrf: string };
export type Terms = { name: string; combine: boolean; front?: string };
export type PrepaidCard = { number: string; env: Environment; balance: number; terms: Terms; state: string };
export type Wallet = {
  environment: Environment; available: boolean; balances: Record<string, number | null>;
  requested: number | null; complete: boolean; cards: PrepaidCard[];
};
export type Order = {
  id: string; kind: 'pay' | 'hold' | 'agreement'; env: Environment; status: string;
  title: string; merchant_name: string; out_trade_no: string; amount: number;
  created: number; expires: number; return_url?: string; failure?: string;
};
export type Checkout = { order: Order; cards: PrepaidCard[]; payment_order: string[] };
export type Account = { orders: Order[] };
export type PaymentCard = {
  key: string; name: string; type: 'vault' | 'scoreboard' | 'prepaid';
  balance: number | null; detail: string; art?: string; combine?: boolean;
};
