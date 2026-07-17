import { Injectable } from '@nestjs/common';
import type { Socket } from 'net';

export interface StarlinkConnectionInfo {
  deviceId: string;
  remoteAddress?: string;
  remotePort?: number;
  connectedAt: Date;
  lastActivityAt: Date;
}

/**
 * In-memory registry mapping StarLink deviceId -> live TCP socket +
 * metadata. Mirrors `TrackerConnectionRegistryService` - kept separate
 * from `StarlinkTcpServer` so anything that needs "is this device online
 * right now" doesn't need to depend on the socket-handling internals.
 */
@Injectable()
export class StarlinkConnectionRegistryService {
  private readonly sockets = new Map<string, Socket>();
  private readonly info = new Map<string, StarlinkConnectionInfo>();

  register(
    deviceId: string,
    socket: Socket,
    remoteAddress: string | undefined,
    remotePort: number | undefined,
  ): void {
    this.sockets.set(deviceId, socket);
    const existing = this.info.get(deviceId);
    const now = new Date();
    this.info.set(deviceId, {
      deviceId,
      remoteAddress,
      remotePort,
      connectedAt: existing?.connectedAt ?? now,
      lastActivityAt: now,
    });
  }

  touch(deviceId: string): void {
    const existing = this.info.get(deviceId);
    if (existing) {
      existing.lastActivityAt = new Date();
    }
  }

  unregister(deviceId: string): void {
    this.sockets.delete(deviceId);
    this.info.delete(deviceId);
  }

  isConnected(deviceId: string): boolean {
    return this.sockets.has(deviceId);
  }

  getSocket(deviceId: string): Socket | undefined {
    return this.sockets.get(deviceId);
  }

  getConnectionInfo(deviceId: string): StarlinkConnectionInfo | undefined {
    return this.info.get(deviceId);
  }

  getConnectedDeviceIds(): string[] {
    return [...this.sockets.keys()];
  }

  getAllConnectionInfo(): StarlinkConnectionInfo[] {
    return [...this.info.values()];
  }

  get connectedCount(): number {
    return this.sockets.size;
  }
}
