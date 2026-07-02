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
import { NombaClient } from "./nomba.client";

@Injectable()
export class NombaProvider extends PaymentProviderPort {
  constructor(private readonly client: NombaClient) {
    super();
  }

  createCheckoutOrder(amountKobo: number, reference: string): Promise<CheckoutOrder> {
    return this.client.createCheckoutOrder(amountKobo, reference);
  }

  verifyTransaction(reference: string): Promise<TransactionStatus> {
    return this.client.verifyTransaction(reference);
  }

  verifyTransactionById(transactionId: string): Promise<TransactionStatus> {
    return this.client.verifyTransactionById(transactionId);
  }

  transferToBank(
    accountNumber: string,
    accountName: string,
    bankCode: string,
    amountKobo: number,
    merchantTxRef: string,
    senderName: string
  ): Promise<TransferResult> {
    return this.client.transferToBank(accountNumber, accountName, bankCode, amountKobo, merchantTxRef, senderName);
  }

  walletTransfer(
    receiverAccountId: string,
    amountKobo: number,
    merchantTxRef: string,
    senderName: string
  ): Promise<TransferResult> {
    return this.client.walletTransfer(receiverAccountId, amountKobo, merchantTxRef, senderName);
  }

  payElectricity(
    disco: string,
    customerId: string,
    meterType: MeterType,
    amountKobo: number,
    merchantTxRef: string,
    payerName: string
  ): Promise<BillPaymentResult> {
    return this.client.payElectricity(disco, customerId, meterType, amountKobo, merchantTxRef, payerName);
  }

  payCable(
    cableTvType: string,
    customerId: string,
    amountKobo: number,
    merchantTxRef: string,
    payerName: string
  ): Promise<CablePaymentResult> {
    return this.client.payCable(cableTvType, customerId, amountKobo, merchantTxRef, payerName);
  }

  listElectricityDiscos(): Promise<BillerOption[]> {
    return this.client.listElectricityDiscos();
  }

  lookupElectricityCustomer(disco: string, customerId: string, meterType: MeterType): Promise<BillerCustomer> {
    return this.client.lookupElectricityCustomer(disco, customerId, meterType);
  }

  listCableProducts(cableTvType: string): Promise<BillerOption[]> {
    return this.client.listCableProducts(cableTvType);
  }

  lookupCableCustomer(cableTvType: string, customerId: string): Promise<BillerCustomer> {
    return this.client.lookupCableCustomer(cableTvType, customerId);
  }

  listBanks(): Promise<{ code: string; name: string }[]> {
    return this.client.listBanks();
  }

  lookupAccountName(accountNumber: string, bankCode: string): Promise<{ accountName: string }> {
    return this.client.lookupAccountName(accountNumber, bankCode);
  }

  refundTransaction(input: RefundTransactionInput): Promise<RefundResult> {
    return this.client.refundTransaction(input);
  }

  createVirtualAccount(input: CreateVirtualAccountInput): Promise<VirtualAccountDetails> {
    return this.client.createVirtualAccount(input);
  }

  fetchVirtualAccount(identifier: string): Promise<VirtualAccountDetails | null> {
    return this.client.fetchVirtualAccount(identifier);
  }

  updateVirtualAccount(identifier: string, input: UpdateVirtualAccountInput): Promise<VirtualAccountDetails> {
    return this.client.updateVirtualAccount(identifier, input);
  }

  expireVirtualAccount(identifier: string): Promise<void> {
    return this.client.expireVirtualAccount(identifier);
  }

  fetchAccountBalance(): Promise<AccountBalance | null> {
    return this.client.fetchAccountBalance();
  }
}
