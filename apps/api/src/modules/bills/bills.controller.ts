import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  billerCustomerSchema,
  billerOptionListSchema,
  cableLookupQuerySchema,
  cableProductsQuerySchema,
  electricityLookupQuerySchema,
  type BillerCustomer,
  type BillerOption,
  type CableProductsQuery
} from "@paadi/contracts";
import { BillerCategory } from "@paadi/domain";
import { Scopes } from "../../common/decorators/scopes.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ApiZodResponse } from "../../common/swagger/zod-api";
import { BillerRegistry } from "../../integrations/nomba/biller.registry";

@ApiTags("bills")
@ApiBearerAuth()
@Scopes("bills:read")
@Controller("bills")
export class BillsController {
  constructor(private readonly registry: BillerRegistry) {}

  @Get(":category/providers")
  @ApiZodResponse(200, billerOptionListSchema)
  listProviders(@Param("category") category: BillerCategory): Promise<BillerOption[]> {
    return this.registry.get(category).listProviders();
  }

  @Get(":category/plans")
  @ApiZodResponse(200, billerOptionListSchema)
  listPlans(
    @Param("category") category: BillerCategory,
    @Query(new ZodValidationPipe(cableProductsQuerySchema)) query: CableProductsQuery
  ): Promise<BillerOption[]> {
    const adapter = this.registry.get(category);
    return adapter.listPlans ? adapter.listPlans(query.cableTvType) : Promise.resolve([]);
  }

  @Get(":category/lookup")
  @ApiZodResponse(200, billerCustomerSchema)
  lookup(@Param("category") category: BillerCategory, @Query() query: unknown): Promise<BillerCustomer> {
    const adapter = this.registry.get(category);
    if (category === "electricity") {
      const q = new ZodValidationPipe(electricityLookupQuerySchema).transform(query);
      return adapter.lookupCustomer(q.disco, q.customerId, { meterType: q.meterType });
    }
    const q = new ZodValidationPipe(cableLookupQuerySchema).transform(query);
    return adapter.lookupCustomer(q.cableTvType, q.customerId);
  }
}
