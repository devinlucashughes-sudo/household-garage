import { unstable_rethrow } from "next/navigation";
import type { MaintenanceFormState } from "./maintenance-input";

/** Keep controlled answers and retry metadata when a server response is interrupted. */
export async function maintenanceAttempt(operation: () => Promise<MaintenanceFormState>): Promise<MaintenanceFormState> {
  try { return await operation(); }
  catch (error) {
    unstable_rethrow(error);
    return { message: "The response was interrupted. Your entries are still here. Try again using this form; repeated saves will not create another schedule." };
  }
}
