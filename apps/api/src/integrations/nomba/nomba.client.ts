import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AccountBalance,
  BillerCustomer,
  BillerOption,
  BillPaymentResult,
  CablePaymentResult,
  CheckoutOrder,
  CreateVirtualAccountInput,
  MeterType,
  RefundResult,
  RefundTransactionInput,
  TransactionStatus,
  TransferResult,
  UpdateVirtualAccountInput,
  VirtualAccountDetails
} from "@paadi/domain";

const SKEW_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_LIFETIME_MS = 30 * 60 * 1000;

@Injectable()
export class NombaClient {
  private cachedToken: { accessToken: string; expiresAt: number } | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {}

  async createCheckoutOrder(amountKobo: number, reference: string): Promise<CheckoutOrder> {
    const { data } = await this.call<{ orderReference?: string; checkoutLink?: string }>("/v1/checkout/order", {
      method: "POST",
      body: {
        order: {
          callbackUrl: this.config.get<string>("nomba.checkoutCallbackUrl") ?? "",
          customerEmail: this.config.get<string>("nomba.checkoutEmail") ?? "",
          amount: this.nairaString(amountKobo),
          currency: "NGN",
          orderReference: reference
        }
      }
    });
    return { reference: data.orderReference ?? reference, checkoutLink: data.checkoutLink ?? "" };
  }

  async verifyTransaction(reference: string): Promise<TransactionStatus> {
    const { data } = await this.call<NombaTransaction>(
      `/v1/transactions/accounts/single?orderReference=${encodeURIComponent(reference)}`,
      { method: "GET" }
    );
    return this.toTransactionStatus(data);
  }

  async verifyTransactionById(transactionId: string): Promise<TransactionStatus> {
    const { data } = await this.call<NombaTransaction>(
      `/v1/transactions/accounts/single?transactionRef=${encodeURIComponent(transactionId)}`,
      { method: "GET" }
    );
    return this.toTransactionStatus(data);
  }

  async transferToBank(
    accountNumber: string,
    accountName: string,
    bankCode: string,
    amountKobo: number,
    merchantTxRef: string,
    senderName: string
  ): Promise<TransferResult> {
    const { data } = await this.call<{ status?: string; id?: string }>("/v2/transfers/bank", {
      method: "POST",
      body: {
        amount: this.nairaString(amountKobo),
        accountNumber,
        accountName,
        bankCode,
        merchantTxRef,
        senderName
      }
    });
    return { status: this.toTransferStatus(data.status), reference: merchantTxRef, transferId: data.id };
  }

  async walletTransfer(
    receiverAccountId: string,
    amountKobo: number,
    merchantTxRef: string,
    senderName: string
  ): Promise<TransferResult> {
    const { data } = await this.call<{ status?: string }>("/v2/transfers/wallet", {
      method: "POST",
      body: {
        amount: this.nairaString(amountKobo),
        receiverAccountId,
        merchantTxRef,
        senderName
      }
    });
    return { status: this.toTransferStatus(data.status), reference: merchantTxRef };
  }

  async payElectricity(
    disco: string,
    customerId: string,
    meterType: MeterType,
    amountKobo: number,
    merchantTxRef: string,
    payerName: string
  ): Promise<BillPaymentResult> {
    const { data } = await this.call<{ meta?: { phcnVendToken?: string; phcnVendUnits?: string } }>(
      "/v1/bill/electricity",
      {
        method: "POST",
        body: {
          amount: this.nairaInt(amountKobo),
          disco,
          merchantTxRef,
          payerName,
          customerId,
          meterType
        }
      }
    );
    return { vendToken: data.meta?.phcnVendToken ?? "", units: data.meta?.phcnVendUnits };
  }

  async payCable(
    cableTvType: string,
    customerId: string,
    amountKobo: number,
    merchantTxRef: string,
    payerName: string
  ): Promise<CablePaymentResult> {
    const { data } = await this.call<{ status?: string }>("/v1/bill/cabletv", {
      method: "POST",
      body: {
        cableTvType,
        amount: this.nairaInt(amountKobo),
        merchantTxRef,
        payerName,
        customerId
      }
    });
    return { status: data.status ?? "" };
  }

  async listElectricityDiscos(): Promise<BillerOption[]> {
    const { data } = await this.call<{ id: string; name: string }[]>("/v1/bill/electricity/discos", {
      method: "GET"
    });
    return (data ?? []).map((disco) => ({ code: disco.id, name: disco.name }));
  }

  async lookupElectricityCustomer(disco: string, customerId: string, meterType: MeterType): Promise<BillerCustomer> {
    void meterType;
    const { data } = await this.call<string>(
      `/v1/bill/electricity/lookup?disco=${encodeURIComponent(disco)}&customerId=${encodeURIComponent(customerId)}`,
      { method: "GET" }
    );
    return { customerName: data ?? "" };
  }

  async listCableProducts(cableTvType: string): Promise<BillerOption[]> {
    const { data } = await this.call<{ subScriptionType: string; name: string; amount: number }[]>(
      `/v1/bill/cableTvProduct?cableTvType=${encodeURIComponent(cableTvType)}`,
      { method: "GET" }
    );
    return (data ?? []).map((product) => ({
      code: product.subScriptionType,
      name: product.name,
      amountKobo: Math.round(product.amount * 100)
    }));
  }

  async lookupCableCustomer(cableTvType: string, customerId: string): Promise<BillerCustomer> {
    const { data } = await this.call<string>(
      `/v1/bill/cabletv/lookup?customerId=${encodeURIComponent(customerId)}&cableTvType=${encodeURIComponent(cableTvType)}`,
      { method: "GET" }
    );
    return { customerName: data ?? "" };
  }

  async listBanks(): Promise<{ code: string; name: string }[]> {
    const { data } = await this.call<{ code: string; name: string }[]>("/v1/transfers/banks", { method: "GET" });
    return data ?? [];
  }

  async lookupAccountName(accountNumber: string, bankCode: string): Promise<{ accountName: string }> {
    const { data } = await this.call<{ accountName?: string }>("/v1/transfers/bank/lookup", {
      method: "POST",
      body: { accountNumber, bankCode }
    });
    return { accountName: data.accountName ?? "" };
  }

  async refundTransaction(input: RefundTransactionInput): Promise<RefundResult> {
    const baseUrl = this.config.get<string>("nomba.baseUrl") ?? "";
    const response = await fetch(`${baseUrl}/v1/checkout/refund`, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify({
        transactionId: input.transactionId,
        amount: input.amountKobo === undefined ? undefined : this.nairaString(input.amountKobo),
        accountNumber: input.accountNumber,
        bankCode: input.bankCode
      })
    });
    const body = (await response.json()) as {
      code?: string;
      description?: string;
      data?: { success?: boolean; reference?: string; refundReference?: string };
    };
    if (!response.ok) {
      throw new HttpException(
        `nomba /v1/checkout/refund failed: ${body.description ?? response.status}`,
        HttpStatus.BAD_GATEWAY
      );
    }
    const success = body.code === "00" && body.data?.success === true;
    return { success, nombaRef: body.data?.refundReference ?? body.data?.reference };
  }

  async createVirtualAccount(input: CreateVirtualAccountInput): Promise<VirtualAccountDetails> {
    const { data } = await this.call<NombaVirtualAccount>("/v1/accounts/virtual", {
      method: "POST",
      body: {
        accountRef: input.accountRef,
        accountName: input.accountName,
        bvn: input.bvn
      }
    });
    return this.toVirtualAccountDetails(data);
  }

  async fetchVirtualAccount(identifier: string): Promise<VirtualAccountDetails | null> {
    const baseUrl = this.config.get<string>("nomba.baseUrl") ?? "";
    const path = `/v1/accounts/virtual/${encodeURIComponent(identifier)}`;
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: await this.authHeaders()
    });
    if (response.status === 404) {
      return null;
    }
    const body = (await response.json()) as { code?: string; description?: string; data?: NombaVirtualAccount };
    if (!response.ok || body.code !== "00") {
      throw new HttpException(`nomba ${path} failed: ${body.description ?? response.status}`, HttpStatus.BAD_GATEWAY);
    }
    return this.toVirtualAccountDetails(body.data as NombaVirtualAccount);
  }

  async updateVirtualAccount(identifier: string, input: UpdateVirtualAccountInput): Promise<VirtualAccountDetails> {
    await this.call<{ updated?: boolean }>(`/v1/accounts/virtual/${encodeURIComponent(identifier)}`, {
      method: "PUT",
      body: { accountName: input.accountName }
    });
    const details = await this.fetchVirtualAccount(identifier);
    if (!details) {
      throw new HttpException(
        `nomba /v1/accounts/virtual/${identifier} not found after update`,
        HttpStatus.BAD_GATEWAY
      );
    }
    return details;
  }

  async expireVirtualAccount(identifier: string): Promise<void> {
    await this.call<{ expired?: boolean }>(`/v1/accounts/virtual/${encodeURIComponent(identifier)}`, {
      method: "DELETE"
    });
  }

  async fetchAccountBalance(): Promise<AccountBalance | null> {
    const baseUrl = this.config.get<string>("nomba.baseUrl") ?? "";
    try {
      const response = await fetch(`${baseUrl}/v1/accounts/balance`, {
        method: "GET",
        headers: await this.authHeaders()
      });
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as { code?: string; data?: NombaBalance };
      if (body.code !== "00" || !body.data) {
        return null;
      }
      const availableNaira = body.data.availableBalance ?? body.data.balance;
      if (availableNaira === undefined || availableNaira === null) {
        return null;
      }
      return { availableKobo: Math.round(availableNaira * 100) };
    } catch {
      return null;
    }
  }

  private toVirtualAccountDetails(data: NombaVirtualAccount): VirtualAccountDetails {
    return {
      accountHolderId: data?.accountHolderId ?? "",
      accountRef: data?.accountRef ?? "",
      accountNumber: data?.bankAccountNumber ?? "",
      accountName: data?.bankAccountName ?? "",
      providerBank: data?.bankName ?? "",
      currency: data?.currency ?? "NGN",
      expired: data?.expired ?? false
    };
  }

  private toTransactionStatus(data: NombaTransaction): TransactionStatus {
    return {
      success: data?.status === "SUCCESS",
      reference: data?.orderReference ?? "",
      transactionId: data?.id ?? "",
      amountKobo: Math.round((data?.amount ?? 0) * 100),
      status: data?.status ?? ""
    };
  }

  private toTransferStatus(status: string | undefined): string {
    return status === "SUCCESS" ? "success" : "pending";
  }

  private nairaString(amountKobo: number): string {
    return (amountKobo / 100).toFixed(2);
  }

  private nairaInt(amountKobo: number): number {
    if (amountKobo % 100 !== 0) {
      throw new HttpException(`nomba bill amount must be a whole naira value: ${amountKobo}`, HttpStatus.BAD_REQUEST);
    }
    return amountKobo / 100;
  }

  private async call<T>(path: string, init: { method: string; body?: unknown }): Promise<{ data: T }> {
    const baseUrl = this.config.get<string>("nomba.baseUrl") ?? "";
    const response = await fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: await this.authHeaders(),
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });
    const body = (await response.json()) as { code?: string; description?: string; data?: T };
    if (!response.ok || (body.code !== "00" && response.status !== 201)) {
      throw new HttpException(`nomba ${path} failed: ${body.description ?? response.status}`, HttpStatus.BAD_GATEWAY);
    }
    return { data: body.data as T };
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await this.accessToken()}`,
      accountId: this.config.get<string>("nomba.accountId") ?? ""
    };
  }

  private async accessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - SKEW_MS) {
      return this.cachedToken.accessToken;
    }
    if (!this.inFlight) {
      this.inFlight = this.issueToken().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async issueToken(): Promise<string> {
    const baseUrl = this.config.get<string>("nomba.baseUrl") ?? "";
    const accountId = this.config.get<string>("nomba.accountId") ?? "";
    const response = await fetch(`${baseUrl}/v1/auth/token/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", accountId },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.config.get<string>("nomba.clientId") ?? "",
        client_secret: this.config.get<string>("nomba.clientSecret") ?? ""
      })
    });
    const body = (await response.json()) as {
      code?: string;
      description?: string;
      data?: { access_token?: string; expiresAt?: string };
    };
    if (!response.ok || body.code !== "00" || !body.data?.access_token) {
      throw new HttpException(
        `nomba token issue failed: ${body.description ?? response.status}`,
        HttpStatus.BAD_GATEWAY
      );
    }
    const parsedExpiry = Date.parse(body.data.expiresAt ?? "");
    this.cachedToken = {
      accessToken: body.data.access_token,
      expiresAt: Number.isNaN(parsedExpiry) ? Date.now() + DEFAULT_TOKEN_LIFETIME_MS : parsedExpiry
    };
    return this.cachedToken.accessToken;
  }
}

interface NombaTransaction {
  id?: string;
  orderReference?: string;
  amount?: number;
  status?: string;
}

interface NombaVirtualAccount {
  accountHolderId?: string;
  accountRef?: string;
  accountName?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  currency?: string;
  expired?: boolean;
}

interface NombaBalance {
  availableBalance?: number;
  balance?: number;
}
