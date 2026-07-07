export class TrackerDeviceConnectedEvent {
  constructor(
    public readonly imei: string,
    public readonly remoteAddress: string | undefined,
    public readonly remotePort: number | undefined,
    public readonly connectedAt: Date = new Date(),
  ) {}
}

export class TrackerDeviceDisconnectedEvent {
  constructor(
    public readonly imei: string,
    public readonly remoteAddress: string | undefined,
    public readonly remotePort: number | undefined,
    public readonly disconnectedAt: Date = new Date(),
  ) {}
}
