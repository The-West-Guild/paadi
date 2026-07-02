import { Processor, WorkerHost } from "@nestjs/bullmq";
import { ForbiddenException, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { VirtualAccountService } from "../modules/virtual-accounts/virtual-account.service";
import { QUEUES } from "../queue/queue.constants";
import { VaProvisioningJob } from "../queue/jobs/job.types";

@Processor(QUEUES.vaProvisioning)
export class VirtualAccountProvisioningProcessor extends WorkerHost {
  private readonly logger = new Logger(VirtualAccountProvisioningProcessor.name);

  constructor(private readonly virtualAccounts: VirtualAccountService) {
    super();
  }

  async process(job: Job<VaProvisioningJob>): Promise<void> {
    const { kind, userId } = job.data;
    if (kind === "provision") {
      await this.provision(userId);
      return;
    }
    await this.rename(userId);
  }

  private async provision(userId: string): Promise<void> {
    try {
      const outcome = await this.virtualAccounts.provisionVirtualAccount(userId);
      if (outcome.created) {
        this.logger.log(`provisioned virtual account for user ${userId}`);
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        this.logger.warn(`skipping virtual account provisioning for ineligible user ${userId}`);
        return;
      }
      throw error;
    }
  }

  private async rename(userId: string): Promise<void> {
    const renamed = await this.virtualAccounts.renameFromIdentity(userId);
    if (renamed) {
      this.logger.log(`reconciled virtual account holder name for user ${userId}`);
    }
  }
}
