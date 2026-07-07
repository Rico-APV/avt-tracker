import { Injectable } from '@nestjs/common';
import type { Socket } from 'net';

export interface TrackerConnectionInfo {
  imei: string;
  remoteAddress?: string;
  remotePort?: number;
  connectedAt: Date;
  lastActivityAt: Date;
}

/**
 * In-memory registry mapping IMEI -> live TCP socket + metadata.
 *
 * Kept separate from `TrackerTcpServer` so anything that needs to know
 * "is this device online right now" (the HTTP monitoring endpoints today,
 * a future outbound-command feature tomorrow) doesn't need to depend on
 * the socket-handling internals directly.
 */
@Injectable()
export class TrackerConnectionRegistryService {
  private readonly sockets = new Map<string, Socket>();
  private readonly info = new Map<string, TrackerConnectionInfo>();

  register(
    imei: string,
    socket: Socket,
    remoteAddress: string | undefined,
    remotePort: number | undefined,
  ): void {
    this.sockets.set(imei, socket);
    const existing = this.info.get(imei);
    const now = new Date();
    this.info.set(imei, {
      imei,
      remoteAddress,
      remotePort,
      connectedAt: existing?.connectedAt ?? now,
      lastActivityAt: now,
    });
  }

  touch(imei: string): void {
    const existing = this.info.get(imei);
    if (existing) {
      existing.lastActivityAt = new Date();
    }
  }

  unregister(imei: string): void {
    this.sockets.delete(imei);
    this.info.delete(imei);
  }

  isConnected(imei: string): boolean {
    return this.sockets.has(imei);
  }

  getSocket(imei: string): Socket | undefined {
    return this.sockets.get(imei);
  }

  getConnectionInfo(imei: string): TrackerConnectionInfo | undefined {
    return this.info.get(imei);
  }

  getConnectedImeis(): string[] {
    return [...this.sockets.keys()];
  }

  getAllConnectionInfo(): TrackerConnectionInfo[] {
    return [...this.info.values()];
  }

  get connectedCount(): number {
    return this.sockets.size;
  }
}
