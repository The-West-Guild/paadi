export interface NombaWebhookBody {
  event_type?: string;
  requestId?: string;
  data?: {
    merchant?: { userId?: string; walletId?: string };
    order?: { orderReference?: string; amount?: string; paymentMethod?: string; currency?: string };
    transaction?: {
      transactionId?: string;
      type?: string;
      time?: string;
      responseCode?: string;
      transactionAmount?: string;
      merchantTxRef?: string;
      aliasAccountNumber?: string;
      aliasAccountType?: string;
      aliasAccountName?: string;
      aliasAccountReference?: string;
    };
    customer?: {
      billerId?: string;
      productId?: string;
      senderName?: string;
      accountNumber?: string;
      bankName?: string;
      bankCode?: string;
    };
  };
}
