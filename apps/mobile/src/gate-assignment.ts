let selectedGateId: string | null = null;
export function setSelectedGateId(value: string): void {
  selectedGateId = value || null;
}
export function getSelectedGateId(): string {
  return selectedGateId ?? "";
}
export function clearSelectedGateId(): void {
  selectedGateId = null;
}
