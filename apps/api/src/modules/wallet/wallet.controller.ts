import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  payFromWalletBodySchema,
  potDetailSchema,
  statementQuerySchema,
  walletBalanceResponseSchema,
  walletStatementResponseSchema,
  withdrawalParamsSchema,
  withdrawalViewSchema,
  withdrawSchema,
  type PayFromWalletInput,
  type PotDetail,
  type StatementQuery,
  type WalletBalanceResponse,
  type WalletStatementResponse,
  type WithdrawalParams,
  type WithdrawalView,
  type WithdrawInput
} from "@paadi/contracts";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Scopes } from "../../common/decorators/scopes.decorator";
import { Audited } from "../../infra/audit/audited.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ApiZod, ApiZodResponse } from "../../common/swagger/zod-api";
import type { AccessClaims } from "../../infra/auth/token.service";
import { WalletSpendService } from "./wallet-spend.service";
import { WalletStatementService } from "./wallet-statement.service";
import { WithdrawService } from "./withdrawal.service";

@ApiTags("wallet")
@ApiBearerAuth()
@Controller()
export class WalletController {
  constructor(
    private readonly statement: WalletStatementService,
    private readonly spend: WalletSpendService,
    private readonly withdrawals: WithdrawService
  ) {}

  @Get("me/wallet")
  @Scopes("wallet:read")
  @ApiOperation({
    summary: "Get wallet balance",
    description: "Returns the caller's reconciled wallet balance in kobo, derived from the double-entry ledger."
  })
  @ApiZodResponse(200, walletBalanceResponseSchema)
  balance(@CurrentUser() claims: AccessClaims): Promise<WalletBalanceResponse> {
    return this.statement.getBalance(claims.sub);
  }

  @Get("me/wallet/transactions")
  @Scopes("wallet:read")
  @ApiTags("statements")
  @ApiOperation({
    summary: "List wallet transactions",
    description: "Returns the caller's ledger-derived wallet transactions for the requested window."
  })
  @ApiZodResponse(200, walletStatementResponseSchema)
  transactions(
    @CurrentUser() claims: AccessClaims,
    @Query(new ZodValidationPipe(statementQuerySchema)) query: StatementQuery
  ): Promise<WalletStatementResponse> {
    return this.statement.getStatement(claims.sub, query);
  }

  @Get("me/statement")
  @Scopes("wallet:read")
  @ApiTags("statements")
  @ApiOperation({
    summary: "Get customer statement",
    description: "Returns the ledger-derived statement for the caller over the requested date range."
  })
  @ApiZodResponse(200, walletStatementResponseSchema)
  statementAlias(
    @CurrentUser() claims: AccessClaims,
    @Query(new ZodValidationPipe(statementQuerySchema)) query: StatementQuery
  ): Promise<WalletStatementResponse> {
    return this.statement.getStatement(claims.sub, query);
  }

  @Post("me/wallet/pay")
  @Scopes("wallet:pay")
  @Audited("wallet.pay")
  @ApiOperation({
    summary: "Pay a split from wallet",
    description: "Settles a pot split directly from the wallet balance. Requires an idempotency-key header and the caller's PIN."
  })
  @ApiZod({ body: payFromWalletBodySchema, response: potDetailSchema, status: 200 })
  async pay(
    @CurrentUser() claims: AccessClaims,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(payFromWalletBodySchema)) body: PayFromWalletInput
  ): Promise<PotDetail> {
    if (!idempotencyKey) {
      throw new BadRequestException("idempotency-key header required");
    }
    const result = await this.spend.payFromWallet({
      userId: claims.sub,
      potId: body.potId,
      splitId: body.splitId,
      amountKobo: body.amountKobo,
      pin: body.pin,
      idempotencyKey
    });
    return result.pot;
  }

  @Post("me/wallet/withdraw")
  @Scopes("wallet:withdraw")
  @Audited("wallet.withdraw")
  @ApiOperation({
    summary: "Withdraw from wallet",
    description: "Moves value out of the wallet to a bank account. Requires an idempotency-key header; subject to KYC tier limits."
  })
  @ApiZod({ body: withdrawSchema, response: withdrawalViewSchema, status: 200 })
  withdraw(
    @CurrentUser() claims: AccessClaims,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(withdrawSchema)) body: WithdrawInput
  ): Promise<WithdrawalView> {
    if (!idempotencyKey) {
      throw new BadRequestException("idempotency-key header required");
    }
    return this.withdrawals.withdraw(claims.sub, body, idempotencyKey);
  }

  @Get("me/wallet/withdrawals/:id")
  @Scopes("wallet:read")
  @ApiOperation({
    summary: "Get withdrawal",
    description: "Returns the status and detail of a single withdrawal the caller initiated."
  })
  @ApiZodResponse(200, withdrawalViewSchema)
  getWithdrawal(
    @CurrentUser() claims: AccessClaims,
    @Param(new ZodValidationPipe(withdrawalParamsSchema)) params: WithdrawalParams
  ): Promise<WithdrawalView> {
    return this.withdrawals.getWithdrawal(claims.sub, params.id);
  }
}
