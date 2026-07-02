import { Injectable } from "@nestjs/common";
import {
  AccountBalance,
  BillerCustomer,
  BillerOption,
  BillPaymentResult,
  CablePaymentResult,
  CheckoutOrder,
  CreateVirtualAccountInput,
  MeterType,
  PaymentProviderPort,
  RefundResult,
  RefundTransactionInput,
  TransactionStatus,
  TransferResult,
  UpdateVirtualAccountInput,
  VirtualAccountDetails
} from "@paadi/domain";

@Injectable()
export class MockNombaProvider extends PaymentProviderPort {
  private readonly virtualAccounts = new Map<string, VirtualAccountDetails>();
  async createCheckoutOrder(amountKobo: number, reference: string): Promise<CheckoutOrder> {
    void amountKobo;
    return { reference, checkoutLink: `https://checkout.nomba.com/pay/mock-${reference}` };
  }

  async verifyTransaction(reference: string): Promise<TransactionStatus> {
    return {
      success: true,
      reference,
      transactionId: `mock-txn-${reference}`,
      amountKobo: 0,
      status: "SUCCESS"
    };
  }

  async verifyTransactionById(transactionId: string): Promise<TransactionStatus> {
    return {
      success: true,
      reference: `mock-ref-${transactionId}`,
      transactionId,
      amountKobo: 0,
      status: "SUCCESS"
    };
  }

  async transferToBank(
    accountNumber: string,
    accountName: string,
    bankCode: string,
    amountKobo: number,
    merchantTxRef: string,
    senderName: string
  ): Promise<TransferResult> {
    void accountNumber;
    void accountName;
    void bankCode;
    void amountKobo;
    void senderName;
    return { status: "success", reference: merchantTxRef, transferId: `mock-transfer-${merchantTxRef}` };
  }

  async walletTransfer(
    receiverAccountId: string,
    amountKobo: number,
    merchantTxRef: string,
    senderName: string
  ): Promise<TransferResult> {
    void receiverAccountId;
    void amountKobo;
    void senderName;
    return { status: "success", reference: merchantTxRef };
  }

  async payElectricity(
    disco: string,
    customerId: string,
    meterType: MeterType,
    amountKobo: number,
    merchantTxRef: string,
    payerName: string
  ): Promise<BillPaymentResult> {
    void disco;
    void customerId;
    void meterType;
    void amountKobo;
    void merchantTxRef;
    void payerName;
    return { vendToken: "MOCK-1234-5678", units: "23.5" };
  }

  async payCable(
    cableTvType: string,
    customerId: string,
    amountKobo: number,
    merchantTxRef: string,
    payerName: string
  ): Promise<CablePaymentResult> {
    void cableTvType;
    void customerId;
    void amountKobo;
    void merchantTxRef;
    void payerName;
    return { status: "SUCCESS" };
  }

  async listElectricityDiscos(): Promise<BillerOption[]> {
    return [
      { code: "phed", name: "PHED" },
      { code: "ikeja", name: "Ikeja Electric" }
    ];
  }

  async lookupElectricityCustomer(
    disco: string,
    customerId: string,
    meterType: MeterType
  ): Promise<BillerCustomer> {
    void disco;
    void customerId;
    void meterType;
    return { customerName: "ADA OKEKE" };
  }

  async listCableProducts(cableTvType: string): Promise<BillerOption[]> {
    void cableTvType;
    return [{ code: "dstv-compact", name: "DStv Compact", amountKobo: 1050000 }];
  }

  async lookupCableCustomer(cableTvType: string, customerId: string): Promise<BillerCustomer> {
    void cableTvType;
    void customerId;
    return { customerName: "ADA OKEKE" };
  }

  async listBanks(): Promise<{ code: string; name: string }[]> {
    return [
      { code: "011", name: "First Bank" },
      { code: "058", name: "GTBank" },
      { code: "033", name: "UBA" },
      { code: "090267", name: "Kuda" }
    ];
  }

  async lookupAccountName(
    accountNumber: string,
    bankCode: string
  ): Promise<{ accountName: string }> {
    void accountNumber;
    void bankCode;
    return { accountName: "ADA OKEKE" };
  }

  async refundTransaction(input: RefundTransactionInput): Promise<RefundResult> {
    return { success: true, nombaRef: `mock-refund-${input.transactionId}` };
  }

  async createVirtualAccount(input: CreateVirtualAccountInput): Promise<VirtualAccountDetails> {
    const existing = this.virtualAccounts.get(input.accountRef);
    if (existing) {
      return existing;
    }
    const details: VirtualAccountDetails = {
      accountHolderId: `mock-va-${input.accountRef}`,
      accountRef: input.accountRef,
      accountNumber: this.deterministicNuban(input.accountRef),
      accountName: `Nomba/${input.accountName}`,
      providerBank: "Paadi MFB",
      currency: "NGN",
      expired: false
    };
    this.virtualAccounts.set(input.accountRef, details);
    return details;
  }

  async fetchVirtualAccount(identifier: string): Promise<VirtualAccountDetails | null> {
    return this.virtualAccounts.get(identifier) ?? null;
  }

  async updateVirtualAccount(identifier: string, input: UpdateVirtualAccountInput): Promise<VirtualAccountDetails> {
    const existing = this.virtualAccounts.get(identifier);
    const base: VirtualAccountDetails = existing ?? {
      accountHolderId: `mock-va-${identifier}`,
      accountRef: identifier,
      accountNumber: this.deterministicNuban(identifier),
      accountName: "",
      providerBank: "Paadi MFB",
      currency: "NGN",
      expired: false
    };
    const updated: VirtualAccountDetails = {
      ...base,
      accountName: input.accountName === undefined ? base.accountName : `Nomba/${input.accountName}`
    };
    this.virtualAccounts.set(identifier, updated);
    return updated;
  }

  async expireVirtualAccount(identifier: string): Promise<void> {
    const existing = this.virtualAccounts.get(identifier);
    if (existing) {
      this.virtualAccounts.set(identifier, { ...existing, expired: true });
    }
  }

  async fetchAccountBalance(): Promise<AccountBalance | null> {
    return { availableKobo: 1_000_000_000 };
  }

  private deterministicNuban(accountRef: string): string {
    let hash = 0;
    for (let index = 0; index < accountRef.length; index++) {
      hash = (hash * 31 + accountRef.charCodeAt(index)) % 1_000_000_000;
    }
    return `9${hash.toString().padStart(9, "0")}`;
  }
}
