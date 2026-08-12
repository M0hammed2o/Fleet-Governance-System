import type { ConnectivityState } from "@genbridge/api-client";

export class MutableConnectivity implements ConnectivityState {
  constructor(private online = true) {}
  isOnline() {
    return this.online;
  }
  update(online: boolean) {
    this.online = online;
  }
}
