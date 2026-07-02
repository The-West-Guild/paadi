import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  ExceptionResolutionAction,
  type ExceptionDto,
  type ExceptionResolutionAction as ExceptionResolutionActionType,
  type ListExceptionsQuery,
  type ListExceptionsResponse,
  type ResolveExceptionInput
} from "@paadi/contracts";
import { PaymentProviderPort, TransferResult } from "@paadi/domain";
import { ReconciliationException } from "@paadi/db";
import { ReconciliationRepository, RefundResolution } from "../../infra/persistence/reconciliation.repository";
import { toExceptionDto } from "../../infra/persistence/mappers/reconciliation.mapper";

const REFUND_NARRATION = "Paadi Refund";
const PENDING_PROVIDER_STATUSES = new Set(["success", "pending", "pending_billing"]);

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly reconciliation: ReconciliationRepository,
    @Inject(PaymentProviderPort) private readonly provider: PaymentProviderPort
  ) {}

  async listExceptions(query: ListExceptionsQuery): Promise<ListExceptionsResponse> {
    const [page, totals] = await Promise.all([
      this.reconciliation.list({
        status: query.status,
        reason: query.reason,
        cursor: query.cursor,
        limit: query.limit
      }),
      this.reconciliation.totals()
    ]);
    return {
      items: page.items.map(toExceptionDto),
      nextCursor: page.nextCursor,
      totals
    };
  }

  async resolve(
    exceptionId: string,
    action: ExceptionResolutionActionType,
    resolvedBy: string,
    body: ResolveExceptionInput
  ): Promise<ExceptionDto> {
    const exception = await this.reconciliation.findById(exceptionId);
    if (!exception) {
      throw new NotFoundException("exception not found");
    }
    if (action === ExceptionResolutionAction.Assign) {
      return this.resolveAssign(exceptionId, resolvedBy, body);
    }
    if (action === ExceptionResolutionAction.Refund) {
      return this.resolveRefund(exception, resolvedBy, body);
    }
    return this.resolveHold(exceptionId, resolvedBy, body);
  }

  private async resolveAssign(
    exceptionId: string,
    resolvedBy: string,
    body: ResolveExceptionInput
  ): Promise<ExceptionDto> {
    if (!body.userId) {
      throw new BadRequestException("userId required to assign");
    }
    const resolved = await this.reconciliation.assign(exceptionId, {
      userId: body.userId,
      resolvedBy,
      note: body.note
    });
    return toExceptionDto(resolved);
  }

  private async resolveRefund(
    exception: ReconciliationException,
    resolvedBy: string,
    body: ResolveExceptionInput
  ): Promise<ExceptionDto> {
    if (!exception.senderAccount) {
      throw new ConflictException("exception not refundable: missing sender bank details");
    }
    const bankCode = await this.resolveBankCode(exception, body.bankCode);
    const resolution = await this.reconciliation.refund(exception.id, {
      senderAccount: exception.senderAccount,
      bankCode,
      senderName: exception.senderName ?? "",
      resolvedBy,
      note: body.note
    });
    return toExceptionDto(await this.executeRefundTransfer(resolution));
  }

  private async resolveHold(
    exceptionId: string,
    resolvedBy: string,
    body: ResolveExceptionInput
  ): Promise<ExceptionDto> {
    const resolved = await this.reconciliation.hold(exceptionId, {
      resolvedBy,
      matchedUserId: body.userId,
      note: body.note
    });
    return toExceptionDto(resolved);
  }

  private async resolveBankCode(
    exception: ReconciliationException,
    explicitBankCode?: string
  ): Promise<string> {
    if (explicitBankCode) {
      return explicitBankCode;
    }
    if (exception.senderBankCode) {
      return exception.senderBankCode;
    }
    const mapped = await this.mapBankNameToCode(exception.senderBank);
    if (!mapped) {
      throw new ConflictException("exception not refundable: missing sender bank details");
    }
    return mapped;
  }

  private async mapBankNameToCode(senderBank: string | null): Promise<string | null> {
    if (!senderBank) {
      return null;
    }
    const target = this.normalizeBankName(senderBank);
    const banks = await this.provider.listBanks();
    const match = banks.find((bank) => this.normalizeBankName(bank.name) === target);
    return match?.code ?? null;
  }

  private normalizeBankName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
  }

  private async executeRefundTransfer(resolution: RefundResolution): Promise<ReconciliationException> {
    let result: TransferResult;
    try {
      result = await this.provider.transferToBank(
        resolution.senderAccount,
        resolution.senderName,
        resolution.bankCode,
        resolution.amountKobo,
        resolution.merchantTxRef,
        REFUND_NARRATION
      );
    } catch (error) {
      this.logger.error(
        `refund transfer failed for exception ${resolution.exception.id}: ${String(error)}`
      );
      return this.reconciliation.reopenAfterFailedRefund(resolution.exception.id);
    }
    if (!PENDING_PROVIDER_STATUSES.has(result.status.toLowerCase())) {
      this.logger.error(
        `refund transfer for exception ${resolution.exception.id} returned non-pending status ${result.status}`
      );
      return this.reconciliation.reopenAfterFailedRefund(resolution.exception.id);
    }
    return this.reconciliation.recordRefundOutcome(resolution.exception.id, {
      refundStatus: resolution.exception.refundStatus ?? "PENDING",
      refundNombaRef: result.reference
    });
  }
}
