import { activityTools } from "./activity";
import { billTools } from "./bills";
import { payTools } from "./pay";
import { potTools } from "./pots";
import { profileTools } from "./profile";
import { receiptTools } from "./receipts";
import type { ToolDef } from "./types";
import { walletTools } from "./wallet";

/** The full Paadi tool catalog. The server gates this by scope and PIN config. */
export const allTools: ToolDef[] = [
  ...potTools,
  ...walletTools,
  ...billTools,
  ...activityTools,
  ...profileTools,
  ...receiptTools,
  ...payTools,
];
