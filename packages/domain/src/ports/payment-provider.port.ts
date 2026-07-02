export interface CheckoutOrder {
  reference: string;
  checkoutLink: string;
}

export interface BillPaymentResult {
  vendToken: string;
  units?: string;
}

export interface TransferResult {
  status: string;
  reference: string;
  transferId?: string;
}

export interface TransactionStatus {
  success: boolean;
  reference: string;
  transactionId: string;
  amountKobo: number;
  status: string;
}

export interface CablePaymentResult {
  status: string;
}

export interface BillerOption {
  code: string;
  name: string;
  amountKobo?: number;
}

export interface BillerCustomer {
  customerName: string;
}

export interface RefundTransactionInput {
  transactionId: string;
  amountKobo?: number;
  accountNumber?: string;
  bankCode?: string;
}

export interface RefundResult {
  success: boolean;
  nombaRef?: string;
}

export type MeterType = "PREPAID" | "POSTPAID";

export interface VirtualAccountDetails {
  accountHolderId: string;
  accountRef: string;
  accountNumber: string;
  accountName: string;
  providerBank: string;
  currency: string;
  expired: boolean;
}

export interface CreateVirtualAccountInput {
  accountRef: string;
  accountName: string;
  bvn?: string;
}

export interface UpdateVirtualAccountInput {
  accountName?: string;
}

export interface AccountBalance {
  availableKobo: number;
}

export abstract class PaymentProviderPort {
  abstract createCheckoutOrder(amountKobo: number, reference: string): Promise<CheckoutOrder>;
  abstract verifyTransaction(reference: string): Promise<TransactionStatus>;
  abstract verifyTransactionById(transactionId: string): Promise<TransactionStatus>;
  abstract transferToBank(
    accountNumber: string,
    accountName: string,
    bankCode: string,
    amountKobo: number,
    merchantTxRef: string,
    senderName: string
  ): Promise<TransferResult>;
  abstract walletTransfer(
    receiverAccountId: string,
    amountKobo: number,
    merchantTxRef: string,
    senderName: string
  ): Promise<TransferResult>;
  abstract payElectricity(
    disco: string,
    customerId: string,
    meterType: MeterType,
    amountKobo: number,
    merchantTxRef: string,
    payerName: string
  ): Promise<BillPaymentResult>;
  abstract payCable(
    cableTvType: string,
    customerId: string,
    amountKobo: number,
    merchantTxRef: string,
    payerName: string
  ): Promise<CablePaymentResult>;
  abstract listElectricityDiscos(): Promise<BillerOption[]>;
  abstract lookupElectricityCustomer(
    disco: string,
    customerId: string,
    meterType: MeterType
  ): Promise<BillerCustomer>;
  abstract listCableProducts(cableTvType: string): Promise<BillerOption[]>;
  abstract lookupCableCustomer(cableTvType: string, customerId: string): Promise<BillerCustomer>;
  abstract listBanks(): Promise<{ code: string; name: string }[]>;
  abstract lookupAccountName(accountNumber: string, bankCode: string): Promise<{ accountName: string }>;
  abstract refundTransaction(input: RefundTransactionInput): Promise<RefundResult>;
  abstract createVirtualAccount(input: CreateVirtualAccountInput): Promise<VirtualAccountDetails>;
  abstract fetchVirtualAccount(identifier: string): Promise<VirtualAccountDetails | null>;
  abstract updateVirtualAccount(
    identifier: string,
    input: UpdateVirtualAccountInput
  ): Promise<VirtualAccountDetails>;
  abstract expireVirtualAccount(identifier: string): Promise<void>;
  abstract fetchAccountBalance(): Promise<AccountBalance | null>;
}
