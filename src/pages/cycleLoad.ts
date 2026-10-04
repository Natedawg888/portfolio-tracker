/**
 * A cycle request stays current only until a newer load starts.
 * A late response must not replace the selected country or clear loading.
 */
export type CycleLoadTicket = {
  requestId: number;
  country: string;
};

export function nextCycleLoad(currentRequestId: number, country: string): CycleLoadTicket {
  return { requestId: currentRequestId + 1, country };
}

export function isCurrentCycleRequest(ticket: CycleLoadTicket, currentRequestId: number): boolean {
  return ticket.requestId === currentRequestId;
}

export function shouldApplyCyclePayload(
  ticket: CycleLoadTicket,
  currentRequestId: number,
  payloadCountry: string,
): boolean {
  return isCurrentCycleRequest(ticket, currentRequestId) && payloadCountry === ticket.country;
}
