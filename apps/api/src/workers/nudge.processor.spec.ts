import { Job } from "bullmq";
import { ConfigService } from "@nestjs/config";
import { NudgesService } from "../modules/nudges/nudges.service";
import { NudgeProcessor } from "./nudge.processor";

function build() {
  const nudges = {
    sweepCreatedDelay: jest.fn(async () => 3),
    sweepDeadlineWindow: jest.fn(async () => 5),
  } as unknown as NudgesService;
  const config = new ConfigService({
    nudges: {
      createdDelayMs: 86_400_000,
      deadlineWindowMs: 86_400_000,
    },
  });
  const processor = new NudgeProcessor(nudges, config);
  return { processor, nudges };
}

describe("NudgeProcessor", () => {
  it("dispatches created-delay jobs to sweepCreatedDelay", async () => {
    const { processor, nudges } = build();

    await processor.process({ data: { kind: "created-delay" } } as Job<{ kind: "created-delay" | "deadline-window" }>);

    expect(nudges.sweepCreatedDelay).toHaveBeenCalledWith(86_400_000);
    expect(nudges.sweepDeadlineWindow).not.toHaveBeenCalled();
  });

  it("dispatches deadline-window jobs to sweepDeadlineWindow", async () => {
    const { processor, nudges } = build();

    await processor.process({ data: { kind: "deadline-window" } } as Job<{ kind: "created-delay" | "deadline-window" }>);

    expect(nudges.sweepDeadlineWindow).toHaveBeenCalledWith(86_400_000);
    expect(nudges.sweepCreatedDelay).not.toHaveBeenCalled();
  });
});