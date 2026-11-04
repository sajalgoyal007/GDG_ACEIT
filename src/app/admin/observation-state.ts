export interface ProgressObservationActionState {
  status: "idle" | "success" | "error";
  message: string;
}

export const initialProgressObservationActionState: ProgressObservationActionState = { status: "idle", message: "" };
