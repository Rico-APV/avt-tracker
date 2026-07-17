export class StarlinkDeviceConnectedEvent {
  constructor(
    public readonly deviceId: string,
    public readonly remoteAddress: string | undefined,
    public readonly remotePort: number | undefined,
    public readonly connectedAt: Date = new Date(),
  ) {}
}

export class StarlinkDeviceDisconnectedEvent {
  constructor(
    public readonly deviceId: string,
    public readonly remoteAddress: string | undefined,
    public readonly remotePort: number | undefined,
    public readonly disconnectedAt: Date = new Date(),
  ) {}
}
